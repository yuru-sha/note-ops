# note-ops

[English](README.md) | [日本語](README.ja.md)

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/yuru-sha/note-ops)

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

認証対象の一覧取得・詳細取得・下書き作成・下書き編集には、`NOTE_USER_ID` と、既存セッション（`NOTE_SESSION_V5`。下書き操作では `NOTE_XSRF_TOKEN` またはセッション応答のXSRFトークンを使用）、`NOTE_ALL_COOKIES`、または `NOTE_EMAIL` と `NOTE_PASSWORD` の直接ログインを設定します。認証値はコミットせず、ログやMCPレスポンスに出力しないでください。

認証対象の操作では、note.com の `current_user` と `NOTE_USER_ID` が一致することを事前に確認します。`get-note`、`edit-note`、`set-note-eyecatch` では記事の所有者も確認します。`get-note` に numeric ID を渡した場合は、認証済みユーザーの記事一覧から note key を解決して詳細を取得します。`open-note-editor` も numeric ID の場合は認証済みユーザーの記事一覧から note key を解決し、`https://editor.note.com/notes/<note-key>/edit/` を返します。一致しない、所有者を確認できない、note key を解決できない、または認証に失敗した場合は処理を中止し、秘密情報を含まないエラーを返します。記事キーを直接渡した場合の `open-note-editor` は一覧取得を行いません。

## MCPツール

| Tool | 用途 | 変更範囲 |
|---|---|---|
| `get-my-notes` | 自分の記事・下書き一覧 | 読み取り |
| `get-note` | 記事・下書き詳細 | 読み取り |
| `post-draft-note` | 新規下書き作成・更新 | 下書き保存 |
| `edit-note` | 既存記事を下書き保存 | 下書き保存 |
| `set-note-eyecatch` | 自分の下書きにローカル画像をタイトル画像として設定 | 下書きメタデータ更新 |
| `open-note-editor` | 編集URL生成 | 読み取り |

公開、コメント、スキ、本文画像のアップロード、検索、Notion、Obsidian、HTTP/n8n、ブラウザ自動化はMVPの対象外です。公開操作はnote.comから行ってください。タイトル画像は、認証済みの自分の下書きに対して、実寸1280x670pxのPNG/JPEG/GIF/WebPローカルファイル（10MB以下）だけを設定できます。公開済み記事には設定できません。`post-draft-note` は note.com の create response、または認証済み下書き一覧から実際の note key を返します。

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
- `NOTE_SESSION_V5`、`NOTE_ALL_COOKIES`、または `NOTE_EMAIL` と `NOTE_PASSWORD`（read smoke は `NOTE_SESSION_V5` だけで実行可）

```bash
npm run test:live
```

read smoke は `current_user` の一致と記事詳細の設定ユーザー所有を確認します。下書きの作成・編集まで確認する場合だけ `NOTE_LIVE_DRAFT_TESTS=true` も設定してください。下書きへのアイキャッチ設定と読み戻しまで確認する場合は、さらに `NOTE_LIVE_EYECATCH_TESTS=true` を設定してください。`NOTE_ALL_COOKIES` と `NOTE_LIVE_DRAFT_TESTS=true` で live draft smoke を実行する場合は事前チェックのため `NOTE_XSRF_TOKEN` も設定してください。実行時刻を含む `[note-ops live smoke ...]` のタイトルで識別できる下書きを作成し、返された note key で詳細を読み戻し、編集後に認証済みの下書き一覧への再取得で未公開状態を確認したうえで残します。アイキャッチ smoke はリポジトリ内のテスト画像を設定し、詳細取得と下書き一覧で確認します。作成した下書きは自動削除せず、cleanupする場合はその実行で作成した下書きだけを明示的に対象にしてください。live smoke は資格情報や full response body を出力しません。失敗時は操作名と確認事項だけを redacted して表示します。

仕様の詳細は [SPEC.md](SPEC.md) を参照してください。note.comの非公開API仕様変更により動作しなくなる可能性があります。

## GitHub Release

See [docs/agents/release.md](docs/agents/release.md) for the release note format and creation procedure. The shared body template is [.github/release-notes-template.md](.github/release-notes-template.md), and the generated-note categories are managed in [.github/release.yml](.github/release.yml).
