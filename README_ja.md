# KnewStudio

[English](README.md) · [简体中文](README_zh.md) · [日本語](README_ja.md)

KnewStudio は、チームや小規模サーバー向けのセルフホスト型 AI 画像ワークスペースです。管理者がプロバイダー認証情報、実際のモデル ID、モデル権限、登録、クォータを管理し、利用者は生成、編集、会話、アセット管理に集中できます。

## 主な機能

- OpenAI 互換画像 API による生成、画像編集、マスク付き部分修正
- BullMQ の永続ジョブ、会話、再試行、アップロード、生成アセット
- 登録承認、ユーザーグループ、ユーザー別クォータ、データ分離
- 管理者 MFA、リカバリーコード、暗号化されたプロバイダー鍵、CSRF、レート制限、SSRF 対策
- アプリ/データネットワークを分離し、内蔵または外部 PostgreSQL/Redis を選べるソースビルド Docker Compose
- ホスト Nginx、Caddy、Docker Traefik、Cloudflare の安全な例

## クイックスタート

Docker Engine、Docker Compose v2.24.4 以降が必要です。2 CPU / 4 GiB 以上を推奨します。

```bash
cp .env.example .env
openssl rand -hex 32       # POSTGRES_PASSWORD
openssl rand -hex 32       # REDIS_PASSWORD
openssl rand -base64 32    # PROVIDER_SECRET_KEY
openssl rand -base64 32    # MFA_SECRET_KEY
```

`.env` のすべての `change-me-*` を置き換えて起動します。

```bash
docker compose up -d --build
docker compose ps
```

[http://localhost:8080](http://localhost:8080) を開きます。既定では `127.0.0.1` のみに公開され、PostgreSQL、Redis、API のポートは公開されません。

初回ログイン後、初期パスワードの変更、管理者 MFA の登録、リカバリーコードのオフライン保存を行い、`.env` から `BOOTSTRAP_ADMIN_*` を削除して API を再作成してください。

```bash
docker compose up -d --force-recreate api
```

## サポート対象

| 構成 | 状態 | 要点 |
| --- | --- | --- |
| ローカル + 内蔵サービス | テスト済み既定値 | `.env.example` を使用 |
| LAN/NAS のプライベート HTTP | 明示的な設定で対応 | private origin、`0.0.0.0`、転送ヘッダー無視 |
| ホスト Nginx/Caddy HTTPS | 対応 | ループバック、信頼する単一プロキシ |
| Docker Traefik HTTPS | 対応 | `compose.traefik.yml` を使用 |
| Cloudflare → ホスト Nginx | オプション対応 | Cloudflare 専用ガイドとファイアウォール |
| 外部 PostgreSQL/Redis | 対応 | `compose.external.yml` と外部 URL/secret を使用 |
| Kubernetes、Swarm、S3、URL サブパス | 現在は非対応 | コミュニティ貢献を歓迎 |

公開前に [Deployment guide](docs/DEPLOYMENT.md) と [Configuration reference](docs/CONFIGURATION.md) を確認してください。

## セキュリティと開発

`.env`、`secrets/`、データベース、Redis、Docker ボリューム、API コンテナを公開しないでください。脆弱性は [SECURITY.md](SECURITY.md) に従って非公開で報告してください。

内蔵 PostgreSQL と Redis は内部データネットワークだけに接続され、Web コンテナから直接到達できません。CI は内部ポートの公開や誤ったネットワーク接続を拒否します。スタンドアロン Traefik 例は Docker Socket を直接マウントせず、読み取り専用の API 許可リスト付き Socket Proxy を使用します。

```bash
npm ci
npm run db:generate
npm run db:migrate
npm run dev
npm test
npm run lint
npm run build
npm run licenses:check
npm audit --audit-level=high
npm audit --omit=dev --audit-level=high
```

CI はレビュー済みリビジョンごとに CycloneDX SBOM アーティファクトも生成します。

貢献方法は [CONTRIBUTING.md](CONTRIBUTING.md) を参照してください。ライセンスは [Apache-2.0](LICENSE) です。
