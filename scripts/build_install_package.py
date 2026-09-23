"""Build the ready-to-load Edge extension and an offline installation guide."""
import json
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

from build_learning_kit import build as build_learning_kit

ROOT = Path(__file__).resolve().parents[1]


def build():
    build_learning_kit()
    extension = ROOT / 'extension'
    manifest = json.loads((extension / 'manifest.json').read_text(encoding='utf-8'))
    target = ROOT / 'downloads/course-clipper-edge.zip'
    target.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(target, 'w', ZIP_DEFLATED) as archive:
        def add(name, content):
            info = ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            archive.writestr(info, content)

        for file in sorted(extension.rglob('*')):
            if not file.is_file() or '__pycache__' in file.parts or file.suffix in {'.pyc', '.before'}:
                continue
            add('course-clipper/' + file.relative_to(extension).as_posix(), file.read_bytes())
        guide = (ROOT / 'docs/安装指南.html').read_text(encoding='utf-8')
        add('安装指南.html', guide.replace('data-extension="../extension/"', 'data-extension="course-clipper/"').encode('utf-8'))
        add('course-clipper/LICENSE', (ROOT / 'LICENSE').read_bytes())
        add('使用说明.md', (ROOT / '使用说明.md').read_bytes())
    print(f'Built {target.name} (v{manifest["version"]})')


if __name__ == '__main__':
    build()
