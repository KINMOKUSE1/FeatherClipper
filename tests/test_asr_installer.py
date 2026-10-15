"""Exercise the real Windows installer worker with offline executable fixtures."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
POWERSHELL = shutil.which("powershell.exe")
STUB_SOURCE = r'''
using System;
using System.IO;
using System.Reflection;
class RuntimeFixture {
  static int Main(string[] args) {
    string home = Directory.GetParent(Environment.GetEnvironmentVariable("UV_UNMANAGED_INSTALL")).FullName;
    string joined = String.Join(" ", args);
    Console.Error.WriteLine("Fixture package download progress");
    if (Environment.GetEnvironmentVariable("ASR_FIXTURE_FAIL_GPU") == "1" && joined.Contains("nvidia-cudnn")) return 7;
    if (args.Length > 1 && args[0] == "venv") {
      string target = Path.Combine(args[1], "Scripts", "python.exe");
      Directory.CreateDirectory(Path.GetDirectoryName(target));
      File.Copy(Assembly.GetExecutingAssembly().Location, target, true);
    }
    if (args.Length > 1 && args[0].EndsWith("download_model.py")) {
      Directory.CreateDirectory(args[1]);
      foreach (string name in new[] {"config.json", "model.bin", "tokenizer.json", "vocabulary.txt"})
        File.WriteAllText(Path.Combine(args[1], name), "offline fixture");
    }
    if (joined.Contains("nvidia-cudnn")) {
      string directory = Path.Combine(home, ".venv", "Lib", "site-packages", "nvidia", "fixture");
      Directory.CreateDirectory(directory);
      foreach (string name in new[] {"cublas64_12.dll", "cudnn64_9.dll"}) File.WriteAllText(Path.Combine(directory, name), "fixture");
    }
    return 0;
  }
}
'''


@unittest.skipUnless(os.name == "nt" and POWERSHELL, "Windows PowerShell is required")
class InstallerWorkerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        directory = ROOT / "work/asr-installer-tests"
        directory.mkdir(parents=True, exist_ok=True)
        cls.temp = tempfile.TemporaryDirectory(dir=directory)
        cls.root = Path(cls.temp.name)
        source = cls.root / "runtime-fixture.cs"
        source.write_text(STUB_SOURCE, encoding="utf-8")
        cls.runner = cls.root / "runtime-fixture.exe"
        command = f"Add-Type -TypeDefinition ([IO.File]::ReadAllText('{source}')) -OutputAssembly '{cls.runner}' -OutputType ConsoleApplication"
        subprocess.run([POWERSHELL, "-NoProfile", "-NonInteractive", "-Command", command], check=True, capture_output=True)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def prepare(self, name):
        home = self.root / name
        (home / "tools").mkdir(parents=True)
        (home / ".vid2notes-asr").write_text("Vid2Notes local transcription")
        shutil.copy2(self.runner, home / "tools/uv.exe")
        return home

    def run_worker(self, home, mode="cpu", fail_gpu=False):
        result_file = self.root / (home.name + "-result.txt")
        environment = dict(os.environ, ASR_FIXTURE_FAIL_GPU="1" if fail_gpu else "0")
        completed = subprocess.run([
            POWERSHELL, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
            str(ROOT / "asr/setup-runtime.ps1"), "-InstallDir", str(home), "-Mode", mode,
            "-ResultFile", str(result_file),
        ], env=environment, capture_output=True, timeout=30)
        return completed, result_file

    def test_cpu_install_creates_private_code_and_handles_progress_on_stderr(self):
        home = self.prepare("新安装 with spaces")
        result, code = self.run_worker(home)
        self.assertEqual(result.returncode, 0, result.stdout.decode("utf-8", errors="replace"))
        config = json.loads((home / "config.json").read_text(encoding="utf-8"))
        self.assertRegex(config["token"], r"^[a-f0-9]{64}$")
        self.assertFalse(config["gpu_enabled"])
        self.assertEqual(code.read_text(), config["token"])
        self.assertNotIn(config["token"].encode(), result.stdout + result.stderr)
        self.assertTrue((home / ".venv/Scripts/python.exe").is_file())
        self.assertTrue((home / "model/model.bin").is_file())

    def test_failed_gpu_update_preserves_configuration_and_retry_keeps_code(self):
        home = self.prepare("gpu-update")
        (home / "config.json").write_text('{"token":"existing-test-code","gpu_enabled":false,"other":"keep"}')
        result, code = self.run_worker(home, "gpu", fail_gpu=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(code.exists())
        self.assertEqual(json.loads((home / "config.json").read_text())["gpu_enabled"], False)
        result, code = self.run_worker(home, "gpu")
        self.assertEqual(result.returncode, 0, result.stdout.decode("utf-8", errors="replace"))
        config = json.loads((home / "config.json").read_text())
        self.assertTrue(config["gpu_enabled"])
        self.assertEqual(config["other"], "keep")
        self.assertEqual(code.read_text(), "existing-test-code")
        self.assertNotIn(b"existing-test-code", result.stdout + result.stderr)

    def test_unrelated_nonempty_directory_is_not_modified(self):
        home = self.root / "unrelated"
        home.mkdir()
        (home / "user-file.txt").write_text("preserve")
        result, code = self.run_worker(home)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual([file.name for file in home.iterdir()], ["user-file.txt"])
        self.assertFalse(code.exists())

    def test_drive_root_is_rejected_before_any_files_are_created(self):
        result, code = self.run_worker(Path(ROOT.anchor))
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(code.exists())

    def test_native_setup_completes_with_offline_runtime_and_no_user_shortcuts(self):
        compiler = os.environ.get("INNO_SETUP_COMPILER") or ROOT / "work/asr-installer-tools/compiler/ISCC.exe"
        if not Path(compiler).is_file():
            self.skipTest("Inno Setup compiler is required for the EXE integration test")
        payload = self.root / "native-setup"
        payload.mkdir()
        for name in ("installer.iss", "setup-runtime.ps1", "download_model.py", "server.py", "start-local-asr.cmd", "README.md"):
            shutil.copy2(ROOT / "asr" / name, payload / name)
        shutil.copytree(ROOT / "asr/languages", payload / "languages")
        # Keep the real wizard and worker, but isolate install registration and shortcuts.
        script = (payload / "installer.iss").read_text(encoding="utf-8")
        script = re.sub(r"^AppId=.*$", "AppId=Vid2Notes-ASR-OfflineTest", script, flags=re.M)
        script = script.replace("[Setup]", "[Setup]\nUninstallable=no\nCreateUninstallRegKey=no")
        script = re.sub(r"\[Icons\][\s\S]*?(?=\[Run\])", "", script)
        script = re.sub(r"\[UninstallDelete\][\s\S]*?(?=\[Code\])", "", script)
        (payload / "installer.iss").write_text(script, encoding="utf-8")
        compiled = subprocess.run([str(compiler), "/Q", f"/O{payload}", str(payload / "installer.iss")], capture_output=True, timeout=30)
        self.assertEqual(compiled.returncode, 0, compiled.stdout.decode(errors="replace"))
        home = self.prepare("native-install")
        log = payload / "setup-test.log"
        result = subprocess.run([str(payload / "vid2notes-asr-setup.exe"), "/VERYSILENT", "/SUPPRESSMSGBOXES",
                                 "/NORESTART", f"/DIR={home}", f"/LOG={log}"], capture_output=True, timeout=45)
        self.assertEqual(result.returncode, 0, log.read_text(encoding="utf-8-sig") if log.exists() else "No setup log")
        self.assertTrue((home / "server.py").is_file())
        self.assertTrue((home / "启动本地转写.cmd").is_file())
        self.assertTrue((home / "model/model.bin").is_file())
        self.assertFalse((home / "unins000.exe").exists())
        config = json.loads((home / "config.json").read_text())
        self.assertRegex(config["token"], r"^[a-f0-9]{64}$")
        self.assertNotIn(config["token"], log.read_text(encoding="utf-8-sig"))


if __name__ == "__main__":
    unittest.main()
