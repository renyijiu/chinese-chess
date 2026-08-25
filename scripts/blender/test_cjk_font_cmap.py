from __future__ import annotations

import struct
import tempfile
import unittest
from pathlib import Path

from cjk_font_cmap import FontCoverageError, font_glyph_ids, validated_text_body


def make_font(format_: int, groups: list[tuple[int, int, int]]) -> bytes:
    subtable = struct.pack(">HHIII", format_, 0, 16 + len(groups) * 12, 0, len(groups))
    subtable += b"".join(struct.pack(">III", *group) for group in groups)
    cmap = struct.pack(">HHHHI", 0, 1, 3, 10, 12) + subtable
    table_offset = 28
    sfnt = struct.pack(">IHHHH", 0x00010000, 1, 0, 0, 0)
    sfnt += struct.pack(">4sIII", b"cmap", 0, table_offset, len(cmap))
    return sfnt + cmap


class CjkFontCmapTests(unittest.TestCase):
    def glyph_ids(self, font: bytes, characters: str) -> dict[str, int]:
        with tempfile.TemporaryDirectory() as directory:
            font_path = Path(directory) / "test.ttf"
            font_path.write_bytes(font)
            return font_glyph_ids(font_path, characters)

    def test_accepts_distinct_required_glyphs(self) -> None:
        font = make_font(12, [(ord("仕"), ord("仕"), 11), (ord("相"), ord("相"), 12)])
        self.assertEqual(self.glyph_ids(font, "仕相"), {"仕": 11, "相": 12})

    def test_rejects_missing_cjk_codepoint(self) -> None:
        font = make_font(12, [(ord("A"), ord("Z"), 1)])
        with self.assertRaisesRegex(FontCoverageError, "does not contain"):
            self.glyph_ids(font, "仕")

    def test_rejects_shared_fallback_glyph(self) -> None:
        font = make_font(13, [(0x4E00, 0x9FFF, 7)])
        with self.assertRaisesRegex(FontCoverageError, "shared fallback glyph"):
            self.glyph_ids(font, "仕相")

    def test_rejects_wrong_text_body(self) -> None:
        with self.assertRaisesRegex(FontCoverageError, "became"):
            validated_text_body("相", "木")


if __name__ == "__main__":
    unittest.main()
