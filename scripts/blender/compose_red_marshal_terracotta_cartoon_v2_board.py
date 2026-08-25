from __future__ import annotations

import os
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[2]
RENDER_ROOT = ROOT / "assets" / "renders"
NAME = "red-marshal-terracotta-cartoon-v2"
REFERENCE = RENDER_ROOT / f"{NAME}-reference.png"
OUTPUT = RENDER_ROOT / f"{NAME}-board.png"


def font_candidates() -> list[Path]:
    configured = os.environ.get("TERRACOTTA_FONT_PATH")
    candidates = (
        Path(configured).expanduser() if configured else None,
        ROOT / "assets" / "fonts" / "NotoSerifCJKsc-Regular.otf",
        Path("/System/Library/Fonts/Supplemental/Songti.ttc"),
        Path("/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc"),
        Path("C:/Windows/Fonts/simhei.ttf"),
    )
    return [path for path in candidates if path and path.is_file()]


FONT_CANDIDATES = font_candidates()


def load_font(size: int):
    for path in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(str(path), size)
        except OSError:
            continue
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


WIDTH, HEIGHT = 2560, 1600
canvas = Image.new("RGB", (WIDTH, HEIGHT), (18, 14, 12))
pixels = canvas.load()
randomizer = random.Random(20260824)
x_radial_terms = [((x - WIDTH * 0.48) / WIDTH) ** 2 for x in range(WIDTH)]
y_radial_terms = [((y - HEIGHT * 0.43) / HEIGHT) ** 2 for y in range(HEIGHT)]
for y in range(HEIGHT):
    vertical = int(8 * (1 - abs(y - HEIGHT * 0.46) / (HEIGHT * 0.7)))
    for x in range(WIDTH):
        radial = max(0.0, 1.0 - (x_radial_terms[x] + y_radial_terms[y]) * 3.1)
        grain = randomizer.choice((-2, -1, 0, 0, 0, 1, 2))
        pixels[x, y] = (
            max(0, 18 + vertical + int(9 * radial) + grain),
            max(0, 14 + vertical // 2 + int(6 * radial) + grain),
            max(0, 12 + int(4 * radial) + grain),
        )

draw = ImageDraw.Draw(canvas)
font_title = load_font(70)
font_subtitle = load_font(27)
font_label = load_font(31)
font_note = load_font(23)
gold = (221, 185, 130)
muted_gold = (155, 124, 88)
line = (96, 73, 53)

draw.text((90, 54), "红帅 · 秦俑卡通收藏 V2", fill=gold, font=font_title)
draw.text((94, 137), "PRIMITIVE-BUILT VINYL TOY  /  EDITABLE BLEND  /  SINGLE-MESH GLB", fill=muted_gold, font=font_subtitle)
draw.line((90, 178, WIDTH - 90, 178), fill=line, width=2)


def framed_render(path: Path, box: tuple[int, int, int, int], label: str, label_en: str) -> None:
    x, y, width, height = box
    with Image.open(path) as source:
        source = source.convert("RGB")
        image = ImageOps.contain(source, (width, height), method=Image.Resampling.LANCZOS)
    panel = Image.new("RGB", (width, height), (7, 6, 5))
    panel.paste(image, ((width - image.width) // 2, (height - image.height) // 2))
    canvas.paste(panel, (x, y))
    draw.rectangle((x, y, x + width, y + height), outline=line, width=2)
    draw.text((x + 4, y + height + 16), label, fill=gold, font=font_label)
    draw.text((x + 4, y + height + 54), label_en, fill=muted_gold, font=font_note)


framed_render(REFERENCE, (90, 220, 820, 1060), "六面造型目标", "V2 DESIGN REFERENCE")
framed_render(RENDER_ROOT / f"{NAME}.png", (960, 220, 720, 1060), "真实三维英雄图", "BLENDER HERO RENDER")
framed_render(RENDER_ROOT / f"{NAME}-head.png", (1740, 220, 720, 500), "大头与双尾冠", "FACE / CROWN DETAIL")
framed_render(RENDER_ROOT / f"{NAME}-front.png", (1740, 780, 720, 500), "正交比例验证", "ORTHOGRAPHIC FRONT")

draw.line((90, 1390, WIDTH - 90, 1390), fill=line, width=2)
draw.text((90, 1420), "2.25 头身  ·  大圆头软脸颊  ·  大眼高光  ·  稀疏大片甲  ·  双手扶剑  ·  帅字棋座", fill=gold, font=font_label)
draw.text((92, 1471), "左：V2 视觉目标；右：纯基础体与简单网格构成的可编辑 BLEND 实拍，GLB 由同源几何合并导出。", fill=muted_gold, font=font_note)

swatches = (
    ((181, 91, 49), "陶"),
    ((61, 38, 29), "褐"),
    ((145, 42, 28), "朱"),
    ((62, 111, 86), "玉"),
)
for index, (color, label) in enumerate(swatches):
    x = 1940 + index * 122
    draw.ellipse((x, 1420, x + 38, 1458), fill=color, outline=gold, width=1)
    draw.text((x + 47, 1423), label, fill=muted_gold, font=font_note)

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
canvas.save(OUTPUT, quality=96)
print(f"BOARD={OUTPUT}")
