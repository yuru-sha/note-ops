# Save drafts

A user creates a new draft or saves content to an existing article through the note-ops MCP tools; these operations do not publish.

## Sub-features

- create: save a new Markdown or HTML draft and return its note key/editor URL.
- edit: save an existing owned article as a draft.
- conversion: Markdown converts to note.com HTML; existing HTML is preserved.

## How to get to it (user POV)

- Call `post-draft-note` to create a draft.
- Call `edit-note` to save an existing article as a draft.

## Driving it with the configured MCP client

Preconditions:

- Authenticated MCP client with matching `NOTE_USER_ID`, usable session credentials, and XSRF protection for writes.
- Obtain explicit approval for the exact draft content and use a designated test note/draft. Never use this recipe to publish.

- Create draft: call `post-draft-note` with `{ "title": "<approved test title>", "body": "<approved Markdown body>" }`. Observe the returned note ID, actual note key, and editor URL; then read the result with `get-note` and confirm it remains a draft.
- Edit as draft: call `edit-note` with `{ "noteId": "<owned-note-id-or-key>", "title": "<approved test title>", "body": "<approved Markdown body>" }`. Read it back with `get-note` and confirm the saved content remains unpublished.

## Gotchas

- Writes require configured-user identity, target ownership where applicable, and XSRF protection; failures must not be bypassed.
- The opt-in live smoke can create and retain a specifically identifiable draft. Follow `README.md`; it is not part of the offline driver and does not automatically clean up the draft.
- Never capture credentials or publish the verification draft.
