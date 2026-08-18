# Security Policy

## Supported versions

Security fixes are provided only for the latest version on the default branch. Deployers should pull updates promptly, rebuild images, and maintain current security updates for the operating system, Docker, and reverse proxy.

## Reporting a vulnerability

Please report security issues privately through **Security → Advisories → Report a vulnerability** in the GitHub repository. Do not disclose exploitable details of an unpatched vulnerability in a public issue, discussion, or pull request.

Please include the following where possible:

- The affected commit or version
- Preconditions, reproduction steps, and a minimal proof of concept
- The impact on confidentiality, integrity, or availability
- Known mitigations or suggested fixes

Please avoid accessing data that does not belong to you, destructive testing, or actions that could affect other users. After the maintainers confirm and fix the issue, they will coordinate a public disclosure timeline.

## Deployment incidents

If deployment credentials are suspected to be compromised, immediately rotate the database password, Redis password, provider encryption key, MFA encryption key, and all upstream API keys, then revoke existing sessions. Validate key-rotation tools in a backup environment first.
