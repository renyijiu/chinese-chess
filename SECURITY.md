# Security Policy

## Supported versions

本项目处于实验性预发布阶段。安全修复只针对默认分支的最新版本；旧提交和个人 Fork 不提供安全维护承诺。

## Reporting a vulnerability

请使用 GitHub 的 [Private Vulnerability Reporting](https://github.com/renyijiu/chinese-chess/security/advisories/new) 私下报告漏洞。不要在公开 Issue、Discussion、Pull Request 或提交信息中披露利用细节。

报告请包含：

- 受影响的提交、页面或资产路径；
- 可复现步骤与预期影响；
- 已验证的浏览器、操作系统和部署方式；
- 可选的最小修复建议。

维护者目标是在 3 个工作日内确认收到报告、7 个工作日内给出初步影响评估；复杂问题的修复时间取决于影响范围，但会在私密通道持续同步状态并协调披露。若 GitHub 私密报告入口不可用，请只提交一个不含技术细节的公开 Issue，请求维护者建立私密联系方式。

修复可用前请勿公开漏洞细节。维护者会在补丁、受影响版本、缓解方式和致谢信息准备完成后与报告者商定披露时间；若问题不属于安全漏洞，也会说明理由并建议合适的公开跟进渠道。

当前游戏没有账户、认证或应用数据库边界。未来增加这些能力前，必须单独完成威胁建模、权限测试和部署层 header 验证。
