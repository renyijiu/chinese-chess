# 网页 3D 中国象棋

这是一个面向写实中国象棋的浏览器游戏。当前首页按山城战场方向构建可实时交互的 3D 棋盘，32 枚棋子使用帅/将、仕/士、相/象、车、马、炮、兵/卒七类秦兵马俑带骨骼 GLB 资产。烧土陶色是主体，红黑双方共享几何，以少量风化朱砂/铜绿甲片、符节和军印区分阵营。

## 3D 棋盘场景

棋盘由 [`app/BoardViewer.tsx`](app/BoardViewer.tsx) 在 Three.js / React Three Fiber 中程序化构建，不依赖外部贴图或棋盘 GLB：

- 九道纵线、十道横线、两座九宫和中央河界按中国象棋结构生成。
- 河界处七条内部纵线断开，最外两条边线保持贯通。
- 炮位与兵卒位使用标准角标；所有落子点以固定 `SPACING` 映射到世界坐标，方便后续规则引擎和拾取系统复用。
- 美术表现采用实例化青石板、铜质嵌线、动态水道、分层城台、垛口、烽火和红黑军旗；远景使用约 500 KB 的 [`public/background/fortress-valley-v1.jpg`](public/background/fortress-valley-v1.jpg) 写实天幕承载夕阳、山谷与两侧山城细节，形成“写实远景 + 实时 3D 棋台”的混合渲染结构。
- 页面提供战场透视、正上方俯视、自动巡游、拖动旋转、滚轮缩放和右键平移。

远景天幕的无损 PNG 源文件保存在同目录的 `fortress-valley-v1.png`，生成规格记录在 [`assets/background/fortress-valley-v1.prompt.md`](assets/background/fortress-valley-v1.prompt.md)。默认关闭自动巡游，优先保持棋盘与山谷背景共同设计的导演机位。

七类正式资产的底座直径约 `0.89` 米，静止姿态最大占地 `0.943` 米，小于 `1.14` 的落子点间距；模型包围盒底面会自动贴合棋盘表面。高/中画质默认加载 LOD1，低画质加载 LOD2。

## 技术基线

- React 19 + TypeScript + Vinext/Vite 负责页面和应用层。
- Three.js + React Three Fiber 9 + Drei 负责三维场景、GLB 加载、镜头和交互。
- 正式渲染基线为 WebGL2；WebGPU 暂不作为发布依赖，等生态稳定且目标设备验证通过后再评估。
- 正式运行时资产采用 glTF 2.0/GLB、Meshopt 几何压缩；当前角色没有位图贴图，因此 KTX2 策略明确标记为 N/A，后续加入 BaseColor/Normal/ORM 位图时再启用 ETC1S/UASTC。
- 中国象棋规则实现为与 React/Three.js 解耦的纯 TypeScript 模块，规则状态是棋局唯一真相。

## 资产管线

七类角色依据原创的 [`秦兵马俑阵容概念图`](assets/concepts/xiangqi-characters/qin-terracotta-roster-v1.png) 构建，完整生成提示与使用边界记录在 [`qin-terracotta-roster-v1.prompt.md`](assets/concepts/xiangqi-characters/qin-terracotta-roster-v1.prompt.md)。帅/将采用秦军将领冠，仕/士持竹简与虎符，兵/卒采用秦式层札甲；“炮”保留象棋规则名称，但模型按秦代幻想重释为双人重型床弩，不出现火药、炮口或火球。可编辑 Blender 源、三档 raw GLB、Meshopt 运行时 GLB 和版本化 manifest 的当前流程是：

```text
秦兵马俑阵容概念 → Blender 可编辑源/骨架/7 clips/sockets → 三档 raw GLB
→ 合同校验 → Meshopt 运行时 GLB → 版本化 manifest → R3F/WebGL2
```

当前文件约定：

- `assets/characters/{role}/source/{role}.blend`：正式可编辑源。
- `assets/characters/{role}/exports/{role}-lod{0,1,2}-raw.glb`：交换与验证文件。
- `public/models/pieces/v1/{role}/{role}-lod{0,1,2}.glb`：网页实际加载的 Meshopt 产物。
- `public/models/pieces/v1/manifest.json`：7 类角色、14 种阵营外观、21 个 GLB 的公共契约。

常用命令：

```bash
# 重新生成、压缩并硬验证 21 个角色资产
npm run assets:pieces:build

# 只验证现有产物或打印预算报告
npm run assets:pieces:validate
npm run assets:pieces:report
```

当前 21 个运行时 GLB 均为单一 opaque skinned primitive、14 joints、7 clips；LOD1 七类合计约 1.70 MiB。模型通过顶点级烧土明暗、墓土侵蚀、裂隙、低金属度和高粗糙度避免塑料玩具感，完整红黑阵容接触表在 [`roster-contact-sheet-qin-terracotta.png`](assets/characters/reviews/roster-contact-sheet-qin-terracotta.png)。写实度定位是可实时上棋盘的秦俑中模，不宣称达到博物馆扫描或电影级手雕高模。

## 初始性能预算

以下是第一版约束，不是视觉目标；每加入一种角色都要在代表性的桌面和移动设备上复测，并以画面稳定性优先调整：

| 项目 | 均衡画质 | 电影画质/近景 |
| --- | ---: | ---: |
| 单角色 LOD0 | 40k–80k 三角面 | 80k–120k 三角面，仅少量近景角色 |
| 棋盘常驻 LOD1 | 每枚 10k–20k 三角面 | 每枚不超过 30k 三角面 |
| 远景 LOD2 | 每枚 2k–6k 三角面 | 同左 |
| 全场可见三角面 | 约 600k 以内 | 约 1.2M 以内 |
| 每帧绘制调用 | 100 以内 | 160 以内 |
| 单角色纹理 | 1K KTX2 | 2K KTX2；只给近景英雄角色 |
| 首屏 3D 下载 | 12 MB 以内 | 25 MB 以内，按需加载 |

同类棋子必须复用几何、骨骼和材质，优先使用实例化；红黑双方通过矿物残彩、甲片、符节和徽记变化区分。LOD 切换、阴影分级、DPR 上限和纹理分辨率都要随画质档位调整。禁止把 4K 未压缩贴图、雕刻高模或未合并的大量零件直接放入网页运行时 GLB。

## 本地运行

需要 Node.js `>=22.13.0`。

```bash
npm install
npm run prepare:model
npm run dev
```

质量检查：

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

`npm test` 会先执行 Vinext 生产构建，再验证服务端输出、R3F 棋盘接线、九纵十横结构和 WebGL2 回退逻辑。Playwright 另覆盖音频用户手势、键盘完整走子、直接点击/触摸 WebGL 棋盘交叉点、红黑双方连续八手对弈、吃子、精确存档恢复、确认框焦点隔离、WebGL context loss/恢复和低画质视觉回归。严格性能场景要显式运行 `test:performance:headed`，无头软件渲染结果不作为真机 GPU 结论。

可重复的测试范围、浏览器证据、资源预算、性能数字及尚未关闭的发布门槛记录在 [`docs/validation.md`](docs/validation.md)。当前 M1 Max 可见 Chromium 高画质实测为 87 次当前绘制、106 次峰值绘制、18.7 ms p95 渲染帧间隔和 3.84 MiB 首次可玩生产响应体；连续性能轮次的 p95 在 17.8–18.7 ms 波动。绘制与下载预算通过，但尚未稳定达到计划中的 16.7 ms 精确目标，严格性能命令会如实返回失败，因此不会宣称完整性能验收已经通过。

部署层继续使用 Vinext/Vite 与 Cloudflare Worker；D1、Durable Objects 和账号体系留给联机阶段接入。
