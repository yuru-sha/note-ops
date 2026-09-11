# note-ops Specification

## Status

MVP `0.1.0`. This document is the contract for the default MCP server.

## Purpose

`note-ops` provides a small local MCP server for managing one note.com user's articles and drafts. It uses note.com's private web APIs, so endpoint behavior may change independently of this repository.

## Default server

- Entry point: `build/index.js`, source `src/index.ts`
- Transport: local MCP stdio
- Tool registration: `src/tools/mvp-tools.ts`
- Content conversion: `src/utils/markdown-converter.ts`
- API and authentication: `src/utils/api-client.ts` and `src/utils/auth.ts`

The default server exposes exactly these tools:

| Tool | Purpose | Mutation |
|---|---|---|
| `get-my-notes` | List the configured user's articles and drafts | No |
| `get-note` | Read an article or draft by ID/key | No |
| `post-draft-note` | Create or save a draft | Draft save |
| `edit-note` | Save an existing article as a draft | Draft save |
| `open-note-editor` | Build the note editor URL | No |

## Tool rules

- `get-my-notes` requires `NOTE_USER_ID` and supports `all`, `draft`, and `public` filters.
- `get-note` accepts a note ID or key and includes draft content when note.com returns it.
- `post-draft-note` accepts Markdown or HTML. Markdown is converted to note.com HTML; already-HTML input is preserved.
- `edit-note` resolves note keys when necessary and always uses the draft-save path.
- `open-note-editor` requires `NOTE_USER_ID` and returns an editor URL.
- Note IDs and keys are URL-encoded before API or URL construction.
- API errors are returned as MCP error responses with actionable, non-secret messages.

## Authentication

The preferred configuration is an existing session:

```env
NOTE_USER_ID=your_note_user_id
NOTE_SESSION_V5=your_session_cookie_value
NOTE_XSRF_TOKEN=your_xsrf_token
```

`NOTE_EMAIL` and `NOTE_PASSWORD` provide the optional direct-login path. Authentication is resolved lazily when an authenticated API call is made. Session cookies, XSRF tokens, passwords, and full response bodies stay out of logs and MCP responses.

## Safety boundary

The MVP writes only drafts. Publication, comments, likes, image uploads, analytics, search, memberships, Notion, Obsidian, HTTP/n8n, and browser automation are outside the default server surface.

## Verification

The local gate is:

```bash
npm test
```

It must build the TypeScript entry point and pass the offline tests for the MVP tool list and Markdown conversion. Live note.com API checks require user-provided credentials and are separate from this gate.

## Change policy

Changes that expand the default tool surface must update this specification and its offline registration check together.
