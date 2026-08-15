# 2 核 4 GiB Linux 运行配置

仓库默认 Compose 配置就是 2C4G 的保守生产档。它优先保证 API、登录和页面响应稳定，让图片生成与规范化排队执行，而不是用并行任务换取容易触发 OOM 或 CPU 抖动的短时吞吐。

## 推荐配置

保留 `.env.example` 中的以下值：

```dotenv
WORKER_CONCURRENCY=1
IMAGE_PROCESSING_CONCURRENCY=1
PASSWORD_HASH_CONCURRENCY=1
SSE_POLL_INTERVAL_MS=2000
MEDIA_X_ACCEL_REDIRECT=true

API_MEMORY_LIMIT=1536m
API_CPU_LIMIT=1.5
NODE_HEAP_MIB=768
POSTGRES_MEMORY_LIMIT=512m
POSTGRES_CPU_LIMIT=0.75
REDIS_MEMORY_LIMIT=256m
REDIS_CPU_LIMIT=0.25
NGINX_MEMORY_LIMIT=128m
NGINX_CPU_LIMIT=0.25
POSTGRES_EFFECTIVE_CACHE_SIZE=1GB
POSTGRES_MAX_WAL_SIZE=512MB
```

不要在 2C4G 主机上提高 `WORKER_CONCURRENCY`、`IMAGE_PROCESSING_CONCURRENCY` 或 `PASSWORD_HASH_CONCURRENCY`。这三个任务都会消耗大量 CPU 或原生内存，并发提高后会直接挤压 API 与数据库。

内置数据库 URL 已限制 Prisma 连接池为 5，并设置 10 秒池等待上限。使用外部 PostgreSQL 时也应在 `DATABASE_URL` 中保留 `connection_limit=5&pool_timeout=10`。

## 已启用的低资源优化

- Sharp 图片处理全局串行并使用顺序读取，避免并发解码造成 CPU/原生内存峰值；原有编码质量以及像素、格式、大小检查保持不变。
- Argon2 参数保持不变，只限制同时运行的密码哈希数量，避免恶意并发登录耗尽 CPU 和内存。
- SSE 每 2 秒检查一次任务；状态不变时仅发送轻量心跳，状态变化仍发送完整任务。
- API 完成用户与资源归属鉴权后，由内部 Nginx `sendfile` 发送私有图片。内部媒体路径不能从外部直接访问。
- Redis 和数据库池在依赖异常时有明确超时，避免请求长期悬挂。
- PostgreSQL 使用平滑检查点和适合 4 GiB 主机的缓存估算，降低写入尖峰。

## Linux 主机建议

- 使用 64 位 Linux、Docker Engine 和 Compose v2；媒体与 PostgreSQL 数据优先放在 SSD。
- 使用媒体目录绑定挂载时，`APP_UID:APP_GID` 必须可写，并应让 Nginx 容器只读访问该目录。若宿主机权限策略不允许，可设置 `MEDIA_X_ACCEL_REDIRECT=false`，由 API 流式发送媒体；默认命名卷无需修改。
- 至少预留 600 MiB 给内核、Docker 与文件页缓存，不要在同一台 4 GiB 主机上再运行重型服务。
- 可配置 1–2 GiB swap 作为 OOM 保险，但 swap 不能替代内存；持续换页时应降低负载或扩容。
- 生产环境保留 HTTPS、精确 `APP_ORIGINS`、内部数据库/Redis 网络和现有限流设置。

部署后用以下命令观察 10–20 分钟，至少覆盖一次上传与生成：

```bash
docker compose up -d --build
docker compose ps
docker stats
docker compose logs --tail=200 api postgres redis nginx
```

健康状态应全部正常，API 不应接近 1536 MiB 上限，主机不应持续使用 swap。若生成速度受上游供应商限制，提高本机并发不会改善单任务耗时。
