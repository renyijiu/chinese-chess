from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPT_DIR = ROOT / "scripts" / "blender"
ROLES = ("marshal", "advisor", "elephant", "chariot", "horse", "cannon", "soldier")


def resolve_blender() -> str:
    configured = os.environ.get("BLENDER_BIN")
    candidates = (
        configured,
        shutil.which("blender"),
        "/Applications/Blender.app/Contents/MacOS/Blender",
    )
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return candidate
    raise FileNotFoundError("Blender not found; set BLENDER_BIN to its executable path")


def run(command: list[str]) -> None:
    subprocess.run(command, cwd=ROOT, check=True)


def main() -> None:
    blender = resolve_blender()
    run([sys.executable, str(SCRIPT_DIR / "test_cjk_font_cmap.py")])
    run(
        [
            blender,
            "--background",
            "--factory-startup",
            "--python-exit-code",
            "1",
            "--python",
            str(SCRIPT_DIR / "create_red_xiangqi_terracotta_cartoon_set_v3.py"),
        ]
    )
    requested = [role for role in os.environ.get("XIANGQI_SOURCE_ROLES", ",".join(ROLES)).split(",") if role.strip()]
    # Belt and braces for the public-metadata check: no workstation path may ship in a render.
    renders = [
        str(ROOT / "assets" / "renders" / f"red-{role}-terracotta-cartoon-v3{suffix}.png")
        for role in ROLES
        if role in requested
        for suffix in ("", "-front")
    ]
    run(["node", str(ROOT / "scripts" / "assets" / "strip-png-text-metadata.mjs"), *renders])
    for role in ROLES:
        if role not in requested:
            continue
        blend_path = ROOT / "assets" / "models" / f"red-{role}-terracotta-cartoon-v3.blend"
        run(
            [
                blender,
                "--background",
                str(blend_path),
                "--python-exit-code",
                "1",
                "--python",
                str(SCRIPT_DIR / "validate_red_xiangqi_terracotta_cartoon_set_v3.py"),
                "--",
                role,
            ]
        )
    print("PIPELINE_VALIDATED=red-xiangqi-terracotta-cartoon-set-v3")


if __name__ == "__main__":
    main()
