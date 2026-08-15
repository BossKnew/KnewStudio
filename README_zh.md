# KnewStudio

[English](README.md) · [简体中文](README_zh.md) · [日本語](README_ja.md)

KnewStudio 是面向团队和小型服务器的自托管 AI 图片工作台。管理员统一管理供应商凭据、真实模型 ID、模型权限、注册和配额，普通用户专注于生成、编辑、会话与资产管理。

## 主要特性

- 兼容 OpenAI 图片接口的生成、整图编辑和遮罩局部重绘
- BullMQ 持久任务、会话、失败重试、上传和生成资产
- 注册审批、用户组、用户级配额和资源隔离
- 管理员强制 MFA、恢复码、供应商密钥加密、CSRF、限流和 SSRF 防护
- 从源码构建的 Docker Compose，应用与数据网络隔离，可使用内置或外部 PostgreSQL/Redis
- 提供宿主机 Nginx、Caddy、Docker Traefik 和 Cloudflare 安全部署示例

## 快速开始

需要 Docker Engine、Docker Compose v2.24.4 或更高版本；建议至少 2 核 CPU、4 GiB 内存。

```bash
cp .env.example .env
openssl rand -hex 32       # POSTGRES_PASSWORD
openssl rand -hex 32       # REDIS_PASSWORD
openssl rand -base64 32    # PROVIDER_SECRET_KEY
openssl rand -base64 32    # MFA_SECRET_KEY
```

替换 `.env` 中全部 `change-me-*` 值后启动：

```bash
docker compose up -d --build
docker compose ps
```

访问 [http://localhost:8080](http://localhost:8080)。默认端口仅绑定 `127.0.0.1`，PostgreSQL、Redis 和 API 均不发布端口。

首次登录后立即修改初始密码、绑定管理员 MFA、离线保存恢复码，然后删除 `.env` 中的 `BOOTSTRAP_ADMIN_*` 并重建 API：

```bash
docker compose up -d --force-recreate api
```

## 官方支持矩阵

| 部署方式 | 状态 | 配置要点 |
| --- | --- | --- |
| 本机浏览器 + 内置依赖 | 默认测试方案 | 使用 `.env.example` 默认值 |
| 局域网/NAS 私网 HTTP | 支持，必须显式启用 | 私网 origin、监听 `0.0.0.0`、忽略转发头 |
| 宿主机 Nginx/Caddy HTTPS | 支持 | 回环监听、可信单层代理 |
| Docker Traefik HTTPS | 支持 | 使用 `compose.traefik.yml` |
| Cloudflare → 宿主机 Nginx | 支持的可选方案 | 使用 Cloudflare 专用指南和防火墙白名单 |
| 外部 PostgreSQL/Redis | 支持 | 使用 `compose.external.yml`，配置外部 URL 或 secret 文件 |
| Kubernetes、Swarm、S3、URL 子路径 | 当前不支持 | 欢迎社区贡献 |

公网开放前请阅读[通用部署指南](docs/DEPLOYMENT_zh.md)、[2C4G 性能配置](docs/PERFORMANCE_2C4G_zh.md)、[配置参考](docs/CONFIGURATION.md)和[Cloudflare 生产指南](deploy/PRODUCTION_zh.md)。

## 安全与贡献

不要暴露 `.env`、`secrets/`、数据库、Redis、Docker 卷或 API 容器。公网部署必须使用 HTTPS 和明确配置的可信反向代理。应用会拒绝通配 origin、公网 HTTP origin、危险供应商目标和携带凭据的跨域重定向。

内置 PostgreSQL 和 Redis 只接入内部数据网络，Web 容器无法直接访问。CI 会阻止内部服务意外发布端口或接入错误网络。独立 Traefik 示例通过只读、API 白名单化的 Docker Socket Proxy 工作，不把 Docker Socket 直接挂载给 Traefik。

安全漏洞请按 [SECURITY.md](SECURITY.md) 私密报告，不要在公开 Issue 中提交利用细节或真实凭据。贡献说明见 [CONTRIBUTING.md](CONTRIBUTING.md)。项目采用 [Apache-2.0](LICENSE) 许可证。

仓库正式公开前，维护者还需完成[开源发布清单](docs/MAINTAINER_CHECKLIST.md)中的 GitHub 安全设置。

## 本地开发

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

CI 还会为每个受审版本生成 CycloneDX SBOM 构件。
