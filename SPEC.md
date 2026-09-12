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

Authenticated operations require `NOTE_USER_ID` and an authentication source: `NOTE_SESSION_V5`, `NOTE_ALL_COOKIES`, or `NOTE_EMAIL` plus `NOTE_PASSWORD`. Draft write requests include an XSRF token from `NOTE_XSRF_TOKEN` or the authenticated session response when available. The note.com API may reject a draft write without it. When `NOTE_ALL_COOKIES` and `NOTE_LIVE_DRAFT_TESTS=true` are used, the live draft smoke preflight requires `NOTE_XSRF_TOKEN`. `open-note-editor` only builds a URL and requires `NOTE_USER_ID`; it does not make an authenticated API call.

Before any authenticated list, read, create-draft, or edit-draft operation, the server resolves `current_user` and requires its `id` or `urlname` to match `NOTE_USER_ID`. If the identity is unavailable or mismatched, the operation fails closed with a redacted diagnostic. This check applies to session cookies, `NOTE_ALL_COOKIES`, and the optional email/password login path.

`get-note` and `edit-note` also require the target note to belong to `NOTE_USER_ID`; missing or mismatched ownership fails closed. Authentication and API errors are returned as actionable MCP errors without secrets or full response bodies.

## Safety boundary

The MVP writes only drafts. Publication, comments, likes, image uploads, analytics, search, memberships, Notion, Obsidian, HTTP/n8n, and browser automation are outside the default server surface.

## Verification

The local gate is:

```bash
npm test
```

It must build the TypeScript entry point and pass the offline tests for the MVP tool list and Markdown conversion. Live note.com API checks require user-provided credentials and are separate from this gate.

An opt-in authenticated smoke check is available as `npm run test:live` when
`NOTE_LIVE_TESTS=true`, `NOTE_USER_ID`, `NOTE_LIVE_NOTE_ID`, and the documented
note.com credentials are configured. It checks article-list and article-detail
reads, including the authenticated identity and configured-user ownership
checks, without creating an article. Draft creation/editing requires
the additional `NOTE_LIVE_DRAFT_TESTS=true` flag, uses an identifiable smoke-test
draft, verifies it appears in the authenticated user's draft list after editing,
and never publishes it. The smoke-test draft is retained for manual cleanup; only
the explicitly identified draft created by that run may be deleted. When
`NOTE_ALL_COOKIES` and `NOTE_LIVE_DRAFT_TESTS=true` are used, draft checks also require `NOTE_XSRF_TOKEN`.
Credentials and full response bodies are not printed.

## Change policy

Changes that expand the default tool surface must update this specification and its offline registration check together.
