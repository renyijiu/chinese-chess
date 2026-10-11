# Changelog

本项目的重要变更记录在此文件中，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- 增加 CodeQL、依赖变更审查、JavaScript gzip 预算和更严格的 TypeScript/ESLint 检查。
- 增加架构、发布、贡献、安全、支持、行为准则和资产来源文档。

### Changed

- 七类 Q 版秦俑棋子换成一体雕塑母版（V3）：保留大头比例、造型元素与配色，脸、手、衣褶、甲片、发髻重新雕刻并带烘焙明暗。
- 棋子改为等比缩放到 0.89 m 棋座，不再被纵向拉伸；各角色高度随之变化（例如仕/士约 1.48 m → 1.18 m）。
- 运行时模型按部位蒙皮（头、武器、坐骑整体跟随单根骨骼），阵营色区域通过 `_SHADE` 属性保留烘焙明暗。
- AI Provider 与在线会话改为按需加载，避免进入初始棋局 JavaScript 闭包。
- 升级并收敛构建依赖，删除未接入的数据库与 Cloudflare 绑定脚手架。

### Security

- 生产与开发依赖审计恢复为零已知漏洞；GitHub Actions 均固定到完整提交 SHA。

首个带版本标签的发布会在此节稳定后创建，并将 `[Unreleased]` 内容归档到对应版本。
