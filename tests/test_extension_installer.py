"""Exercise Windows extension deployment and the offline package layout."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
POWERSHELL = shutil.which('powershell.exe')


@unittest.skipUnless(os.name == 'nt' and POWERSHELL, 'Windows PowerShell is required')
class ExtensionInstallerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='vid2notes-extension-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.bundle = self.root / '源码 安装包'
        (self.bundle / 'scripts').mkdir(parents=True)
        self.source = self.bundle / 'extension'
        self.source.mkdir()
        self.write_manifest('1.3.5')
        (self.source / 'page.js').write_text('current source', encoding='utf-8')
        shutil.copy2(ROOT / 'scripts/install_extension.ps1', self.bundle / 'scripts')
        shutil.copy2(ROOT / '安装.cmd', self.bundle)
        self.target = self.root / '用户 扩展目录'

    def write_manifest(self, version):
        (self.source / 'manifest.json').write_text(json.dumps({'name': 'Vid2Notes', 'manifest_version': 3, 'version': version}), encoding='utf-8')

    def run_installer(self, target=None):
        return subprocess.run([POWERSHELL, '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
            str(self.bundle / 'scripts/install_extension.ps1'), '-PrepareOnly', '-InstallDir', str(target or self.target)],
            capture_output=True, timeout=30)

    def test_first_install_and_update_mirror_only_managed_files(self):
        first = self.run_installer()
        self.assertEqual(first.returncode, 0, first.stdout.decode(errors='replace'))
        self.assertEqual((self.target / 'page.js').read_text(), 'current source')
        self.assertTrue((self.target / '.vid2notes-install').is_file())
        (self.target / 'obsolete.js').write_text('old file')
        self.write_manifest('1.3.6')
        (self.source / 'page.js').write_text('updated source')
        updated = self.run_installer()
        self.assertEqual(updated.returncode, 0, updated.stdout.decode(errors='replace'))
        self.assertFalse((self.target / 'obsolete.js').exists())
        self.assertEqual((self.target / 'page.js').read_text(), 'updated source')
        self.assertEqual(json.loads((self.target / 'manifest.json').read_text())['version'], '1.3.6')
        self.assertTrue((self.target / '.vid2notes-install').is_file())

    def test_unrelated_existing_directory_is_preserved(self):
        self.target.mkdir()
        (self.target / 'my-notes.md').write_text('keep me')
        result = self.run_installer()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual([p.name for p in self.target.iterdir()], ['my-notes.md'])
        self.assertEqual((self.target / 'my-notes.md').read_text(), 'keep me')

    def test_drive_root_and_overlapping_source_paths_are_rejected(self):
        for target in (Path(self.source.anchor), self.source, self.bundle, self.source / 'nested'):
            with self.subTest(target=target):
                self.assertNotEqual(self.run_installer(target).returncode, 0)
        self.assertEqual((self.source / 'page.js').read_text(), 'current source')
        self.assertFalse((self.source / '.vid2notes-install').exists())

    def test_missing_manifest_does_not_create_destination(self):
        (self.source / 'manifest.json').unlink()
        self.assertNotEqual(self.run_installer().returncode, 0)
        self.assertFalse(self.target.exists())

    def test_cmd_entry_forwards_paths_with_spaces(self):
        command = 'call "{}" -PrepareOnly -InstallDir "{}"'.format(self.bundle / '安装.cmd', self.target)
        result = subprocess.run(command, shell=True, input=b'\r\n', capture_output=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout.decode(errors='replace'))
        self.assertTrue((self.target / 'manifest.json').is_file())

    def test_browser_flow_copies_manager_address_then_install_path_after_confirmation(self):
        executable = Path(os.environ.get('ProgramFiles(x86)', '')) / 'Microsoft/Edge/Application/msedge.exe'
        if not executable.is_file():
            self.skipTest('Edge is required for browser discovery')
        prepared = self.run_installer()
        self.assertEqual(prepared.returncode, 0)
        clipboard = self.root / 'clipboard.txt'
        launched = self.root / 'launched.json'
        literal = lambda value: str(value).replace("'", "''")
        # Keep real discovery and deployment, mock only the user's browser/clipboard effects.
        command = """
function Set-Clipboard { param($Value) Add-Content -LiteralPath '%s' -Value $Value -Encoding UTF8 }
function Read-Host { param($Prompt) return '' }
function Start-Process { param($FilePath, $ArgumentList) @{ file = $FilePath; args = $ArgumentList } | ConvertTo-Json | Set-Content -LiteralPath '%s' -Encoding UTF8 }
& '%s' -Browser Edge -InstallDir '%s'
""" % (literal(clipboard), literal(launched), literal(self.bundle / 'scripts/install_extension.ps1'), literal(self.target))
        result = subprocess.run([POWERSHELL, '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], capture_output=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout.decode(errors='replace'))
        self.assertEqual(clipboard.read_text(encoding='utf-8-sig').splitlines(), ['edge://extensions/', str(self.target)])
        launch = json.loads(launched.read_text(encoding='utf-8-sig'))
        self.assertEqual(Path(launch['file']), executable)
        self.assertEqual(launch['args'], ['--new-window', 'about:blank'])

    def test_arrow_navigation_wraps_and_escape_cancels_selection(self):
        installer = str(ROOT / 'scripts/install_extension.ps1').replace("'", "''")
        command = r"""
$ast = [Management.Automation.Language.Parser]::ParseFile('INSTALLER_PATH', [ref]$null, [ref]$null)
foreach ($fn in $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
    . ([ScriptBlock]::Create($fn.Extent.Text))
}
Initialize-InstallerTerminal
# Feed keyboard events into the real selection state machine, with console I/O isolated.
$script:interactive = $true
function Clear-InstallerBlock { param($Rows) }
function Write-InstallerText { param($Text, $Tone) }
function Read-InstallerKey { return @{ Key = $script:keys.Dequeue() } }
$options = @(@{ Name = 'Edge' }, @{ Name = 'Chrome' })
$script:keys = New-Object Collections.Queue
$script:keys.Enqueue('DownArrow'); $script:keys.Enqueue('Enter')
if ((Select-InstallerBrowser $options) -ne 'Chrome') { throw 'Down arrow failed' }
$script:keys.Enqueue('UpArrow'); $script:keys.Enqueue('Enter')
if ((Select-InstallerBrowser $options) -ne 'Chrome') { throw 'Up arrow wrap failed' }
$script:keys.Enqueue('Escape')
if ($null -ne (Select-InstallerBrowser $options)) { throw 'Escape did not cancel' }
""".replace('INSTALLER_PATH', installer)
        result = subprocess.run([POWERSHELL, '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-Command', command], capture_output=True, timeout=15)
        self.assertEqual(result.returncode, 0, (result.stdout + result.stderr).decode(errors='replace'))

    def test_package_contains_the_working_installer_and_no_obsolete_guide_or_kit(self):
        for name in ('LICENSE', '使用说明.md'):
            (self.bundle / name).write_text('fixture', encoding='utf-8')
        spec = importlib.util.spec_from_file_location('extension_package', ROOT / 'scripts/build_install_package.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.ROOT = self.bundle
        with contextlib.redirect_stdout(io.StringIO()):
            package = module.build()
        self.assertEqual(package.name, 'vid2notes-extension-1.3.5.zip')
        with ZipFile(package) as archive:
            names = archive.namelist()
            for name in ('安装.cmd', 'scripts/install_extension.ps1', 'extension/manifest.json', 'extension/page.js', 'LICENSE', '使用说明.md'):
                self.assertIn(name, names)
            self.assertFalse(any('安装指南' in name or 'learning-kit' in name or 'installer-ui' in name or 'installer-common' in name for name in names))
            self.assertEqual(archive.read('scripts/install_extension.ps1'), (ROOT / 'scripts/install_extension.ps1').read_bytes())
        extracted = self.root / '解压后的安装包'
        with ZipFile(package) as archive:
            archive.extractall(extracted)
        result = subprocess.run([POWERSHELL, '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', str(extracted / 'scripts/install_extension.ps1'),
            '-PrepareOnly', '-InstallDir', str(self.target)], capture_output=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout.decode(errors='replace'))
        self.assertTrue((self.target / 'page.js').is_file())


if __name__ == '__main__':
    unittest.main()
