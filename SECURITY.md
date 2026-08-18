# Security Policy

## Supported versions

安全修复只针对默认分支的最新版本。部署方应及时拉取更新、重新构建镜像，并自行维护操作系统、Docker 和反向代理的安全更新。

## Reporting a vulnerability

请通过 GitHub 仓库的 **Security → Advisories → Report a vulnerability** 私下提交安全问题。不要在公开 Issue、Discussion 或 Pull Request 中披露未修复漏洞的利用细节。

报告中请尽量包含：

- 受影响的提交或版本
- 前置条件、复现步骤和最小验证样例
- 对机密性、完整性或可用性的影响
- 已知缓解措施或建议修复方案

请避免访问不属于你的数据、执行破坏性测试或影响其他用户。维护者确认并修复问题后，会协调公开披露时间。

## Deployment incidents

如果怀疑部署密钥泄露，请立即轮换数据库密码、Redis 密码、供应商加密密钥、MFA 加密密钥和所有上游 API Key，并撤销现有会话。密钥轮换工具应先在备份环境中验证。
