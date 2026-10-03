# List and read notes

A user lists their note.com articles and drafts or reads one article or draft through the MCP client.

## Sub-features

- list: page through all, draft-only, or public-only notes.
- detail: read an article or draft by note ID or key.
- editor lookup: numeric IDs resolve through the authenticated user's list before detail fetch.

## How to get to it (user POV)

- Call `get-my-notes` in the configured MCP client.
- Call `get-note` with a note ID or key in the configured MCP client.

## Driving it with the configured MCP client

Preconditions:

- An MCP client is connected to this build and the user has configured `NOTE_USER_ID` plus an authentication source.
- Verify note.com's current user matches `NOTE_USER_ID`. For detail, use an owned note only.

- List all: call `get-my-notes` with `{ "status": "all", "page": 1, "perPage": 20 }`. Observe page metadata and only the configured user's notes.
- List drafts/public: call `get-my-notes` with `status` set to `draft` and then `public`. Observe the returned status and notes for each filter.
- Read detail: call `get-note` with `{ "noteId": "<owned-note-key-or-id>" }`. Observe the returned note content and metadata; for a numeric ID, verify resolution uses the owned list entry.

## Gotchas

- `npm run test:live` is separate and credential-gated; offline tests do not prove note.com behavior.
- Missing/mismatched identity or unverified ownership must fail closed. Do not treat an error as a successful read.
- Avoid capturing unrelated private note content in evidence.
