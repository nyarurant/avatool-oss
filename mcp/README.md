# Avatool MCP

## 設定画面から自動セットアップ

Avatool の「設定 → AI連携」では、Codex と Claude Code の状態確認と自動セットアップを実行できます。自動セットアップはボタンを押した場合だけ次を行います。

- 共通 Skill `avatool-mcp` を Codex の `%USERPROFILE%\.agents\skills\avatool-mcp` と Claude Code の `%USERPROFILE%\.claude\skills\avatool-mcp` に配置
- ユーザー単位の stdio MCP `avatool` を両CLIへ登録
- Skill と MCP の登録内容を再確認し、再起動が必要な場合は設定画面へ表示

Skill は Avatool が管理したコピーだけを自動更新します。同名のユーザー作成 Skill や、配置後に手編集された Skill は上書きしません。配布版では Avatool 実行ファイルを `ELECTRON_RUN_AS_NODE=1` で起動するため、別途 Node.js のインストールは不要です。MCP のポートは固定せず、Avatool が `%APPDATA%\avatool\data\mcp-endpoint.json` に書く現在の loopback endpoint をクライアントが読み取ります。

Avatool のローカル管理機能を Codex / Claude Code から操作するための MCP サーバーです。MCP は標準入出力で動作し、実アプリへは一時的な loopback bridge だけで接続します。

## 接続・結果の安全境界

- bridge の接続先は canonical な `http://127.0.0.1:<port>/call` だけです。endpoint ファイルから取得した bearer token はこの URL にのみ送信し、token は必須です。
- MCP 呼び出しには無限待ちを許可しません。通常の呼び出しは 120 秒、長時間操作は 10 分、Unity import は 35 分で timeout になります。
- `set_wishlist` は Avatool ローカル状態と BOOTH を同じ希望状態へ同期します。結果の `localChanged` はローカルライブラリを変更したか、`boothSynced` は BOOTH 同期が確認できたかを表します。ローカル更新後に BOOTH 同期が失敗した場合は `ok: false`, `partial: true`, `localChanged: true`, `boothSynced: false`, `boothError` を返し、成功として扱いません。

## 起動と登録

```powershell
npm run mcp:bridge

codex.cmd mcp add avatool -- node C:\Avatool\mcp\server.js
claude mcp add --scope user avatool -- node C:\Avatool\mcp\server.js
```

`mcp:bridge` は UI、スケジューラー、VCC watcher、AutoBootstrap を起動しないヘッドレスモードです。BOOTH Cookie は Electron の safeStorage を使うため、bridge は Electron 内で動作します。

## ツール（37個）

### 読み取り・確認（23個）

- `avatool_status` — アプリ、ライブラリ、キューの概要。
- `list_assets` — `query`, `limit` でライブラリを列挙。
- `get_asset` — `itemId` の詳細を取得。
- `search_assets` — `query`, `limit` でライブラリを検索。
- `list_unity_projects` — 登録済み Unity プロジェクトと起動状態を取得。
- `get_download_queue` — ダウンロードキューの状態を取得。
- `get_settings` — 許可された設定を取得。秘匿値は返しません。
- `get_operation_logs` — `limit` 件の操作ログを取得。
- `run_health_check` — ヘルスチェックを実行。
- `get_storage_usage` — 使用容量を取得。
- `list_item_files` — `itemId`, `limit` で展開済みファイルを列挙。
- `list_unitypackages` — `itemId` の UnityPackage を列挙。
- `get_project_items` — `projectPath` のインポート済みアイテムを取得。
- `search_booth` — `query`, `page`, `sort` で BOOTH を検索。
- `get_booth_item` — `itemId` の BOOTH 詳細を取得。
- `list_bootstrap_choices` — AutoBootstrap の選択肢を取得。
- `get_booth_cart` — `shopSubdomain`（省略可）の BOOTH カートを取得。
- `list_settings_profiles` — 保存済み設定プロファイル名を取得。
- `get_import_history` — `itemId`（省略可）、`limit` で Unity インポート履歴を取得。
- `scan_unitypackage` — `itemId` と `packagePath`（`__extracted` 配下の相対パス、省略時は全件）を解析。
- `analyze_vpm_dependencies` — 登録済み `projectPath` と `itemId`（省略可）の依存関係を解析。
- `get_runtime_logs` — `limit` 件の実行時ログを取得。
- `check_app_update` — 更新有無だけを確認。ダウンロード・インストールはしません。

### 変更操作（14個、すべて `confirm: true` 必須）

- `sync_library` — BOOTH ライブラリを同期。
- `download_item` — `itemId` をダウンロードキューへ追加。
- `import_asset_to_unity` — `itemId`, `projectPath`, `importMode`（`background` / `live`）で Unity へインポート。
- `control_download_queue` — `action`（`stop` / `resume` / `retry_failed`）でキューを制御。
- `extract_item` — `itemId`, `force`（省略可）でアーカイブを展開。
- `install_vpm_dependencies` — `projectPath` に `modularAvatar` / `liltoon` をインストール。
- `run_auto_bootstrap` — `projectPath` の AutoBootstrap を開始。
- `set_wishlist` — `itemId`, `wishlisted` で Avatool / BOOTH Wishlist を更新。
- `import_booth_wishlist` — BOOTH Wishlist を Avatool ライブラリへ取り込む。
- `add_to_booth_cart` — `itemId`, `variationName`（省略可）を BOOTH カートへ追加。
- `update_settings` — `patch` の許可済み設定だけを更新。Cookie・token 類は受け付けません。
- `apply_settings_profile` — `profileName` の設定プロファイルを適用。
- `save_settings_profile` — 現在の許可済み設定を `profileName` で保存。
- `clear_operation_logs` — 保存済み操作ログを消去。

## 安全境界

- bridge は `127.0.0.1` のランダムポートのみで待ち受け、短命 bearer token を `%APPDATA%\avatool\data\mcp-endpoint.json` に保存します。
- 公開ツールは allowlist 方式です。任意の IPC、シェル実行、任意 URL のダウンロード、更新のダウンロード／インストールは公開しません。
- 秘匿キーは入出力から除外します。
- `scan_unitypackage` は既知ライブラリの `__extracted` 配下だけを対象とし、絶対パス、`..` traversal、シンボリックリンク／ルート外ファイルを拒否します。
- 変更操作は MCP クライアントが `confirm: true` を明示しない限り実行されません。
