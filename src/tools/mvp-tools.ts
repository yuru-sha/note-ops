import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { File, FormData } from "node-fetch";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { env } from "../config/environment.js";
import { noteApiRequest } from "../utils/api-client.js";
import {
  buildAuthHeaders,
  getVerifiedConfiguredUserIdentifiers,
} from "../utils/auth.js";
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
  noteOwnership,
} from "../utils/note-normalizers.js";

export const MVP_TOOL_NAMES = [
  "get-my-notes",
  "get-note",
  "post-draft-note",
  "edit-note",
  "set-note-eyecatch",
  "open-note-editor",
] as const;

const EYECATCH_MAX_BYTES = 10 * 1024 * 1024;
const EYECATCH_WIDTH = 1280;
const EYECATCH_HEIGHT = 670;
const EYECATCH_MIME_TYPES: Record<string, string> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export function eyecatchMimeType(filePath: string): string {
  const mimeType = EYECATCH_MIME_TYPES[extname(filePath).toLowerCase()];
  if (!mimeType) {
    throw new Error("アイキャッチはPNG、JPEG、GIF、WebP形式に対応しています。");
  }
  return mimeType;
}

export function assertEyecatchSize(size: number): void {
  if (size > EYECATCH_MAX_BYTES) throw new Error("アイキャッチは10MB以下にしてください。");
}

export function buildEyecatchFormData(
  noteId: string,
  fileName: string,
  mimeType: string,
  contents: Buffer
): FormData {
  const form = new FormData();
  const fileBody = new Uint8Array(contents).buffer.slice(
    contents.byteOffset,
    contents.byteOffset + contents.byteLength
  ) as ArrayBuffer;
  form.set("note_id", noteId);
  form.set("file", new File([fileBody], fileName, { type: mimeType }));
  form.set("width", String(EYECATCH_WIDTH));
  form.set("height", String(EYECATCH_HEIGHT));
  return form;
}

export function eyecatchUrlFromPayload(result: any): string | null {
  const candidates = [
    result?.url,
    result?.image_url,
    result?.eyecatch,
    result?.data?.url,
    result?.data?.image_url,
    result?.data?.eyecatch,
    result?.data?.image?.url,
    result?.data?.data?.url,
  ];
  return candidates.find((value) => typeof value === "string" && value) || null;
}

export function isDraftNote(note: any): boolean {
  return note?.status === "draft" || note?.isDraft === true;
}

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

export function draftNoteKey(id: string, key?: unknown): string {
  if (typeof key === "string" && key) return key;
  return id.startsWith("n") ? id : `n${id}`;
}

export function noteKeyFromPayload(note: any): string | undefined {
  const key = note?.key ?? note?.note_key ?? note?.noteKey;
  return typeof key === "string" && key ? key : undefined;
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

async function resolveNoteReference(
  noteId: string
): Promise<{ id: string; key?: string; isDraft: boolean }> {
  const result = await noteApiRequest(
    `/v3/notes/${encodeURIComponent(noteId)}`,
    "GET",
    null,
    true
  );
  const payload = extractNotePayload(result);
  ensureNoteOwnership(payload);
  const key = noteKeyFromPayload(payload);
  return {
    id: String(payload.id || noteId),
    key: key || (noteId.startsWith("n") ? noteId : undefined),
    isDraft: isDraftNote(payload),
  };
}

function ensureNoteOwnership(note: any): void {
  const ownership = noteOwnership(
    note,
    env.NOTE_USER_ID,
    getVerifiedConfiguredUserIdentifiers()
  );
  if (ownership === "unknown") {
    throw new Error("記事の所有者情報を確認できないため、安全のため操作を中止しました。");
  }
  if (!ownership) throw new Error("指定された記事は設定ユーザーの所有ではありません。");
}

export function buildNoteListQuery(
  page: number,
  limit: number,
  status: "all" | "draft" | "public"
): string {
  const params = new URLSearchParams({ limit: String(limit), page: String(page) });
  if (status !== "all") params.set("status", status);
  return params.toString();
}

async function fetchNoteListPage(
  page: number,
  limit: number,
  status: "all" | "draft" | "public"
): Promise<{ notes: any[]; total: number }> {
  const result = await noteApiRequest(
    `/v2/note_list/contents?${buildNoteListQuery(page, limit, status)}`,
    "GET",
    null,
    true
  );
  return normalizeNoteListResponse(result);
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

        const { notes, total } = await fetchNoteListPage(page, perPage, status);
        const formatted = notes.map((note: any) => {
          const draft = note.noteDraft || note.note_draft;
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
        ensureNoteOwnership(note);
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
        let createdNoteKey: string | undefined;

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
          createdNoteKey = noteKeyFromPayload(note) || noteKeyFromPayload(payload);
          if (!id) throw new Error("下書きの作成に失敗しました。");
        } else {
          const resolved = await resolveNoteReference(id);
          id = resolved.id;
          createdNoteKey = resolved.key;
        }

        await noteApiRequest(
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
        const noteKey = draftNoteKey(id, createdNoteKey);
        return createSuccessResponse({
          success: true,
          noteId: id,
          noteKey,
          editUrl: `https://editor.note.com/notes/${encodeURIComponent(noteKey)}/edit/`,
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
        const { id } = await resolveNoteReference(noteId);
        const html = toNoteHtml(body);
        await noteApiRequest(
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
        return createSuccessResponse({ success: true, noteId });
      } catch (error) {
        return handleApiError(error, "記事編集");
      }
    }
  );

  server.tool(
    "set-note-eyecatch",
    "自分の下書きにローカル画像をアイキャッチとして設定する（公開しない）",
    {
      noteId: z.string().min(1).describe("記事IDまたは記事キー"),
      imagePath: z.string().min(1).describe("アップロードするローカル画像のパス"),
    },
    async ({ noteId, imagePath }) => {
      try {
        const { id, key, isDraft } = await resolveNoteReference(noteId);
        if (!isDraft) throw new Error("指定された記事が下書きではないため、アイキャッチ設定を中止しました。");
        const mimeType = eyecatchMimeType(imagePath);
        const fileStats = await stat(imagePath);
        if (!fileStats.isFile()) throw new Error("アイキャッチのパスがファイルではありません。");
        assertEyecatchSize(fileStats.size);
        const contents = await readFile(imagePath);
        const form = buildEyecatchFormData(id, basename(imagePath), mimeType, contents);
        const result = await noteApiRequest(
          "/v1/image_upload/note_eyecatch",
          "POST",
          form,
          true,
          {
            origin: "https://editor.note.com",
            referer: "https://editor.note.com/",
            "x-requested-with": "XMLHttpRequest",
          }
        );
        return createSuccessResponse({
          success: true,
          noteId: id,
          noteKey: key || draftNoteKey(id),
          eyecatchUrl: eyecatchUrlFromPayload(result),
        });
      } catch (error) {
        return handleApiError(error, "アイキャッチ設定");
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
