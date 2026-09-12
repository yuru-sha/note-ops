import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { env } from "../config/environment.js";
import { noteApiRequest } from "../utils/api-client.js";
import { buildAuthHeaders } from "../utils/auth.js";
import {
  createErrorResponse,
  createSuccessResponse,
  handleApiError,
} from "../utils/error-handler.js";
import { convertMarkdownToNoteHtml, looksLikeHtml } from "../utils/markdown-converter.js";
import { formatNote } from "../utils/formatters.js";
import {
  extractNotePayload,
  normalizeNoteListResponse,
  noteBelongsToUser,
} from "../utils/note-normalizers.js";

export const MVP_TOOL_NAMES = [
  "get-my-notes",
  "get-note",
  "post-draft-note",
  "edit-note",
  "open-note-editor",
] as const;

let cachedNoteApiUserId: string | null = null;

function draftHeaders(): Record<string, string> {
  return {
    ...buildAuthHeaders(),
    "content-type": "application/json",
    origin: "https://editor.note.com",
    referer: "https://editor.note.com/",
    "x-requested-with": "XMLHttpRequest",
  };
}

function toNoteHtml(body: string): string {
  return looksLikeHtml(body) ? body : convertMarkdownToNoteHtml(body);
}

async function getCreateDraftEndpoint(): Promise<string> {
  if (!env.NOTE_USER_ID) {
    throw new Error("新規下書きの作成にはNOTE_USER_IDが必要です。.envを確認してください。");
  }

  if (!cachedNoteApiUserId) {
    const result = await noteApiRequest(
      `/v2/creators/${encodeURIComponent(env.NOTE_USER_ID)}`,
      "GET",
      null,
      true
    );
    const payload = (result.data || result) as any;
    const numericId = payload.id || payload.user?.id;
    if (!numericId) throw new Error("note.comの数値ユーザーIDを解決できませんでした。");
    cachedNoteApiUserId = String(numericId);
  }

  return `/v1/text_notes?user_id=${encodeURIComponent(cachedNoteApiUserId)}`;
}

async function resolveNumericNoteId(noteId: string): Promise<string> {
  const result = await noteApiRequest(
    `/v3/notes/${encodeURIComponent(noteId)}`,
    "GET",
    null,
    true
  );
  const payload = extractNotePayload(result);
  if (!noteBelongsToUser(payload, env.NOTE_USER_ID)) {
    throw new Error("指定された記事は設定ユーザーの所有ではありません。");
  }
  return String(payload.id || noteId);
}

export function registerMvpTools(server: McpServer): void {
  server.tool(
    "get-my-notes",
    "自分の記事と下書きの一覧を取得する",
    {
      page: z.number().int().min(1).default(1).describe("ページ番号"),
      perPage: z.number().int().min(1).max(100).default(20).describe("1ページの件数"),
      status: z.enum(["all", "draft", "public"]).default("all").describe("状態フィルター"),
    },
    async ({ page, perPage, status }) => {
      try {
        if (!env.NOTE_USER_ID) {
          return createErrorResponse("環境変数 NOTE_USER_ID が設定されていません。");
        }

        const params = new URLSearchParams({
          page: String(page),
          per_page: String(perPage),
          draft: "true",
          draft_reedit: "false",
          ts: String(Date.now()),
        });
        if (status !== "all") params.set("status", status);

        const result = await noteApiRequest(
          `/v2/note_list/contents?${params.toString()}`,
          "GET",
          null,
          true
        );
        const { notes, total } = normalizeNoteListResponse(result);
        const formatted = notes.map((note: any) => {
          const draft = note.noteDraft;
          const body = note.body || draft?.body || "";
          const key = note.key || "";
          const encodedKey = encodeURIComponent(key || note.id || "");
          return {
            id: String(note.id || ""),
            key,
            title: note.name || draft?.name || "(無題)",
            excerpt: body.replace(/<[^>]*>/g, "").slice(0, 100),
            status: note.status || "unknown",
            isDraft: note.status === "draft" || Boolean(draft),
            publishedAt: note.publishAt || note.publish_at || note.createdAt || "",
            url: `https://note.com/${encodeURIComponent(env.NOTE_USER_ID)}/n/${encodedKey}`,
            editUrl: `https://editor.note.com/notes/${encodedKey}/edit/`,
          };
        });

        return createSuccessResponse({
          total,
          page,
          perPage,
          status,
          totalPages: Math.ceil(total / perPage),
          hasNextPage: page * perPage < total,
          notes: formatted,
        });
      } catch (error) {
        return handleApiError(error, "記事一覧取得");
      }
    }
  );

  server.tool(
    "get-note",
    "記事または下書きの詳細を取得する",
    { noteId: z.string().min(1).describe("記事IDまたは記事キー") },
    async ({ noteId }) => {
      try {
        const params = new URLSearchParams({
          draft: "true",
          draft_reedit: "false",
          ts: String(Date.now()),
        });
        const result = await noteApiRequest(
          `/v3/notes/${encodeURIComponent(noteId)}?${params}`,
          "GET",
          null,
          true
        );
        const note = extractNotePayload(result);
        if (!noteBelongsToUser(note, env.NOTE_USER_ID)) {
          throw new Error("指定された記事は設定ユーザーの所有ではありません。");
        }
        return createSuccessResponse(
          formatNote(note, note.user?.urlname || env.NOTE_USER_ID, true, true)
        );
      } catch (error) {
        return handleApiError(error, "記事取得");
      }
    }
  );

  server.tool(
    "post-draft-note",
    "MarkdownまたはHTML本文を下書き保存する",
    {
      title: z.string().min(1).describe("記事タイトル"),
      body: z.string().describe("MarkdownまたはHTML本文"),
      tags: z.array(z.string()).max(10).optional().describe("タグ"),
      id: z.string().optional().describe("既存下書きのID"),
    },
    async ({ title, body, tags, id }) => {
      try {
        const html = toNoteHtml(body);

        if (!id) {
          const created = await noteApiRequest(
            await getCreateDraftEndpoint(),
            "POST",
            { body: "<p></p>", body_length: 0, name: title, index: false, is_lead_form: false },
            true,
            draftHeaders()
          );
          const payload = extractNotePayload(created);
          const note = payload.note || payload;
          id = String(note.id || payload.note_id || payload.noteId || "");
          if (!id) throw new Error("下書きの作成に失敗しました。");
        } else {
          id = await resolveNumericNoteId(id);
        }

        const saved = await noteApiRequest(
          `/v1/text_notes/draft_save?id=${encodeURIComponent(id)}&is_temp_saved=true`,
          "POST",
          {
            body: html,
            body_length: html.length,
            name: title,
            tags: tags || [],
            index: false,
            is_lead_form: false,
          },
          true,
          draftHeaders()
        );
        const noteKey = id.startsWith("n") ? id : `n${id}`;
        return createSuccessResponse({
          success: true,
          noteId: id,
          noteKey,
          editUrl: `https://editor.note.com/notes/${encodeURIComponent(noteKey)}/edit/`,
          data: saved,
        });
      } catch (error) {
        return handleApiError(error, "記事下書き保存");
      }
    }
  );

  server.tool(
    "edit-note",
    "既存記事を下書きとして保存する（公開しない）",
    {
      noteId: z.string().min(1).describe("記事IDまたは記事キー"),
      title: z.string().min(1).describe("記事タイトル"),
      body: z.string().describe("MarkdownまたはHTML本文"),
      tags: z.array(z.string()).max(10).optional().describe("タグ"),
    },
    async ({ noteId, title, body, tags }) => {
      try {
        const id = await resolveNumericNoteId(noteId);
        const html = toNoteHtml(body);
        const saved = await noteApiRequest(
          `/v1/text_notes/draft_save?id=${encodeURIComponent(id)}&is_temp_saved=true`,
          "POST",
          {
            body: html,
            body_length: html.length,
            name: title,
            tags: tags || [],
            index: false,
            is_lead_form: false,
          },
          true,
          draftHeaders()
        );
        return createSuccessResponse({ success: true, noteId, data: saved });
      } catch (error) {
        return handleApiError(error, "記事編集");
      }
    }
  );

  server.tool(
    "open-note-editor",
    "記事の編集ページURLを生成する",
    { noteId: z.string().min(1).describe("記事IDまたは記事キー") },
    async ({ noteId }) => {
      if (!env.NOTE_USER_ID) return createErrorResponse("環境変数 NOTE_USER_ID が設定されていません。");
      return createSuccessResponse({
        editUrl: `https://editor.note.com/notes/${encodeURIComponent(noteId)}/edit/`,
      });
    }
  );
}
