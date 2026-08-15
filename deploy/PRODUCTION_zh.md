# Cloudflare + Linux Nginx 生产部署

目标链路：`访客 → Cloudflare → 宿主机 Nginx:443 → 127.0.0.1:8080 → Compose API`。

## 1. Cloudflare 与云防火墙

1. 为独立子域名创建已代理（橙云）的 DNS 记录。
2. SSL/TLS 模式设为 **Full (strict)**，启用 **Always Use HTTPS** 和当前套餐可用的托管 WAF 规则。
3. 创建 Cache Rule：URI Path 以 `/api/` 开头时 **Bypass cache**。不要对整个应用启用 Cache Everything。
4. 云防火墙关闭 80；443 的 IPv4 和 IPv6 入站来源仅允许 <https://www.cloudflare.com/ips/> 当前列出的全部网段。先添加新增网段并验证，再删除废弃网段。
5. 每周及每次上线前核对 Cloudflare IP 列表。此部署不启用 Authenticated Origin Pulls，因此防火墙白名单是阻止绕过 Cloudflare 的必要条件。

## 2. 全新生产密钥

不要复制开发机的 `.env`、数据库或供应商凭据。服务器上从 `.env.example` 新建 `.env`，分别生成独立值：

```bash
openssl rand -hex 32       # POSTGRES_PASSWORD
openssl rand -hex 32       # REDIS_PASSWORD
openssl rand -base64 32    # PROVIDER_SECRET_KEY
openssl rand -base64 32    # MFA_SECRET_KEY
chmod 600 .env
```

管理员初始密码使用密码管理器生成，至少 15 个字符。生产域名假设为 `studio.example.com`：

```dotenv
HTTP_PORT=8080
HTTP_BIND_ADDRESS=127.0.0.1
APP_ORIGINS=https://studio.example.com
ALLOW_INSECURE_HTTP=false
FORWARDED_HEADERS_MODE=trusted-single-proxy
```

供应商和 MFA 加密密钥不得相同，并应另存一份离线备份。`.env` 不得提交 Git、放入镜像、日志或工单。

## 3. 宿主机 Nginx

1. 将 Cloudflare Origin CA 证书和私钥保存到 `/etc/nginx/ssl/`，私钥权限设为 `600`。
2. 将 `deploy/cloudflare-real-ip.conf.example` 安装为 `/etc/nginx/snippets/cloudflare-real-ip.conf`，先与 Cloudflare 官方列表核对。
3. 将 `deploy/nginx-host-cloudflare.conf.example` 安装为 `/etc/nginx/sites-available/knewstudio`，替换域名和证书路径并启用站点。
4. 执行 `nginx -t`，成功后 reload。不要额外创建公开的 80 监听。

宿主机 Nginx 会覆盖而不是信任访客提交的 `X-Forwarded-*`，固定向应用传递 `X-Forwarded-Proto: https`，并为 SSE 禁用缓冲。

## 4. 启动与首次初始化

```bash
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:8080/api/v1/health
```

首次登录后立即修改管理员密码、绑定 MFA 并离线保存恢复码。随后从 `.env` 删除 `BOOTSTRAP_ADMIN_USERNAME` 和 `BOOTSTRAP_ADMIN_PASSWORD`，执行：

```bash
docker compose up -d --force-recreate api
```

只在部署包含安全重定向策略的版本后重新录入供应商 API Key。

## 5. 上线检查

- 从非 Cloudflare 网络直接连接源站 IP:443 应超时或被拒绝；通过正式域名应正常。
- 登录 Cookie 应为 `__Host-kv_session`，并含 `Secure; HttpOnly; SameSite=Lax`。
- Cloudflare 对 `/api/v1/auth/me` 应显示 `DYNAMIC` 或 `BYPASS`，不能为 `HIT`。
- 上传 20 MiB 图片、运行任务和 SSE 持续 20 分钟均应正常。
- 两个不同公网 IP 登录时，API 日志中的来源指纹和限流计数应相互独立。
- 上线前运行 `npm audit --omit=dev`；使用 Docker Scout、Trivy 或等效工具扫描最终镜像。存在 High/Critical 漏洞时停止上线并评估或升级。

定期备份 PostgreSQL、`media_data` 和加密主密钥。备份不得与在线服务器使用同一访问控制边界。
