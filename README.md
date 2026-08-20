# KnewStudio

[简体中文](README_zh.md)

KnewStudio is a self-hosted image-generation workspace for teams. It supports OpenAI Images-compatible providers, text-to-image generation, full-image editing, masked inpainting, asset management, and an administration console with user groups and model permissions.

## Features

- OpenAI Images-compatible provider and model configuration
- Text-to-image generation, reference-image editing, and masked inpainting
- Conversations, generation history, asset library, group-shared reference images, thumbnails, and storage quotas
- User approval, user groups, model access control, and optional per-group generation quotas
- Mandatory administrator MFA, TOTP, recovery codes, and session revocation
- Encrypted storage for API keys and MFA secrets
- SSRF protection for outbound requests, rate limiting, CSRF protection, and security headers
- PostgreSQL, Redis, background job queues, and Docker Compose deployment
- Chinese and English user interfaces

The current release supports image generation only. Video adapter interfaces are reserved in the codebase but are not exposed as product features.

## Technology Stack

- Web: React 19, Vite, and TypeScript
- API: NestJS, Prisma, PostgreSQL, Redis, and BullMQ
- Deployment: Docker Compose and Nginx, with optional Traefik or an external reverse proxy

## Quick Start

### Requirements

- Docker Engine and Docker Compose v2.24 or later
- OpenSSL for generating random secrets
- At least 2 CPUs and 4 GiB of memory are recommended for the default resource profile

### 1. Configure the environment

Linux/macOS:

```bash
cp .env.example .env
```

PowerShell:

```powershell
Copy-Item .env.example .env
```

Edit `.env` and replace every value containing `change-me`. Use a different secret for each purpose:

```bash
openssl rand -hex 32
openssl rand -base64 32
```

`PROVIDER_SECRET_KEY` and `MFA_SECRET_KEY` must be independent 32-byte Base64 keys.

### 2. Validate and start

```bash
docker compose config --quiet
docker compose up -d --build
```

The default address is <http://localhost:8080>. Sign in with the bootstrap administrator account from `.env`; the system will require a password change and MFA enrollment.

After the first login, remove `BOOTSTRAP_ADMIN_USERNAME` and `BOOTSTRAP_ADMIN_PASSWORD` from `.env`, then recreate the API container:

```bash
docker compose up -d --force-recreate api
```

View service status and logs:

```bash
docker compose ps
docker compose logs -f --tail=200
```

## Production Deployment

Do not expose the default plain-HTTP configuration to the public internet. At minimum, production deployments should:

- Set `APP_ORIGINS` to the exact HTTPS origin, such as `https://studio.example.com`
- Set `ALLOW_INSECURE_HTTP=false`
- Use separate, high-strength database, Redis, encryption, and administrator credentials
- Allow only trusted reverse proxies to access the application entry point
- Back up PostgreSQL data and `MEDIA_VOLUME` regularly

### Traefik

Create the external Traefik network specified in `.env`, set `APP_HOST`, `TRAEFIK_NETWORK`, `TRAEFIK_ENTRYPOINT`, and `TRAEFIK_CERT_RESOLVER`, then run:

```bash
docker compose -f docker-compose.yml -f compose.traefik.yml up -d --build
```

### External PostgreSQL and Redis

Set `DATABASE_URL` and `REDIS_URL` in `.env`, then use the external-services overlay:

```bash
docker compose -f docker-compose.yml -f compose.external.yml up -d --build
```

### Compose secrets

Write each required secret to a separate file under `SECRETS_DIR`, then run:

```bash
docker compose -f docker-compose.yml -f compose.secrets.yml up -d --build
```

Overlays can be combined. Always run `docker compose ... config --quiet` before starting the final configuration.

More reverse-proxy examples are available in the [`deploy`](deploy) directory.

## Local Development

Requirements: Node.js 24, npm 11, PostgreSQL, and Redis.

```bash
npm ci
npm run db:generate
npm run dev
```

Your local `.env` must provide `DATABASE_URL` and `REDIS_URL` values reachable from the host. Development servers use:

- Web: <http://localhost:5173>
- API: <http://localhost:4000>

Vite proxies `/api` requests to the local API.

## Quality Checks

```bash
npm run lint
npm test
npm run build
npm run licenses:check
npm run security-configs:check
npm audit --audit-level=high
```

GitHub Actions also builds the complete container stack and checks the public health endpoint.

## Security

Do not commit `.env`, `secrets/`, private keys, database backups, or runtime media files. The project excludes these by default through `.gitignore` and `.dockerignore`.

Report security issues privately according to [`SECURITY.md`](SECURITY.md). Do not disclose exploitable details in public issues.

## License

This project is licensed under the [Apache License 2.0](LICENSE).
