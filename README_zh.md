# 🎨 KnewStudio

[English](README.md) | 简体中文

KnewStudio 是一个面向团队的自托管图片与视频生成工作台：文生图、整图编辑、局部重绘、文生视频、图生视频，内置素材库、额度管理、用户组与模型权限控制。

## ✨ 功能

- 🎨 **生成**：文生图、参考图编辑、蒙版局部重绘、文生视频、图生视频
- 🔌 **供应商**：OpenAI Images 兼容接口；OpenAI Videos、Seedance（火山方舟）、Wan（通义万相）视频适配器，兼容 OpenAI Videos 协议的网关可直接复用
- 🖥️ **工作台**：图片/视频模式切换，历史记录、重新生成、重试、下载、参考图与遮罩绘制
- 🗂️ **素材**：会话、素材库、组内分享参考图、缩略图、存储配额
- 👥 **管理**：用户审批、用户组、模型访问控制、组级生成额度（图片按张、视频按秒）
- ✍️ **提示词润色**：支持文生图、图片编辑、文生视频，可配置多家供应商
- 🛡️ **安全**：管理员强制 MFA、API Key 与 MFA 密钥加密存储、SSRF 防护、速率限制、CSRF 防护
- 🌐 **界面**：中文、英文

## 🧰 技术栈

Web（React 19、Vite、TypeScript）· API（NestJS、Prisma、PostgreSQL、Redis、BullMQ）· 部署（Docker Compose、Nginx）

## ⚡ 快速开始

环境要求：Docker Engine 与 Compose v2.24+、OpenSSL；建议至少 2 CPU / 4 GiB 内存。

```bash
cp .env.example .env    # Windows PowerShell: Copy-Item .env.example .env
```

编辑 `.env`，替换所有 `change-me` 占位值；各密钥独立生成：

```bash
openssl rand -hex 32
openssl rand -base64 32
```

启动：

```bash
docker compose config --quiet
docker compose up -d --build
```

访问 <http://localhost:8080>。首次登录使用 `.env` 中的引导管理员账号，系统会要求修改密码并绑定 MFA。

## 🚢 生产部署

- 🔐 使用 HTTPS：设置 `APP_ORIGINS` 为准确的 Origin，并设 `ALLOW_INSECURE_HTTP=false`
- 🔑 使用独立的高强度数据库、Redis、加密密钥与管理员密码
- 💾 定期备份 PostgreSQL 数据与媒体卷
- 🧩 可选叠加：Traefik（`compose.traefik.yml`）、外部数据库/Redis（`compose.external.yml`）、Compose secrets（`compose.secrets.yml`）
- 📁 反向代理示例见 [`deploy`](deploy) 目录

## 🛠️ 本地开发

环境要求：Node.js 24、npm 11、PostgreSQL、Redis、`ffmpeg`。

```bash
npm ci
npm run db:generate
npm run dev
```

开发服务器：Web <http://localhost:5173>，API <http://localhost:4000>（Vite 将 `/api` 代理到本地 API）。

## 🔒 安全

不要提交 `.env`、密钥、数据库备份或媒体文件（默认已忽略）。漏洞请按 [`SECURITY.md`](SECURITY.md) 私下报告。

## 📄 许可证

[Apache License 2.0](LICENSE)
