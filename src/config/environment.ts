import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// ESMでの__dirnameの代替
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 環境変数を読み込む（ビルドディレクトリを考慮）
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env") });

export interface Environment {
  DEBUG: boolean;
  NOTE_SESSION_V5: string;
  NOTE_XSRF_TOKEN: string;
  NOTE_EMAIL: string;
  NOTE_PASSWORD: string;
  NOTE_USER_ID: string;
}

export const env: Environment = {
  DEBUG: process.env.DEBUG === "true",
  NOTE_SESSION_V5: process.env.NOTE_SESSION_V5 || "",
  NOTE_XSRF_TOKEN: process.env.NOTE_XSRF_TOKEN || "",
  NOTE_EMAIL: process.env.NOTE_EMAIL || "",
  NOTE_PASSWORD: process.env.NOTE_PASSWORD || "",
  NOTE_USER_ID: process.env.NOTE_USER_ID || "",
};
