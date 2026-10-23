"""Build the Windows offline extension package; ASR is built separately."""
import json
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]


def build():
    extension = ROOT / 'extension'
    manifest = json.loads((extension / 'manifest.json').read_text(encoding='utf-8'))
    target = ROOT / f'downloads/vid2notes-extension-{manifest["version"]}.zip'
    target.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(target, 'w', ZIP_DEFLATED) as archive:
        def add(name, content):
            info = ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            archive.writestr(info, content)

        for file in sorted(extension.rglob('*')):
            if not file.is_file() or '__pycache__' in file.parts or file.suffix in {'.pyc', '.before'}:
                continue
            add('extension/' + file.relative_to(extension).as_posix(), file.read_bytes())
        for name in ('安装.cmd', 'scripts/install_extension.ps1', 'LICENSE', '使用说明.md'):
            add(name, (ROOT / name).read_bytes())
    print(f'Built {target.name} (v{manifest["version"]})')
    return target


if __name__ == '__main__':
    build()
