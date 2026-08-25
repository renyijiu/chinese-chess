# 验证与交付证据

本文记录 2026-08-25 在 Apple M1 Max 开发机上的可重复验证范围。除明确标注的限制外，结果来自自动化命令；无头软件渲染数据不替代可见 GPU 浏览器或目标手机证据。

## 交付命令

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run test:runtime
npm test
npm run assets:pieces:validate
npm run test:budget
npm run test:e2e
npm run test:visual:update
npm run test:visual
npm run test:performance:headed
```

- `npm test` 执行生产构建和 SSR/启动特征测试。
- `test:e2e` 覆盖音频手势、键盘、真实 Canvas 指针/触摸、红黑连续对弈、吃子、存档恢复、悔棋、认输、全景/河面/环境动画降级、保存画质冷启动、100+ 环境帧、画质往返、WebGL context loss 和移动布局；严格性能场景只由显式 performance 命令运行。
- `test:visual:update` 只在人工确认有意视觉变更后更新基线；随后必须执行一次不带更新参数的 `test:visual`。
- `test:performance:headed` 在 1920×1080 可见 Chromium 中运行。当前绘制、DPR、主动全景和下载断言通过，但 16.7 ms 精确帧间隔断言仍返回非零，作为未关闭发布门槛保留。

本次命令结果：typecheck 与 lint 通过；规则 26、对局 15、演出 20、运行时 36 个测试全部通过；21 个 GLB 资产全部通过合同和 Khronos 校验；生产 build 与 2 个 SSR smoke 通过；完整 E2E 为 15 passed / 1 skipped（性能场景只由显式命令启用）；干净视觉比较为 3 passed。唯一非零门槛是下文记录的 `test:performance:headed` p95 断言。

## 浏览器流程证据

Playwright 使用 Chromium 验证了：

- 桌面开始与继续、AudioContext 用户手势解锁、方向键/WASD、Enter/Space、Escape、完整吃子表现、刷新恢复、悔棋、认输取消与确认。
- 真实 WebGL Canvas 在红方与黑方俯视镜头下完成选择和落子，没有调用控制器或 DOM 走子捷径。
- 红黑双方连续八手覆盖兵、马、车与炮位床弩；每手核对合法落点、回合、演出解锁、历史和刷新后的 `revision=8`。
- 全景请求被主动中止时，环境显式进入 `degraded`，主题渐变与雾保留；红方 `a3 → a4`、黑方 `a6 → a5` 仍连续完成，状态始终保持 `degraded`。
- 强制河面渲染失败时退回静态釉面河道并上报 `degraded`；强制一个环境帧任务失败时仅注销该任务并保持其他调度任务运行。两条故障路径中红兵都能正常走到 `revision=1`。
- 已保存 low 或 medium 画质时，初始化壳会先恢复设置再挂载 Canvas；网络记录只出现对应档全景，从未请求 high 全景。
- `high → low → high → low → high` 每档均等待 `ready`；独占全景纹理的释放计数依次为 `0 → 1 → 2 → 3 → 4`，任一时刻只有当前档 URL 活跃。Skeleton 骨骼纹理在角色 LOD 卸载时也显式释放，往返后的 geometry / texture 计数保持在允许的异步 LOD 波动内。
- 高画质、环境运动开启时经过 120 个真实浏览器帧，geometry / texture 都保持 `59 → 59` / `38 → 38`，环境状态保持 `ready`。
- 通过 `WEBGL_lose_context` 触发上下文丢失/恢复后，黑方继续完成 `a6 → a5` 并成功悔棋，规则 revision 与历史保持一致。
- 390×844 覆盖设置面板、中低画质切换、减少动态效果、无水平溢出、所有可见交互目标至少 24×24 CSS px、黑方视角触摸 `a3 → a4` 和终局面板。
- 确认框打开后取消按钮获得焦点，后台棋局区域进入 inert；当前回合的“将军”状态同时使用文字、边线和色彩，不只依赖颜色。

## 视觉回归

截图先等待 `.board-viewer[data-environment-status="ready"|"degraded"]`，再等待渲染遥测和两个浏览器帧；不再用固定秒数猜测全景是否就绪。人工审查并批准的最小矩阵为：

- `desktop-high-menu-battle.png`：高画质、减少动态效果、战场视角、开始菜单。
- `desktop-low-selected-legal.png`：低画质俯视、选中棋子与合法落点。
- `desktop-low-pre-capture.png`：低画质俯视、吃子提交前目标底座外侧的朱砂提示环。
- `desktop-low-post-capture.png`：吃子时间线收敛后的规则终态与历史。
- `desktop-low-black-battle-check.png`：黑方战场视角、减少动态效果、将军提示。
- `desktop-low-terminal.png`：桌面终局面板。
- `mobile-low-settings.png`：390×844 设置面板。
- `mobile-low-playing.png`：390×844 黑方俯视触摸走子后。
- `mobile-low-terminal.png`：390×844 终局面板。

基线位于 `tests/visual/baselines/{desktop-chromium,mobile-chromium}/`，全图差异上限为 `0.5%`。高画质战场截图冻结非必要运动，严格性能测试则保留正式高画质动态策略。

## 资源生命周期

单元测试执行 100 次 `PresentationStore` 创建/释放和 100 次 mixer 注册/注销，断言监听器、mixer、临时 actor 与 effect 计数回到零。U6 的真实浏览器画质往返最初发现每轮增加 64 个纹理；根因是 32 个独立 `SkinnedMesh` 的 `Skeleton.boneTexture` 未在 LOD 卸载时释放。修复后，卸载路径对每个克隆模型的唯一 Skeleton 调用 `dispose()`，不遍历或处理 GLTF 缓存中的共享源 Skeleton。全景也改为单组件独占 `TextureLoader` 生命周期：质量档卸载时立即释放已加载纹理，迟到的网络回调在到达时释放而不发布。最新 high / low 往返的独占全景释放计数严格递增，120 个高画质环境帧前后 `renderer.info.memory` 的 geometry / texture 均稳定为 `59 / 38`。

场景保留一个无色 `BoardHitGrid` instanced draw 用于 90 个交叉点拾取。`renderer.info` 可验证 geometry / texture 登记数量稳定，但不提供真实 GPU 分配字节，因此不能据此宣称满足移动 GPU ≤128 MiB。

## 资产与下载预算

`npm run test:budget` 的 2026-08-25 结果：

| 项目 | 实测 | 门槛 | 结论 |
| --- | ---: | ---: | --- |
| 21 个角色运行时 GLB | 6,820,108 bytes / 6.50 MiB | 记录项 | 通过校验 |
| 七个 LOD1 角色 | 1,989,092 bytes / 1.90 MiB | ≤8.6 MiB | 通过 |
| high / medium / low 全景 | 126,368 / 63,914 / 25,440 bytes | 单调递减；high ≤250 KB | 通过 |
| 三档全景合计 | 215,722 bytes / 0.21 MiB | 记录项 | 通过 |
| LOD1 + 活动 high 全景 | 2,115,460 bytes / 2.02 MiB | ≤12 MiB | 通过 |

生产性能测试从导航开始累计浏览器实际读取的同源响应体，并要求七个 LOD1 GLB 与 high 全景都成功返回；medium/low 全景在首玩记录停止前必须没有请求。最新实际响应体为 `3,836,260` bytes（3.66 MiB），低于 12 MiB。

## 性能测量

固定场景为高画质 1920×1080、DPR 上限 1.5。32 子和 high 全景加载完成后先以自动巡游预热 60 帧，再清零采样、执行一次兵移动，并以自动巡游补足至少 180 帧。可见 Chromium 使用 ANGLE Metal（Apple M1 Max）得到 203 个正式样本：

| 指标 | 实测 | 项目门槛 | 结论 |
| --- | ---: | ---: | --- |
| 当前 draw calls | 77 | ≤100 | 通过 |
| 峰值 draw calls | 82 | ≤160 | 通过 |
| rendered-frame interval 平均 / p50 | 16.42 / 16.5 ms（平均约 60.91 FPS） | 诊断项 | 记录 |
| rendered-frame interval p90 / p95 / max | 17.9 / 18.4 / 19.8 ms | p95 ≤16.7 ms | **未通过** |
| 当前三角形 | 494,204 | 诊断项 | 记录 |
| geometry / texture 数 | 63 / 38 | 稳定性诊断 | 记录 |
| Canvas DPR | 1.0 | ≤1.5 | 通过 |
| 首次可玩生产响应体 | 3.66 MiB | ≤12 MiB | 通过 |
| 首玩活动环境 | high 全景；无 medium/low | 仅活动变体 | 通过 |

无头 SwiftShader 轮次的 draw calls 为 79 / 峰值 79，DPR 1.0、首玩 3.66 MiB；其 p95 为 140.4 ms，只作软件渲染诊断。可见浏览器同页 120 个原生 `requestAnimationFrame` 样本为平均 16.6675、p50 16.7、p90 16.8、p95 17.5、max 18.2 ms；场景 p95 比原生 rAF p95 慢 0.9 ms。该指标包含浏览器调度、垂直同步和合成，不是 CPU 函数耗时或 GPU render duration。没有通过归一化、容差或放宽断言伪造验收。

## 尚未关闭的发布门槛

- M1 Max 可见 Chromium 的场景 p95 为 18.4 ms，同页原生 rAF p95 为 17.5 ms，未达到计划要求的 16.7 ms；`test:performance:headed` 保持失败。
- 尚未取得目标手机的 30 FPS、GPU 内存和 context recovery 真机证据。
- 浏览器画质往返、120 个环境帧与单元登记表已经稳定；100 次真实攻击后的 GPU driver 分配仍需目标设备工具补测。
- 程序化中景道具当前没有独立网络资产，因此不存在“缺少道具文件”的请求故障面；本轮浏览器故障注入覆盖了全景网络失败、河面渲染失败和环境调度任务异常。
