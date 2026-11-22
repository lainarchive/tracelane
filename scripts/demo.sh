#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cargo build --manifest-path "$repo/Cargo.toml" --release --examples --bin tracelane
bin="$repo/target/release"
port="${MOCK_LLM_PORT:-9900}"
workspace="$(mktemp -d "${TMPDIR:-/tmp}/tracelane-demo.XXXXXX")"
cd "$workspace"
printf '[package]\nname = "demo_workspace"\nversion = "0.1.0"\nedition = "2024"\n' > Cargo.toml
mkdir src
printf 'pub fn greeting(name: &str) -> String {\n    format!("Hi, {name}")\n}\n' > src/lib.rs
"$bin/examples/mock_llm" "$port" &
mock_pid=$!
trap 'kill "$mock_pid" 2>/dev/null || true; wait "$mock_pid" 2>/dev/null || true' EXIT
ready=false
for ((attempt=0; attempt<100; attempt++)); do
    kill -0 "$mock_pid" 2>/dev/null || { wait "$mock_pid"; exit 1; }
    if curl --silent --fail "http://127.0.0.1:$port/health" >/dev/null; then ready=true; break; fi
    sleep 0.05
done
if [[ "$ready" != true ]]; then printf 'mock_llm did not become ready\n' >&2; exit 1; fi
printf '\nRecording three requests\n'
mkdir -p .tracelane
printf -v record_command '%q ' "$bin/tracelane" record --target "http://127.0.0.1:$port" -- "$bin/examples/mock_agent"
script -q -e -c "$record_command" /dev/null </dev/null | tee .tracelane/record.log
run_id="$(sed -nE 's/.*  run ([0-9a-f]{12})  proxy .*/\1/p' .tracelane/record.log)"
[[ "$run_id" =~ ^[0-9a-f]{12}$ ]] || { printf 'Could not read run id\n' >&2; exit 1; }
printf '\nInspecting %s\n' "$run_id"
"$bin/tracelane" inspect "$run_id"
"$bin/tracelane" inspect "$run_id" --step 2
printf '\nReplaying from step 2: only steps 2 and 3 should reach mock_llm\n'
"$bin/tracelane" replay "$run_id" --from-step 2 --target "http://127.0.0.1:$port" -- "$bin/examples/mock_agent"
printf '\nWorkspace: %s\ncd %q && %q ui\n' "$workspace" "$workspace" "$bin/tracelane"
