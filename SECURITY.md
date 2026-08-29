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

维护者会在私密通道确认收到报告，并在完成影响评估后协调修复与披露。若 GitHub 私密报告入口不可用，请只提交一个不含技术细节的公开 Issue，请求维护者建立私密联系方式。

`app/chatgpt-auth.ts` 等未接入活动路由的示例或预留边界，不应被视为生产认证合同；启用前必须单独完成威胁建模和部署层 header 验证。
