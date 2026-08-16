# Contributing to Avatool

Avatool への Issue / Pull Request を歓迎します。

## 開発環境

- Windows 10 / 11 64-bit
- Node.js 22.x
- npm
- Unity / VCC は該当機能を検証する場合のみ必要

```bash
git clone https://github.com/nyarurant/avatool-oss.git
cd avatool-oss
npm ci
npm start
```

## 変更前の確認

変更を送る前に、少なくとも次を実行してください。

```bash
npm run lint
npm run test:unit
```

アプリ全体の基本動作も確認する場合:

```bash
npm test
```

配布物に影響する変更では、可能であればパッケージングも確認してください。

```bash
npm run pack
```

## Issue

バグ報告では、再現手順、期待した結果、実際の結果、Avatool / Windows / Unity のバージョンをできるだけ記載してください。

BOOTH の Cookie、セッショントークン、認証情報、個人情報、ローカルパスに含まれるユーザー名などは投稿しないでください。ログを添付する場合は事前に機密情報を削除してください。

セキュリティ上の問題は公開 Issue に詳細を書かず、[SECURITY.md](SECURITY.md) の手順を使用してください。

## Pull Request

- 1 PR では、できるだけ 1 つの目的に集中してください。
- 挙動変更には、可能な範囲でテストを追加または更新してください。
- UI を変更した場合は、説明またはスクリーンショットがあるとレビューしやすくなります。
- 無関係な整形や大規模リネームを同じ PR に混ぜないでください。
- 既存の設計や命名規則に合わせてください。

PR を作成すると GitHub Actions で lint と unit test が実行されます。

## コード構成

主要なロジックは `lib/`、renderer 側のモジュールは `renderer/`、テストは `__tests__/` にあります。Electron の main / preload / renderer 境界をまたぐ変更では、IPC の入力検証と公開 API の最小化を意識してください。

## ライセンス

コントリビューションは、このリポジトリの [ISC License](LICENSE) の下で提供されるものとして扱われます。
