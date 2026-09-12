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

export function noteOwnership(note: any, userId: string): boolean | "unknown" {
  if (!userId) return "unknown";
  const user = note?.user || note?.author || {};
  const identifiers = [user.urlname, user.id, note?.user_id, note?.userId].filter(Boolean);
  if (identifiers.length === 0) return "unknown";
  return identifiers.some((value) => String(value) === userId);
}

export function noteBelongsToUser(note: any, userId: string): boolean {
  return noteOwnership(note, userId) === true;
}
