# KnewStudio

[English](README.md) · [简体中文](README_zh.md) · [日本語](README_ja.md)

KnewStudio is a self-hosted AI image workspace for teams and small servers. Administrators control provider credentials, real model IDs, model access, registration, and quotas while users get a focused generation, editing, conversation, and asset workflow.

## Highlights

- OpenAI-compatible image generation, editing, and masked inpainting
- Persistent BullMQ jobs, conversations, retries, uploads, and generated assets
- Registration approval, user groups, per-user quotas, and isolated resources
- Mandatory administrator MFA, recovery codes, encrypted provider keys, CSRF protection, rate limits, and SSRF-hardened outbound HTTP
- Source-built Docker Compose deployment with isolated application/data networks and bundled or external PostgreSQL and Redis
- Secure examples for host Nginx, Caddy, Docker Traefik, and Cloudflare

## Quick start

Requirements: Docker Engine, Docker Compose v2.24.4 or newer, and at least 2 CPU cores / 4 GiB RAM recommended.

```bash
cp .env.example .env
openssl rand -hex 32       # POSTGRES_PASSWORD
openssl rand -hex 32       # REDIS_PASSWORD
openssl rand -base64 32    # PROVIDER_SECRET_KEY
openssl rand -base64 32    # MFA_SECRET_KEY
```

Replace every `change-me-*` value in `.env`, then start the source build:

```bash
docker compose up -d --build
docker compose ps
```

Open [http://localhost:8080](http://localhost:8080). The default port is bound only to `127.0.0.1`; PostgreSQL, Redis, and the API have no published ports.

After the first login, change the bootstrap password, enroll administrator MFA, save recovery codes offline, remove `BOOTSTRAP_ADMIN_*` from `.env`, and recreate the API:

```bash
docker compose up -d --force-recreate api
```

## Supported deployment matrix

| Topology | Official status | Configuration |
| --- | --- | --- |
| Local browser + bundled services | Tested default | `.env.example` defaults |
| LAN/NAS over private HTTP | Supported, explicit opt-in | Private `APP_ORIGINS`, `0.0.0.0`, forwarded headers ignored |
| Host Nginx or Caddy over HTTPS | Supported | Loopback bind, trusted single proxy |
| Docker Traefik over HTTPS | Supported | `compose.traefik.yml` overlay |
| Cloudflare → host Nginx | Supported profile | Cloudflare-specific guide and firewall controls |
| External PostgreSQL and Redis | Supported | `compose.external.yml`, external URLs or secret files |
| Kubernetes, Swarm, S3 storage, URL subpaths | Not supported in this release | Community integrations are welcome |

See [Deployment](docs/DEPLOYMENT.md) and [Configuration reference](docs/CONFIGURATION.md) before exposing the service outside your machine.

## Security

Do not expose `.env`, `secrets/`, database services, Redis, Docker volumes, or the API container. Public deployments require HTTPS and an explicitly trusted reverse proxy. KnewStudio rejects wildcard origins, public HTTP origins, unsafe provider targets, and credentialed cross-origin redirects.

The bundled database and Redis live only on an internal data network. The Web container cannot reach them, and CI fails if an internal service gains a published port or an unsafe network attachment. The standalone Traefik example uses a read-only, API-allowlisted Docker Socket Proxy instead of mounting the Docker socket into Traefik.

Report vulnerabilities privately according to [SECURITY.md](SECURITY.md). Do not publish exploit details or real credentials in an issue.

Repository owners should complete the [maintainer release checklist](docs/MAINTAINER_CHECKLIST.md) before making a fork public.

## Development

Node.js 24, PostgreSQL, and Redis are required:

```bash
npm ci
npm run db:generate
npm run db:migrate
npm run dev
```

Before contributing, run:

```bash
npm test
npm run lint
npm run build
npm run licenses:check
npm audit --audit-level=high
npm audit --omit=dev --audit-level=high
```

CI also generates a CycloneDX SBOM artifact for every reviewed revision.

See [CONTRIBUTING.md](CONTRIBUTING.md). KnewStudio is licensed under [Apache-2.0](LICENSE).
