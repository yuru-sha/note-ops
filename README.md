# note-ops

[English](README.md) | [日本語](README.ja.md)

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/yuru-sha/note-ops)

A local stdio MCP server for managing note.com articles and drafts. It currently provides only an MVP focused on drafts.

## Quick Start

```bash
git clone https://github.com/yuru-sha/note-ops.git
cd note-ops
npm ci
cp .env.sample .env
npm run build
npm start
```

To list or read articles, create drafts, or edit drafts, configure `NOTE_USER_ID` and one of the following authentication methods: an existing session (`NOTE_SESSION_V5`; draft operations use `NOTE_XSRF_TOKEN` or the XSRF token from the session response), `NOTE_ALL_COOKIES`, or direct login with `NOTE_EMAIL` and `NOTE_PASSWORD`. Never commit credentials or include them in logs or MCP responses.

For authenticated operations, verify in advance that note.com's `current_user` matches `NOTE_USER_ID`. For `get-note`, `edit-note`, and `set-note-eyecatch`, also verify note ownership. When `get-note` receives a numeric ID, it resolves the note key from the authenticated user's note list before fetching details. For a numeric ID, `open-note-editor` also resolves the note key from the authenticated user's note list and returns `https://editor.note.com/notes/<note-key>/edit/`. If identities do not match, ownership cannot be verified, the note key cannot be resolved, or authentication fails, the operation fails closed and returns an error without secret information. When given a note key directly, `open-note-editor` does not fetch the note list.

## MCP Tools

| Tool | Purpose | Scope |
|---|---|---|
| `get-my-notes` | List my articles and drafts | Read only |
| `get-note` | Read article or draft details | Read only |
| `post-draft-note` | Create or update a draft | Save as draft |
| `edit-note` | Save an existing article as a draft | Save as draft |
| `set-note-eyecatch` | Set a local image as the title image for my draft | Update draft metadata |
| `open-note-editor` | Generate an editor URL | Read only |

Publishing, commenting, liking, uploading body images, searching, Notion, Obsidian, HTTP/n8n, and browser automation are outside the MVP. Publish from note.com. A title image can only be set on your authenticated draft, using a local PNG/JPEG/GIF/WebP file with actual dimensions of 1280x670 pixels and a size of 10 MB or less. Published articles are not supported. `post-draft-note` returns the actual note key from note.com's create response or the authenticated draft list.

## MCP Client Configuration Example

```json
{
  "mcpServers": {
    "note-ops": {
      "command": "node",
      "args": ["/path/to/note-ops/build/index.js"]
    }
  }
}
```

## Development

```bash
npm run build
npm test
```

### Authenticated Live Smoke Test (Optional)

`npm test` does not use credentials. To check the current note.com API, configure the following environment variables and run the separate command below.

- `NOTE_LIVE_TESTS=true` (required explicit opt-in)
- `NOTE_USER_ID` (required)
- `NOTE_LIVE_NOTE_ID` (ID or key of an existing article or draft for the detail read)
- `NOTE_SESSION_V5`, `NOTE_ALL_COOKIES`, or `NOTE_EMAIL` and `NOTE_PASSWORD` (read smoke can run with `NOTE_SESSION_V5` alone)

```bash
npm run test:live
```

The read smoke verifies that `current_user` matches and that the article details belong to the configured user. Set `NOTE_LIVE_DRAFT_TESTS=true` only when checking draft creation and editing. To also check setting and reading back a draft title image, set `NOTE_LIVE_EYECATCH_TESTS=true`. When using `NOTE_ALL_COOKIES` with `NOTE_LIVE_DRAFT_TESTS=true` for live draft smoke, also set `NOTE_XSRF_TOKEN` for the preflight check. The test creates a draft with a title containing the execution time in the form `[note-ops live smoke ...]`, reads its details using the returned note key, verifies it remains unpublished by fetching the authenticated draft list after editing, and leaves it in place. The eyecatch smoke uses a test image from the repository and verifies the result through the note details and draft list. Drafts are not deleted automatically; if cleanup is needed, explicitly target only the draft created by that run. Live smoke does not print credentials or full response bodies. On failure, it prints only the operation name and redacted checks.

See [SPEC.md](SPEC.md) for details. Changes to note.com's private API may cause this server to stop working.

## GitHub Release

See [docs/agents/release.md](docs/agents/release.md) for the release note format and creation procedure. The shared body template is [.github/release-notes-template.md](.github/release-notes-template.md), and the generated-note categories are managed in [.github/release.yml](.github/release.yml).
