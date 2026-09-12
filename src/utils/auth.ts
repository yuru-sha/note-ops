import { env } from "../config/environment.js";
import { API_BASE_URL, DEFAULT_HEADERS } from "../config/api-config.js";
import fetch from "node-fetch";
import { redactSensitiveValues } from "./safe-logging.js";

// 動的セッション情報を保持する変数
let activeSessionCookie: string | null = null;
let activeXsrfToken: string | null = null;
let activeUserKey: string | null = null;
let verifiedConfiguredUserId: string | null = null;
let verifiedConfiguredUserIdentifiers: Set<string> | null = null;

export function getActiveSessionCookie(): string | null {
  return activeSessionCookie;
}

export function getActiveXsrfToken(): string | null {
  return activeXsrfToken;
}

export function getActiveUserKey(): string | null {
  return activeUserKey;
}

export function setActiveUserKey(key: string): void {
  activeUserKey = key;
}

export function setActiveSessionCookie(cookie: string): void {
  activeSessionCookie = cookie;
  activeXsrfToken = null;
  verifiedConfiguredUserId = null;
  verifiedConfiguredUserIdentifiers = null;
}

export function setActiveXsrfToken(token: string): void {
  activeXsrfToken = token;
}

export function hasAuth(): boolean {
  return Boolean(
    activeSessionCookie ||
      env.NOTE_SESSION_V5 ||
      process.env.NOTE_ALL_COOKIES ||
      (env.NOTE_EMAIL && env.NOTE_PASSWORD)
  );
}

export function hasSessionAuth(): boolean {
  return Boolean(activeSessionCookie || env.NOTE_SESSION_V5 || process.env.NOTE_ALL_COOKIES);
}

export function getVerifiedConfiguredUserIdentifiers(): readonly string[] {
  return verifiedConfiguredUserIdentifiers ? [...verifiedConfiguredUserIdentifiers] : [];
}

function currentUserIdentity(currentUserResponse: any): {
  identifiers: string[];
  numericIdentifiers: string[];
  urlnameIdentifiers: string[];
} {
  const user = [
    currentUserResponse?.data?.user,
    currentUserResponse?.data?.current_user,
    currentUserResponse?.user,
    currentUserResponse?.data,
  ].find((candidate) => candidate && typeof candidate === "object");
  const numericIdentifiers = [user?.id, user?.user_id, user?.userId]
    .filter(Boolean)
    .map(String);
  const urlnameIdentifiers = [user?.urlname].filter(Boolean).map(String);
  return {
    identifiers: [...new Set([...numericIdentifiers, ...urlnameIdentifiers])],
    numericIdentifiers,
    urlnameIdentifiers,
  };
}

export function assertCurrentUserMatchesConfiguredUser(
  currentUserResponse: any,
  configuredUserId: string
): void {
  const { identifiers, numericIdentifiers, urlnameIdentifiers } =
    currentUserIdentity(currentUserResponse);

  if (identifiers.length === 0) {
    throw new Error(
      "current-userのユーザーIDを確認できません。セッションCookieとNOTE_USER_IDを確認してください。"
    );
  }
  if (new Set(numericIdentifiers).size > 1 || new Set(urlnameIdentifiers).size > 1) {
    throw new Error(
      "current-userのユーザーIDが複数あり一致を確認できません。セッションCookieを確認してください。"
    );
  }
  if (!identifiers.includes(configuredUserId)) {
    throw new Error(
      "current-userのユーザーIDがNOTE_USER_IDと一致しません。NOTE_USER_IDまたはセッションCookieを確認してください。"
    );
  }
  verifiedConfiguredUserIdentifiers = new Set(identifiers);
}

export function extractXsrfTokenFromSetCookie(setCookieHeader: string): string | null {
  const match = /(?:^|[;,]\s*)XSRF-TOKEN=([^;,\s]+)/.exec(setCookieHeader);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function resolveXsrfToken(
  currentToken: string | null,
  responseXsrfToken: string | null,
  setCookieHeader: string | null
): string | null {
  if (responseXsrfToken) {
    try {
      return decodeURIComponent(responseXsrfToken);
    } catch {
      return responseXsrfToken;
    }
  }
  return setCookieHeader
    ? extractXsrfTokenFromSetCookie(setCookieHeader) || currentToken
    : currentToken;
}

function captureXsrfToken(response: any): void {
  activeXsrfToken = resolveXsrfToken(
    activeXsrfToken,
    response.headers.get("x-xsrf-token"),
    response.headers.get("set-cookie")
  );
}

export async function ensureAuthenticatedUser(): Promise<void> {
  if (!env.NOTE_USER_ID) {
    throw new Error("NOTE_USER_IDが必要です。設定ユーザーを指定してください。");
  }
  if (verifiedConfiguredUserId === env.NOTE_USER_ID) return;

  if (!hasSessionAuth()) {
    if (!env.NOTE_EMAIL || !env.NOTE_PASSWORD || !(await loginToNote())) {
      throw new Error("認証情報が必要です。.envファイルを確認してください。");
    }
  }

  let response: any;
  try {
    response = await fetch(`${API_BASE_URL}/v2/current_user`, {
      method: "GET",
      headers: { ...DEFAULT_HEADERS, ...buildAuthHeaders() },
    });
  } catch {
    throw new Error(
      "current-userのユーザーIDを確認できません。セッションCookieを確認してください。"
    );
  }

  if (!response.ok) {
    throw new Error(
      "current-userのユーザーIDを確認できません。セッションCookieを確認してください。"
    );
  }

  captureXsrfToken(response);
  let responseData: any;
  try {
    responseData = await response.json();
  } catch {
    throw new Error(
      "current-userのユーザーIDを確認できません。セッションCookieを確認してください。"
    );
  }

  assertCurrentUserMatchesConfiguredUser(responseData, env.NOTE_USER_ID);
  verifiedConfiguredUserId = env.NOTE_USER_ID;
}

// noteへのログイン処理を行う関数
export async function loginToNote(): Promise<boolean> {
  if (!env.NOTE_EMAIL || !env.NOTE_PASSWORD) {
    console.error("メールアドレスまたはパスワードが設定されていません。");
    return false;
  }

  const loginPath = "/v1/sessions/sign_in";
  let responseData: any = null; // responseDataを関数スコープで宣言
  const loginUrl = `${API_BASE_URL}${loginPath}`;

  try {
    if (env.DEBUG) {
      console.error("note login started");
    }

    const response = await fetch(loginUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36",
        Accept: "application/json",
      },
      body: JSON.stringify({ login: env.NOTE_EMAIL, password: env.NOTE_PASSWORD }),
    });

    const responseText = await response.text();
    if (env.DEBUG) {
      console.error(`Login response: ${response.status} ${response.statusText}`);
    }

    if (!response.ok) {
      console.error(`Login failed: ${response.status} ${response.statusText}`);
      return false;
    }

    // レスポンスボディからトークン情報取得を試みる
    try {
      responseData = JSON.parse(responseText); // 関数スコープのresponseDataに代入
      if (responseData?.data?.key) {
        setActiveUserKey(responseData.data.key);
      }
      if (responseData && responseData.data && responseData.data.token) {
        setActiveSessionCookie(`_note_session_v5=${responseData.data.token}`);
        console.error("Login successful. Session token obtained.");
      }
    } catch (e) {
      if (env.DEBUG) console.error("Failed to parse note login response");
    }

    // Set-Cookieヘッダーからの取得方法も残す
    const setCookieHeader = response.headers.get("set-cookie");
    if (setCookieHeader) {
      const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
      cookies.forEach((cookieStr) => {
        if (cookieStr.includes("_note_session_v5=")) {
          // セッションCookieを保存
          setActiveSessionCookie(cookieStr.split(";")[0]);
        } else if (cookieStr.includes("XSRF-TOKEN=")) {
          // XSRFトークンを保存（Cookieから）
          const tokenValue = cookieStr.split(";")[0].split("=")[1];
          activeXsrfToken = decodeURIComponent(tokenValue);
        }
      });
    }

    const responseXsrfToken = response.headers.get("x-xsrf-token");
    if (responseXsrfToken) {
      activeXsrfToken = decodeURIComponent(responseXsrfToken);
    } else if (env.DEBUG && !activeXsrfToken) {
      console.error("XSRF Token not found in initial login headers.");
    }

    if (!activeSessionCookie) {
      console.error("Login succeeded but session cookie was not found.");
      return false;
    }

    // console.error(`>>> Before 'Login successful' log: activeSessionCookie = ${activeSessionCookie}`);
    console.error("Login successful. Session cookie obtained.");

    // セッションクッキーが取得できたら、current_userリクエストでXSRFトークンを取得する
    // console.error(`>>> Checking condition for current_user API call: activeSessionCookie=${!!activeSessionCookie}, activeXsrfToken=${!!activeXsrfToken}`);
    if (activeSessionCookie && !activeXsrfToken) {
      console.error("Trying to obtain XSRF token from current_user API...");
      try {
        const currentUserResponse = await fetch(`${API_BASE_URL}/v2/current_user`, {
          method: "GET",
          headers: {
            Accept: "application/json",
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36",
            Cookie: activeSessionCookie,
          },
        });

        // XSRFトークンをヘッダーから取得
        const xsrfToken = currentUserResponse.headers.get("x-xsrf-token");
        if (xsrfToken) {
          activeXsrfToken = decodeURIComponent(xsrfToken);
          console.error("XSRF token successfully obtained from current_user API.");
        } else {
          // Set-Cookieヘッダーからも確認
          const currentUserSetCookieHeader = currentUserResponse.headers.get("set-cookie");
          // console.log(`>>> current_user API response Set-Cookie header: ${currentUserSetCookieHeader}`);
          if (currentUserSetCookieHeader) {
            const cookies = Array.isArray(currentUserSetCookieHeader)
              ? currentUserSetCookieHeader
              : [currentUserSetCookieHeader];
            cookies.forEach((cookieStr) => {
              if (cookieStr.includes("XSRF-TOKEN=")) {
                activeXsrfToken = decodeURIComponent(cookieStr.split(";")[0].split("=")[1]);
                console.error("XSRF token found in current_user response cookies.");
              }
            });
          }

          // activeXsrfToken がここでセットされていれば、後続の処理に進む
        }
      } catch (error) {
        console.error("Error fetching current_user for XSRF token");
      }
    }
    // console.log(`>>> After current_user API call: activeXsrfToken = ${activeXsrfToken}`);

    if (env.DEBUG) {
      // console.error(`>>> Login state check: session=${!!activeSessionCookie}, xsrf=${!!activeXsrfToken} (value: ${activeXsrfToken})`);
    }

    // Login success is primarily based on session cookie and XSRF token.
    // preview_access_token will be fetched by a dedicated function when needed.
    if (activeSessionCookie && activeXsrfToken) {
      console.error("Session cookie and XSRF token successfully obtained/confirmed.");
    } else if (activeSessionCookie) {
      console.warn(
        "Session cookie obtained, but XSRF token is missing. Further operations might fail."
      );
    } else {
      console.error("Failed to obtain session cookie. Login is considered unsuccessful.");
      return false; // Explicitly return false if session cookie is not obtained
    }

    return activeSessionCookie !== null;
  } catch (error) {
    console.error(`Error during note login: ${redactSensitiveValues(error)}`);
    return false;
  }
}

// 認証ヘッダーを構築する関数 (CookieとXSRFトークン専用)
export function buildAuthHeaders(): { [key: string]: string } {
  const headers: { [key: string]: string } = {};
  const cookies = [];

  // 動的に取得したCookieがある場合は優先
  if (activeSessionCookie) {
    cookies.push(activeSessionCookie);
    if (env.DEBUG) console.error("Using dynamically obtained session cookie for Cookie header");
    if (cookies.length > 0) {
      headers["Cookie"] = cookies.join("; ");
    }
  } else if (process.env.NOTE_ALL_COOKIES) {
    // すべてのCookieを使用（参照記事の方式）
    // XSRF-TOKENはヘッダーで送るのでCookieからは除外
    const cookiesWithoutXsrf = process.env.NOTE_ALL_COOKIES.split("; ")
      .filter((c) => !c.startsWith("XSRF-TOKEN="))
      .join("; ");
    headers["Cookie"] = cookiesWithoutXsrf;
    if (env.DEBUG)
      console.error("Using all cookies from .env file for Cookie header (XSRF-TOKEN excluded)");
  } else if (env.NOTE_SESSION_V5) {
    // .envファイルのセッションCookieを使用
    cookies.push(`_note_session_v5=${env.NOTE_SESSION_V5}`);
    if (env.DEBUG) console.error("Using session cookie from .env file for Cookie header");
    if (cookies.length > 0) {
      headers["Cookie"] = cookies.join("; ");
    }
  }

  // XSRFトークンの設定 (ヘッダー用)
  // 動的に取得したトークンを優先（ログインで取得した新しいトークンを使用）
  if (activeXsrfToken) {
    headers["X-XSRF-TOKEN"] = activeXsrfToken;
    if (env.DEBUG) console.error("Using dynamically obtained XSRF token for X-XSRF-TOKEN header");
  } else if (env.NOTE_XSRF_TOKEN) {
    headers["X-XSRF-TOKEN"] = env.NOTE_XSRF_TOKEN;
    if (env.DEBUG) console.error("Using XSRF token from .env file for X-XSRF-TOKEN header");
  }

  // note.comの書き込みAPIはdouble-submit CSRF検証を行うため、
  // X-XSRF-TOKENヘッダーと同じ値をXSRF-TOKEN Cookieにも含める。
  const xsrfToken = headers["X-XSRF-TOKEN"];
  if (headers["Cookie"] && xsrfToken && !/(^|;\s*)XSRF-TOKEN=/.test(headers["Cookie"])) {
    let decodedToken = xsrfToken;
    try {
      decodedToken = decodeURIComponent(xsrfToken);
    } catch {
      // 既にデコード済み、または不正なpercent encodingの場合は元の値を使用する。
    }
    headers["Cookie"] += `; XSRF-TOKEN=${encodeURIComponent(decodedToken)}`;
  }

  // User-Agentは常に設定
  headers["User-Agent"] =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36";

  return headers;
}

// preview_access_tokenを取得する関数
export async function getPreviewAccessToken(noteId: string): Promise<string | null> {
  if (!activeSessionCookie || !activeXsrfToken) {
    console.error("Cannot get preview_access_token: Session cookie or XSRF token is missing.");
    return null;
  }
  if (!noteId) {
    console.error("Cannot get preview_access_token: noteId is missing.");
    return null;
  }

  const url = `${API_BASE_URL}/api/v2/notes/${noteId}/access_tokens`;
  const headers = buildAuthHeaders(); // これには Cookie と X-XSRF-TOKEN が含まれる
  headers["Content-Type"] = "application/json"; // POSTリクエストのため

  if (env.DEBUG) {
    console.error("preview access token request started");
  }

  try {
    const response = await fetch(url, {
      method: "POST", // ユーザーの分析に基づきPOSTメソッドを使用
      headers: headers,
      body: JSON.stringify({}), // 空のJSONボディと仮定
    });

    const responseText = await response.text();
    if (env.DEBUG) {
      console.error(`PreviewAccessToken API response: ${response.status} ${response.statusText}`);
    }

    if (!response.ok) {
      console.error(`Failed to get preview_access_token: ${response.status}`);
      return null;
    }

    const responseJson = JSON.parse(responseText);
    const token = responseJson?.data?.preview_access_token;

    if (token) {
      console.error("Preview access token successfully obtained.");
      return token;
    } else {
      console.error("Preview access token not found in response.");
      return null;
    }
  } catch (error) {
    console.error(`Error obtaining preview_access_token: ${redactSensitiveValues(error)}`);
    return null;
  }
}
