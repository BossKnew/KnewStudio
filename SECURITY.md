# Security Policy

## Supported versions

Security fixes are provided for the latest released version and the default branch. Older releases may require upgrading before a fix can be applied.

## Reporting a vulnerability

Do not open a public issue for authentication bypasses, credential exposure, SSRF, cross-user data access, or other security vulnerabilities.

Use GitHub's **Report a vulnerability** form under the repository Security tab (Private Vulnerability Reporting). Include the affected version, deployment topology, reproduction steps, impact, and any suggested remediation. Remove real API keys, passwords, session cookies, personal data, and production hostnames from the report.

Repository owners must enable Private Vulnerability Reporting before making the repository public. If the button is unavailable, contact the repository owner privately through their published profile contact rather than opening a public issue.

Maintainers should acknowledge a complete report within 7 days and provide a status update within 14 days. Disclosure timing will be coordinated with the reporter after a fix or mitigation is available.

## Deployment responsibility

KnewStudio is self-hosted software. Operators are responsible for TLS termination, firewall rules, reverse-proxy trust, secret storage, backups, updates, and provider account controls. Start with the loopback-only Compose defaults and only expose the service after following the relevant deployment guide.
