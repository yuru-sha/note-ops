# Repository Guidelines

## Project Overview

`note-ops` is a local MCP stdio server for managing one configured note.com user's articles and drafts. The default server exposes exactly six tools and only saves drafts or draft eyecatch metadata. Treat [`docs/SPEC.md`](docs/SPEC.md) as the behavioral and safety contract; note.com uses private APIs whose behavior can change independently.

## Architecture & Data Flow

- [`src/index.ts`](src/index.ts) creates the MCP server, registers tools, and connects the stdio transport.
- [`src/tools/mvp-tools.ts`](src/tools/mvp-tools.ts) defines the default tools and their handlers. Typical path: Zod input validation → ID/key and ownership resolution as needed → API request → normalization/formatting → MCP response.
- [`src/utils/api-client.ts`](src/utils/api-client.ts) centralizes HTTP requests, headers, authentication checks, body handling, and response/error parsing. [`src/utils/auth.ts`](src/utils/auth.ts) manages session/login state, verified identity, and XSRF-token capture.
- Other utilities provide note normalization/ownership checks (`note-normalizers.ts`), response formatting and editor URLs (`formatters.ts`), Markdown conversion (`markdown-converter.ts`), redacted error responses (`error-handler.ts`), and safe logging (`safe-logging.ts`).
- `registerMvpTools(server, request = noteApiRequest)` provides the main dependency-injection seam; pass a request implementation for offline handler tests.
- Authenticated operations verify the configured `NOTE_USER_ID`; target-note operations also verify ownership and fail closed when identity/ownership is absent, conflicting, or mismatched. Encode note IDs and keys in paths and URLs. Keep credentials, XSRF tokens, cookies, and full response bodies out of logs and MCP responses.

## Key Directories

- `src/config/` — environment and API configuration.
- `src/tools/` — MCP tool registration and handlers.
- `src/utils/` — API, auth, parsing, formatting, conversion, validation, and logging helpers.
- `src/types/` — API and domain types.
- `test/` — offline tests and credential-gated live smoke runner.
- `docs/` — specification and behavior documentation.
- `tools/note-exporter/` — separate export utility; it is not part of the default MCP server contract.

## Development Commands

```bash
npm ci                 # install locked dependencies
npm run build          # compile TypeScript to build/
npm start              # run build/index.js
npm run dev             # build, then start
npm test                # build, then run offline Node tests
npm run dev:watch       # TypeScript watch mode
npm run test:live       # opt-in note.com smoke workflow
```

`npm test` is the local gate. Live checks require explicit flags and credentials; consult [`docs/SPEC.md`](docs/SPEC.md) before using them. Draft/eyecatch live checks can write a retained smoke-test draft. CI uses Node.js 20 and runs `npm ci` followed by `npm test`.

## Code Conventions & Common Patterns

- Use TypeScript ES modules, strict typing, async/await for I/O, and shared utility functions rather than duplicate request/auth logic.
- Validate tool arguments with Zod before making network requests. Keep handlers focused on validation, orchestration, and MCP response construction; route API errors through the shared redacting error handler.
- Preserve injectable request functions for deterministic offline tests. Keep network access behind the shared API client.
- Verify configured-user identity before authenticated list, read, create-draft, or edit-draft operations, and verify target-note ownership for `get-note`, `edit-note`, and `set-note-eyecatch`; fail closed when identity or ownership is unavailable, mismatched, or conflicting. Require an XSRF token for draft and eyecatch writes.
- Keep credentials in environment variables or the user's existing local session configuration. Log operation names and HTTP status only; credential values, cookies, XSRF tokens, passwords, and full response bodies remain private. Encode note IDs and keys before placing them in paths or URLs.
- Keep content mutations on the draft-save path and eyecatch changes on the draft metadata path. The six-tool MVP contract excludes publishing, comments, likes, body-image uploads, integrations, HTTP/n8n, and browser automation unless the specification is explicitly changed.
- Root `tsconfig.json` explicitly includes the default entry, MVP tool module, and live-smoke utility; imported modules form the compiled dependency graph. Keep unrelated legacy modules unreachable from the default entry unless their cleanup is specifically in scope.

## Code and Comment Guidance

Use each artifact to communicate a different kind of intent:

- Code explains **how** behavior is implemented.
- Tests explain **what** behavior is expected.
- Commit messages explain **why** the change was made.
- Comments explain **why not**: document non-obvious constraints, rejected alternatives, trade-offs, or why the seemingly simpler approach is incorrect. Do not restate what clear code already says.

## Project Skills

- For note.com article workflow requests (draft, inspect, revise, or save), read [`skills/note-management-workflow/SKILL.md`](skills/note-management-workflow/SKILL.md) before using the MCP workflow.

## Contribution Workflow

- Follow the commit-message policy in [`CONTRIBUTING.md`](CONTRIBUTING.md). Do not create commits unless explicitly requested.
- Do not edit, commit, or push directly to `main`; use a feature branch and pull request unless the user explicitly authorizes direct work.
- GitHub Issues are the canonical work tracker. Keep `.github/copilot-instructions.md` specific to Copilot review; this file is the primary repository guidance.

## Important Files

- `docs/SPEC.md` — authoritative default-server contract, safety rules, and verification requirements.
- `src/index.ts` — stdio server entry point.
- `src/tools/mvp-tools.ts` — six-tool registration and behavior.
- `src/utils/api-client.ts`, `auth.ts`, `note-normalizers.ts`, `markdown-converter.ts`, `error-handler.ts` — core request, trust, and content behavior.
- `src/config/environment.ts` — `.env` and `NOTE_*` configuration.
- `package.json`, `package-lock.json`, `tsconfig.json` — scripts, dependency lock, compiler configuration.
- `test/mvp.test.mjs`, `test/live-smoke.test.mjs`, `test/live-smoke.mjs` — offline suite and opt-in live path.
- `README.md` and `README.ja.md` — setup and user-facing usage.

## Runtime/Tooling Preferences

- Use Node.js 20 (the CI runtime) and npm; `package.json` is ESM (`"type": "module"`).
- TypeScript 5 compiles the server to `build/`; Node runs the compiled entry point. The tests are `.mjs` files using compiled output.
- Prefer existing dependencies and Node.js facilities. Do not add dependencies or change the runtime/toolchain without a concrete need.

## Testing & QA

- Offline tests use Node's built-in `node:test` and `node:assert/strict`; run with `npm test`. The script builds first, then runs `test/*.test.mjs`.
- Add focused offline regression coverage for non-trivial behavior using injected requests and fixtures; avoid credential-dependent tests in the default suite.
- `npm run test:live` is separate and opt-in. Read [`docs/SPEC.md`](docs/SPEC.md) for required environment variables and write-capable flags; never assume it is read-only when draft/eyecatch flags are enabled.
- Update `docs/SPEC.md` and its offline registration checks when changing tool behavior, authentication, transport, safety boundaries, or the default tool surface.
