# Set draft eyecatch

A user selects a local image and sets it as the title image for their own note.com draft.

## Sub-features

- formats: PNG, JPEG, GIF, and WebP local files.
- preflight: verify format, signature, actual 1280x670 dimensions, and size no greater than 10 MB.
- ownership: update only the authenticated user's draft using XSRF protection.

## How to get to it (user POV)

- Call `set-note-eyecatch` in the configured MCP client with the owned draft and image path.

## Driving it with the configured MCP client

Preconditions:

- Authenticated MCP client with matching `NOTE_USER_ID`, an owned draft, an XSRF token, and an explicitly approved local test image meeting the documented constraints.
- The image must not contain private content. The operation writes draft metadata on note.com.

- Set image: call `set-note-eyecatch` with `{ "noteId": "<owned-draft-key-or-id>", "imagePath": "<approved-local-image>" }`. Observe the returned eyecatch URL and `noteId`.
- Read back: call `get-note` for the same draft and confirm its eyecatch matches the returned URL and the note remains a draft.

## Gotchas

- Do not use a published article or a note whose ownership cannot be verified.
- Invalid images must fail before network upload; do not bypass validation.
- Live eyecatch verification is opt-in and credential-gated as described in `README.md`.
