# Contributing

感谢你帮助改进网页 3D 中国象棋。项目仍处于实验性预发布阶段；请让每个改动保持范围清晰、可验证，并保留规则状态作为棋局唯一真相。

## 开始之前

1. 安装 Git LFS、Node.js `>=22.13.0` 和 npm；使用 nvm 时运行 `nvm use` 会读取仓库的 `.nvmrc`。
2. Fork 并克隆仓库，然后运行：

   ```bash
   git lfs install
   git lfs pull
   npm ci
   npm run dev
   ```

3. 阅读 [`docs/architecture.md`](docs/architecture.md)；对较大功能先提交 Issue，说明用户场景、边界和验收方式。

## 开发约定

- 规则和存档逻辑必须保持确定性；动画、音频和 Worker 失败不能改变已提交棋局。
- 不提交密钥、`.env*`、工作站绝对路径或未经确认可再分发的素材。
- 资产修改必须更新来源、生成脚本、运行时产物和相应校验。请阅读 [`ASSET_ATTRIBUTION.md`](ASSET_ATTRIBUTION.md)。
- 大文件必须遵守 [`.gitattributes`](.gitattributes) 的 Git LFS 规则。不要把 LFS pointer 当作有效运行时文件。
- 使用与现有历史一致的 Conventional Commit 风格，例如 `fix(ai): ...`、`feat(scene): ...`、`docs: ...`。

## 验证

小改动至少运行直接相关的测试以及：

```bash
npm run typecheck
npm run lint
```

跨模块或发布相关改动运行：

```bash
npm run test:unit
npm run test:runtime
npm run test:budget
npm test
npm run test:bundle
npm run test:e2e:release
```

视觉改动还要运行 `npm run test:visual`，检查差异后才更新基线。引擎、模型或音频改动分别运行对应的 `assets:*:validate` 命令。

## Pull Request

- 说明问题、解决方式、验证结果与仍存在的风险。
- 把功能改动和无关格式化拆开。
- 若改动 UI，请附桌面和移动截图；若更新快照，解释每个预期差异。
- 若引入第三方代码、模型、音频或数据，请补充版本、上游链接、许可证和完整 provenance。
- 同意提交即表示你有权按本仓库的 `GPL-3.0-only` 许可证贡献该内容。

安全问题不要提交公开 Issue；请遵循 [`SECURITY.md`](SECURITY.md)。
