# Agent instructions

Read `docs/docs/SPEC.md` before changing code. Treat it as the authoritative contract for the default server.

## Working sequence

1. Inspect the current diff and the files named by the task.
2. Keep the default entry point in `src/index.ts` and the default tool surface in `src/tools/mvp-tools.ts`.
3. Reuse the existing API client, authentication, error handling, and Markdown conversion utilities.
4. Keep content mutations on the draft-save path and eyecatch changes on the draft metadata path. A request to publish, comment, like, upload body images, or add an integration requires an explicit scope change and a `docs/docs/SPEC.md` update.
5. Add or update one small offline regression check for non-trivial behavior.
6. Run `npm test` and report the result. Treat live note.com checks as separate because they require credentials.

## Safety and privacy

- Keep credentials in environment variables or the user's existing local session configuration.
- Log operation names and HTTP status only. Credential values, cookies, XSRF tokens, passwords, and full response bodies remain private.
- Verify configured-user identity before authenticated list, read, create-draft, or edit-draft operations, and verify target-note ownership for `get-note`, `edit-note`, and `set-note-eyecatch`; fail closed when identity or ownership is unavailable, mismatched, or conflicting.
- Require an XSRF token for draft and eyecatch writes; keep it in the configured environment or authenticated session.
- Encode note IDs and keys before placing them in paths or URLs.
- Preserve the stdio-only default until the HTTP/n8n requirement is explicitly accepted.

## Scope and style

- Prefer the smallest change that satisfies `docs/docs/SPEC.md`.
- Use existing dependencies and standard Node.js facilities before adding code or packages.
- Leave legacy, non-MVP source files unreachable from the default TypeScript entry point until their cleanup is explicitly scoped.
- Keep public behavior backward compatible within the six-tool MVP contract.
- Update `docs/docs/SPEC.md` when tool behavior, authentication, transport, or safety boundaries change.

## Project skills

- For note.com article workflow requests (draft, inspect, revise, or save), read `skills/note-management-workflow/SKILL.md` before using the MCP workflow.

## Commit Messages

- Follow the commit-message policy in `CONTRIBUTING.md`.
- Do not create commits unless the user explicitly requests it.


## Code and comment guidance

Use each artifact to communicate a different kind of intent:

- Code should explain **How** the behavior is implemented.
- Test code should explain **What** behavior is expected.
- Commit messages should explain **Why** the change was made.
- Code comments should explain **Why not**: document non-obvious constraints, rejected alternatives, trade-offs, or reasons the seemingly simpler approach is incorrect.

Do not use comments to restate what the code already makes clear.

## Branch And Pull Request Workflow

- Do not edit, commit, or push directly to `main`. Make changes on a feature branch and merge them through a pull request.
- Direct work on `main` is allowed only when the user explicitly authorizes it.

## GitHub workflow

- GitHub Issues are the canonical work tracker.
- Shared Bug / Feature / Question forms and the default Pull Request template are inherited from `yuru-sha/.github`.
- Shared non-default labels, including `orca:*`, are synchronized from `yuru-sha/project-template`.
- Keep `.github/copilot-instructions.md` as a Copilot-review-specific policy; `AGENTS.md` remains the primary Codex repository guidance.
- Use `orca:*` labels only for ORCA execution state; do not treat them as release categories.
