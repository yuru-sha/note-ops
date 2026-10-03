---
name: verify-note-ops
description: "Verify note-ops, a local stdio MCP server, by driving its real MCP handshake and tool discovery; use after server or tool-surface changes."
---

# Verify note-ops

Read `features/README.md` and the applicable feature file before driving. This repository's primary user surface is the local MCP stdio server; there is no web UI or CLI. The six default tools and their safety boundary are defined by `SPEC.md`.

## Launch

From the repository root, run:

```bash
npm run build && node .agents/skills/verify-note-ops/verify.mjs
```

The helper launches `node build/index.js` as its own child process, performs MCP `initialize` and `tools/list` over stdio, and exits that process after the response. Readiness is the successful protocol handshake and `PASS` output naming `note-ops` and six tools. Each run gets a distinct child; do not drive a separately running server. The helper removes inherited `NOTE_*` variables from the child environment, but the app can reload credentials from the repository's `.env`; this verification stays offline because it sends only `initialize` and `tools/list` and never calls an authenticated tool.

## Doctor

Run the launch command above as the read-only doctor. It checks that TypeScript builds, the child process starts, the MCP handshake identifies the expected server, and the exact six-tool surface is registered. A failed build, timeout, unexpected server identity, tool mismatch, or nonzero process exit means the instance is not worth driving. It does not validate note.com credentials or live API health.

## Drive

For an offline real-server proof, run the Launch command and inspect its output and JSON artifact. It sends actual MCP JSON-RPC messages to the built server through the stdio transport; it does not mock handlers or call internal setters.

For authenticated features, use an already configured MCP client connected to this checkout's `build/index.js`; call the matching tool with the arguments in the feature map. Do not print or capture cookies, passwords, XSRF tokens, or full credential-bearing environment. Live note.com behavior is not part of the offline proof and must not be claimed without an explicit credential-gated run. Never use verification to publish content or mutate a note not explicitly designated by the user.

## Evidence

The helper records the MCP action, server identity/version, negotiated protocol version, discovered tool names/descriptions, stderr, and exit code in `artifacts/verify-note-ops/<RUN_ID>/mcp-tool-discovery.json`. It reports the artifact path. Preserve artifacts when cleaning up. For authenticated operations, capture the request tool name and non-secret arguments, returned state, and a read-only second view of any mutation; redact credentials and unrelated note content. Exercise the actual MCP path, not tests or handler internals.

## Cleanup

The helper closes stdin and waits for the server child to exit; on failure it kills only the child process it started. No separate server or persistent data directory is created. Keep `artifacts/verify-note-ops/<RUN_ID>/` as proof; cleanup must not remove evidence.

## Helpers

`verify.mjs` is the stdio MCP driver and evidence writer. Invoke it only from the repository root with `node .agents/skills/verify-note-ops/verify.mjs`, after `npm run build`.
