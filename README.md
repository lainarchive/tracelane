# Tracelane

Record model HTTP requests alongside workspace snapshots, inspect changes, and fork a run from a recorded step.

Tracelane runs a local proxy for OpenAI- and Anthropic-compatible clients. Each request captures a before/after workspace snapshot and the request and response payloads in SQLite.

## Quick look

```bash
# Run a command with OPENAI_BASE_URL and ANTHROPIC_BASE_URL pointing at the proxy
tracelane record --port 7474 --target https://api.openai.com -- my-command

# Inspect a run or the file diffs and payload summaries for one step
tracelane inspect <run-id>
tracelane inspect <run-id> --step 3

# Restore the workspace to just before step 3
tracelane replay <run-id> --from-step 3

# Restore and fork: requests 1–2 are cached, then requests go upstream
tracelane replay <run-id> --from-step 3 -- my-command
```

## How it works

- The current directory is the workspace. State lives in `.tracelane/traces.db` (SQLite WAL) and `.tracelane/blobs/` (SHA-256 content-addressed file contents).
- Snapshots skip `.git`, `target`, `node_modules`, and `.tracelane` directories. Identical trees share a snapshot. Symlinks and file permissions are not captured.
- Requests are serialized. JSON responses are parsed; SSE responses are buffered and stored verbatim, not streamed to the client.
- Replay restores files, deletes non-ignored files absent from the snapshot, and removes empty directories. **Unrecorded workspace edits can be lost.** Back up anything you need before replaying.
- A fork serves the parent's responses before the chosen step without upstream requests. A request mismatch disables the remaining cache and continues live. Cached JSON is reserialized; SSE bodies retain their exact bytes.
- The upstream defaults to `TRACELANE_UPSTREAM_URL`, then `https://api.openai.com`. Authentication headers are forwarded from the client. Payloads and workspace files may contain sensitive data; keep `.tracelane/` private.

## Run locally

```bash
git clone https://github.com/lainarchive/tracelane.git
cd tracelane
cargo run -- --help
cargo build
cargo test
cargo clippy --all-targets -- -D warnings
```

## Status

Core CLI only. No web interface or SDK is included.
