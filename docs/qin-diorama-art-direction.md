# Qin Diorama Art Direction

This document is the visual contract for the Qin terracotta diorama. The existing Q-shaped Qin roster remains authoritative: large readable heads, compact rounded bodies, matte fired-clay massing, restrained surface detail, and faction accents from `FACTION_COLORS`. Scene, interaction, and HUD work consume `QIN_DIORAMA_THEME`; DOM styling consumes its serialized `QIN_DIORAMA_CSS_VARIABLES` projection.

## Palette and materials

| Role                   | Direction                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Fired clay             | Dominant warm matte mass. Use light and shadow variants to describe form, not photographic texture noise.                            |
| Black lacquer          | Deep neutral for recessed structure, background separation, and HUD surfaces. Avoid featureless pure black.                          |
| Aged bronze            | Sparse borders, fittings, and selected-state emphasis. Keep metalness localized.                                                     |
| Chalk                  | High-luminance linework, labels, and ordinary legal-move dots.                                                                       |
| Cinnabar and verdigris | Restrained faction accents derived from the authoritative red and black piece palette. Do not invent replacement faction hex values. |
| Mineral blue           | A small cool counter-accent reserved for fill light and keyboard focus.                                                              |

The canonical runtime values live in `components/xiangqi/scene/scene-theme.ts`. Do not add local scene or stylesheet palettes when a semantic token exists.

## Silhouette, scale, and motifs

- Favor broad, rounded, toy-like masses and stepped miniature-diorama layers. Detail must support the Q roster at gameplay distance rather than compete with it.
- Use the Qin mausoleum's rectangular double enclosure, north-south axis, terracotta-pit corridors, Qin brick rhythm, and sparse roof-tile medallion impressions.
- Keep motifs shallow and selective. Repeated mid-field elements must be instanced or merged; the far field is a stylized 360-degree panorama, not a full 3D city.
- Do not use Tang/Song pavilion silhouettes, wet photoreal stone, gothic battlements, dense foliage, or photographic mountain plates as the dominant language.

## Lighting and atmosphere

- Use a warm fired-clay key, restrained mineral-blue fill, black-lacquer recesses, and matching warm fog. Preserve matte ceramic readability instead of polished cinematic contrast.
- High quality may animate sparse environment lights; medium keeps a static reduced light set; low omits dynamic environment lights. Quality profiles are authoritative for this choice.
- Reduced motion is orthogonal to quality. It freezes flags, dust, river movement, and animation-driven light updates while retaining the active tier's piece LOD, static environment detail, and panorama selection.

## Interaction and accessibility

Interaction states must remain recognizable in grayscale and without color alone:

| State          | Required indicator          |
| -------------- | --------------------------- |
| Legal move     | Chalk dot                   |
| Capture        | Cinnabar ring               |
| Keyboard focus | Mineral-blue double outline |
| Selected piece | Aged-bronze halo            |
| Check          | Faction-energy seal         |

Preserve existing labels, focus order, input behavior, and mobile control layout. Color can reinforce a state but never be its only signal.

## Board safe zone and camera

- The 9 × 10 intersections, river gap, palace lines, markers, `BOARD_SPACING`, `BOARD_SURFACE_Y`, `squareToWorld()`, top-view FOV, height, and target are fixed contracts.
- Keep decorative geometry, props, particles, and labels outside the board's pointer and sight-line safe zone. Decorative nodes must not participate in board raycasts.
- Validate red and black sides in both top and battle views. Panoramas and silhouettes must remain continuous during side changes and the existing tour motion.

## Quality and delivery guardrails

- Environment cost must fall monotonically from high to medium to low: detail level 3 → 2 → 1, panorama high → medium → low, shadows full → reduced → none, ambient cadence 60 → 24 → 15, and dynamic environment lights animated → static → none.
- Desktop high quality at 1920 × 1080 and DPR ≤ 1.5 remains capped at 100 stationary draw calls, 160 combat-peak draw calls, and 16.7 ms p95 frame interval.
- First playable production response remains capped at 12 MiB. Only the active panorama variant and required environment resources should load; quality switching must dispose replaced resources.
- Optional panorama, prop, or river failures degrade locally to theme fog/gradient, omitted props, or a static glazed surface. They must never block the board.
- This visual release does not redesign character geometry, skeletons, animations, timelines, or audio.

## Source and provenance guidance

Historical references guide palette, massing, and motifs; they are not runtime assets and must not be copied literally. New environment assets require a generation brief, source/authorization record, editable or lossless source, and separate optimized web output.

- [Emperor Qinshihuang's Mausoleum Site Museum: painted terracotta colors](https://bmy.com.cn/news/news/993.html)
- [UNESCO: Mausoleum of the First Qin Emperor](https://whc.unesco.org/en/list/441)
- [National Museum of China: Qin large eave tile](https://www.chnmuseum.cn/zp/zpml/kgfjp/202110/t20211027_251884.shtml)
- [National Museum of China: sunflower-pattern eave tile](https://www.chnmuseum.cn/zp/zpml/kgfjp/202110/t20211027_251883.shtml)
- [React Three Fiber: performance scaling](https://r3f.docs.pmnd.rs/advanced/scaling-performance)
- [WCAG 2.2: non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast)
