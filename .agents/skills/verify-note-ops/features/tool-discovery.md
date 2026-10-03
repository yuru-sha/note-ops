# MCP tool discovery

An MCP client initializes note-ops over local stdio and learns the available operations and descriptions.

## Sub-features

- handshake: negotiate MCP protocol and identify the server.
- tools: enumerate exactly six default tools.

## How to get to it (user POV)

- Configure an MCP client to launch this checkout's `build/index.js` with `node`.
- The verification driver performs this path independently without note.com credentials.

## Driving it with the stdio MCP verification driver

Preconditions:

- Build output exists; run `npm run build` from the repository root.

- Initialize and list: run `node .agents/skills/verify-note-ops/verify.mjs`. Observe `PASS: note-ops 0.1.0; 6 tools discovered` and the evidence path. The JSON artifact at `artifacts/verify-note-ops/<RUN_ID>/mcp-tool-discovery.json` records the initialize/list action, server identity, protocol version, tool names/descriptions, stderr, and clean exit code.
- Confirm surface: verify the artifact contains `get-my-notes`, `get-note`, `post-draft-note`, `edit-note`, `set-note-eyecatch`, and `open-note-editor`, with no additional default tool.

## Gotchas

- This proves only local MCP startup and registration, not note.com authentication or API health.
- The driver deliberately strips `NOTE_*` variables and never calls a note.com tool.
- Do not leave a separate server process running and mistake it for the child's proof.
