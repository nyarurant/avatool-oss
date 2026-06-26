# Avatool — Agent Instructions

このファイルは AI エージェント（Claude Code / Codex / その他）向けのプロジェクト仕様書 兼 運用ルールです。
作業前に必ず読むこと。

---

## プロジェクト概要

**Avatool** は Electron v38 + Node.js 製の Windows 向けデスクトップアプリ。
VRChat アバター向けの BOOTH 購入アセットを管理するツールで、以下を自動化する。

- BOOTH 購入物のライブラリ同期・バージョントラッキング
- ZIP / unitypackage のキューダウンロード・自動展開
- Unity プロジェクトへのバッチインポート / ライブインポート
- VCC (VRChat Creator Companion) プロジェクト同期
- MA (Modular Avatar) / lilToon / NDMF の VPM 自動インストール

**現行バージョン**: `package.json` の `version` を正とすること（固定値をこのファイルに転記しない）。

---

## ディレクトリ構成

```
Avatool/
├─ main.js                    # Electron メインプロセス
├─ render.js                  # レンダラープロセス UI ロジック
├─ preload.js                 # IPC コンテキストブリッジ
├─ asset_manager.html         # 主 UI（Tailwind CSS）
├─ log_window.html            # ログウィンドウ
│
├─ lib/                       # モジュール群（ファイル数は変動するため実ファイルを確認）
│   ├─ ipc_handlers.js        # IPC ハンドラ一括登録
│   ├─ settings_manager.js    # 設定読み書き・normalize
│   ├─ meta_manager.js        # ライブラリメタ管理
│   ├─ download_queue.js      # ダウンロードキュー
│   ├─ unity_manager.js       # Unity インポート・解析・Worker 制御
│   ├─ vpm_manager.js         # VPM パッケージ管理
│   ├─ app_updater.js         # 自動更新
│   ├─ log_manager.js         # 操作ログ
│   ├─ booth_meta_fetcher.js  # BOOTH API・メタ取得
│   ├─ booth_downloader.js    # ファイルダウンロード・ZIP展開
│   ├─ booth_cookie_store.js  # Cookie 暗号化（Electron safeStorage）
│   ├─ booth_session_manager.js
│   ├─ autobootstrap_service.js
│   ├─ vcc_sync_service.js
│   ├─ unity_reconcile_worker.js  # Worker thread
│   ├─ unity_editor_support.js
│   ├─ utils.js               # 共通ユーティリティ（純粋関数）
│   ├─ storage_manager.js
│   ├─ health_check_service.js
│   ├─ app_bootstrap.js
│   ├─ unity_package_scanner.js
│   ├─ scheduler_service.js
│   ├─ login_window.js
│   ├─ window_manager.js
│   └─ export_bundle.js
│
├─ scripts/
│   ├─ build-and-upload-avatool.js  # ビルド＋CDN アップロード
│   ├─ smoke_test.js                # 統合テスト（Node.js）
│   ├─ ui_probe.js                  # UIプローブ
│   ├─ debug-data-reset.js
│   └─ debug-import.js
│
├─ __tests__/                 # Jest ユニットテスト（件数は `npm run test:unit` を正とする）
│
├─ PatchNote/                 # バージョン別パッチノート
├─ DevNote/                   # 開発者向け技術メモ（YYYY-MM/ サブディレクトリ）
└─ .claude/                   # Claude Code 用設定（CLAUDE.md 含む）
```

---

## アーキテクチャ

### 依存注入（DI）パターン

すべての `lib/` モジュールは `create<Name>Manager(deps)` ファクトリ形式。
`main.js` が deps を構築して `registerIpcHandlers(deps)` に渡す。

```js
// main.js の初期化フロー（概略）
const settingsMgr = createSettingsManager({ fs, path, app, DEFAULT_SETTINGS, ... });
const unityMgr    = createUnityManager({ fs, path, spawn, Worker, ... });

registerIpcHandlers({
  ipcMain, app, shell, dialog, BrowserWindow, session,
  settingsMgr, logMgr, metaMgr, downloadQueue, vpmMgr, unityMgr,
  // + 定数・アダプタ関数 多数
});
```

**テスト時は deps にモックを渡すことで Electron 不要でユニットテスト可能。**

### Cookie 暗号化

`lib/booth_cookie_store.js` は `electron.safeStorage.encryptString` で Cookie を暗号化。
Electron App-Bound Encryption (v28+) により **同一バイナリからのみ復号可能**。
Node.js 単体では復号できない → Cookie 関連テストは `npm start -- --smoke-test` で実施。

---

## コマンド一覧

```bash
# 開発起動
npm start

# テスト
npm run test:unit           # Jest ユニットテスト
npm run test:unit:coverage  # カバレッジ付き
npm run test:unit:watch     # ウォッチモード
node scripts/smoke_test.js  # 統合テスト（25件）
npm run test:ui-probe       # UIプローブ
npm start -- --smoke-test   # Electron 内テスト（Cookie/Booth API）

# ビルド・リリース（パッチバージョン自動インクリメント）
npm run release:upload

# CSS ビルド（Tailwind）
npm run build:css
```

---

## データパス（実行時）

| 用途 | パス |
|------|------|
| 設定ファイル | `%APPDATA%/avatool/data/settings.json` |
| ライブラリメタ | `%APPDATA%/avatool/data/librarymeta.json` |
| Cookie | `%APPDATA%/avatool/data/booth.pm.json` |
| ダウンロード | `%APPDATA%/avatool/data/downloads/<itemId>_<name>/` |

---

## ユニットテストを書くときの注意

- `jest.fn()` で deps をモックして `createXxxManager(deps)` に渡す
- `toHaveProperty('a.b')` はドットをネスト記法として解釈する → ドット含みキーは `toHaveProperty(['a.b'])` を使うこと
- `Number(null) = 0`（有限数）→ `toFiniteNumber(null, fallback)` は `0` を返す（fallback ではない）
- Electron 依存（safeStorage, ipcMain 等）が必要なテストは `npm start -- --smoke-test` で実施。Jest では不可。

## UIデバッグ方針

- UI/表示/操作性の不具合は、ログ確認だけで結論を出さず、可能な限り DOM 状態とスクリーンショットで確認する。
- UIバグ対応は原則として「コードチェックで疑わしい箇所を見つける → DOMデバッグで実害を確認する → 修正する → DOMデバッグで修正結果を確認する」の順で行う。
- UIデバッグでは、まず本番相当の Avatool 起動環境を DevTools Protocol / Playwright / in-app browser 相当の手段で DOM inspect し、クリック・入力・表示状態・console error・スクリーンショットを確認する。
- `npm run test:ui-probe` は合成データでの補助確認が必要な場合だけ使う。実データ依存・実画面依存の確認では CDP/DOM 操作を優先する。
- 本番相当環境を操作する場合、読み取り・表示確認・非破壊クリックを基本とする。ダウンロード、Unityインポート、削除、ログアウト、設定保存など状態を変える操作は、必要性を説明してユーザー確認を得てから実行する。
- UI変更を行った場合は、該当画面の代表状態（通常、空、読み込み中、エラー、モーダル表示など）を少なくとも1つ以上 DOM/スクリーンショットで確認する。

---

## 運用ルール

### ビルド・リリース

- ビルド時は必ずパッチバージョンをインクリメントする（例: `1.2.3` → `1.2.4`）
- ビルド後は必ず成果物をアップロードする
- アップロードトークンは常に **`***REMOVED-UPLOAD-TOKEN***`** を使用する
- コードを変更したタスクでは、リリース有無に関わらず PatchNote と DevNote を両方更新する
- 配布物に Codex/Claude 作業ログ、一時デバッグ素材、調査用HTML/JSON/ZIPを含めない。`package.json` の `build.files` と `scripts/build-and-upload-avatool.js` の source archive 除外ルールを両方確認する
- `PatchNote/` と `DevNote/` はアプリ本体には含めない。CDNへアップロードする `source-<version>.zip` には含めてよい

### PatchNote ルール

- ファイル: `PatchNote/PatchNote<version>.md`
- **現行バージョンではなく次回リリース予定バージョン** に記載する
- ユーザーに体感できる変更のみ記載（機能追加・不具合修正・UI改善）
- 内部改善のみ → 「このバージョンにユーザー影響のある変更はありません。」の一文だけでよい
- デバッグ専用機能（Log Window 等）の変更は PatchNote に書かない
- 既存 PatchNote ファイルは削除・他バージョンへの移動禁止

### DevNote ルール

- ファイル: `DevNote/YYYY-MM/DevNote-YYYY-MM-DD[-topic].md`
- **AIモデル名**（例: `model: claude-sonnet-4-6`）を必ず記載
- **`build_at`** と **`update_at`** を ISO 8601 形式で必ず記載（ビルド未実施は `N/A`）
- 内部変更理由・実装詳細・既知制限・将来案を自由に記載してよい
- ユーザー影響がある内容のみ、必要に応じて PatchNote へ要約反映する

---

## 既知の制約

| 項目 | 内容 |
|------|------|
| Cookie 復号 | Electron バイナリ固有。外部プロセスから復号不可 |
| ライブインポート | Unity Editor 起動中が前提。自動テスト不可 |
| Worker タイムアウト | unity_reconcile_worker に 120秒タイムアウト設定済み |
| PatchNote 1.0.329 | リリースされなかったバージョン。削除不可の孤立ファイル |
