# 场景、资产与性能预算

本文面向要改动 3D 场景或模型资产的贡献者，说明棋盘怎么搭、画质怎么分档、角色模型怎么生成，以及体积和性能的上限。视觉风格约定见 [`qin-diorama-art-direction.md`](qin-diorama-art-direction.md)，实测数据见 [`validation.md`](validation.md)。

## 渲染基线

- 渲染基于 WebGL2。WebGPU 暂不作为发布依赖，等生态稳定并在目标设备上验证后再评估。
- 运行时模型采用 glTF 2.0 / GLB，几何用 Meshopt 压缩。当前角色没有位图贴图，所以不使用 KTX2；以后加入 BaseColor / Normal / ORM 贴图时再启用 ETC1S / UASTC。

## 棋盘场景

棋盘由 [`BoardSurface.tsx`](../components/xiangqi/scene/BoardSurface.tsx) 用代码生成，不依赖外部棋盘模型：

- 九道纵线、十道横线、两座九宫和中央河界按中国象棋结构生成。河界处中间七条纵线断开，最外两条边线贯通；炮位和兵卒位有标准角标。
- 所有落子点只通过 `squareToWorld()` 换算成固定的世界坐标，规则和点击拾取都不依赖美术节点。
- 近景是厚陶棋台、圆角秦砖、黑漆线格、青绿釉河、双重低城垣和瓦当压印。中景道具使用实例化几何，不参与棋盘的点击检测（raycast）。
- 远景按画质只加载一张 360° 秦陵沙盘全景图。加载失败时退回与雾色匹配的渐变背景，棋盘照常可用。
- 镜头支持战场透视、正上方俯视、自动巡游、拖动旋转、滚轮缩放和右键平移。

全景图的无损源文件是 [`qin-diorama-panorama-v1.png`](../assets/background/qin-diorama-panorama-v1.png)，生成说明、用途与限制见 [`qin-diorama-panorama-v1.prompt.md`](../assets/background/qin-diorama-panorama-v1.prompt.md)。网页只加载 `public/background/` 下的 high / medium / low 三个 WebP 版本。

棋子底座直径 `0.89` 米，静止时最大占地 `0.971` 米，小于 `1.14` 的落子点间距；模型底面会自动贴合棋盘表面。

## 画质档位

三档画质风格一致，开销逐档下降。新用户默认使用 medium。

| 档位   | 棋子模型 | 全景        | 环境细节 | 环境阴影 / 动态光         | 环境运动             |
| ------ | -------- | ----------- | -------: | ------------------------- | -------------------- |
| high   | LOD1     | high WebP   |        3 | 完整静态阴影 / 稀疏动态光 | 旗帜、尘粒、釉河     |
| medium | LOD1     | medium WebP |        2 | 降级静态阴影 / 静态灯     | 低频旗帜、尘粒、釉河 |
| low    | LOD2     | low WebP    |        1 | 关闭                      | 关闭                 |

“减少动态效果”与画质档位相互独立：它只冻结非必要的环境运动，不改变当前档位的静态细节、全景和棋子模型。

## 角色资产

七类角色依据原创的 [`秦兵马俑阵容概念图`](../assets/concepts/xiangqi-characters/qin-terracotta-roster-v1.png) 制作，生成提示与使用边界见 [`qin-terracotta-roster-v1.prompt.md`](../assets/concepts/xiangqi-characters/qin-terracotta-roster-v1.prompt.md)。帅/将戴秦军将领冠，仕/士持竹简与虎符，兵/卒穿秦式层札甲。“炮”保留象棋里的名称，但模型做成秦代幻想风格的双人重型床弩，不出现火药、炮口或火球。

七个角色的母版是一体雕塑的 Q 版秦俑：保留 2.25 头身的大头比例，脸、手、衣褶和甲片用“数字泥塑”雕出，而不是用球体和方块拼接。母版和它的生成脚本在 `assets/models/`，重建与锁定步骤见 [`assets/models/README.md`](../assets/models/README.md)。

制作流程：

```text
秦兵马俑阵容概念 → 雕塑母版（assets/models）→ 等比缩放到棋座 / 骨架 / 7 个动作 / 挂点
→ 三档 raw GLB → 规格校验 → Meshopt 运行时 GLB → 版本化 manifest → 网页加载
```

文件位置：

- `assets/models/red-{role}-terracotta-cartoon-v3.{blend,glb}`：雕塑母版，外观以它为准。
- `assets/characters/{role}/source/{role}.blend`：可编辑源文件。
- `assets/characters/{role}/exports/{role}-lod{0,1,2}-raw.glb`：用于交换与验证的导出文件。
- `public/models/pieces/v1/{role}/{role}-lod{0,1,2}.glb`：网页实际加载的 Meshopt 产物。
- `public/models/pieces/v1/manifest.json`：7 类角色、14 种阵营外观、21 个 GLB 的清单。

常用命令：

```bash
# 重新生成、压缩并校验 21 个角色资产
npm run assets:pieces:build

# 只校验现有产物，或打印预算报告
npm run assets:pieces:validate
npm run assets:pieces:report
```

当前 21 个运行时 GLB 都是单个不透明蒙皮网格，14 个骨骼关节、7 个动作；七类 LOD1 合计约 3.21 MiB。所有棋子按同一比例缩放到 `0.89` 米棋座，不做纵向拉伸，所以高度随造型而定（帅、兵约 1.42 米，仕约 1.18 米，相、炮约 0.86 米）。烧土明暗烘焙在顶点上，配合低金属度和高粗糙度，避免塑料玩具感。完整红黑阵容见 [`roster-contact-sheet-qin-terracotta.png`](../assets/characters/reviews/roster-contact-sheet-qin-terracotta.png)。这套模型的定位是在棋盘上容易辨认的 Q 版秦俑，不追求博物馆扫描级的精度。

模型与动作的更多约定见 [`assets/characters/README.md`](../assets/characters/README.md) 和 [`assets/models/README.md`](../assets/models/README.md)。

## 性能预算

以下是第一版的上限，不是画面目标。每加入一种角色，都要在有代表性的桌面和移动设备上复测，优先保证画面稳定。

| 项目                        |            均衡画质 |                   电影画质/近景 |
| --------------------------- | ------------------: | ------------------------------: |
| 单角色 LOD0                 |      40k–80k 三角面 | 80k–120k 三角面，仅少量近景角色 |
| 棋盘常驻 LOD1               | 每枚 10k–20k 三角面 |           每枚不超过 30k 三角面 |
| 远景 LOD2                   |   每枚 2k–6k 三角面 |                            同左 |
| 全场可见三角面              |        约 600k 以内 |                    约 1.2M 以内 |
| 每帧绘制调用                |            100 以内 |                        160 以内 |
| 单角色纹理                  |             1K KTX2 |       2K KTX2；只给近景英雄角色 |
| 首屏 3D 下载                |          12 MB 以内 |            25 MB 以内，按需加载 |
| 初始棋局 JavaScript（gzip） |         490 KB 以内 |       AI 与在线协议继续按需加载 |

几条硬性要求：

- 同类棋子复用几何、骨骼和材质，优先使用实例化；红黑双方靠矿物残彩、甲片、符节和徽记区分。
- LOD 切换、阴影分级、DPR 上限和纹理分辨率都随画质档位调整。
- 不要把 4K 未压缩贴图、雕刻高模或大量未合并的零件直接放进网页加载的 GLB。
