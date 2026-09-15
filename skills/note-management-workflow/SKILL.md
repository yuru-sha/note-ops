---
name: note-management-workflow
description: Draft, inspect, revise, save, and set one note.com article eyecatch through the six note-ops MCP tools, with confirmation before every write.
---

# Note.com article workflow

Use this skill when the user supplies source material and asks to prepare or
revise one note.com article. The MCP server remains the execution boundary.

## Inputs

- Source material, supplied in the request or an already available local file.
- Optional title, tags, and existing note ID/key.
- Optional local eyecatch image path.
- The intended action: prepare a new draft, or inspect/revise an existing one.

If the target or intended action is ambiguous, ask before reading or writing.
Do not invent missing source material, title requirements, or tags.

## Math and comparison tables

When an article needs a formula or a comparison table, use note's TeX/KaTeX
notation instead of Markdown pipe tables. Note supports inline and display
math; display delimiters must be `$$` on their own lines, with the expression
between them. Comparison tables must always use the display form `$$...$$`,
never the inline form `$...$`. Use KaTeX's supported `array` environment:

```markdown
$$
\begin{array}{lrr}
\text{項目} & \text{レンズA} & \text{レンズB} \\
\hline
\text{質量} & 994\,\mathrm{g} & 995\,\mathrm{g} \\
\text{焦点距離} & 400\,\mathrm{mm} & 600\,\mathrm{mm}
\end{array}
$$
```

Use only commands and environments listed in the [KaTeX supported
functions](https://katex.org/docs/supported.html) and [KaTeX support
table](https://katex.org/docs/support_table.html). Keep raw HTML and unsupported
color features out of equations. When sending the body through the MCP,
preserve the display delimiters and line breaks as Markdown; do not wrap a
display equation in an HTML paragraph. After saving, re-read the draft and
check that pipe-table markers are absent and the `array` source remains in the
body. The [note equation guide](https://www.help-note.com/hc/ja/articles/4410665086873-%E6%95%B0%E5%BC%8F%E8%A8%98%E6%B3%95%E3%81%AE%E4%BD%BF%E3%81%84%E6%96%B9) is the authority for note-specific delimiters and limitations.

## Workflow

1. Prepare a candidate title, body, and tags from the supplied source. Keep the
   full body in working context only; return a short summary until the user
   asks to see the body.
2. Inspect the target when needed with `get-my-notes` and `get-note`. Prefer the
   returned note key for detail reads; numeric IDs are resolved through the
   authenticated user's list before `get-note` calls the detail endpoint. When
   an editor link is useful, call `open-note-editor` and report its exact
   `editUrl` result. Treat that returned editor URL as the single source of
   truth; the public note URL and a URL derived by appending `/edit` are not
   editor links. These reads do not change note.com state.
3. Show the proposed action, target, title, tags, and a short body summary.
   Stop at an explicit confirmation boundary. A clear user confirmation is
   required immediately before every draft write.
4. After confirmation, use `post-draft-note` for a new draft or `edit-note` for
   an existing note. Both operations must remain on the draft-save path.
5. If an eyecatch image is requested for the configured user's own draft, use
   `set-note-eyecatch` after the draft exists. Treat this as a separate write
   and require explicit confirmation immediately before it.
6. Report the saved draft status, note ID, and the exact editor URL returned by
   `open-note-editor`. Tell the user that publication remains a deliberate
   manual action on note.com.

The only permitted note-management MCP tools are:

- `get-my-notes`
- `get-note`
- `post-draft-note`
- `edit-note`
- `set-note-eyecatch`
- `open-note-editor`

Use no other MCP tools or note.com endpoints for this workflow.

## Failure and safety

- Validate inputs and confirmation before any write. Never infer confirmation
  from the initial request to draft or revise.
- On an authentication, ownership, validation, or API error, stop the
  workflow, identify the failed operation, and pass through only the server's
  redacted actionable message. Do not retry a draft write automatically.
- If a numeric ID cannot be mapped to a note key, stop and report the redacted
  diagnostic; do not guess a key from the numeric ID.
- Keep credentials, cookies, tokens, and full article bodies out of logs and
  routine status output.
- This workflow does not publish, comment, like, upload body images, or analyze
  other users. It may set a local eyecatch on the configured user's own draft
  only after explicit confirmation. It has no analytics or content-strategy step.
