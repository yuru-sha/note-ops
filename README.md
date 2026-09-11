# note-ops

note.comの記事と下書きを管理するための最小MCPサーバーです。

現在はローカルstdioトランスポートと、下書き中心のMVPだけを提供します。

---

## 🚀 クイックスタート

### 1. インストール

```bash
git clone https://github.com/yuru-sha/note-ops.git
cd note-ops
npm install
npm run build
```

### 2. 認証設定

```bash
cp .env.sample .env
```

`.env` を編集：

```env
NOTE_EMAIL=your-email@example.com
NOTE_PASSWORD=your-password
NOTE_USER_ID=your_note_user_id
# Existing session credentials are preferred for the MVP:
# NOTE_SESSION_V5=your_session_cookie_value
# NOTE_XSRF_TOKEN=your_xsrf_token
```

`.env` は `.gitignore` に含まれています。認証値はログやMCPレスポンスに出力せず、コミットしないでください。

### 3. 起動

**stdioモード（Claude Desktop / Claude Code / Cursor）:**

```bash
npm run start
```

MVPではstdioモードのみを提供します。

## 🔌 トランスポート

### stdioモード（デフォルト）

ローカルのMCPクライアントから直接起動される標準的な接続方式です。

```bash
node build/index.js
```

## ✨ MVPツール

| Tool | 用途 | 認証 |
|---|---|---|
| `get-my-notes` | 自分の記事・下書き一覧 | 必須 |
| `get-note` | 記事・下書き詳細 | 必須 |
| `post-draft-note` | 新規下書き作成・更新 | 必須 |
| `edit-note` | 下書き保存（公開しない） | 必須 |
| `open-note-editor` | 編集URL生成 | `NOTE_USER_ID` |

## 📋 旧実装に残るTool一覧（MVP未登録）

MVPで有効なToolは次の5つです。

- `get-my-notes` - 自分の記事・下書き一覧
- `get-note` - 記事・下書き詳細
- `post-draft-note` - 新規下書き作成・更新
- `edit-note` - 下書き保存（公開しない）
- `open-note-editor` - 編集URL生成

検索、画像、コメント、スキ、公開、Notion、Obsidian、HTTP/n8n、メンバーシップはMVP対象外です。

以下の一覧は移行前の実装に残っているToolの記録で、MVPのデフォルトサーバーには登録されません。

### 検索・分析（認証不要）

- `search-notes` - 記事検索（新着/人気/急上昇）
- `search-all` - note全体検索
- `analyze-notes` - 記事詳細分析
- `get-note` - 記事詳細取得
- `search-users` - ユーザー検索
- `get-user` - ユーザー情報取得
- `get-user-notes` - ユーザーの記事一覧
- `search-magazines` - マガジン検索
- `get-magazine` - マガジン詳細
- `get-category-notes` - カテゴリー別記事一覧
- `list-categories` - カテゴリー一覧
- `list-hashtags` - ハッシュタグ一覧
- `get-hashtag` - ハッシュタグ詳細
- `get-comments` - コメント一覧
- `get-likes` - スキ一覧
- `list-contests` - コンテスト一覧

### 投稿・編集（認証必須）

- `post-draft-note` - 下書き作成（Markdown自動変換）
- `get-my-notes` - 自分の記事一覧（下書き含む）
- `open-note-editor` - 記事の編集ページを開く

### インタラクション（認証必須）

- `post-comment` - コメント投稿
- `like-note` / `unlike-note` - スキ機能
- `add-magazine-note` / `remove-magazine-note` - マガジン管理
- `get-stats` - PV統計情報
- `get-notice-counts` - 通知件数
- `get-search-history` - 検索履歴

### メンバーシップ（認証必須）

- `get-membership-summaries` - 加入済みメンバーシップ一覧
- `get-membership-plans` - メンバーシッププラン一覧
- `get-membership-notes` - メンバーシップの記事一覧
- `get-circle-info` - サークル情報

## 🔧 設定方法

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "note-api": {
      "command": "node",
      "args": ["/path/to/note-ops/build/index.js"],
      "env": {
        "NOTE_EMAIL": "your_email@example.com",
        "NOTE_PASSWORD": "your_password",
        "NOTE_USER_ID": "your_note_user_id"
      }
    }
  }
}
```

### Claude Code

`~/.claude/settings.json` の `mcpServers` に追加：

```json
{
  "mcpServers": {
    "note-api": {
      "command": "node",
      "args": ["/path/to/note-ops/build/index.js"],
      "cwd": "/path/to/note-ops",
      "env": {
        "NOTE_EMAIL": "your_email@example.com",
        "NOTE_PASSWORD": "your_password",
        "NOTE_USER_ID": "your_note_user_id"
      }
    }
  }
}
```

### Cursor

`~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "note-api": {
      "command": "node",
      "args": ["/path/to/note-ops/build/index.js"],
      "env": {
        "NOTE_EMAIL": "your_email@example.com",
        "NOTE_PASSWORD": "your_password",
        "NOTE_USER_ID": "your_note_user_id"
      }
    }
  }
}
```

### Windsurf

`~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "note-api": {
      "command": "node",
      "args": ["/path/to/note-ops/build/index.js"],
      "env": {
        "NOTE_EMAIL": "your_email@example.com",
        "NOTE_PASSWORD": "your_password",
        "NOTE_USER_ID": "your_note_user_id"
      }
    }
  }
}
```

> `/path/to/note-ops` は実際のプロジェクトの絶対パスに置き換えてください。

## 🔐 認証フロー

MVPでは `NOTE_SESSION_V5` と `NOTE_XSRF_TOKEN` を優先して使用します。`NOTE_EMAIL` と `NOTE_PASSWORD` による直接ログインも利用できます。認証値をログへ出力しないでください。

## 📝 Markdown変換ルール

投稿時のMarkdownは自動的にnote.com用HTMLに変換されます。

| Markdown | note.com | HTML |
|----------|----------|------|
| `# H1` / `## H2` | 大見出し | `<h2>` |
| `### H3` | 小見出し | `<h3>` |
| `#### H4-H6` | 太字 | `<strong>` |
| `![[image.png]]` | 画像 | `<figure><img>` |
| `- リスト` | 箇条書き | `<ul><li>` |

## 💡 使い方の例

### 下書き保存（認証必須）

```
タイトル「技術メモ」、本文「## 概要\n\n本文」で下書きを作成して
```

## ⚠️ 注意点

- **投稿機能**: 下書き作成のみ対応です。公開はnote.comから直接行ってください
- **認証**: note.comの非公開API仕様変更で動作しなくなる可能性があります

## 🛠️ 開発

```bash
# ビルド
npm run build

# 開発モード（ファイル監視）
npm run dev:watch

# オフライン回帰テスト
npm test
```

## 📄 ライセンス

MIT License
