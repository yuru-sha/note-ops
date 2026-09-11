import fetch from "node-fetch";
import { API_BASE_URL, DEFAULT_HEADERS } from "../config/api-config.js";
import { env } from "../config/environment.js";
import { NoteApiResponse } from "../types/api-types.js";
import { buildAuthHeaders, loginToNote, hasAuth } from "./auth.js";

// APIリクエスト用のヘルパー関数
export async function noteApiRequest(
  endpoint: string,
  method: string = "GET",
  body: any = null,
  requireAuth: boolean = false,
  customHeaders?: { [key: string]: string }
): Promise<NoteApiResponse> {
  const headers: { [key: string]: string } = {
    ...DEFAULT_HEADERS,
  };

  // 認証ヘッダーを追加。XSRFトークンだけでは認証済みとみなさない。
  if (requireAuth && !hasAuth()) {
    if (env.NOTE_EMAIL && env.NOTE_PASSWORD && (await loginToNote())) {
      Object.assign(headers, buildAuthHeaders());
    } else {
      throw new Error("認証情報が必要です。.envファイルを確認してください。");
    }
  } else if (hasAuth()) {
    Object.assign(headers, buildAuthHeaders());
  }

  // POST/PUTリクエストの場合、OriginとRefererヘッダーを追加（CSRF対策）
  if (method === "POST" || method === "PUT") {
    headers["Origin"] = "https://note.com";
    headers["Referer"] = "https://note.com/";
  }

  // customHeadersがある場合は最後に適用（優先）
  if (customHeaders) {
    Object.assign(headers, customHeaders);
  }

  const options: any = {
    method,
    headers,
  };

  if (body && (method === "POST" || method === "PUT")) {
    // Bufferの場合はそのまま送信、それ以外はJSON化
    if (Buffer.isBuffer(body)) {
      options.body = body;
    } else {
      options.body = JSON.stringify(body);
    }
  }

  try {
    if (env.DEBUG) {
      console.error(`API request: auth=${hasAuth() ? "present" : "absent"}`);
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, options);
    if (env.DEBUG) console.error(`API response: status=${response.status}`);

    if (!response.ok) {
      if (env.DEBUG) {
        console.error(`API error: status=${response.status}`);
      }

      // エラー種別ごとの詳細な説明
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          "認証エラー: noteへのアクセス権限がありません。認証情報を確認してください。"
        );
      } else if (response.status === 404) {
        throw new Error("API error: 404 Not Found");
      }

      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as NoteApiResponse;
    return data;
  } catch (error) {
    if (env.DEBUG) {
      console.error("API request failed");
    }
    throw error;
  }
}
