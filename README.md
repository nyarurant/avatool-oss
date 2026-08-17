<p align="center">
  <img src="assets/icons/icons/256x256.png" width="112" alt="Avatool" />
</p>

<h1 align="center">Avatool</h1>

<p align="center">
  <strong>BOOTH の購入アセット管理から Unity インポートまでをまとめて自動化する、VRChat クリエイター向け Windows デスクトップツール。</strong>
</p>

<p align="center">
  Library sync → Download → Extract → Unity import → VCC / VPM setup
</p>

<p align="center">
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows-0078D4?logo=windows&logoColor=white" />
  <img alt="Electron" src="https://img.shields.io/badge/Electron-43-47848F?logo=electron&logoColor=white" />
  <img alt="License" src="https://img.shields.io/badge/license-ISC-green" />
</p>

<p align="center">
  <img src="assets/demo/avatool-demo.gif" width="820" alt="Avatool demo: BOOTH asset download and Unity import workflow" />
</p>

<p align="center">
  <a href="#overview">概要</a> ·
  <a href="#demo">Demo</a> ·
  <a href="#features">機能</a> ·
  <a href="#setup">セットアップ</a> ·
  <a href="#development">開発</a> ·
  <a href="#limitations">制限</a>
</p>

---

<a id="overview"></a>
## Avatool とは

**Avatool** は、VRChat アバター改変で繰り返し発生する BOOTH アセット管理と Unity への導入作業をまとめて処理する Electron アプリです。

BOOTH で購入したアセットを一覧化し、更新差分を確認し、必要なファイルをダウンロードして展開し、`.unitypackage` を Unity プロジェクトへ投入するところまでを 1 つの UI から扱えます。

VCC / VPM とも連携できるため、新しいプロジェクトに Modular Avatar、NDMF、liltoon などを導入する初期セットアップも自動化できます。

> **English summary:** Avatool is a Windows desktop application for VRChat creators that automates the BOOTH asset lifecycle: library synchronization, downloads, archive extraction, Unity imports, VCC/VPM integration, and repeatable project setup.

### 何が変わるか

| 手作業 | Avatool |
|---|---|
| BOOTH の購入ページを何度も開く | 購入ライブラリを一覧化して同期 |
| zip / 7z / rar を手で展開する | ダウンロード後に自動展開 |
| `.unitypackage` を探して Unity にドラッグする | 対象パッケージを収集してインポート |
| 「どのプロジェクトに入れたか」を覚えておく | インポート履歴を記録 |
| 更新された商品を自分で探す | 再同期時に更新差分を検出 |
| MA / NDMF / liltoon を新規プロジェクトごとに入れる | VCC / VPM 連携で初期導入を自動化 |
| 複数プロジェクトへ同じ操作を繰り返す | ルールとキューでまとめて処理 |

### 基本フロー

```text
BOOTH library
     │
     ▼
Library sync / diff detection
     │
     ▼
Download
     │
     ▼
Archive extraction
     │
     ▼
.unitypackage collection
     │
     ├── Unity running ──► Live import
     │
     └── Unity closed  ──► batchmode import
                              │
                              ▼
                    History / metadata
```

---

<a id="demo"></a>
## Demo

### Download → Unity import

ダウンロードボタンを押すと、進捗表示を伴ってファイルを取得し、zip / 7z / rar を自動展開します。展開後に収集された `.unitypackage` から対象を選び、Unity 起動中なら Live import、閉じていてもバックグラウンドインポートを選べます。

<p align="center">
  <img src="assets/demo/avatool-demo.gif" width="820" alt="Download to Unity import demo" />
</p>

### ライブラリ同期・更新確認

「更新アクション」からライブラリ同期と更新確認を実行できます。新規購入アイテムや既存アイテムの更新を検出し、対象をその場で再ダウンロードできます。

<p align="center">
  <img src="assets/demo/avatool-demo-library-sync.gif" width="820" alt="Avatool library sync and update check demo" />
</p>

### アバターフィルター

対応アバターを選択すると、そのアバター本体と対応する衣装・髪型などの関連アイテムだけに絞り込めます。

<p align="center">
  <img src="assets/demo/avatool-demo-avatar-filter.gif" width="820" alt="Avatool avatar filter demo" />
</p>

### 一括インポート

ダウンロード済みの複数アイテムを選択し、収集された `.unitypackage` をまとめて 1 つの Unity プロジェクトへ投入できます。

<p align="center">
  <img src="assets/demo/avatool-demo-batch-import.gif" width="820" alt="Avatool batch import demo" />
</p>

### プロジェクト内検索

Unity プロジェクトをスキャンし、ライブラリ内のどのアイテムがすでにインポート済みかを照合できます。

<p align="center">
  <img src="assets/demo/avatool-demo-project-items.gif" width="820" alt="Avatool project items demo" />
</p>

---

<a id="features"></a>
## 主な機能

### BOOTH ライブラリ管理

- 購入アセットの一覧取得とローカル同期
- 新規 / 更新あり / 変化なしの差分判定
- 未ダウンロード / 未インポート / 更新ありでの絞り込み
- アバター別フィルタリング
- ライブラリ内の商品名・作者名での検索
- BOOTH URL / 商品 ID からの手動追加
- サムネイルキャッシュとプレビュー
- 対応アバター情報の表示・詳細解析

### BOOTH 検索

- キーワードでの商品検索
- トップページのおすすめセクション表示
- 商品詳細・関連商品の閲覧
- ほしいリストへの登録

### Download / archive processing

- 複数アセットの一括・バックグラウンドダウンロード
- zip / 7z / rar の展開
- パスワード付きアーカイブへの対応
- 入れ子を含む `.unitypackage` の再帰収集
- 同梱ファイルの個別選択
- 更新ファイルの再取得
- 失敗項目だけのリトライ
- リアルタイム進捗表示

### Unity import

- 起動中プロジェクトへの Live import
- `Unity.exe -batchmode` を使ったバックグラウンドインポート
- 複数パッケージのキュー処理
- 複数プロジェクトへの投入
- 同一プロジェクトへの重複実行ロック
- インポート進捗の表示
- 実行履歴とエラー結果の保存
- 失敗パッケージのみの再実行

### VCC / VPM

- VCC のプロジェクト一覧を同期
- VPM パッケージの導入
- manifest の依存関係反映
- 導入済みバージョンの追跡
- Modular Avatar / NDMF / liltoon / SimpleFolderIcon などのセットアップ補助
- `.unitypackage` ベースの導入にも対応

### Auto Bootstrap

プロジェクト検知後の初期処理を連続して実行できます。

```text
Project detected
      │
      ▼
VPM setup
      │
      ▼
Asset selection
      │
      ▼
Unity import
      │
      ▼
Result recording
```

プロジェクト名やパスに応じたルールを設定できるため、PC / Quest / Test など用途ごとに処理内容を変えられます。

### その他

- 定時自動ダウンロード
- light / balanced / fast の処理プロファイル
- 設定プロファイルの保存と復元
- ライブラリ / 設定 / ダウンロード済みデータのエクスポート・インポート
- カスタマイズ可能なキーボードショートカット
- 操作ログと通知
- 起動時ヘルスチェック
- アプリ内自動アップデート

---

## Unity import modes

| | Live import | Background import |
|---|---|---|
| 対象 Unity | 起動中のプロジェクト | Unity を閉じた状態でも可 |
| 実行方式 | Unity Editor 側の bridge | `Unity.exe -batchmode` |
| 少量の即時投入 | 向いている | 可能 |
| 大量処理 | 不向き | 向いている |
| 夜間・放置運用 | 不向き | 向いている |
| 複数プロジェクト | 1 プロジェクトずつ | 順次処理可能 |

---

<a id="setup"></a>
## セットアップ

### 動作環境

| 項目 | 要件 |
|---|---|
| OS | Windows 10 / 11 64-bit |
| BOOTH account | 購入ライブラリ同期・ダウンロード機能で必要 |
| Unity Editor | Unity import を使用する場合に必要 |
| VCC | VCC / VPM 連携を使用する場合に必要 |
| Internet | BOOTH 同期・ダウンロード・アップデートで必要 |

### 配布版

配布版は updater CDN を使用しています。

- [配布メタデータ `latest.yml`](https://cdn.necco.xyz/file/avatool/latest.yml)

### 初回設定

1. Avatool を起動して BOOTH にログイン
2. ライブラリ同期を実行
3. Unity import を使う場合は `Unity.exe` のパスを設定
4. VCC 連携を使う場合は VCC プロジェクトを同期
5. 必要に応じて Auto Bootstrap / project rules を設定

### データ保存先

```text
%APPDATA%\avatool\
```

ダウンロードデータ、メタ情報、履歴などはこの配下で管理されます。

### 認証とローカルデータ

BOOTH の認証状態は Electron の `safeStorage` を利用してローカルに保存します。

- ブラウザの BOOTH セッションとは独立
- 認証状態は端末側で暗号化して保存
- PC 移行時は BOOTH への再ログインが必要
- インポート履歴やダウンロードデータは `%APPDATA%\avatool\` 配下に保存

---

<a id="development"></a>
## 開発

### Requirements

- Windows
- Node.js 22.x
- npm
- Unity / VCC は該当連携を検証する場合のみ必要

### Start

```bash
git clone https://github.com/nyarurant/avatool-oss.git
cd avatool-oss
npm ci
npm start
```

CSS を再生成して起動する場合:

```bash
npm run start:rebuild
```

### Quality checks

```bash
npm run lint
npm run test:unit
npm test
npm run test:unit:coverage
```

### Build

Windows NSIS installer:

```bash
npm run dist:win
```

Packaged directory only:

```bash
npm run pack
```

### CI

`.github/workflows/ci.yml` は Windows / Node.js 22 で次を検証する構成です。

```text
npm ci
npm run lint
npm run test:unit
npm run pack -- --publish never
```

### README demo recording

```bash
npm run demo:readme
npm run demo:library-sync
npm run demo:avatar-filter
npm run demo:batch-import
npm run demo:project-items
```

---

## Repository layout

```text
avatool-oss/
├─ .github/              # CI / Issue forms / PR template
├─ __tests__/            # Jest tests
├─ assets/               # icons, styles, README demos
├─ lib/                  # application services / core logic
├─ renderer/             # renderer-side modules
├─ scripts/              # build, debug, demo, release tooling
├─ PatchNote/            # version-by-version patch notes
├─ main.js               # Electron main process
├─ preload.js            # renderer bridge
├─ render.js             # renderer entry
├─ CONTRIBUTING.md
├─ SECURITY.md
├─ LICENSE
└─ package.json
```

### Contributing / Security

- コントリビューション手順: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- セキュリティ報告: [`SECURITY.md`](SECURITY.md)

---

## FAQ

### Unity を起動しておく必要はある？

必須ではありません。起動中プロジェクトへの Live import と、Unity を閉じた状態でも使える batchmode import の両方があります。

### 1 商品に複数の `.unitypackage` がある場合は？

収集されたファイルから対象を選択できます。

### BOOTH の商品が更新されたら自動で分かる？

ライブラリ同期時に差分を検出します。リアルタイム push 通知ではありません。

### 複数 BOOTH アカウントは使える？

現在は 1 アカウントを前提としています。

### PC を移行したら BOOTH のログイン状態も移せる？

認証情報は端末側の暗号化に依存するため、移行後は再ログインが必要です。

---

<a id="limitations"></a>
## 既知の制限

- Windows 専用です
- BOOTH アカウントは現在 1 アカウントを前提としています
- BOOTH 側の変更はライブラリ同期を実行するまで反映されません
- 同一 Unity プロジェクトへの並列インポートは行いません
- batchmode は対象プロジェクトに対応した Unity Editor と有効な Unity 環境を必要とします
- BOOTH 以外のアセットでは自動ダウンロードや更新検出を利用できません
- 大量の購入履歴を初回同期する場合は処理に時間がかかることがあります

---

## Patch notes

変更履歴は [`PatchNote/`](PatchNote/) にバージョンごとに保存しています。

---

## License

[ISC License](LICENSE)

---

<p align="center">
  <strong>Avatool</strong><br>
  BOOTH × Unity asset workflow automation for VRChat creators.
</p>
