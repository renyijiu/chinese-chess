# 验证与交付证据

本文记录 2026-08-24 在 Apple M1 Max 开发机上的可重复验证范围。除明确标注的限制外，结果来自自动化命令，不把静态推断当成浏览器实测。

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
npm run test:visual
npm run test:performance:headed
```

- `npm test` 执行生产构建和 SSR/启动特征测试。
- `test:e2e` 覆盖音频手势、键盘、真实 Canvas 指针/触摸、红黑连续对弈、吃子、精确存档恢复、悔棋、认输、WebGL context loss、移动布局和低画质视觉回归；严格性能场景只由显式 performance 命令运行。
- `test:visual:update` 只在确认有意视觉变更时更新基线；提交前必须再执行一次不带更新参数的 `test:visual`。
- `test:performance:headed` 必须在可见 Chromium 中运行。无头 SwiftShader 结果只能作诊断，不能替代目标 GPU 浏览器测量。当前该命令会在精确 `16.7 ms` 断言处返回非零，作为尚未关闭的发布门槛保留。

## 浏览器流程证据

Playwright 使用 Chromium 验证了：

- 桌面 1440×900：开始对局；探针确认 AudioContext 在开始手势中首次创建，若初始为 suspended 则同一手势调用 resume；方向键/WASD 移动焦点、Enter 选择与走子、Escape 取消、吃子表现完成后解锁、刷新继续、悔棋、认输取消与确认。
- 真实 3D 拾取：俯视镜头下直接向 WebGL Canvas 的 `a3` 与 `a4` 交叉点发送指针事件，确认选中、合法落点、`revision=1` 和历史记录；测试没有调用控制器或 DOM 捷径。
- 双方完整回合：真实 WebGL Canvas 连续执行红黑各四手，覆盖兵、马、车与炮位床弩，逐手核对合法落点、回合交替、表现解锁和历史记法；`revision=8` 后刷新继续仍恢复同一局面。
- 恢复能力：通过 `WEBGL_lose_context` 真实触发丢失，等待 `webglcontextrestored`、确认上下文恢复并产生新帧，然后直接在恢复后的 Canvas 完成黑方 `a6 → a5`；规则 revision、历史与悔棋保持一致。
- 390×844 移动视口：触摸开始、设置和 HUD 控件，验证减少动态效果、画质切换、无水平溢出及可操作按钮；随后通过触屏坐标在 Canvas 完成 `a3 → a4`。模拟移动视口已经覆盖真实触摸拾取，目标真机仍需补手指落点与 GPU 验收。
- 刷新继续会核对 `revision=3`、行棋方以及三条历史的精确顺序和坐标，不只检查存在一个可撤销状态；主/备存档损坏回退另由单元测试覆盖。
- 认输确认框打开后取消按钮自动获得焦点，后台棋局区域进入 inert 状态，确认命令使用打开对话框时冻结的 revision。
- 可访问性：盘面键盘控件保持可见焦点和当前坐标/棋子 ARIA 描述，方向键/WASD、Enter/Space 与 Escape 均有行为测试。

低画质视觉基线位于：

- `tests/visual/baselines/desktop-chromium/visual.spec.ts/desktop-low-initial-board.png`
- `tests/visual/baselines/mobile-chromium/mobile.spec.ts/mobile-low-playing.png`

基线先通过 `test:visual:update` 生成，再由一次干净的 `test:visual` 比对通过；全图差异上限为 `0.5%`。低画质用于降低软件渲染器噪声；高画质性能是独立场景，不用视觉阈值掩盖性能失败。

## 资源生命周期

单元测试执行 100 次 `PresentationStore` 创建/释放以及 100 次 mixer 注册/注销，断言监听器、mixer、临时 actor 和 effect 计数回到零；时间线另覆盖 marker 跨帧、重复更新、取消、跳过、异常和超时收敛。这证明应用所有的生命周期登记表能够稳定清空，但不等价于浏览器驱动层的 GPU 分配字节测量。

场景保留一个无色 `BoardHitGrid` instanced draw 用于 90 个交叉点拾取，并非零成本拾取层。性能统计包含这一次绘制调用。

## 资产与下载预算

- 21 个秦兵马俑运行时 GLB 校验通过；全部 LOD 合计约 5.6 MiB。
- 七个 LOD1 角色合计约 1.70 MiB，低于 8.6 MB 预算。
- 生产构建高画质首次可玩同源响应体最新合计 `4,025,707` bytes，即 `3.84 MiB`，低于 12 MiB 门槛。

性能配置先执行生产构建，再由 `vinext start` 在独立端口提供资源。测试要求七个 LOD1 GLB 全部成功返回，任何已纳入的响应体读取失败都会直接失败，不再静默少算。该数字是浏览器可读的生产响应体总量；CDN 上线后的压缩 wire transfer 仍需在部署环境复核。

## 性能测量

固定场景为高画质 1440×900、32 子加载完成后预热、清零采样，再执行一次兵移动。可见 Chromium 使用 ANGLE Metal（Apple M1 Max）测得：

| 指标 | 实测 | 项目门槛 | 结论 |
| --- | ---: | ---: | --- |
| 当前 draw calls | 87 | ≤100 | 通过 |
| 峰值 draw calls | 106 | ≤160 | 通过 |
| p95 rendered-frame interval | 18.7 ms（连续轮次 17.8–18.7 ms） | ≤16.7 ms | **未通过精确 60 FPS 门槛** |
| 当前三角形 | 212,386 | 诊断项 | 记录 |
| geometry / texture 数 | 84 / 44 | 稳定性诊断 | 记录 |
| 首次可玩生产响应体 | 3.84 MiB | ≤12 MiB | 通过 |

`p95 rendered-frame interval` 是浏览器相邻渲染帧的墙钟间隔，包含调度和合成影响；它不是 CPU 函数耗时，也不是 GPU render duration。`renderer.info` 只提供资源数量，不提供实际 GPU 内存字节，因此当前不能声称满足移动 GPU ≤128 MB。静态阴影冻结与动作期环境暂停已降低 shadow pass 和峰值工作量，但精确 16.7 ms 门槛仍差约 1.1–2.0 ms；发布前仍需针对正式目标桌面和现代中高端手机做真机分析与优化。

## 尚未关闭的发布门槛

- 可见桌面浏览器 p95 帧间隔仍未达到计划中的 16.7 ms。
- 尚未取得目标手机的 30 FPS、GPU 内存和上下文恢复真机证据。
- 浏览器生命周期测试验证登记表稳定；100 次攻击后的浏览器 GPU driver 分配仍需使用目标设备工具补测。
- 视觉基线覆盖低画质初始局面和移动布局；14 种角色六视图与每类攻击/击毁关键帧需要随最终美术资产继续扩充。
