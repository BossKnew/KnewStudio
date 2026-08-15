# 通用部署指南

所有官方支持方案都以 `docker-compose.yml` 为应用定义，并从已检出的源码构建镜像。要求 Docker Compose v2.24.4 或更高版本；生产环境应使用正式版本标签或经过审核的提交。

基础拓扑拆分为 `app` 与内部 `data` 网络。Nginx 只接入 `app`，PostgreSQL/Redis 只接入 `data`，API 与迁移容器连接两者。API、PostgreSQL 和 Redis 均不得发布宿主机端口。

## 本机与局域网

`.env.example` 默认只允许本机访问。需要在 NAS 或局域网开放 HTTP 时：

```dotenv
HTTP_BIND_ADDRESS=0.0.0.0
HTTP_PORT=8080
APP_ORIGINS=http://192.168.1.20:8080
ALLOW_INSECURE_HTTP=true
FORWARDED_HEADERS_MODE=ignore
```

防火墙只允许预期私网网段。这种模式使用非 Secure Cookie，不得映射到公网、通过公网隧道发布或用于公共 Wi-Fi。

## 宿主机 Nginx 或 Caddy

```dotenv
HTTP_BIND_ADDRESS=127.0.0.1
HTTP_PORT=8080
APP_ORIGINS=https://studio.example.com
ALLOW_INSECURE_HTTP=false
FORWARDED_HEADERS_MODE=trusted-single-proxy
```

根据实际代理选择 `deploy/nginx-host.conf.example` 或 `deploy/Caddyfile.example`，替换域名与证书配置。Compose 端口必须保持回环监听。上线前分别运行 `nginx -t` 或 `caddy validate`。

外层代理必须覆盖客户端提交的转发头，允许 21 MiB 请求体，对 SSE 禁用缓冲和缓存，并允许至少 15 分钟的连接。

## Docker Traefik

先检查并替换 `deploy/traefik-compose.yml.example` 中的 ACME 邮箱。该示例把只读 Docker Socket Proxy 隔离在内部网络，仅开放 Traefik 所需的 Docker API 读取操作，Traefik 本身不挂载 Docker Socket。配置 HTTPS `APP_ORIGINS`、`APP_HOST` 和 `ALLOW_INSECURE_HTTP=false` 后运行：

```bash
docker network create proxy
docker compose -f deploy/traefik-compose.yml.example up -d
docker compose -f docker-compose.yml -f compose.traefik.yml up -d --build
```

叠加文件会移除宿主机 Web 端口、加入外部代理网络、启用可信单代理模式，并在 TLS 边缘添加 HSTS。不得发布 Socket Proxy 的 `2375` 端口，也不得让不可信容器接入其内部网络。如果 Traefik 前方还有 CDN，只能通过 `forwardedHeaders.trustedIPs` 信任明确网段，生产环境不得启用 `forwardedHeaders.insecure`。

## 外部 PostgreSQL 与 Redis

```dotenv
COMPOSE_PROFILES=
DATABASE_URL=postgresql://user:encoded-password@db.example:5432/knewstudio?sslmode=require&connection_limit=5
REDIS_URL=rediss://user:encoded-password@cache.example:6380/0
```

凭据中的特殊字符必须进行 URL 编码。使用以下命令禁用内置依赖并启动：

```bash
docker compose -f docker-compose.yml -f compose.external.yml up -d --build
```

迁移容器与 API 使用相同的 URL 或 `_FILE` secret；`rediss://` 会启用 Redis TLS。上线前验证连接数、持久化、备份与恢复。

## Docker secrets

创建权限为 `0700` 的 `secrets/`，按[配置参考](CONFIGURATION.md)生成文件，再运行：

```bash
docker compose -f docker-compose.yml -f compose.secrets.yml up -d --build
```

使用内置服务时，`database_url`/`redis_url` 中的密码必须分别与 `postgres_password`/`redis_password` 一致。

## 存储、备份与验收

默认使用 `media_data` 命名卷，也可以设置 `MEDIA_VOLUME=/srv/knewstudio/media`。宿主机目录必须允许 `APP_UID:APP_GID` 写入。PostgreSQL、媒体文件和加密密钥环必须一致备份；Redis 也需要持久化以保留会话与任务队列。

公网验收至少包括：内部端口不可达、HTTPS Cookie 与 HSTS 正确、JSON API 使用 `no-store`、SSE 使用 `no-cache, no-transform`、登录后媒体只允许私有缓存、SSE 连续 20 分钟、20 MiB 上传成功、不同访客限流独立、测试/类型检查/生产构建/完整及生产依赖审计/许可证检查/SBOM/Compose 安全不变量/镜像扫描全部通过。

Cloudflare 部署继续参照 [Cloudflare 生产指南](../deploy/PRODUCTION_zh.md)。
