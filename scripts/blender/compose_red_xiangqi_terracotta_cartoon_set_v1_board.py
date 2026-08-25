from __future__ import annotations

import os
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[2]
RENDER_ROOT = ROOT / "assets" / "renders"
REFERENCE = RENDER_ROOT / "red-xiangqi-terracotta-cartoon-set-v1-reference.png"
OUTPUT = RENDER_ROOT / "red-xiangqi-terracotta-cartoon-set-v1-board.png"
ROLES = (
    ("advisor", "仕 · 文官", "ADVISOR / BAMBOO TABLET"),
    ("elephant", "相 · 战象", "ELEPHANT / ARMOURED GUARDIAN"),
    ("chariot", "车 · 战车", "CHARIOT / TINY DRIVER"),
    ("horse", "马 · 骑兵", "HORSE / CAVALRY RIDER"),
    ("cannon", "炮 · 砲手", "CANNON / TORSION ENGINEER"),
    ("soldier", "兵 · 步卒", "SOLDIER / SPEARMAN"),
)


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


def load_font(size: int):
    for path in font_candidates():
        try:
            return ImageFont.truetype(str(path), size)
        except OSError:
            continue
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


WIDTH, HEIGHT = 3200, 2200
canvas = Image.new("RGB", (WIDTH, HEIGHT), (18, 14, 12))
pixels = canvas.load()
randomizer = random.Random(20260825)
x_terms = [((x - WIDTH * 0.50) / WIDTH) ** 2 for x in range(WIDTH)]
y_terms = [((y - HEIGHT * 0.43) / HEIGHT) ** 2 for y in range(HEIGHT)]
for y in range(HEIGHT):
    vertical = int(8 * (1 - abs(y - HEIGHT * 0.46) / (HEIGHT * 0.7)))
    for x in range(WIDTH):
        radial = max(0.0, 1.0 - (x_terms[x] + y_terms[y]) * 3.0)
        grain = randomizer.choice((-2, -1, 0, 0, 0, 1, 2))
        pixels[x, y] = (
            max(0, 18 + vertical + int(9 * radial) + grain),
            max(0, 14 + vertical // 2 + int(6 * radial) + grain),
            max(0, 12 + int(4 * radial) + grain),
        )

draw = ImageDraw.Draw(canvas)
gold = (221, 185, 130)
muted_gold = (155, 124, 88)
line = (96, 73, 53)
title_font = load_font(72)
subtitle_font = load_font(28)
label_font = load_font(30)
note_font = load_font(21)

draw.text((90, 52), "秦俑 Q 版中国象棋 · 红方角色套装 V1", fill=gold, font=title_font)
draw.text((94, 140), "SIX DISTINCT PRIMITIVE-BUILT COLLECTIBLES  /  EDITABLE BLEND  /  SINGLE-MESH GLB", fill=muted_gold, font=subtitle_font)
draw.line((90, 184, WIDTH - 90, 184), fill=line, width=2)


def framed(path: Path, box, label: str, caption: str) -> None:
    x, y, width, height = box
    with Image.open(path) as source:
        image = ImageOps.contain(source.convert("RGB"), (width, height), Image.Resampling.LANCZOS)
    panel = Image.new("RGB", (width, height), (7, 6, 5))
    panel.paste(image, ((width - image.width) // 2, (height - image.height) // 2))
    canvas.paste(panel, (x, y))
    draw.rectangle((x, y, x + width, y + height), outline=line, width=2)
    draw.text((x + 5, y + height + 12), label, fill=gold, font=label_font)
    draw.text((x + 5, y + height + 49), caption, fill=muted_gold, font=note_font)


framed(REFERENCE, (90, 220, 900, 720), "六角色目标设定", "GENERATED STYLE REFERENCE")
draw.text((95, 1040), "六角色正交轮廓", fill=gold, font=label_font)
draw.text((95, 1080), "ORTHOGRAPHIC FRONT CHECK", fill=muted_gold, font=note_font)
for index, (role, label, _caption) in enumerate(ROLES):
    column = index % 3
    row = index // 3
    x = 90 + column * 300
    y = 1130 + row * 395
    with Image.open(RENDER_ROOT / f"red-{role}-terracotta-cartoon-v1-front.png") as source:
        image = ImageOps.contain(source.convert("RGB"), (280, 330), Image.Resampling.LANCZOS)
    panel = Image.new("RGB", (280, 330), (7, 6, 5))
    panel.paste(image, ((280 - image.width) // 2, (330 - image.height) // 2))
    canvas.paste(panel, (x, y))
    draw.rectangle((x, y, x + 280, y + 330), outline=line, width=2)
    draw.text((x + 5, y + 338), label, fill=gold, font=note_font)
panel_width, panel_height = 650, 720
for index, (role, label, caption) in enumerate(ROLES):
    column = index % 3
    row = index // 3
    x = 1060 + column * 690
    y = 220 + row * 900
    framed(
        RENDER_ROOT / f"red-{role}-terracotta-cartoon-v1.png",
        (x, y, panel_width, panel_height),
        label,
        caption,
    )

draw.line((90, 2040, WIDTH - 90, 2040), fill=line, width=2)
draw.text((90, 2070), "同一陶俑玩具家族：圆头大眼 · 短肢软轮廓 · 深色秦衣甲 · 朱砂边饰 · 玉色点缀 · 正确棋字底座", fill=gold, font=label_font)
draw.text((94, 2120), "左为统一视觉设定；右为六个独立、可编辑、纯基础体与简单网格构成的 Blender 角色渲染。", fill=muted_gold, font=note_font)

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
canvas.save(OUTPUT, quality=96)
print(f"BOARD={OUTPUT}")
