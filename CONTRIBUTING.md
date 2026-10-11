# 贡献指南

感谢你帮忙改进网页 3D 中国象棋。项目还在实验性预发布阶段，请让每个改动范围清楚、可以验证。

## 开始之前

1. 安装 Git LFS、Node.js `>=22.13.0` 和 npm。使用 nvm 的话，运行 `nvm use` 会读取仓库里的 `.nvmrc`。
2. Fork 并克隆仓库，然后运行：

   ```bash
   git lfs install
   git lfs pull
   npm ci
   npm run dev
   ```

3. 读一遍 [`docs/architecture.md`](docs/architecture.md)。较大的功能请先提 Issue，说明使用场景、范围和验收方式。

## 开发约定

- 棋局只以规则模块（`lib/xiangqi/`）的状态为准。规则和存档逻辑必须是确定性的；动画、音频或 Worker 出错，都不能改变已经提交的棋局。
- 不要提交密钥、`.env*`、本机绝对路径，或不确定能否再分发的素材。
- 改动资产时，要同时更新来源记录、生成脚本、运行时产物和对应的校验。详见 [`ASSET_ATTRIBUTION.md`](ASSET_ATTRIBUTION.md)。
- 大文件按 [`.gitattributes`](.gitattributes) 的规则走 Git LFS。不要把 LFS 指针文件当成真正的运行时文件。
- 提交信息沿用现有的 Conventional Commit 风格，例如 `fix(ai): ...`、`feat(scene): ...`、`docs: ...`。

## 验证

小改动至少运行直接相关的测试，以及：

```bash
npm run format:check
npm run typecheck
npm run lint
```

跨模块或与发布相关的改动，再运行：

```bash
npm run test:unit
npm run test:runtime
npm run test:budget
npm test
npm run test:bundle
npm run test:e2e:release
```

- 改了界面或画面：运行 `npm run test:visual`，确认差异符合预期后再更新基线。
- 改了引擎、模型或音频：运行对应的 `assets:*:validate` 命令。

各命令的作用见 [`README.md`](README.md#开发与测试)。

## Pull Request

- 写清楚要解决的问题、做法、验证结果和还存在的风险。
- 功能改动和无关的格式调整分开提交。
- 改了界面，请附桌面和手机截图；更新了截图基线，请说明每处差异为什么符合预期。
- 引入第三方代码、模型、音频或数据时，补充版本、上游链接、许可证和完整的来源记录。
- 提交即表示你有权按本仓库的 `GPL-3.0-only` 许可证贡献这些内容。

安全问题不要提公开 Issue，请按 [`SECURITY.md`](SECURITY.md) 处理。
