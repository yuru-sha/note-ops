import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { File, FormData } from "node-fetch";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { env } from "../config/environment.js";
import { DASHBOARD_GRAPHQL_ENDPOINT } from "../config/api-config.js";
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
import { formatNote, noteEditorUrl } from "../utils/formatters.js";
import {
  extractNotePayload,
  normalizeNoteListResponse,
  noteOwnership,
} from "../utils/note-normalizers.js";

export const MVP_TOOL_NAMES = [
  "get-my-notes",
  "get-note",
  "get-note-page-views",
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

function uint16BE(contents: Uint8Array, offset: number): number {
  return (contents[offset] << 8) | contents[offset + 1];
}

function uint16LE(contents: Uint8Array, offset: number): number {
  return contents[offset] | (contents[offset + 1] << 8);
}

function uint24LE(contents: Uint8Array, offset: number): number {
  return contents[offset] | (contents[offset + 1] << 8) | (contents[offset + 2] << 16);
}

function jpegDimensions(contents: Uint8Array): { width: number; height: number } | null {
  let offset = 2;
  while (offset < contents.length) {
    if (contents[offset] !== 0xff) return null;
    while (contents[offset] === 0xff) offset += 1;
    const marker = contents[offset++];
    if (marker >= 0xd0 && marker <= 0xd9) continue;
    if (marker === 0xda || offset + 1 >= contents.length) return null;
    const segmentLength = uint16BE(contents, offset);
    if (segmentLength < 2 || offset + segmentLength > contents.length) return null;
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof && segmentLength >= 7) {
      return { height: uint16BE(contents, offset + 3), width: uint16BE(contents, offset + 5) };
    }
    offset += segmentLength;
  }
  return null;
}

function webpDimensions(contents: Uint8Array): { width: number; height: number } | null {
  if (contents.length < 20 || !startsWithBytes(contents, [0x52, 0x49, 0x46, 0x46])) {
    return null;
  }
  if (!startsWithBytes(contents.subarray(8), [0x57, 0x45, 0x42, 0x50])) return null;
  if (startsWithBytes(contents.subarray(12), [0x56, 0x50, 0x38, 0x20])) {
    if (contents.length < 30 || !startsWithBytes(contents.subarray(23), [0x9d, 0x01, 0x2a])) {
      return null;
    }
    return {
      width: uint16LE(contents, 26) & 0x3fff,
      height: uint16LE(contents, 28) & 0x3fff,
    };
  }
  if (startsWithBytes(contents.subarray(12), [0x56, 0x50, 0x38, 0x4c])) {
    if (contents.length < 25 || contents[20] !== 0x2f) return null;
    const bits = contents.slice(21, 25);
    return {
      width: 1 + (bits[0] | ((bits[1] & 0x3f) << 8)),
      height: 1 + ((bits[1] >> 6) | (bits[2] << 2) | ((bits[3] & 0x0f) << 10)),
    };
  }
  if (startsWithBytes(contents.subarray(12), [0x56, 0x50, 0x38, 0x58])) {
    if (contents.length < 30) return null;
    return { width: 1 + uint24LE(contents, 24), height: 1 + uint24LE(contents, 27) };
  }
  return null;
}

function pngDimensions(contents: Uint8Array): { width: number; height: number } | null {
  if (
    contents.length < 33 ||
    uint32BE(contents, 8) !== 13 ||
    !startsWithBytes(contents.subarray(12), [0x49, 0x48, 0x44, 0x52])
  ) {
    return null;
  }
  return { width: uint32BE(contents, 16), height: uint32BE(contents, 20) };
}

function eyecatchDimensions(
  contents: Uint8Array,
  mimeType: string
): { width: number; height: number } | null {
  if (mimeType === "image/png") {
    return pngDimensions(contents);
  }
  if (mimeType === "image/jpeg") return contents.length >= 2 ? jpegDimensions(contents) : null;
  if (mimeType === "image/gif") {
    return contents.length >= 10
      ? { width: uint16LE(contents, 6), height: uint16LE(contents, 8) }
      : null;
  }
  if (mimeType === "image/webp") return webpDimensions(contents);
  return null;
}

function uint32BE(contents: Uint8Array, offset: number): number {
  return (
    contents[offset] * 0x1000000 +
    (contents[offset + 1] << 16) +
    (contents[offset + 2] << 8) +
    contents[offset + 3]
  );
}

export function assertEyecatchDimensions(contents: Uint8Array, mimeType: string): void {
  const dimensions = eyecatchDimensions(contents, mimeType);
  if (dimensions?.width !== EYECATCH_WIDTH || dimensions.height !== EYECATCH_HEIGHT) {
    throw new Error("アイキャッチは1280x670pxの画像にしてください。");
  }
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

const DASHBOARD_PAGE_VIEW_QUERY = `query Dashboard_StatPageQuery(
  $unit: DashboardPeriodUnit!
  $date: Datetime!
  $endDate: Datetime
  $order: DashboardNoteListOrder
  $first: Int!
  $after: String
) {
  dashboardNoteListConnection(unit: $unit, date: $date, endDate: $endDate, order: $order, first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    edges { node { note { key link { absoluteUrl } } metrics { pageViewCount } } }
  }
}`;
const DASHBOARD_PAGE_VIEW_PAGE_SIZE = 100;
const DASHBOARD_FIRST_DATA_DATE = "2014-04-01";

type DashboardPageViewPeriod =
  | "LAST_7_DAYS"
  | "LAST_28_DAYS"
  | "LAST_365_DAYS"
  | "THIS_MONTH"
  | "LAST_MONTH"
  | "ALL"
  | "CUSTOM";

interface DashboardPeriodRange {
  unit: DashboardPageViewPeriod | "MONTH";
  date: string;
  endDate?: string;
  period: {
    preset: DashboardPageViewPeriod;
    startDate: string;
    endDate: string;
  };
}

interface DashboardPageView {
  noteKey: string;
  url: string;
  pageViews: number;
}

const dashboardGraphqlEnvelopeSchema = z.object({
  errors: z.array(z.unknown()).optional(),
  data: z.unknown().optional(),
});
const dashboardPageViewDataSchema = z.object({
  dashboardNoteListConnection: z.object({
    pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
    edges: z.array(
      z.object({
        node: z.object({
          note: z.object({
            key: z.string().min(1),
            link: z.object({ absoluteUrl: z.string().url() }),
          }),
          metrics: z.object({ pageViewCount: z.number().int().nonnegative().refine(Number.isSafeInteger).nullable() }),
        }),
      })
    ),
  }),
});
function dashboardDate(date: Date): { apiDate: string; calendarDate: string } {
  const calendarDate = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
  return { apiDate: `${calendarDate}T00:00:00.000Z`, calendarDate };
}
function dashboardCalendarDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("カスタム期間の日付はYYYY-MM-DD形式で指定してください。");
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (dashboardDate(date).calendarDate !== value) {
    throw new Error("カスタム期間の日付が無効です。");
  }
  return date;
}


function dashboardPeriodRange(
  period: DashboardPageViewPeriod,
  customStartDate?: string,
  customEndDate?: string,
  now = new Date()
): DashboardPeriodRange {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === "CUSTOM") {
    if (!customStartDate || !customEndDate) {
      throw new Error("カスタム期間には開始日と終了日の両方が必要です。");
    }
    const start = dashboardCalendarDate(customStartDate);
    const end = dashboardCalendarDate(customEndDate);
    const todayDate = dashboardDate(today).calendarDate;
    if (
      customStartDate < DASHBOARD_FIRST_DATA_DATE ||
      customStartDate > customEndDate ||
      customEndDate > todayDate
    ) {
      throw new Error("カスタム期間は2014-04-01から本日までの範囲で指定してください。");
    }
    return {
      unit: period,
      date: dashboardDate(start).apiDate,
      endDate: dashboardDate(end).apiDate,
      period: { preset: period, startDate: customStartDate, endDate: customEndDate },
    };
  }
  if (customStartDate !== undefined || customEndDate !== undefined) {
    throw new Error("開始日と終了日はカスタム期間の指定時のみ使用できます。");
  }

  const start = new Date(today);
  let unit: DashboardPeriodRange["unit"] = period;
  if (period === "LAST_7_DAYS") start.setDate(start.getDate() - 6);
  else if (period === "LAST_28_DAYS") start.setDate(start.getDate() - 27);
  else if (period === "LAST_365_DAYS") start.setDate(start.getDate() - 364);
  else if (period === "THIS_MONTH") {
    unit = "MONTH";
    start.setDate(1);
  } else if (period === "LAST_MONTH") {
    unit = "MONTH";
    start.setMonth(start.getMonth() - 1, 1);
    const end = new Date(today.getFullYear(), today.getMonth(), 0);
    return {
      unit,
      date: dashboardDate(start).apiDate,
      period: {
        preset: period,
        startDate: dashboardDate(start).calendarDate,
        endDate: dashboardDate(end).calendarDate,
      },
    };
  } else if (period === "ALL") {
    const [year, month, day] = DASHBOARD_FIRST_DATA_DATE.split("-").map(Number);
    start.setTime(new Date(year, month - 1, day).getTime());
  }

  return {
    unit,
    date: dashboardDate(period === "ALL" ? today : start).apiDate,
    period: {
      preset: period,
      startDate: dashboardDate(start).calendarDate,
      endDate: dashboardDate(today).calendarDate,
    },
  };
}

async function fetchDashboardPageViews(
  period: DashboardPageViewPeriod,
  request: NoteApiRequest,
  customStartDate?: string,
  customEndDate?: string
): Promise<{ period: DashboardPeriodRange["period"]; articles: DashboardPageView[] }> {
  if (!env.NOTE_USER_ID) throw new Error("環境変数 NOTE_USER_ID が設定されていません。");

  const range = dashboardPeriodRange(period, customStartDate, customEndDate);
  const articles: DashboardPageView[] = [];
  const seenNoteKeys = new Set<string>();
  const seenCursors = new Set<string>();
  let after: string | null = null;

  while (true) {
    const rawResponse: unknown = await request(
      DASHBOARD_GRAPHQL_ENDPOINT,
      "POST",
      {
        operationName: "Dashboard_StatPageQuery",
        variables: {
          unit: range.unit,
          date: range.date,
          ...(range.endDate ? { endDate: range.endDate } : {}),
          order: "PAGE_VIEW_COUNT_DESC",
          first: DASHBOARD_PAGE_VIEW_PAGE_SIZE,
          after,
        },
        query: DASHBOARD_PAGE_VIEW_QUERY,
      },
      true,
      {
        "content-type": "application/json",
        origin: "https://note.com",
        referer: "https://note.com/dashboard?metric=PAGE_VIEW",
      }
    );

    const envelope = dashboardGraphqlEnvelopeSchema.safeParse(rawResponse);
    if (!envelope.success || (envelope.data.errors?.length ?? 0) > 0) {
      throw new Error("note.comのダッシュボードAPIがページビューを返しませんでした。");
    }
    const data = dashboardPageViewDataSchema.safeParse(envelope.data.data);
    if (!data.success) {
      throw new Error("note.comのダッシュボード応答を確認できないため、取得を中止しました。");
    }
    const connection = data.data.dashboardNoteListConnection;

    for (const edge of connection.edges) {
      const article = {
        noteKey: edge.node.note.key,
        url: edge.node.note.link.absoluteUrl,
        pageViews: edge.node.metrics.pageViewCount ?? 0,
      };
      if (!article.url.startsWith("https://note.com/")) {
        throw new Error("ダッシュボードの記事指標を確認できないため、取得を中止しました。");
      }
      if (seenNoteKeys.has(article.noteKey)) {
        throw new Error("note.comのダッシュボードに重複記事があるため、取得を中止しました。");
      }
      seenNoteKeys.add(article.noteKey);
      articles.push(article);
    }

    if (!connection.pageInfo.hasNextPage) break;
    const cursor = connection.pageInfo.endCursor;
    if (!cursor || seenCursors.has(cursor)) {
      throw new Error("note.comのダッシュボードページ送りを確認できないため、取得を中止しました。");
    }
    seenCursors.add(cursor);
    after = cursor;
  }

  return { period: range.period, articles };
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
          const key =
            note.key ||
            noteKeyForId(notes, String(note.id || note.note_id || note.noteId || "")) ||
            "";
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
            ...(key ? { editUrl: noteEditorUrl(key) } : {}),
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
          formatNote(note, note.user?.urlname || env.NOTE_USER_ID, true, true, noteReference)
        );
      } catch (error) {
        return handleApiError(error, "記事取得");
      }
    }
  );

  server.tool(
    "get-note-page-views",
    "指定期間の自分の記事ページビュー（PV）を取得する。インプレッションとは異なる指標。",
    {
      period: z.enum([
        "LAST_7_DAYS",
        "LAST_28_DAYS",
        "LAST_365_DAYS",
        "THIS_MONTH",
        "LAST_MONTH",
        "ALL",
        "CUSTOM",
      ]).describe("取得期間。CUSTOMの場合は開始日と終了日も指定"),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("CUSTOM期間の開始日（YYYY-MM-DD）"),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("CUSTOM期間の終了日（YYYY-MM-DD）"),
    },
    async ({ period, startDate, endDate }) => {
      try {
        return createSuccessResponse(await fetchDashboardPageViews(period, request, startDate, endDate));
      } catch (error) {
        return handleApiError(error, "ページビュー取得");
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
          editUrl: noteEditorUrl(noteKey),
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
        assertEyecatchDimensions(contents, mimeType);
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
      try {
        if (!env.NOTE_USER_ID) return createErrorResponse("環境変数 NOTE_USER_ID が設定されていません。");
        const noteKey = /^\d+$/.test(noteId)
          ? await resolveNoteKey(noteId, "all", request)
          : noteId;
        return createSuccessResponse({ editUrl: noteEditorUrl(noteKey) });
      } catch (error) {
        return handleApiError(error, "記事編集URL生成");
      }
    }
  );
}
