# Changelog

本项目的重要变更记录在此文件中，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- 增加 CodeQL、依赖变更审查、JavaScript gzip 预算和更严格的 TypeScript/ESLint 检查。
- 增加架构、发布、贡献、安全、支持、行为准则和资产来源文档。

### Changed

- AI Provider 与在线会话改为按需加载，避免进入初始棋局 JavaScript 闭包。
- 升级并收敛构建依赖，删除未接入的数据库与 Cloudflare 绑定脚手架。

### Security

- 生产与开发依赖审计恢复为零已知漏洞；GitHub Actions 均固定到完整提交 SHA。

首个带版本标签的发布会在此节稳定后创建，并将 `[Unreleased]` 内容归档到对应版本。
