from __future__ import annotations

import struct
from pathlib import Path
from typing import Iterable


class FontCoverageError(ValueError):
    pass


def _unpack(data: bytes, format_: str, offset: int):
    size = struct.calcsize(format_)
    if offset < 0 or offset + size > len(data):
        raise FontCoverageError("Font table is truncated")
    return struct.unpack_from(format_, data, offset)


def _first_sfnt_offset(data: bytes) -> int:
    if data[:4] != b"ttcf":
        return 0
    (font_count,) = _unpack(data, ">I", 8)
    if font_count < 1:
        raise FontCoverageError("TTC contains no fonts")
    (font_offset,) = _unpack(data, ">I", 12)
    return font_offset


def _table_offset(data: bytes, sfnt_offset: int, wanted_tag: bytes) -> int:
    (table_count,) = _unpack(data, ">H", sfnt_offset + 4)
    for index in range(table_count):
        record_offset = sfnt_offset + 12 + index * 16
        tag, _checksum, offset, length = _unpack(data, ">4sIII", record_offset)
        if tag == wanted_tag:
            if offset + length > len(data):
                raise FontCoverageError(f"{wanted_tag.decode()} table is truncated")
            return offset
    raise FontCoverageError(f"Font has no {wanted_tag.decode()} table")


def _format_4_glyph(data: bytes, offset: int, codepoint: int) -> int:
    if codepoint > 0xFFFF:
        return 0
    (seg_count_x2,) = _unpack(data, ">H", offset + 6)
    segment_count = seg_count_x2 // 2
    end_codes = offset + 14
    start_codes = end_codes + segment_count * 2 + 2
    deltas = start_codes + segment_count * 2
    range_offsets = deltas + segment_count * 2
    for index in range(segment_count):
        (end_code,) = _unpack(data, ">H", end_codes + index * 2)
        if codepoint > end_code:
            continue
        (start_code,) = _unpack(data, ">H", start_codes + index * 2)
        if codepoint < start_code:
            return 0
        (delta,) = _unpack(data, ">h", deltas + index * 2)
        (range_offset,) = _unpack(data, ">H", range_offsets + index * 2)
        if range_offset == 0:
            return (codepoint + delta) & 0xFFFF
        glyph_address = range_offsets + index * 2 + range_offset + 2 * (codepoint - start_code)
        (glyph_id,) = _unpack(data, ">H", glyph_address)
        return (glyph_id + delta) & 0xFFFF if glyph_id else 0
    return 0


def _grouped_glyph(data: bytes, offset: int, codepoint: int, constant: bool) -> int:
    (group_count,) = _unpack(data, ">I", offset + 12)
    low = 0
    high = group_count
    while low < high:
        index = (low + high) // 2
        start, end, start_glyph = _unpack(data, ">III", offset + 16 + index * 12)
        if codepoint < start:
            high = index
        elif codepoint > end:
            low = index + 1
        else:
            return start_glyph if constant else start_glyph + codepoint - start
    return 0


def _glyph_from_subtable(data: bytes, offset: int, codepoint: int) -> int:
    (format_,) = _unpack(data, ">H", offset)
    if format_ == 4:
        return _format_4_glyph(data, offset, codepoint)
    if format_ == 12:
        return _grouped_glyph(data, offset, codepoint, constant=False)
    if format_ == 13:
        return _grouped_glyph(data, offset, codepoint, constant=True)
    return 0


def font_glyph_ids(font_path: Path, characters: Iterable[str]) -> dict[str, int]:
    characters = tuple(characters)
    if not characters or any(len(character) != 1 for character in characters):
        raise FontCoverageError("Characters must be non-empty single-codepoint strings")
    data = font_path.read_bytes()
    cmap_offset = _table_offset(data, _first_sfnt_offset(data), b"cmap")
    (record_count,) = _unpack(data, ">H", cmap_offset + 2)
    subtables = []
    for index in range(record_count):
        platform, encoding, relative_offset = _unpack(data, ">HHI", cmap_offset + 4 + index * 8)
        priority = 0 if (platform, encoding) == (3, 10) else 1 if platform == 0 else 2
        if platform == 0 or (platform == 3 and encoding in (1, 10)):
            subtables.append((priority, cmap_offset + relative_offset))
    if not subtables:
        raise FontCoverageError("Font has no Unicode cmap subtable")

    glyph_ids = {}
    for character in characters:
        codepoint = ord(character)
        glyph_id = next(
            (glyph for _, offset in sorted(subtables) if (glyph := _glyph_from_subtable(data, offset, codepoint))),
            0,
        )
        if not glyph_id:
            raise FontCoverageError(f"Font does not contain U+{codepoint:04X} {character}")
        glyph_ids[character] = glyph_id
    if len(set(glyph_ids.values())) != len(glyph_ids):
        raise FontCoverageError("Required characters resolve to a shared fallback glyph")
    return glyph_ids


def validated_text_body(expected: str, actual: str) -> str:
    if actual != expected:
        raise FontCoverageError(f"Requested glyph {expected!r} became {actual!r}")
    return actual
