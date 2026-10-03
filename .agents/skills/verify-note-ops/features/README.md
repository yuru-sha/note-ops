# note-ops verification feature map

Read this index before driving note-ops. Its primary user surface is the local MCP stdio server, consumed through an MCP client. Offline verification proves startup and tool discovery; API operations require configured authentication and note.com availability.

## Baseline

- Build from the repository root with `npm run build`.
- For offline checks, run `node .agents/skills/verify-note-ops/verify.mjs`; it launches and tears down its own stdio server child and writes proof under `artifacts/verify-note-ops/<RUN_ID>/`.
- For note.com operations, use the user's configured MCP client and verified `NOTE_USER_ID` identity. Never include secrets in captured artifacts.
- Writes save drafts or draft eyecatch metadata only; do not publish.

## Features

- [MCP tool discovery](./tool-discovery.md): initialize the stdio server and enumerate the six registered tools.
- [List and read notes](./list-read.md): retrieve the configured user's list and an owned article or draft.
- [Save drafts](./drafts.md): create a draft or save an existing article as a draft.
- [Set draft eyecatch](./eyecatch.md): set a local image on the user's own draft.
- [Open editor](./editor.md): generate an editor URL from a note key or resolve a numeric ID.
