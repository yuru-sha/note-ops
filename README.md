# note-ops

note.comの記事と下書きを管理するための、ローカルstdio MCPサーバーです。
現在は下書き中心のMVPだけを提供しています。

## クイックスタート

```bash
git clone https://github.com/yuru-sha/note-ops.git
cd note-ops
npm ci
cp .env.sample .env
npm run build
npm start
```

`.env` に `NOTE_USER_ID` と、既存セッションの `NOTE_SESSION_V5`／`NOTE_XSRF_TOKEN` を設定してください。メールアドレスとパスワードによる直接ログインも任意で利用できます。認証値はコミットせず、ログやMCPレスポンスに出力しないでください。

認証済みの一覧取得・読み取り・下書き作成・下書き編集では、note.com の `current_user` と `NOTE_USER_ID` が一致することを事前に確認します。一致しない、またはユーザーIDを取得できないセッションでは処理を中止します。`NOTE_ALL_COOKIES` と直接ログインも同じ確認対象です。

## MCPツール

| Tool | 用途 | 変更範囲 |
|---|---|---|
| `get-my-notes` | 自分の記事・下書き一覧 | 読み取り |
| `get-note` | 記事・下書き詳細 | 読み取り |
| `post-draft-note` | 新規下書き作成・更新 | 下書き保存 |
| `edit-note` | 既存記事を下書き保存 | 下書き保存 |
| `open-note-editor` | 編集URL生成 | 読み取り |

公開、コメント、スキ、画像アップロード、検索、Notion、Obsidian、HTTP/n8n、ブラウザ自動化はMVPの対象外です。公開操作はnote.comから行ってください。

## MCPクライアント設定例

```json
{
  "mcpServers": {
    "note-ops": {
      "command": "node",
      "args": ["/path/to/note-ops/build/index.js"]
    }
  }
}
```

## 開発

```bash
npm run build
npm test
```

### 認証済み live smoke test（任意）

通常の `npm test` は認証情報を使いません。note.com の現在の API に対する確認は、次の環境変数を設定して別コマンドで実行します。

- `NOTE_LIVE_TESTS=true`（必須の明示的 opt-in）
- `NOTE_USER_ID`（必須）
- `NOTE_LIVE_NOTE_ID`（detail read 用の既存記事または下書きの ID／key）
- `NOTE_SESSION_V5` と `NOTE_XSRF_TOKEN`、`NOTE_ALL_COOKIES`、または `NOTE_EMAIL` と `NOTE_PASSWORD`

```bash
npm run test:live
```

read smoke は `current_user` の一致と記事詳細の設定ユーザー所有を確認します。下書きの作成・編集まで確認する場合だけ `NOTE_LIVE_DRAFT_TESTS=true` も設定してください。`NOTE_ALL_COOKIES` を使う場合は `NOTE_XSRF_TOKEN` も必要です。実行時刻を含む `[note-ops live smoke ...]` のタイトルで識別できる下書きを作成・編集し、認証済みの下書き一覧への再取得で未公開状態を確認したうえで残します。作成した下書きは自動削除せず、cleanupする場合はその実行で作成した下書きだけを明示的に対象にしてください。live smoke は資格情報や full response body を出力しません。失敗時は操作名と確認事項だけを redacted して表示します。

仕様の詳細は [SPEC.md](SPEC.md) を参照してください。note.comの非公開API仕様変更により動作しなくなる可能性があります。
