# Changelog

All notable changes are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-08-14

Initial source release of the self-hosted KnewStudio image workspace.

### Security

- Isolated PostgreSQL and Redis on an internal Compose data network and added CI topology invariants.
- Replaced direct Traefik Docker Socket access with a read-only, API-allowlisted Socket Proxy example.
- Added account-scoped failed-login throttling and atomic Redis rate-limit windows.
- Moved upload rate and concurrency admission ahead of multipart file parsing.
- Added startup rejection for placeholder, malformed, incomplete, or reused critical secrets.
- Defined no-store/private/SSE cache policies and HSTS for every supported HTTPS edge.

### Added

- CycloneDX SBOM generation, dependency license checks, and full dependency auditing in CI.
- Docker Compose v2.24.4 minimum-version documentation and public-release acceptance checks.
