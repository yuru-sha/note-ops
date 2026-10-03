# Open note editor

A user obtains the canonical note.com editor URL for a note using its key or an owned numeric ID.

## Sub-features

- key: build the editor URL directly from a note key.
- numeric ID: resolve a key through the authenticated user's note list before URL construction.

## How to get to it (user POV)

- Call `open-note-editor` in the configured MCP client with a note key or ID.

## Driving it with the configured MCP client

Preconditions:

- An MCP client is connected to this build.
- `NOTE_USER_ID` is required for both paths. For numeric IDs, also configure authentication and use a note owned by that user. A supplied key does not trigger a note-list fetch or require note.com API credentials.

- Key URL: call `open-note-editor` with `{ "noteId": "<note-key>" }`. Observe `https://editor.note.com/notes/<encoded-key>/edit/`.
- Numeric ID URL: call `open-note-editor` with `{ "noteId": "<owned-numeric-id>" }`. Observe the same canonical URL shape after authenticated key resolution.

## Gotchas

- Numeric IDs must resolve through the configured user's list; unresolved IDs fail closed.
- URL path components are encoded. Do not infer ownership from a URL built from a supplied key.
- This tool returns a URL; it does not launch browser automation, which is out of scope.
