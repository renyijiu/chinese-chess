# 发布维护指南

项目仍处于 `0.x` 实验性阶段。发布由维护者从受保护的 `main` 创建；npm 包发布不在范围内，`package.json` 的 `private: true` 是有意设置。

## 发布前

1. 确认 PR 已通过必需状态检查，所有 review thread 已解决，`CHANGELOG.md` 已把 `[Unreleased]` 内容整理到目标版本。
2. 更新 `package.json` 版本，并确认 Node.js `22.13.0`、Git LFS 与 Chromium 可用。
3. 拉取 LFS 对象，检查第三方代码、模型、音频、字体、WASM 和权重的来源、许可证、对应源码与 hash。
4. 运行完整发布验证：

   ```bash
   git lfs pull
   npm ci
   npm audit --audit-level=low
   npm run format:check
   npm run typecheck
   npm run lint
   npm run test:unit
   npm run test:runtime
   npm run test:budget
   npm test
   npm run test:bundle
   npm run test:e2e:release
   ```

5. 视觉、音频、模型、在线协议或性能有变化时，额外运行 `CONTRIBUTING.md` 指定的场景，并把设备、浏览器、命令和结果写入 `docs/validation.md`。

## 创建发布

1. 从已验证的 `main` 提交创建签名标签 `vX.Y.Z`；标签版本必须与 `package.json` 和 changelog 一致。
2. GitHub Release 使用 changelog 内容，明确实验性限制、浏览器要求、已知风险和升级注意事项。
3. 若发布部署产物，使用同一标签源码运行 `npm ci` 与 `npm run build`，不要复用来源不明的本地 `dist/`。
4. 部署后复查页面状态、安全隔离头、Worker/WASM/NNUE MIME、缓存策略和生产浏览器 smoke。

## 发布后

- 验证 GitHub Release、源码归档与 LFS 对象可下载，并把 `[Unreleased]` 重置为空节。
- 检查 CodeQL、Dependabot、secret scanning 与生产监控；高影响回归优先回滚部署，再通过正常 PR 修复。
- 安全修复遵循 `SECURITY.md` 的私密协调流程，不在补丁可用前公开利用细节。
