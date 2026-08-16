# Security Policy

## Supported versions

セキュリティ修正は原則として最新リリースを対象に行います。古いバージョンで問題を確認した場合は、まず最新版でも再現するか確認してください。

## Reporting a vulnerability

認証、BOOTH セッション、任意ファイル操作、アーカイブ展開、Unity / VCC 連携、自動アップデート、IPC などに関する脆弱性を発見した場合、**公開 Issue に再現詳細や秘密情報を書かないでください**。

GitHub の Security タブで private vulnerability reporting / Security Advisory が利用できる場合は、そこから非公開で報告してください。

利用できない場合は、公開 Issue には脆弱性の詳細を書かず、`Security contact request` という件名で連絡用 Issue を作成してください。非公開で共有できる経路を案内します。

報告には、可能な範囲で以下を含めてください。

- 影響を受ける Avatool のバージョン
- 影響範囲と攻撃条件
- 最小限の再現手順
- 想定される影響
- 修正案がある場合はその概要

## Sensitive data

次の情報は Issue、Pull Request、スクリーンショット、ログへ投稿しないでください。

- BOOTH Cookie / session token
- API token / access token / password
- 個人情報
- 購入物そのものや再配布できないアセット
- ローカル環境固有の秘密情報

ログやスクリーンショットを共有する場合は、投稿前に必ずマスキングしてください。

## Disclosure

修正が利用可能になる前の公開は避けてください。報告内容を確認後、必要に応じて修正と公開タイミングを調整します。
