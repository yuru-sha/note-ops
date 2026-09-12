---
name: note-management-workflow
description: Draft, inspect, revise, and save one note.com article through the five note-ops MCP tools, with confirmation before every draft write.
---

# Note.com article workflow

Use this skill when the user supplies source material and asks to prepare or
revise one note.com article. The MCP server remains the execution boundary.

## Inputs

- Source material, supplied in the request or an already available local file.
- Optional title, tags, and existing note ID/key.
- The intended action: prepare a new draft, or inspect/revise an existing one.

If the target or intended action is ambiguous, ask before reading or writing.
Do not invent missing source material, title requirements, or tags.

## Workflow

1. Prepare a candidate title, body, and tags from the supplied source. Keep the
   full body in working context only; return a short summary until the user
   asks to see the body.
2. Inspect the target when needed with `get-my-notes` and `get-note`. Use
   `open-note-editor` when an editor link is useful. These reads do not change
   note.com state.
3. Show the proposed action, target, title, tags, and a short body summary.
   Stop at an explicit confirmation boundary. A clear user confirmation is
   required immediately before every draft write.
4. After confirmation, use `post-draft-note` for a new draft or `edit-note` for
   an existing note. Both operations must remain on the draft-save path.
5. Report the saved draft status, note ID, and editor URL when available. Tell
   the user that publication remains a deliberate manual action on note.com.

The only permitted note-management MCP tools are:

- `get-my-notes`
- `get-note`
- `post-draft-note`
- `edit-note`
- `open-note-editor`

Use no other MCP tools or note.com endpoints for this workflow.

## Failure and safety

- Validate inputs and confirmation before any write. Never infer confirmation
  from the initial request to draft or revise.
- On an authentication, ownership, validation, or API error, stop the
  workflow, identify the failed operation, and pass through only the server's
  redacted actionable message. Do not retry a draft write automatically.
- Keep credentials, cookies, tokens, and full article bodies out of logs and
  routine status output.
- This workflow does not publish, comment, like, upload images, or analyze
  other users. It has no analytics or content-strategy step.
