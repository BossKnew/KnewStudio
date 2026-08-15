# Configuration reference

KnewStudio reads configuration at container startup. `APP_ORIGINS`, URLs, and security modes are validated before the API listens. Restart or recreate affected containers after changing `.env`.

## Access and proxy trust

| Variable | Default | Meaning |
| --- | --- | --- |
| `HTTP_BIND_ADDRESS` | `127.0.0.1` | Host address publishing the Compose Web port. Use `0.0.0.0` only for intentional LAN access. |
| `HTTP_PORT` | `8080` | Published Web port. |
| `APP_ORIGINS` | required in production | Comma-separated exact browser origins, including scheme and non-default port, without paths or trailing slashes. |
| `ALLOW_INSECURE_HTTP` | `false` | Allows only local/private-network HTTP origins when `true`; produces non-Secure development cookies and a startup warning. |
| `FORWARDED_HEADERS_MODE` | `ignore` | `ignore` uses the direct peer address; `trusted-single-proxy` accepts the single `X-Real-IP` value supplied by a trusted outer proxy. |

Use one protocol class per deployment. HTTPS mode accepts only HTTPS origins. In insecure mode, all origins must be HTTP and use localhost, `.localhost`, `.local`, loopback, private, link-local, or IPv6 unique-local addresses. Public HTTP hostnames are rejected.

Never use `trusted-single-proxy` on a port reachable directly by untrusted clients. The outer proxy must overwrite, not append or preserve, client-supplied `X-Real-IP`, `X-Forwarded-For`, and `X-Forwarded-Proto`.

The API is intentionally reachable only through the inner Web proxy. It has no Compose `ports` entry. The one-hop Express proxy trust setting depends on this invariant and is enforced by the Compose security check in CI.

## Data services and storage

| Variable | Default | Meaning |
| --- | --- | --- |
| `COMPOSE_PROFILES` | empty | Keep empty normally. The external-services overlay places bundled services behind the optional `bundled` profile. |
| `DATABASE_URL` | generated for bundled DB | PostgreSQL URL. Percent-encode special characters in credentials. The bundled URL uses `connection_limit=5&pool_timeout=10`. |
| `REDIS_URL` | generated for bundled Redis | `redis://` or `rediss://` URL with optional username, password, port, and database 0–15. |
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | see `.env.example` | Bundled PostgreSQL credentials. |
| `REDIS_PASSWORD` | required when bundled | Bundled Redis password. |
| `MEDIA_VOLUME` | `media_data` | Named volume or absolute Linux host path mounted at `/data/media`. |
| `APP_UID` / `APP_GID` | `1000` | Runtime identity for API and migration containers; must be able to write the media bind mount. |

External PostgreSQL must support the schema used by Prisma migrations. External Redis must be persistent and must not evict sessions or BullMQ queue keys. The health endpoint fails when either dependency is unavailable.

## Secrets

The API accepts these file-backed equivalents: `DATABASE_URL_FILE`, `REDIS_URL_FILE`, `PROVIDER_SECRET_KEY_FILE`, `PROVIDER_SECRET_KEYS_FILE`, `MFA_SECRET_KEY_FILE`, `MFA_SECRET_KEYS_FILE`, `MFA_SECRET_ACTIVE_KID_FILE`, `BOOTSTRAP_ADMIN_USERNAME_FILE`, and `BOOTSTRAP_ADMIN_PASSWORD_FILE`. A direct environment value takes precedence over its `_FILE` value.

`compose.secrets.yml` supplies a ready-to-use `/run/secrets` overlay. Its files are:

- `postgres_password` and `redis_password`
- `database_url` and `redis_url`
- `provider_secret_key` and `mfa_secret_key`
- `bootstrap_admin_password`

The URL files must contain URLs matching the password files when bundled services are used. Keep the directory mode at `0700` and individual files at `0600`. Remove the bootstrap password secret after initialization.

Startup rejects `change-me` placeholder secrets, malformed encryption keys, a provider key reused for MFA, and a bootstrap username/password configured without its pair. Provider and MFA keys must be independently generated.

## Encryption and outbound access

| Variable | Purpose |
| --- | --- |
| `PROVIDER_SECRET_KEY` | Independent 32-byte Base64 AES key for provider credentials. |
| `PROVIDER_SECRET_KEYS` | Rotation ring in `kid:key` comma-separated form; first entry encrypts new values. |
| `MFA_SECRET_KEY` | Independent 32-byte Base64 key for MFA seeds. |
| `MFA_SECRET_KEYS` / `MFA_SECRET_ACTIVE_KID` | MFA rotation ring and active key ID. |
| `MFA_ISSUER` | Authenticator issuer, up to 64 characters. |
| `OUTBOUND_PRIVATE_ALLOWLIST` | Comma-separated hostname, IP, or CIDR allowlist for private provider targets. |
| `OUTBOUND_HTTP_ALLOWLIST` | Additional hostname or `host:port` permission for private plain-HTTP targets. |

Public providers are HTTPS-only. Private plain HTTP requires a target in both outbound allowlists. Credentialed provider requests only follow same-origin redirects.

## Limits and resource tuning

| Variable | Default | Window / purpose |
| --- | --- | --- |
| `LOGIN_IP_LIMIT` | `50` | Login attempts per source IP per 10 minutes. |
| `LOGIN_PAIR_LIMIT` | `10` | Login attempts per source-IP/username pair per 10 minutes. |
| `LOGIN_ACCOUNT_FAILURE_LIMIT` | `30` | Failed passwords per normalized username per 10 minutes; reset after a valid password. |
| `REGISTRATION_IP_LIMIT` | `5` | Registration attempts per source IP per hour. |
| `GENERATION_RATE_LIMIT` | `10` | Generation requests per user per 10 minutes. |
| `UPLOAD_RATE_LIMIT` | `30` | Upload requests per user per 10 minutes, checked before parsing the file body. |
| `MAX_CONCURRENT_UPLOADS_PER_USER` | `2` | Concurrent upload/parser slots per user, with a 10-minute safety lease. |
| `MAX_ACTIVE_JOBS_PER_USER` | `3` | Running/queued generation jobs per user. |
| `MAX_QUEUED_JOBS` | `200` | Global queued generation jobs. |
| `USER_STORAGE_QUOTA_GIB` | `10` | Stored media per user. |
| `MAX_SSE_CONNECTIONS_PER_USER` | `3` | Concurrent generation event streams per user. |
| `WORKER_CONCURRENCY` | `1` | Generation worker concurrency. |
| `IMAGE_PROCESSING_CONCURRENCY` | `1` | Process-wide Sharp normalization slots; keep at 1 on 2C4G. |
| `PASSWORD_HASH_CONCURRENCY` | `1` | Process-wide Argon2 slots; hash parameters are unchanged. |
| `SSE_POLL_INTERVAL_MS` | `2000` | Generation status polling cadence; unchanged states use lightweight SSE heartbeats. |
| `MEDIA_X_ACCEL_REDIRECT` | `true` | Let the internal Nginx container serve authorized media with `sendfile`. Set `false` only when a restrictive host bind mount cannot be made readable inside Nginx. |

Fixed-window counters and upload concurrency admission use atomic Redis scripts. Keep Redis persistent and configured with `noeviction`.

Container limits: `API_MEMORY_LIMIT`, `API_CPU_LIMIT`, `NODE_HEAP_MIB`, `POSTGRES_MEMORY_LIMIT`, `POSTGRES_CPU_LIMIT`, `REDIS_MEMORY_LIMIT`, `REDIS_CPU_LIMIT`, `NGINX_MEMORY_LIMIT`, and `NGINX_CPU_LIMIT`. `POSTGRES_EFFECTIVE_CACHE_SIZE` and `POSTGRES_MAX_WAL_SIZE` tune the bundled database planner and checkpoint behavior without reserving that amount of RAM. Measure provider image sizes and peak Sharp memory before increasing concurrency.

The default Compose profile is tuned for 2 CPUs and 4 GiB of RAM. Authenticated media remains authorization-checked by the API, then the internal Nginx location serves the file from a read-only media mount with `sendfile`; the internal URI is not externally accessible.

## Unsupported configuration

This release supports only root-path URLs. A deployment such as `https://example.com/studio` will break routes, API requests, static assets, and cookie assumptions. S3-compatible object storage, Kubernetes, and Docker Swarm are not official targets.
