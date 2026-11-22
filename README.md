# Tracelane

Replay failed coding agent runs from any step without starting over.

Most agent logs tell you what the model *said*, not what the repo looked like when step 14 broke. `tracelane` snapshots the working tree and tool I/O at every step boundary so you can inspect the exact state diff and replay from any checkpoint without re-running steps 1–13.

## Quick look

```bash
# Run an agent session under tracelane
$ tracelane record -- npx my-agent "fix flaky auth middleware test"
[step 01] read   src/auth.ts (142 lines)
[step 02] edit   src/auth.ts (+18 -6)       snapshot: sha256:9f3a1c
[step 03] shell  cargo test auth::token     exit 101 (420ms)

# Jump back to step 2, tweak the prompt/tool output, and fork from there
$ tracelane replay 9f3a1c --from-step 2
```

## How it works

- **Step-level filesystem snapshots**: Captures lightweight content-addressed tree diffs between tool calls instead of copying the whole workspace.
- **Append-only trace log**: Tool args, stdout/stderr, exit codes, and model payloads write to a local SQLite WAL file for fast diffing.
- **Deterministic replay**: Rehydrates the workspace to any snapshot hash and stubs prior tool responses so you only pay tokens from the failure point forward.

## Run locally

```bash
git clone https://github.com/your-org/tracelane.git
cd tracelane
cargo run -- --help
```

## Status

Early WIP. Working on the Rust snapshot runner and TypeScript SDK wrapper:

- [x] Minimal HTTP & trace-capture kernel
- [ ] Content-addressed diff store for step rollbacks
- [ ] TypeScript SDK hooks for tool call interception
- [ ] Replay CLI (`tracelane replay <run-id> --from-step <n>`)
