"""Package the optional local transcription installer without the model or runtime."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
FILES = ("install.cmd", "install.ps1", "enable-gpu.cmd", "enable-gpu.ps1",
         "start-local-asr.cmd", "download_model.py", "server.py", "README.md")


def build():
    for target in (ROOT / "extension/asr-installer.zip", ROOT / "downloads/course-cove-asr-installer.zip"):
        target.parent.mkdir(parents=True, exist_ok=True)
        with ZipFile(target, "w", ZIP_DEFLATED) as archive:
            for name in FILES:
                info = ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
                info.compress_type = ZIP_DEFLATED
                archive.writestr(info, (ROOT / "asr" / name).read_bytes())
        print(f"Built {target}")


if __name__ == "__main__":
    build()
