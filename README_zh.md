# KnewStudio

[English](README.md)

KnewStudio 是一个面向团队的自托管图片与视频生成工作台。它支持 OpenAI Images 兼容供应商、OpenAI Videos / Seedance / Wan 视频适配器、文生图、整图编辑、蒙版局部重绘、文生视频、图生视频、素材管理，以及带用户组和模型权限的管理后台。

## 功能

- OpenAI Images 兼容供应商，以及 OpenAI Videos、Seedance、Wan 视频适配器
- 文生图、参考图编辑、蒙版局部重绘、文生视频和图生视频
- 会话、生成历史、素材库、组内分享参考图、缩略图与存储配额
- 用户审批、用户组、模型访问控制和可选的组级生成额度
- 管理员强制 MFA、TOTP、恢复码和会话撤销
- API Key 与 MFA 密钥加密存储
- 出站请求 SSRF 防护、速率限制、CSRF 防护与安全响应头
- PostgreSQL、Redis、后台任务队列和 Docker Compose 部署
- 中文、英文界面

视频任务是异步的：工作进程先创建上游任务，轮询完成后再保存 MP4。管理员为每个视频模型配置允许的比例、时长和可选分辨率。用户组视频额度按滑动窗口内每人秒数计算，与图片张数额度相互独立。

本机开发视频缩略图需要安装 ffmpeg。Docker API 镜像已包含 ffmpeg。

## 技术栈

- Web：React 19、Vite、TypeScript
- API：NestJS、Prisma、PostgreSQL、Redis、BullMQ
- 部署：Docker Compose、Nginx，可选 Traefik 或外部反向代理

## 快速开始

### 环境要求

- Docker Engine 与 Docker Compose v2.24 或更新版本
- 用于生成随机密钥的 OpenSSL
- 默认资源配置建议至少 2 CPU、4 GiB 内存

### 1. 配置环境变量

Linux/macOS：

```bash
cp .env.example .env
```

PowerShell：

```powershell
Copy-Item .env.example .env
```

编辑 `.env`，替换所有包含 `change-me` 的值。各用途的密钥必须独立生成，不能复用：

```bash
openssl rand -hex 32
openssl rand -base64 32
```

`PROVIDER_SECRET_KEY` 和 `MFA_SECRET_KEY` 都必须是独立的 32 字节 Base64 密钥。

### 2. 校验并启动

```bash
docker compose config --quiet
docker compose up -d --build
```

默认地址为 <http://localhost:8080>。首次登录使用 `.env` 中的引导管理员账号；系统会要求修改初始密码并绑定 MFA。

完成首次登录后，从 `.env` 删除 `BOOTSTRAP_ADMIN_USERNAME` 和 `BOOTSTRAP_ADMIN_PASSWORD`，然后重新创建 API 容器：

```bash
docker compose up -d --force-recreate api
```

查看状态与日志：

```bash
docker compose ps
docker compose logs -f --tail=200
```

## 生产部署

不要把默认的明文 HTTP 配置暴露到公网。生产环境至少需要：

- 将 `APP_ORIGINS` 设置为准确的 HTTPS Origin，例如 `https://studio.example.com`
- 设置 `ALLOW_INSECURE_HTTP=false`
- 使用独立、高强度的数据库、Redis、加密和管理员密码
- 只允许受信任的反向代理访问应用入口
- 定期备份 PostgreSQL 数据和 `MEDIA_VOLUME`

### Traefik

先创建 `.env` 中指定的外部 Traefik 网络，并设置 `APP_HOST`、`TRAEFIK_NETWORK`、`TRAEFIK_ENTRYPOINT` 和 `TRAEFIK_CERT_RESOLVER`，然后运行：

```bash
docker compose -f docker-compose.yml -f compose.traefik.yml up -d --build
```

### 外部 PostgreSQL 和 Redis

在 `.env` 中设置 `DATABASE_URL` 与 `REDIS_URL`，然后使用外部服务 overlay：

```bash
docker compose -f docker-compose.yml -f compose.external.yml up -d --build
```

### Compose secrets

将所需秘密分别写入 `SECRETS_DIR` 下的文件，并使用：

```bash
docker compose -f docker-compose.yml -f compose.secrets.yml up -d --build
```

可组合多个 overlay；最终启动前始终先运行 `docker compose ... config --quiet`。

更多反向代理示例位于 [`deploy`](deploy) 目录。

## 本地开发

环境要求：Node.js 24、npm 11、PostgreSQL 和 Redis。

```bash
npm ci
npm run db:generate
npm run dev
```

本地 `.env` 需要提供可从宿主机访问的 `DATABASE_URL` 和 `REDIS_URL`。开发服务器默认使用：

- Web：<http://localhost:5173>
- API：<http://localhost:4000>

Vite 会把 `/api` 请求代理到本地 API。

## 质量检查

```bash
npm run lint
npm test
npm run build
npm run licenses:check
npm run security-configs:check
npm audit --audit-level=high
```

GitHub Actions 还会构建完整容器栈并检查公开健康端点。

## 安全

不要提交 `.env`、`secrets/`、私钥、数据库备份或运行时媒体文件。项目默认已在 `.gitignore` 和 `.dockerignore` 中排除这些内容。

安全问题请按照 [`SECURITY.md`](SECURITY.md) 私下报告，不要在公开 Issue 中披露可利用细节。

## 许可证

本项目采用 [Apache License 2.0](LICENSE)。
