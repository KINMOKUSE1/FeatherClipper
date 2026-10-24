"""Compile the native Windows transcription installer (Inno Setup 6.5+)."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
NAME = "featherclipper-asr-setup.exe"


def find_compiler(explicit=None):
    candidates = [explicit, os.environ.get("INNO_SETUP_COMPILER"), shutil.which("ISCC")]
    for variable in ("ProgramFiles(x86)", "ProgramFiles"):
        if os.environ.get(variable):
            candidates.append(Path(os.environ[variable]) / "Inno Setup 6/ISCC.exe")
    candidates.append(ROOT / "work/asr-installer-tools/compiler/ISCC.exe")
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return str(Path(candidate).resolve())
    raise RuntimeError("未找到 Inno Setup 编译器，请安装 Inno Setup 6.5+，或用 --iscc 指定 ISCC.exe")


def build(iscc=None):
    compiler = find_compiler(iscc)
    version = json.loads((ROOT / "extension/manifest.json").read_text(encoding="utf-8"))["version"]
    target = ROOT / "downloads" / NAME
    target.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([compiler, f"/DAppVersion={version}", str(ROOT / "asr/installer.iss")], check=True)
    shutil.copy2(target, ROOT / "extension" / NAME)
    print(f"Built {target}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--iscc", help="Path to the Inno Setup compiler")
    build(parser.parse_args().iscc)
