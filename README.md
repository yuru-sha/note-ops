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

仕様の詳細は [SPEC.md](SPEC.md) を参照してください。note.comの非公開API仕様変更により動作しなくなる可能性があります。
