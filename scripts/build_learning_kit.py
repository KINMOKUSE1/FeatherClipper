"""Build the downloadable learning kit using Python's standard library."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]


def build():
    files = [(p, p.relative_to(ROOT)) for p in sorted((ROOT / "learning-kit").rglob("*"))
             if p.is_file() and "__pycache__" not in p.parts and p.suffix != ".pyc"]
    files.append((ROOT / "LICENSE", Path("learning-kit/LICENSE")))
    target = ROOT / "extension/learning-kit.zip"
    with ZipFile(target, "w", compression=ZIP_DEFLATED) as bundle:
        for path, name in files:
            info = ZipInfo(name.as_posix(), date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            bundle.writestr(info, path.read_bytes())
    print(f"Built {target.name}: {len(files)} files")


if __name__ == "__main__":
    build()
