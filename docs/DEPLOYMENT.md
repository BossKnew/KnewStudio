# Deployment guide

All supported deployments use `docker-compose.yml` as the application definition and build images from the checked-out source. Docker Compose v2.24.4 or newer is required. Use a released tag or reviewed commit rather than an arbitrary moving branch.

The base topology has separate `app` and internal `data` networks. Nginx joins only `app`; PostgreSQL and Redis join only `data`; API and migrations bridge the two. API, PostgreSQL, and Redis never publish host ports.

## Local and LAN

The `.env.example` defaults serve only `http://localhost:8080`. For an intentional private LAN deployment:

```dotenv
HTTP_BIND_ADDRESS=0.0.0.0
HTTP_PORT=8080
APP_ORIGINS=http://192.168.1.20:8080
ALLOW_INSECURE_HTTP=true
FORWARDED_HEADERS_MODE=ignore
```

Allow the port only from the intended private subnets. This mode uses non-Secure cookies and must never be published to the internet, port-forwarded, or placed behind a public tunnel.

## Host Nginx or Caddy

Set the application to HTTPS proxy mode:

```dotenv
HTTP_BIND_ADDRESS=127.0.0.1
HTTP_PORT=8080
APP_ORIGINS=https://studio.example.com
ALLOW_INSECURE_HTTP=false
FORWARDED_HEADERS_MODE=trusted-single-proxy
```

Install either `deploy/nginx-host.conf.example` or `deploy/Caddyfile.example` on the host after replacing the hostname and certificate settings. Keep the Compose port on loopback. Validate Nginx with `nginx -t` or Caddy with `caddy validate --config /etc/caddy/Caddyfile` before reloading.

The proxy must preserve the original `Host`, overwrite forwarded headers, accept at least 21 MiB bodies, avoid buffering/cache for SSE, and permit streams longer than 15 minutes.

## Docker Traefik

Create the external proxy network and run the reviewed standalone configuration in `deploy/traefik-compose.yml.example`. It isolates a read-only Docker Socket Proxy on an internal network, permits only the Docker API reads Traefik needs, and does not mount the socket into Traefik. Replace the ACME email first. Then set `APP_HOST`, HTTPS `APP_ORIGINS`, and `ALLOW_INSECURE_HTTP=false`:

```bash
docker network create proxy
docker compose -f deploy/traefik-compose.yml.example up -d
docker compose -f docker-compose.yml -f compose.traefik.yml up -d --build
```

The overlay removes the host Web port, joins the proxy network, enables trusted single-proxy mode, and adds HSTS at the TLS edge. Traefik automatically overwrites `X-Real-Ip` and forwarded headers. If another CDN or load balancer is in front of Traefik, configure `forwardedHeaders.trustedIPs`; never use `forwardedHeaders.insecure` in production. Never publish Socket Proxy port `2375` or attach untrusted workloads to its internal network.

## External PostgreSQL and Redis

Provide both URLs and keep the optional bundled profile disabled:

```dotenv
COMPOSE_PROFILES=
DATABASE_URL=postgresql://user:encoded-password@db.example:5432/knewstudio?sslmode=require&connection_limit=5
REDIS_URL=rediss://user:encoded-password@cache.example:6380/0
```

Run with the external-services overlay:

```bash
docker compose -f docker-compose.yml -f compose.external.yml up -d --build
```

The migration job uses the same database secret loader as the API. Redis TLS is enabled by `rediss://`. Validate backups, connection limits, persistence, and recovery before production use.

## Docker secrets

Create `secrets/`, mode `0700`, and the files listed in `docs/CONFIGURATION.md`. For bundled services, `database_url` and `redis_url` must use the service names `postgres` and `redis` and match `postgres_password`/`redis_password`. Then run:

```bash
docker compose -f docker-compose.yml -f compose.secrets.yml up -d --build
```

The directory is ignored by Git and Docker build context. It is still the operator's responsibility to restrict filesystem access and back it up securely.

For external services, combine all three files: `docker compose -f docker-compose.yml -f compose.external.yml -f compose.secrets.yml up -d --build`.

## Storage, backup, and upgrades

Use the `media_data` named volume or set `MEDIA_VOLUME=/srv/knewstudio/media`. A bind mount must be writable by `APP_UID:APP_GID`. Back up PostgreSQL, media, and encryption key rings together. Redis persistence is also required for sessions and queued/running jobs.

Before an upgrade:

```bash
docker compose exec -T postgres pg_dump -U knewstudio knewstudio > knewstudio.sql
docker compose build --pull
docker compose up -d
docker compose ps
```

For external PostgreSQL, use the provider's consistent backup mechanism. Test restoration separately. Do not remove old provider or MFA encryption keys until rotation commands have completed successfully.

## Production acceptance

- Direct access to internal database, Redis, API, and loopback Web ports is impossible from untrusted networks.
- Login cookies are `__Host-kv_session` with `Secure; HttpOnly; SameSite=Lax` under HTTPS.
- JSON `/api/*` responses use `Cache-Control: no-store`; SSE uses `no-cache, no-transform`; authenticated asset content remains `private, max-age=3600`. An SSE job remains connected for at least 20 minutes.
- HTTPS responses include HSTS at the public TLS edge.
- A 20 MiB upload succeeds and a larger request is rejected by the documented limit.
- Distinct clients produce distinct rate-limit buckets; forged forwarded headers do not change identity in direct mode.
- `npm test`, `npm run lint`, `npm run build`, full and production dependency audits, license checks, SBOM generation, Compose security validation, and a High/Critical image scan pass before release.

For Cloudflare, use the additional [Cloudflare production guide](../deploy/PRODUCTION_zh.md).
