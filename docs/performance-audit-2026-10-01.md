**全项目性能分析 · 2026-10-01**

基线提交：`2819496a`。范围覆盖页面启动、R3F/Three.js 场景、动画与拾取、音频、轻量 AI、Master、存档、WebRTC、生产构建和性能测试。此次只做分析与诊断，未修改业务实现。下文区分实际测量、代码确认和待验证建议；没有把预期收益当成已经实现的提升。

最值得先做的是：减少等待落子时的持续渲染，消除开局音频的同步工作，把动画进度移出 React 整层更新路径，并修正画质设置中未真正生效的降级。模型和资源已有较好的基础，不需要先重写渲染引擎或规则系统。

**1. 本次实测与证据边界**

环境为本机 Apple M1 Max、可见 Chromium / ANGLE Metal、1920×1080、实际 Canvas DPR 1，运行当前提交的生产构建，服务为本地 Wrangler。构建工具运行于 Node 26.5.1；CI 的 Node 版本不同。没有 Android/iPhone 真机、远程网络、GPU 分配字节或整机功耗测量。

| 指标                          |                        本次结果 | 判断                                              |
| ----------------------------- | ------------------------------: | ------------------------------------------------- |
| 高画质正式场景 p95 渲染帧间隔 |                       17.225 ms | 超过现有 16.7 ms 门槛                             |
| 同场景最大帧间隔              |                      185.735 ms | 存在需要单独定位的尾部停顿                        |
| 同场景当前 / 峰值 draw calls  |                         82 / 90 | 均低于 100 / 160 预算                             |
| 同场景当前三角形              |                         496,024 | 尚不能仅凭面数认定 GPU 瓶颈                       |
| 首次可玩同源响应体合计        |           3,938,048 B，3.76 MiB | 低于 12 MiB；这是响应体大小，非网络压缩后的传输量 |
| 七个 LOD1 + high 全景文件     |           2,109,496 B，2.01 MiB | 模型/环境文件体积并不失控                         |
| 初始棋局 JS 静态闭包          | 1622.9 KiB raw / 459.9 KiB gzip | 通过现有预算，但仍有可选功能拆包空间              |
| 作者音频资源                  |           1,921,564 B，1.83 MiB | 下载小于解码后占用                                |
| 作者音频解码 PCM              |         29,168,640 B，27.82 MiB | 其中背景音乐占 26.37 MiB                          |
| 浏览器音频引擎持有的 PCM      |         34,561,920 B，32.96 MiB | 加入合成备用音轨后进一步增长                      |
| Master 运行时文件             |         13,006,590 B，12.40 MiB | 已按需加载，不是普通对局首屏负担                  |

正式高画质场景取得 201 个样本。独立 rAF p95 也约为 17.23 ms，所以 **17.225 ms 不能直接解释成 GPU 绘制花了 17.225 ms**；其中包含显示刷新与调度抖动。185.735 ms 的停顿也没有在本次得到逐帧归因，不能直接归咎于 AI、音频或模型中的任一项。

另用诊断脚本在开局后静止 4 秒，统计实际 WebGL 绘制所在的帧和 CDP 主线程 TaskDuration 增量：

| 场景                          | 4 秒内有绘制的帧数 | 主线程任务时间 | 脚本执行时间 |
| ----------------------------- | -----------------: | -------------: | -----------: |
| high，环境运动开启            |                226 |     319.973 ms |   272.124 ms |
| high，减少动态效果            |                  0 |       0.443 ms |         0 ms |
| medium，环境运动开启          |                 80 |     130.687 ms |    96.936 ms |
| low，非静音                   |                  0 |       2.429 ms |     0.925 ms |
| low，静音，延长稳定等待后复测 |                  0 |       1.995 ms |     0.111 ms |

这是一组定位用样本，有少量诊断插桩开销，不能当作多设备 A/B 结论。CPU 数字仅为页面主线程任务时间，不包括音频线程、Worker、GPU、浏览器其他进程。静止时没有新帧是省资源的正确行为，不能把它解读为帧率为零而卡死。

low 静音最初在仅等待 1 秒后记录到 81 个绘制帧；将音频就绪后的等待延长至 5 秒复测为 0，因此不将前一轮报告为持续空转。稳定状态必须与入场/镜头过渡分开测量。该复测的音频冷启动仍出现 368 ms 长任务。

原始数据与可重复脚本位于本地忽略目录：

- [生产场景结果](../output/playwright/performance-audit/performance-evidence.json)
- [AI 场景结果](../output/playwright/performance-audit/ai-performance-evidence.json)
- [画质、静音与静止采样](../output/playwright/performance-audit/browser-results.json)
- [静音低画质延长等待后的复测](../output/playwright/performance-audit/muted-recheck.json)
- [浏览器采样脚本](../output/playwright/performance-audit/probe.mjs)
- [搜索与帧调度微基准](../output/playwright/performance-audit/cpu-probe.mjs)
- [搜索与帧调度结果](../output/playwright/performance-audit/cpu-results.json)
- [Worker 定时器探针](../output/playwright/performance-audit/worker-timers.mjs)、[结果](../output/playwright/performance-audit/worker-timers.json)

**2. 优先级与实施规模**

P1 表示建议第一批解决，P2 表示随后按测量收益推进。规模是相对改动范围，不是工期承诺。

| 优先级 | 项目                                 | 主要收益                                            | 规模   | 证据                             |
| ------ | ------------------------------------ | --------------------------------------------------- | ------ | -------------------------------- |
| P1     | 等待落子时冻结或降低环境更新         | 降低持续 CPU/GPU 工作、发热与耗电                   | 小     | 浏览器实测 + 调用链              |
| P1     | 去除开局同步合成音频；静音时延迟启动 | 缩短点击开始后的停顿，减少无效加载                  | 小～中 | 长任务 + CPU profile + 静音实测  |
| P1     | 动画进度绕过棋子整层 React 更新      | 减少走子/吃子期间 CPU 与分配                        | 中     | 源码确认，收益需 profile         |
| P1     | 修复帧调度的刷新率取整               | 避免 medium 实际变 20 FPS、144 Hz 下 high 变 48 FPS | 小     | 实际 medium 采样 + 确定性模拟    |
| P1     | 修复低画质抗锯齿切换无效             | 使低画质按预期减少开销                              | 小～中 | 浏览器 getContextAttributes 实测 |
| P1     | 补齐开局、吃子、空闲和严重卡顿指标   | 防止遗漏真实体验问题                                | 小～中 | 当前测试缺口和失败结果           |
| P2     | 背景音乐 PCM 占用与加载策略          | 降低约 33 MiB 音频常驻量                            | 中     | 字节计算 + 浏览器统计            |
| P2     | 后处理分辨率与挂载策略               | 减少吃子时突发分配和渲染目标占用                    | 中     | 当前安装依赖源码确认             |
| P2     | 默认画质与动态 DPR                   | 改善移动端、高 DPI 设备负担                         | 小～中 | 配置确认；缺少真机 A/B           |
| P2     | 轻量 AI 调度与局面 key 生成          | 缩短等待、减少每次搜索计算成本                      | 小～中 | Worker 计时 + Node CPU profile   |
| P2     | Master 生命周期、重放校验与内存测量  | 降低重复启动和长局面校验成本                        | 中     | 源码确认                         |
| P2     | 可选功能拆包、模型缓存与拾取         | 改善首次使用和切档峰值                              | 小～中 | 源码确认，尚未量化收益           |

**3. 空闲渲染：最直接的资源节省机会**

位置：[quality.ts](../components/xiangqi/runtime/quality.ts)、[FrameScheduler.tsx](../components/xiangqi/runtime/FrameScheduler.tsx)、[BoardScene.tsx](../components/xiangqi/scene/BoardScene.tsx)、[AnimationRegistry.ts](../components/xiangqi/animation/AnimationRegistry.ts)。

Canvas 已经是 `frameloop="demand"`，但 high 的环境调度为 60 FPS，旗帜、河面、尘粒和灯光持续调用 `invalidate()`。因此，等待玩家思考时仍然渲染整幅棋盘。每个渲染帧还会进入 AnimationDirector，并更新所有已注册棋子的 mixer；“只有一个 useFrame 回调”并不等于“只有一个棋子在做动画计算”。

现有“减少动态效果”已经证明，同样的 high 静态画面可以在静止后停止绘制。最小方案应复用这套机制：棋局等待、菜单/确认框遮挡期间暂停非必要运动，或把纯环境运动降为较低频率；走子、吃子、镜头拖动仍按交互需要渲染。低频环境和高频交互应分别调度，不能为省电把所有走子动画也降到 15 FPS。

进一步只更新正在走子、受击、销毁或淡入淡出的 mixer；待机动作按艺术需求低频更新或冻结。冻结 mixer 只节省骨骼动画 CPU，若场景仍在绘制，SkinnedMesh 的 GPU 蒙皮成本并不会自动消失。

验收应包含：静止 30 秒的绘制帧数与主线程任务时间，随后立即落子/旋转镜头，确认没有第一帧跳变或延迟。标签页隐藏已有暂停逻辑，应保留。R3F 官方也将允许场景静止、使用按需渲染作为降低持续负担的基本手段：[官方说明](https://raw.githubusercontent.com/pmndrs/react-three-fiber/master/docs/advanced/scaling-performance.mdx)。

**4. 开局音频：已有可归因的交互长任务**

位置：[AudioEngine.ts](../components/xiangqi/audio/AudioEngine.ts) 的 `unlock()`、`fillLoop()`、`getBuffer()`，以及 [XiangqiGame.tsx](../components/xiangqi/XiangqiGame.tsx) 的 `handleStart()`。

点击开始会先 `await unlockAudio()`，之后才进入新局。unlock 创建/恢复 AudioContext，立即同步生成 8 秒双声道备用音乐和 6 秒双声道环境音。在 48 kHz 下合计写入 1,344,000 个样本，并逐样本计算三角函数、幂和随机值。

本次开局观测到 87～89 ms 的长任务；首次 high 开局为 357 ms。CPU profile 显示首次 AudioContext 构造约占 268 ms 的自耗时采样，合成循环及噪声函数合计约 71 ms。构造时间受到本机音频设备冷启动影响，不能把全部 357 ms 都归因于 JavaScript 合成。后续页面中合成部分仍约 70 ms，是可直接处理的工作。

建议先做：

- 用户已保存静音设置时，不启动音频上下文、不合成备用音轨、不拉取和解码整套音频；第一次取消静音时再按用户手势启动。
- 将确定性的备用循环在现有资产构建阶段生成；如果必须运行时生成，则分片或放入 Worker，避免在开始按钮处理链中完成一百多万个样本计算。
- 将“棋局可进入”和“音频完全准备好”解耦，保留浏览器要求的用户手势解锁，不让等待音乐成为开局前置条件。

静音样本目前仍加载完整音频包、持有约 32.94 MiB PCM，AudioEngine 状态虽然显示 muted，内部声源仍存在。`setMuted()` 主要改增益，并不等于暂停解码、释放缓存或关闭 AudioContext。这是明确的无效资源开销，不是推测。

**5. 音频内存：压缩 MP3 不会同步缩小 PCM**

位置：[音频 manifest](../public/audio/qin-diorama/v1/manifest.json)、[AudioEngine.ts](../components/xiangqi/audio/AudioEngine.ts) 的 `loadPack()`。

背景音乐为 72 秒、48 kHz、双声道。PCM 采用 Float32，计算为 `72 × 48000 × 2 × 4 = 27,648,000 B`，即 26.37 MiB。仅把 MP3 从 1.10 MiB 再压缩到更小，不会按比例减少这块内存。[MDN AudioBuffer](https://developer.mozilla.org/en-US/docs/Web/API/AudioBuffer) 说明了其解码后数据结构；`decodeAudioData()` 还会重采样至 AudioContext 的采样率，因此单纯降低文件采样率也不一定减少最终 buffer：[API 说明](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData)。

建议顺序：先不加载静音/零音量下不使用的音乐，再让音乐在自身就绪后启动，最后评估缩短循环、按听感选择单声道，或改用原生媒体元素播放长音乐。短音效保留 AudioBuffer，避免牺牲低延迟。

媒体元素方案必须验证现有 4～68 秒循环点、无缝衔接、淡入淡出、移动端手势限制，不能直接替换后宣称体验不变。缩短音乐时长或改为单声道会改变资源合同，需要同步 manifest、hash 和音质验证。

当前 manifest 虽区分 `critical` 与 `deferred`，运行时仍顺序下载并解码六个资源，全部完成后才标记 ready。它限制了并发峰值，这是优点；但 critical/deferred 尚未形成实际的就绪优先级。保留有限并发即可，没有必要为 6 个文件引入通用资源调度框架。

**6. 走子动画：每一帧都让棋子层经过 React**

位置：[PresentationStore.ts](../components/xiangqi/presentation/PresentationStore.ts) 的 `publishActive()`、[GameBoardLayer.tsx](../components/xiangqi/game/GameBoardLayer.tsx) 的 `useSyncExternalStore()`、[PieceLayer.tsx](../components/xiangqi/scene/PieceLayer.tsx)。

调用链为：AnimationDirector → timeline.tick → publishActive → 创建新 snapshot/Set → 通知订阅者 → GameBoardLayer 重新执行 → 遍历所有棋子 → 更新移动棋子位置、阵营标记和 VFX。

普通走子为 700 ms，吃子为 1500 ms。只有少量对象的连续数值需要变化，却会让整层棋子重复创建 JSX、闭包和位置数组。`FactionMarkerInstances` 也会因为新的 `resolveWorldPosition` 函数重新写入整组实例矩阵。现有 useMemo 对稳定数据有效，但不能阻止父组件订阅逐帧 snapshot 后整层重新执行；仅加一个 memo、同时继续传新回调，也解决不了根因。

建议让 React 处理“动作开始/结束、棋局 revision、选择、画质”等低频变化。移动坐标、透明度、缩放和 VFX 进度通过 refs 在统一帧回调中更新；阵营标记只改移动棋子的 instance matrix。保留现有 PresentationStore 的动作去重、marker、超时与失败收敛，不需要另建状态管理器。

这与 R3F 对高频状态更新的建议一致：[Performance pitfalls](https://raw.githubusercontent.com/pmndrs/react-three-fiber/master/docs/advanced/pitfalls.mdx)。本项尚未做实现前后 profile，不能承诺固定 FPS 百分比。验收重点是一次走子/吃子的 React commit 数、主线程耗时、分配量和动作正确性。

**7. 画质降级存在两个具体落差**

首先是帧调度。`FrameScheduler` 在执行后令 `lastFrame = timestamp`，丢弃超出的时间余量。60 Hz 屏幕每次回调约 16.67 ms，medium 的目标间隔 41.67 ms 必须等到第 3 个回调，实际成为 50 ms，即 20 FPS。本次实测 medium 4 秒绘制 80 帧，与之吻合。

调用真实 `isScheduledFrameDue()` 的确定性模拟得到：

| 显示刷新率 | 配置环境帧率 | 模拟实际帧率 |
| ---------- | -----------: | -----------: |
| 60 Hz      |           24 |           20 |
| 120 Hz     |           24 |           24 |
| 144 Hz     |           60 |           48 |

应保留累计余量或使用稳定的下一次执行时间，处理后台恢复时限制追帧，避免连续补画。可把 medium 的艺术目标直接选为适合常见屏幕的 30 FPS，但仍需要修正时间累积；24 FPS 无法在 60 Hz 上做到完全均匀，验收应明确平均频率与间隔分布。

其次是抗锯齿。[BoardViewer.tsx](../app/BoardViewer.tsx) 按 quality 设置 `gl.antialias`，但 Canvas 没有随它重建。抗锯齿属于 WebGL 上下文创建参数；安装的 R3F 仅在没有 renderer 时调用 `new WebGLRenderer()`，后续赋值不改变底层上下文。

本次实测：high 冷启动 `antialias=true`；切到 low 后依然 `true`；low 冷启动则为 `false`。不能因此说 low 的所有降级都失效，LOD、环境、阴影等仍会变化；但抗锯齿这一项没有按界面切换。

最小决策是明确采用固定的上下文抗锯齿策略，动态性能主要由 DPR 和效果开关调节。如果必须动态切换原生 MSAA，再针对这个参数重建 renderer，并验证棋局、资产引用和 GPU 释放；不要让自动 DPR 调节频繁重建整个 Canvas。[WebGL 上下文说明](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/getContext)。

**8. 吃子后处理：分辨率参数和资源生命周期**

位置：[BattlePostprocessing.tsx](../components/xiangqi/scene/BattlePostprocessing.tsx)、[BoardScene.tsx](../components/xiangqi/scene/BoardScene.tsx)。

当前只在 high 吃子期间挂载 EffectComposer，这是减少常驻资源的措施；代价是每次吃子都重新创建并释放后处理链和渲染目标，第一次还有 shader 初始化成本。反复挂载是否构成可感知尖峰，应通过连续吃子的 trace 验证，目前不应误报为泄漏。

更明确的问题是 `EffectComposer resolutionScale={0.65}` 同时配了 `enableNormalPass={false}`。当前安装的 `@react-three/postprocessing 3.1.1` 中，该参数只用于可选 NormalPass 的 DepthDownsamplingPass；composer 本身仍按画布尺寸配置。因此它没有把整套后处理变成 65% 分辨率。SelectiveBloom 有自己的分辨率选项与默认值，也不能把这个 composer 参数理解成 bloom 目标尺寸。

建议先将分辨率控制放到实际支持缩放的效果上，并量测其 render target。若首次吃子仍卡顿，再在 high 会话中初始化一次、仅在吃子时启用执行，降到 medium/low 时释放。这个方案会用常驻 GPU 内存交换更稳定的动画，必须同时看帧时间和资源占用，不能一律把全部效果永久挂载。

**9. 移动端与高 DPI：画质应先匹配设备负担**

位置：[storage.ts](../components/xiangqi/game/storage.ts) 的 `DEFAULT_GAME_SETTINGS`、[quality.ts](../components/xiangqi/runtime/quality.ts)、[BoardViewer.tsx](../app/BoardViewer.tsx)。

没有保存设置的新用户统一 high。high 与 medium 同为 LOD1，中画质主要减少环境频率、阴影大小和后处理，棋子蒙皮与主体面数基本保留。本次两档约 49.6 万 / 49.4 万三角形，低画质约 16 万。

建议给新设备采用更保守的起点或短时间的主动渲染测量，保留用户显式选择。优先调 DPR，其次环境运动、阴影/后处理，再考虑 LOD；用稳定窗口与滞后避免来回跳档。不能把 demand 模式下的主动静止判为性能差。

DPR 从 1.5 降到 1，像素数减少约 55.6%，这是像素工作量的数学比例，不是 FPS 提升承诺。本次实际 DPR 为 1，因此没有验证高 DPI 的最坏情况。`powerPreference="high-performance"` 也不宜被当作省电设置，它只是浏览器选 GPU 的提示；是否调整应以目标设备验证为准。

**10. 轻量 AI：Worker 已隔离主线程，但内部仍可省时间**

位置：[lightweight.ts](../lib/xiangqi/ai/lightweight.ts)、[engine.ts](../lib/xiangqi/engine.ts)、[lightweight.worker.ts](../lib/xiangqi/ai/lightweight.worker.ts)。

Easy/Normal/Hard 已在 Worker 中运行，迁移到 Worker 不是待办。当前每 128 节点让出一次执行，默认实现为 `setTimeout(resolve, 0)`。在独立 Chromium Worker 中，390 次连续让出，三轮分别用了 1938.9、1963.1、1999.0 ms；这段实验完全没有搜索工作。

50,000 节点会涉及约 390 次这样的让出，而 Hard 总安全期限只有 2000 ms。这说明调度等待可能占用大量时间预算。探针不是完整 AI 对局 benchmark，不能直接把其数值加到任一局面的实际搜索时间上。浏览器也不保证零延时 timer 立即执行：[Worker timer 文档](https://developer.mozilla.org/en-US/docs/Web/API/WorkerGlobalScope/setTimeout)。

最小方案先调整分批频率：以可响应取消的时间片为目标，减少过于频繁的 timer；再评估原生任务调度能力或 MessageChannel。不要用无限微任务链代替，否则 Worker 可能处理不到 stop 消息。改动后同时测固定节点数耗时、停止响应时间、隐藏标签页行为和有效搜索深度。

资源目标需要区分：固定节点数时去掉等待主要缩短墙钟时间，未必减少计算总量；如果仍允许跑满 2 秒，反而可能完成更多计算、增加 CPU 总工作。所以不应同时提高节点预算，应保持棋力/工作量目标后再缩短等待期限。

另外，本机 Node 对标准初始局面固定搜索 50,000 节点，三轮为 923、845、824 ms，返回相同合法着法、完成深度 3。该探针禁用了 deadline 和 Worker yield，用于看计算部分，不能代替浏览器时延。CPU profile 中 `getPositionKey` 自耗时约占采样的 25%；它每个推进节点都建立 90 格字符串表示，再复制 repetitionCounts。合法走法生成还会先复制棋盘检查安全，再为同一合法候选复制一次棋盘。

可先减少局面 key 的临时分配、复用已验证的候选棋盘、让“是否存在合法着法”早停。保持规则结果和局面 key 兼容，再评估更复杂的增量表示；暂不建议直接引入位棋盘、通用置换表或重写整套规则。

**11. Master：下载大小之外，还有独立的内存与校验成本**

位置：[MasterEngineAdapter.ts](../components/xiangqi/ai/MasterEngineAdapter.ts)、[OpponentCoordinator.ts](../components/xiangqi/ai/OpponentCoordinator.ts)、[engine-cache.ts](../components/xiangqi/ai/engine-cache.ts)、[Master host](../public/workers/xiangqi-master-v1.worker.js)。

当前 vendored glue 默认 `INITIAL_MEMORY=134217728`，即 128 MiB WebAssembly 线性内存；最大容量为 2 GiB，不表示启动时已实际使用 2 GiB。128 MiB 也不能直接等同于实测进程物理内存。页面 JS heap 的 20～30 MiB 不能覆盖这部分。

资产加载已有哈希、MIME 校验、版本缓存、single-flight，以及 transferable 交接，这些应保留。可考虑的改进是：

- 同一 Master 模式连续新局时，有选择地复用 provider，通过已经支持的 `ucinewgame` 重置。现在 activateMatch 会销毁旧 provider，重新校验、创建 Worker 并初始化 NNUE。离开模式则释放，避免为了快开局长期占用引擎内存。
- `MasterEngineAdapter.search()` 在主线程调用 `validateOpponentRequestPosition()`，该函数反序列化并重放完整命令日志。轻量 AI 的相同校验在 Worker 内。长局面若测到主线程停顿，可复用增量校验或移入 Worker，但必须保留边界验证和主线程最终落子校验。
- 热缓存路径仍会读取并校验所有文件，随后克隆可转移 ArrayBuffer；冷加载写缓存也有拷贝。应先复用同一模式的活跃实例减少重复启动，再测是否需要改 buffer 所有权；不能随意删除校验或共享一个会被 transfer 脱离的 buffer。
- 增补 Master 启动/退出/反复开局时 Worker heap、WASM memory、ArrayBuffer 与浏览器进程内存证据。不要直接降低初始 WASM memory，编译产物、NNUE 和线程堆栈是否允许更小值还需验证。

**12. 其余模块：有机会，但不应抢在前面重构**

| 模块          | 当前情况                                                                                                      | 建议                                                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| JS 加载       | 主棋局 chunk 约 361.5 KiB gzip；引擎和在线会话动态导入已存在                                                  | 分析仍静态进入的 bloom/Selection、在线 UI、信令解析；目前角色没有 KTX2 贴图，可延迟其 loader 支持。按 manifest/产物测量收益，不预先承诺能少多少 KB |
| 模型缓存      | useLoader 复用源，factionGeometry 按源/阵营缓存；但 `source.clone()` 复制所有 geometry attributes，再替换颜色 | 如果内存 profile 显示显著，考虑只复制颜色、共享其余不可变 attributes；先厘清 dispose 所有权，避免一方释放共享 buffer                               |
| 切换 LOD      | 缓存可能同时保留已访问 LOD1/LOD2；每枚棋子分别准备模型和计算 Box3                                             | 缓存每角色/LOD 的静态底部偏移，量测切档后稳定占用。这是有上限的保留，不应直接称为无界泄漏                                                          |
| 拾取          | 90 格已有简化拾取，但棋子 group 仍让真实 SkinnedMesh 参与点击 raycast                                         | 如果点击 trace 显示三角形/蒙皮求交昂贵，用棋子简化碰撞体承接点击；保留轮廓点击和键盘行为，不能只删掉棋子点击                                       |
| 材质/实例化   | 环境、接触阴影和标记已有 instancing；棋子有独立骨骼、淡出与动作                                               | 不建议先重写为全场骨骼实例化。先修高频更新、共享稳定材质，再看是否值得增加复杂度                                                                   |
| 设置/HUD      | 音量滑条每次变化同步保存设置，并更新上层棋局状态；有多处 backdrop-filter                                      | 音频增益即时更新，设置写盘可在松手或短防抖后保存；稳定 props、隔离设置面板更新。模糊覆盖层只在合成器 profile 确认昂贵后降级                        |
| 存档          | 已有增量 GameReplayValidator 和备份保护，避免每手从零重放                                                     | 保留。很长历史的启动读取仍同步重放，先测再分片/迁移；不能为了性能删掉恢复校验或延后关键存档到可能丢失的时机                                        |
| WebRTC        | 传规则命令，15 秒 heartbeat，按 game 引用缓存 fingerprint；无每帧网络同步                                     | 非当前资源重点。只有长历史恢复时再看重放成本，别删 hash、revision 或断线保护                                                                       |
| Worker 服务端 | 主要输出页面和静态资源，业务棋局无数据库请求                                                                  | 不需要加 Redis、数据库索引、后台计算服务；保留引擎 MIME、隔离头和缓存完整性                                                                        |
| HTTP 缓存     | Master 版本化资源已有 immutable，manifest 强制重新验证                                                        | 普通 GLB/全景/音频可在正式 CDN 验证缓存命中与压缩，只有 URL 随内容更新时才使用长期 immutable。本地响应体统计不证明公网传输效率                     |

**13. 性能测量本身需要补齐**

位置：[performance-metrics.ts](../components/xiangqi/runtime/performance-metrics.ts)、[PerformanceSummary.tsx](../components/xiangqi/runtime/PerformanceSummary.tsx)、[performance.spec.ts](../tests/e2e/performance.spec.ts)、[CI](../.github/workflows/ci.yml)。

- 当前丢弃所有大于 250 ms 的帧间隔。这可防止把 demand 静止误判为卡顿，但也可能漏掉主动动画期间最严重的冻结。应区分静止与活跃测量窗口，并另记 >50/>100/>250 ms 停顿次数，不能一律过滤。
- p95 不够：少数 100～300 ms 停顿可能不影响 p95，却明显影响操作。增加首次开始、第一次选择、第一次普通走子、第一次吃子、首次开声音和切档的长任务/交互延迟。
- 性能展示每 0.5 秒发布一次 snapshot。本次 AI 用例得到 21 个样本，未达到至少 30 的断言；当前末尾只等待 sampleCount 比原值增加，不能保证足够数量。需要采足样本、最终主动刷新，并分开记录“搜索期间”与“搜索结束后的巡游”窗口。
- 当前固定高画质场景主要包含普通兵移动和巡游，缺少吃子时的选择性 bloom 压力场景，也未覆盖 DPR 1.5 的真实分辨率。
- CI 已有文件预算、单元测试和生产浏览器 smoke，但没有自动运行完整 performance 场景。普通 CI 可以锁住资源量、静止绘制与主线程长任务；真实 GPU 帧预算应在固定机器/设备上单独重复测量，不能拿 SwiftShader 结果代替。
- geometry/texture 数稳定只是资源数量稳定，不是 GPU 字节数达标。长局面需分别测 page heap、AudioBuffer、Worker/WASM 和 GPU/进程资源，不将它们混成一个 heap 数字。

**14. 建议的落地顺序与验收**

第一批以少量改动为主：静止环境策略、静音不初始化音频、备用循环离线生成、调度保留时间余量、抗锯齿策略纠正，同时修复性能采样窗口。可以先用现有“减少动态效果”作为资源对照，不需要新依赖。

第二批处理动画进度更新路径、首次吃子后处理、背景音乐内存策略和设备默认 DPR。每项分别做同设备同局面的前后比较，避免一次改很多后无法归因。

第三批才做轻量 AI 局面计算、Master 会话复用、资源细分与拾取优化。AI timer 等待可单独先验证，但应保持节点预算，不以增加计算量冒充省资源。

| 场景                 | 需要验证的结果                                               |
| -------------------- | ------------------------------------------------------------ |
| 静止等待落子         | 30 秒绘制次数明显降低；下一次输入及时响应                    |
| 首次开局、取消静音   | 无项目同步合成造成的 >50 ms 长任务；音频失败不阻碍棋局       |
| 静音冷启动           | 不下载/解码未使用音乐；启用声音后正确恢复                    |
| 普通走子与吃子       | 动画连续；React 提交不随整层棋子逐帧增长；marker/音频不重复  |
| 60/120/144 Hz        | 环境平均频率符合目标，无累计漂移、后台追帧                   |
| high ↔ low、多次吃子 | 核对实际 context 参数、DPR、渲染目标与释放后稳定占用         |
| 轻量 AI              | 固定节点下着法合法/确定；搜索等待下降；stop 与隐藏恢复仍及时 |
| Master 多次新局/退出 | 旧请求不提交；模式退出后 Worker/WASM 可释放                  |
| 目标手机             | 连续玩 10～15 分钟后仍流畅，记录温升、掉帧、内存与电量趋势   |

本次实际执行：生产 build、JavaScript budget、runtime/audio/AI 资产预算均通过；runtime 49、presentation 61、AI 70 个单元测试通过。完整 headed performance 两项均失败：高画质 p95 超过门槛；AI 项样本不足。搜索窗口未记录到 >50 ms 主线程长任务，但不能将该项写成性能通过。其余单元/E2E 套件未在本次全量重跑。

环境准备中发现工作树有未展开的 LFS 指针，使用本机已有且 SHA-256 与指针一致的资源完成验证；未修改资产版本。浏览器测试所需的沙盒权限问题已处理，最终上述帧数据确实来自 Metal GPU。此前仓库文档中的 18.185/18.4 ms 是历史记录，不作为此次实测值。
