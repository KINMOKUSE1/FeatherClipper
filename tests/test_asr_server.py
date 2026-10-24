"""Loopback service checks that do not download a model or audio."""
import importlib.util
import io
import json
import tempfile
import threading
import types
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
import sys

SOURCE = Path(__file__).resolve().parents[1] / "asr/server.py"
spec = importlib.util.spec_from_file_location("featherclipper_asr", SOURCE)
server_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server_module)


class LocalServiceTests(unittest.TestCase):
    def test_local_service_rejects_online_credentials(self):
        with tempfile.TemporaryDirectory() as temp:
            home = Path(temp)
            service = ThreadingHTTPServer(("127.0.0.1", 0), server_module.make_handler(home, "test-token"))
            thread = threading.Thread(target=service.serve_forever, daemon=True)
            thread.start()
            base = f"http://127.0.0.1:{service.server_port}"
            headers = {"X-FeatherClipper-Token": "test-token"}
            try:
                request = urllib.request.Request(base + "/jobs", data=json.dumps({
                    "bvid": "BVonline123", "cid": "999", "audio_url": "https://example.bilivideo.com/audio",
                    "provider": "groq", "api_key": "private-provider-key",
                }).encode(), headers=headers)
                with patch.object(server_module, "run_job") as run:
                    with self.assertRaises(urllib.error.HTTPError) as rejected:
                        urllib.request.urlopen(request)
                    self.assertEqual(rejected.exception.code, 400)
                    self.assertNotIn("private-provider-key", rejected.exception.read().decode())
                    run.assert_not_called()
            finally:
                service.shutdown()
                service.server_close()
                thread.join(timeout=2)

    def test_gpu_preflight_uses_cuda_when_available_and_cpu_when_runtime_missing(self):
        class FakeModel:
            def __init__(self, model_path, device, compute_type):
                self.device = device

            def transcribe(self, audio, **kwargs):
                def segments():
                    if self.device == "cuda" and fail_gpu[0]:
                        raise RuntimeError("cublas64_12.dll is not found")
                    return
                    yield
                return segments(), None

        fail_gpu = [False]
        modules = {"faster_whisper": types.SimpleNamespace(WhisperModel=FakeModel),
                   "numpy": types.SimpleNamespace(zeros=lambda *args, **kwargs: [], float32=object())}
        with tempfile.TemporaryDirectory() as temp, patch.dict(sys.modules, modules), \
                patch.object(server_module, "prepare_gpu_libraries"):
            home = Path(temp)
            (home / "config.json").write_text('{"gpu_enabled": true}', encoding="utf-8")
            try:
                server_module.MODEL = None
                self.assertEqual(server_module.get_model(home).device, "cuda")
                self.assertEqual(server_module.MODEL_DEVICE, "cuda")
                server_module.MODEL = None
                fail_gpu[0] = True
                self.assertEqual(server_module.get_model(home).device, "cpu")
                self.assertIn("cuBLAS", server_module.GPU_NOTICE)
            finally:
                server_module.MODEL = None
                server_module.MODEL_DEVICE = "cpu"
                server_module.GPU_NOTICE = ""

    def test_second_service_cannot_bind_same_port(self):
        first = server_module.ExclusiveLocalServer(("127.0.0.1", 0), server_module.make_handler(Path("."), "token"))
        try:
            with self.assertRaises(OSError):
                server_module.ExclusiveLocalServer(("127.0.0.1", first.server_port), server_module.make_handler(Path("."), "token"))
        finally:
            first.server_close()

    def test_media_url_allowlist(self):
        self.assertTrue(server_module.allowed_audio_url("https://example.bilivideo.com/audio.m4s"))
        self.assertTrue(server_module.allowed_audio_url("https://rr1.googlevideo.com/audio.m4a"))
        for url in ("http://example.bilivideo.com/audio", "https://bilivideo.com.evil.test/audio", "file:///etc/passwd"):
            self.assertFalse(server_module.allowed_audio_url(url))

    def test_download_tries_bilibili_backup_after_socket_error(self):
        class FakeOpener:
            calls = 0

            def open(self, request, timeout):
                self.calls += 1
                if self.calls == 1:
                    raise urllib.error.URLError(OSError(10013, "socket denied"))
                return io.BytesIO(b"audio bytes")

        opener = FakeOpener()
        with tempfile.TemporaryDirectory() as temp, patch.object(server_module.urllib.request, "build_opener", return_value=opener):
            target = Path(temp) / "audio.m4a"
            server_module.download_audio([
                "https://first.bilivideo.com/audio.m4s",
                "https://backup.bilivideo.com/audio.m4s",
            ], target, "BV123", threading.Event())
            self.assertEqual(target.read_bytes(), b"audio bytes")
            self.assertEqual(opener.calls, 2)

    def test_health_pairing_and_rejected_job(self):
        with tempfile.TemporaryDirectory() as temp:
            home = Path(temp)
            (home / "model").mkdir()
            for name in ("config.json", "model.bin", "tokenizer.json", "vocabulary.txt"):
                (home / "model" / name).write_bytes(b"model test marker")
            service = ThreadingHTTPServer(("127.0.0.1", 0), server_module.make_handler(home, "secret-token"))
            thread = threading.Thread(target=service.serve_forever, daemon=True)
            thread.start()
            base = f"http://127.0.0.1:{service.server_port}"
            try:
                health = json.load(urllib.request.urlopen(base + "/health"))
                self.assertEqual(health["service"], "featherclipper-asr")
                self.assertTrue(health["model_ready"])
                self.assertTrue(health["audio_backups"])
                self.assertTrue(health["youtube_audio"])
                with self.assertRaises(urllib.error.HTTPError) as denied:
                    urllib.request.urlopen(base + "/pair")
                self.assertEqual(denied.exception.code, 401)
                preflight = urllib.request.Request(base + "/pair", method="OPTIONS", headers={"Origin": "chrome-extension://" + "a" * 32})
                with urllib.request.urlopen(preflight) as response:
                    self.assertEqual(response.headers["Access-Control-Allow-Headers"], "Content-Type, X-FeatherClipper-Token")
                paired = urllib.request.Request(base + "/pair", headers={"X-FeatherClipper-Token": "secret-token"})
                self.assertTrue(json.load(urllib.request.urlopen(paired))["connected"])
                bad_job = urllib.request.Request(base + "/jobs", data=json.dumps({"bvid": "BV123", "cid": "1", "audio_url": "https://evil.test/audio"}).encode(), headers={"X-FeatherClipper-Token": "secret-token"})
                with self.assertRaises(urllib.error.HTTPError) as rejected:
                    urllib.request.urlopen(bad_job)
                self.assertEqual(rejected.exception.code, 400)
                youtube_job = urllib.request.Request(base + "/jobs", data=json.dumps({"bvid": "YT_GWwL_pLuX-U", "cid": "GWwL_pLuX-U", "audio_url": "https://rr1.googlevideo.com/audio"}).encode(), headers={"X-FeatherClipper-Token": "secret-token"})
                with patch.object(server_module, "run_job"):
                    self.assertEqual(json.load(urllib.request.urlopen(youtube_job))["status"], "queued")
                    playlist_job = urllib.request.Request(base + "/jobs", data=json.dumps({"bvid": "YTPL_PLKq1TCpsv3Y4", "cid": "abcdef12345", "audio_url": "https://rr1.googlevideo.com/audio"}).encode(), headers={"X-FeatherClipper-Token": "secret-token"})
                    self.assertEqual(json.load(urllib.request.urlopen(playlist_job))["status"], "queued")
            finally:
                service.shutdown()
                service.server_close()
                thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
