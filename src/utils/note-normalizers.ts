import { commonExtractors, safeExtractData, safeExtractTotal } from "./error-handler.js";

export function extractNotePayload(result: any): any {
  const data = result?.data || result;
  return data?.note || data?.text_note || data?.textNote || data;
}

export function normalizeNoteListResponse(result: any): { notes: any[]; total: number } {
  const response = result?.data === undefined ? { data: result } : result;
  const notes = safeExtractData(response, commonExtractors.notes).map(
    (item: any) => (item?.type === "note" ? item.note || item : item?.note || item)
  );
  return { notes, total: safeExtractTotal(response, notes.length) };
}

export function noteBelongsToUser(note: any, userId: string): boolean {
  if (!userId) return false;
  const user = note?.user || note?.author || {};
  return [user.urlname, user.id, note?.user_id, note?.userId]
    .filter(Boolean)
    .some((value) => String(value) === userId);
}

export function selectNotesPage<T>(notes: T[], page: number, perPage: number): T[] {
  const start = (page - 1) * perPage;
  return notes.slice(start, start + perPage);
}
