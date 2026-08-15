# Maintainer release checklist

Complete these repository settings before making KnewStudio public. They cannot be enabled by committed files alone.

## GitHub security settings

- Enable **Private Vulnerability Reporting** under Settings → Security → Code security and analysis.
- Enable Dependabot alerts, Dependabot security updates, secret scanning, and push protection where the repository plan supports them.
- Keep default GitHub Actions permissions read-only and grant write access only to the CodeQL `security-events` permission already declared in its workflow.
- Replace or remove any repository-specific contact links that do not resolve after the final owner/repository name is chosen.

## Branch and release protection

- Protect `main`; require pull requests and at least one independent review.
- Require the `application`, `compose`, `container-build`, `secret-scan`, `image-scan`, and CodeQL checks before merge.
- Block force pushes and branch deletion. Restrict bypass permission to the smallest maintainer group.
- Create releases from reviewed tags. This project does not publish container images; release notes must tell users which source tag to build.
- Attach or link the CI-generated CycloneDX SBOM for the tagged revision and publish the relevant `CHANGELOG.md` section.

## Pre-publication secret review

- Start from a fresh Git history or scan the entire existing history, not only the working tree.
- Confirm `.env`, `secrets/`, database dumps, media, logs, certificates, private keys, provider responses, MFA seeds, recovery codes, and session cookies were never committed.
- Rotate any credential that has ever appeared in a commit, patch, CI log, issue, screenshot, or shared archive, even if later deleted.
- Run the full CI workflow from a pull request before the first public release.

## Release operations

- Run database and media backup/restore tests against the release candidate.
- Review dependency and container High/Critical findings; do not waive them without a documented impact analysis.
- Verify local, host-proxy, Traefik, external-service, and secrets Compose configurations.
- Confirm the standalone Traefik Socket Proxy pin is still supported and has no known regression affecting Traefik's Docker provider.
- Publish known limitations: root-path deployment only, local media storage only, Docker Compose only, and no prebuilt image.
