from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPT_DIR = ROOT / "scripts" / "blender"
BLEND_PATH = ROOT / "assets" / "models" / "red-marshal-terracotta-cartoon-v2.blend"


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


def blender_script_command(blender: str, script_name: str) -> list[str]:
    return [
        blender,
        "--background",
        "--factory-startup",
        "--python-exit-code",
        "1",
        "--python",
        str(SCRIPT_DIR / script_name),
    ]


def main() -> None:
    blender = resolve_blender()
    commands = (
        blender_script_command(blender, "create_red_marshal_terracotta_cartoon_v2.py"),
        [sys.executable, str(SCRIPT_DIR / "compose_red_marshal_terracotta_cartoon_v2_board.py")],
        [
            blender,
            "--background",
            str(BLEND_PATH),
            "--python-exit-code",
            "1",
            "--python",
            str(SCRIPT_DIR / "validate_red_marshal_terracotta_cartoon_v2.py"),
        ],
    )
    for command in commands:
        subprocess.run(command, cwd=ROOT, check=True)

    print("PIPELINE_VALIDATED=red-marshal-terracotta-cartoon-v2")


if __name__ == "__main__":
    main()
