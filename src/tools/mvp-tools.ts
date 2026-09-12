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

function startsWithBytes(contents: Uint8Array, prefix: number[]): boolean {
  return prefix.every((value, index) => contents[index] === value);
}

export function assertEyecatchContents(contents: Uint8Array, mimeType: string): void {
  const valid =
    (mimeType === "image/png" &&
      startsWithBytes(contents, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
    (mimeType === "image/jpeg" && startsWithBytes(contents, [0xff, 0xd8, 0xff])) ||
    (mimeType === "image/gif" &&
      (startsWithBytes(contents, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
        startsWithBytes(contents, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))) ||
    (mimeType === "image/webp" &&
      startsWithBytes(contents, [0x52, 0x49, 0x46, 0x46]) &&
      startsWithBytes(contents.subarray(8), [0x57, 0x45, 0x42, 0x50]));
  if (!valid) throw new Error("アイキャッチの内容が拡張子と一致しません。");
}

export function buildEyecatchFormData(
  noteId: string,
  fileName: string,
  mimeType: string,
  contents: Buffer
): FormData {
  const form = new FormData();
  form.set("note_id", noteId);
  form.set("file", new File([new Uint8Array(contents)], fileName, { type: mimeType }));
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
  return note?.status === "draft" || note?.isDraft === true || Boolean(note?.noteDraft || note?.note_draft);
}

let cachedNoteApiUserId: string | null = null;
type NoteApiRequest = typeof noteApiRequest;

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

async function saveDraft(
  id: string,
  title: string,
  html: string,
  tags: string[] | undefined,
  request: NoteApiRequest
): Promise<void> {
  await request(
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
}

export function draftNoteKey(id: string, key?: unknown): string {
  if (typeof key === "string" && key) return key;
  return id.startsWith("n") ? id : `n${id}`;
}

export function noteKeyFromPayload(note: any): string | undefined {
  const key = note?.key ?? note?.note_key ?? note?.noteKey;
  return typeof key === "string" && key ? key : undefined;
}

export function noteKeyFromCreateResponse(result: any): string | undefined {
  const payload = extractNotePayload(result);
  const note = payload?.note || payload;
  return noteKeyFromPayload(note) || noteKeyFromPayload(payload);
}

function noteWithId(notes: readonly any[], noteId: string): any | undefined {
  return notes.find((candidate: any) =>
    [candidate?.id, candidate?.note_id, candidate?.noteId].some(
      (value) => String(value ?? "") === noteId
    )
  );
}

export function noteKeyForId(notes: readonly any[], noteId: string): string | undefined {
  const note = noteWithId(notes, noteId);
  const draft = note?.noteDraft || note?.note_draft;
  return noteKeyFromPayload(note) || noteKeyFromPayload(draft);
}

function detailLookupError(error: unknown): unknown {
  if (error instanceof Error && error.message.includes("API error: 400")) {
    return new Error("記事詳細の識別子が受け付けられませんでした。note keyを確認してください。");
  }
  return error;
}

export function buildNoteDetailEndpoint(noteReference: string, timestamp: number): string {
  const params = new URLSearchParams({
    draft: "true",
    draft_reedit: "false",
    ts: String(timestamp),
  });
  return `/v3/notes/${encodeURIComponent(noteReference)}?${params}`;
}

async function getCreateDraftEndpoint(request: NoteApiRequest): Promise<string> {
  if (!env.NOTE_USER_ID) {
    throw new Error("新規下書きの作成にはNOTE_USER_IDが必要です。.envを確認してください。");
  }

  if (!cachedNoteApiUserId) {
    const result = await request(
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

async function resolveNoteKey(
  noteId: string,
  status: "all" | "draft",
  request: NoteApiRequest
): Promise<string> {
  let page = 1;
  while (true) {
    const { notes, total } = await fetchNoteListPage(page, 100, status, request);
    const note = noteWithId(notes, noteId);
    if (note) {
      ensureNoteOwnership(note);
      const key = noteKeyForId(notes, noteId);
      if (key) return key;
      throw new Error("数値IDに対応する記事キーを確認できませんでした。");
    }
    if (notes.length === 0 || page * 100 >= total) break;
    page += 1;
  }
  throw new Error("指定された記事のnote keyを設定ユーザーの一覧から確認できませんでした。");
}

async function fetchNoteDetail(noteReference: string, request: NoteApiRequest): Promise<any> {
  try {
    return await request(
      buildNoteDetailEndpoint(noteReference, Date.now()),
      "GET",
      null,
      true
    );
  } catch (error) {
    throw detailLookupError(error);
  }
}

async function resolveDetailReference(noteId: string, request: NoteApiRequest): Promise<string> {
  return /^\d+$/.test(noteId) ? resolveNoteKey(noteId, "all", request) : noteId;
}

async function resolveNoteReference(
  noteId: string,
  request: NoteApiRequest
): Promise<{ id: string; key?: string; isDraft: boolean }> {
  const noteReference = await resolveDetailReference(noteId, request);
  const result = await fetchNoteDetail(noteReference, request);
  const payload = extractNotePayload(result);
  ensureNoteOwnership(payload);
  const key = noteKeyFromPayload(payload);
  return {
    id: String(payload.id || noteId),
    key: key || (noteReference.startsWith("n") ? noteReference : undefined),
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
  status: "all" | "draft" | "public",
  request: NoteApiRequest = noteApiRequest
): Promise<{ notes: any[]; total: number }> {
  const result = await request(
    `/v2/note_list/contents?${buildNoteListQuery(page, limit, status)}`,
    "GET",
    null,
    true
  );
  return normalizeNoteListResponse(result);
}

export function registerMvpTools(server: McpServer, request: NoteApiRequest = noteApiRequest): void {
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

        const { notes, total } = await fetchNoteListPage(page, perPage, status, request);
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
            isDraft: isDraftNote(note),
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
        const noteReference = await resolveDetailReference(noteId, request);
        const result = await fetchNoteDetail(noteReference, request);
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
          const created = await request(
            await getCreateDraftEndpoint(request),
            "POST",
            { body: "<p></p>", body_length: 0, name: title, index: false, is_lead_form: false },
            true,
            draftHeaders()
          );
          const payload = extractNotePayload(created);
          const note = payload.note || payload;
          id = String(note.id || payload.note_id || payload.noteId || "");
          createdNoteKey = noteKeyFromCreateResponse(created);
          if (!id) throw new Error("下書きの作成に失敗しました。");
        } else {
          const resolved = await resolveNoteReference(id, request);
          id = resolved.id;
          createdNoteKey = resolved.key;
        }

        await saveDraft(id, title, html, tags, request);
        const noteKey = createdNoteKey || (await resolveNoteKey(id, "draft", request));
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
        const { id } = await resolveNoteReference(noteId, request);
        const html = toNoteHtml(body);
        await saveDraft(id, title, html, tags, request);
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
        const mimeType = eyecatchMimeType(imagePath);
        const fileStats = await stat(imagePath);
        if (!fileStats.isFile()) throw new Error("アイキャッチのパスがファイルではありません。");
        assertEyecatchSize(fileStats.size);
        const contents = await readFile(imagePath);
        assertEyecatchSize(contents.byteLength);
        assertEyecatchContents(contents, mimeType);
        const { id, key, isDraft } = await resolveNoteReference(noteId, request);
        if (!isDraft) throw new Error("指定された記事が下書きではないため、アイキャッチ設定を中止しました。");
        if (!buildAuthHeaders()["X-XSRF-TOKEN"]) {
          throw new Error("アイキャッチ設定にはXSRFトークンが必要です。認証情報を確認してください。");
        }
        const form = buildEyecatchFormData(id, basename(imagePath), mimeType, contents);
        const result = await request(
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
