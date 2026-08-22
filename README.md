# KnewStudio

English | [简体中文](README_zh.md)

KnewStudio is a self-hosted image and video generation workspace for teams. It supports OpenAI Images-compatible providers, OpenAI Videos / Seedance / Wan video adapters, text-to-image generation, full-image editing, masked inpainting, text-to-video, image-to-video, asset management, and an administration console with user groups and model permissions.

Latest release: [v0.2.0](https://github.com/BossKnew/KnewStudio/releases/tag/v0.2.0). Video generation is now a product feature. See the [changelog](CHANGELOG.md).

## Features

- OpenAI Images-compatible providers plus OpenAI Videos, Seedance, and Wan video adapters
- Text-to-image, reference-image editing, masked inpainting, text-to-video, and image-to-video
- Studio switch between image and video; playback, download, regenerate, and retry
- Conversations, generation history, asset library, group-shared reference images, thumbnails, and storage quotas
- User approval, user groups, model access control, and optional per-group generation quotas
- Image quotas counted in images; video quotas counted in seconds
- Mandatory administrator MFA, TOTP, recovery codes, and session revocation
- Encrypted storage for API keys and MFA secrets
- SSRF protection for outbound requests, rate limiting, CSRF protection, and security headers
- PostgreSQL, Redis, background job queues, and Docker Compose deployment
- Chinese and English user interfaces

## Video Generation

[v0.2.0](https://github.com/BossKnew/KnewStudio/releases/tag/v0.2.0) exposes video generation. Earlier releases reserved the adapter interfaces but did not turn them on.

- Text-to-video and image-to-video with aspect ratio, duration, and optional resolution
- Adapters: OpenAI Videos, Seedance (Volcengine Ark), and Wan (DashScope). Gateways that speak the OpenAI Videos protocol can reuse the OpenAI Videos adapter
- Asynchronous jobs: the worker creates an upstream task, polls until it finishes, then stores the MP4 with a first-frame thumbnail
- Administrators set each video model's allowed aspect ratios, durations, and optional resolutions, plus a poll timeout
- Group video quotas are a sliding window of seconds per member, independent from image quotas
- Prompt polishing supports text-to-video

Local development of video thumbnails requires `ffmpeg` on the host. The Docker API image includes ffmpeg.

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

Requirements: Node.js 24, npm 11, PostgreSQL, Redis, and `ffmpeg` for video thumbnails.

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

## Changelog

See [CHANGELOG.md](CHANGELOG.md) and [GitHub Releases](https://github.com/BossKnew/KnewStudio/releases).

## License

This project is licensed under the [Apache License 2.0](LICENSE).
