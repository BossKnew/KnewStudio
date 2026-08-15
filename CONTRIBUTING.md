# Contributing to KnewStudio

Thank you for helping improve KnewStudio. By participating, you agree to follow `CODE_OF_CONDUCT.md` and to license contributions under Apache-2.0.

## Before opening a change

- Use GitHub Discussions or an issue for substantial product or schema changes.
- Use GitHub Private Vulnerability Reporting for security issues; never place exploit details or real secrets in a public issue.
- Keep changes focused and preserve compatibility with the supported Docker Compose deployment matrix.

## Development

Use Node.js 24, PostgreSQL, and Redis. Copy `.env.example` to `.env`, use development-only secrets, then run:

```bash
npm ci
npm run db:generate
npm run db:migrate
npm run dev
```

Before submitting a pull request:

```bash
npm test
npm run lint
npm run build
npm run licenses:check
npm run security-configs:check
npm audit --audit-level=high
npm audit --omit=dev --audit-level=high
```

Never commit `.env`, the `secrets/` directory, database dumps, media, provider responses, API keys, cookies, MFA seeds, or recovery codes. Add tests for changed behavior and update all affected language documentation when configuration or deployment behavior changes.

## Pull requests

Describe the problem, approach, security impact, test evidence, migration/rollback requirements, and documentation changes. Maintainers may request smaller commits or changes to preserve secure defaults.
