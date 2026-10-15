"""Offline checks for cloud adapters, chunk boundaries and cancellation."""
import io
import json
import sys
import tempfile
import threading
import types
import unittest
import urllib.error
import wave
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "asr"))
import online


class OnlineTests(unittest.TestCase):
    def job(self):
        return {"cancel": threading.Event()}

    def test_multipart_is_real_wav_and_groq_requests_timestamp_response(self):
        body, content_type = online.multipart("groq", b"RIFF-test-audio")
        self.assertIn(b"whisper-large-v3-turbo", body)
        self.assertIn(b"verbose_json", body)
        self.assertIn(b"RIFF-test-audio", body)
        self.assertTrue(content_type.startswith("multipart/form-data; boundary="))
        body, _ = online.multipart("siliconflow", b"audio")
        self.assertNotIn(b"verbose_json", body)

    def test_groq_offsets_segments_and_siliconflow_has_no_artificial_times(self):
        body = online.normalize_result("groq", {"segments": [{"start": 1.2, "end": 3.4, "text": " original "}]}, 120, 60)
        self.assertEqual(body, [{"from": 121.2, "to": 123.4, "content": "original"}])
        self.assertEqual(online.normalize_result("siliconflow", {"text": " original "}, 120, 60), [{"content": "original"}])
        with self.assertRaises(ValueError):
            online.normalize_result("groq", {"segments": [{"start": -1, "end": 5, "text": "bad"}]}, 0, 60)

    def test_api_errors_hide_keys_and_timeout_is_not_resubmitted(self):
        job = self.job()
        for code in (401, 429, 503):
            error = urllib.error.HTTPError("https://api.test", code, "private-key", {"Retry-After": "9999"}, None)
            with patch.object(online.urllib.request, "urlopen", side_effect=error) as call:
                with self.assertRaises(ValueError) as raised:
                    online.request_transcript("groq", "private-key", b"audio", job)
                self.assertNotIn("private-key", str(raised.exception))
                self.assertEqual(call.call_count, 1)
        with patch.object(online.urllib.request, "urlopen", side_effect=TimeoutError("private-key")) as call:
            with self.assertRaises(ValueError):
                online.request_transcript("groq", "private-key", b"audio", job)
            self.assertEqual(call.call_count, 1)

    def test_rate_limit_retry_is_bounded_and_cancelable(self):
        job = {"cancel": types.SimpleNamespace(is_set=lambda: False, wait=lambda seconds: False)}
        error = urllib.error.HTTPError("https://api.test", 429, "limited", {"Retry-After": "1"}, None)
        with patch.object(online.urllib.request, "urlopen", side_effect=error) as call:
            with self.assertRaises(ValueError):
                online.request_transcript("groq", "key", b"audio", job)
            self.assertEqual(call.call_count, 3)
        job["cancel"] = types.SimpleNamespace(is_set=lambda: False, wait=lambda seconds: True)
        with patch.object(online.urllib.request, "urlopen", side_effect=error) as call:
            with self.assertRaises(InterruptedError):
                online.request_transcript("groq", "key", b"audio", job)
            self.assertEqual(call.call_count, 1)

    def test_cancel_after_a_response_prevents_accepting_the_result(self):
        job = self.job()
        def respond(*args, **kwargs):
            job["cancel"].set()
            return io.BytesIO(json.dumps({"text": "late result"}).encode())
        with patch.object(online.urllib.request, "urlopen", side_effect=respond):
            with self.assertRaises(InterruptedError):
                online.request_transcript("siliconflow", "key", b"audio", job)

    def test_multiple_chunks_merge_in_order_without_loading_a_local_model(self):
        chunks = [(0, b"one", 120), (120, b"two", 30)]
        results = [{"segments": [{"start": 0, "end": 1, "text": "First"}]},
                   {"segments": [{"start": 2, "end": 5, "text": "Second"}]}]
        job = self.job()
        with patch.object(online, "audio_chunks", return_value=iter(chunks)), \
                patch.object(online, "request_transcript", side_effect=results), \
                patch.object(online.time, "monotonic", side_effect=[100, 100, 110, 110]):
            body, language = online.transcribe_online(Path("test.m4a"), "groq", "key", job)
        self.assertEqual([item["from"] for item in body], [0, 122])
        self.assertEqual([item["content"] for item in body], ["First", "Second"])
        self.assertTrue(job["timestamps"])

    def test_audio_chunker_preserves_all_samples_including_resampler_flush(self):
        samples = bytes(range(256)) * 250 + b"\x00\x01" * 8000
        frames = [types.SimpleNamespace(samples=32000, planes=[samples[:64000]])]
        flushed = types.SimpleNamespace(samples=8000, planes=[samples[64000:]])
        container = types.SimpleNamespace(streams=[types.SimpleNamespace(type="audio")], decode=lambda stream: frames)
        class OpenAudio:
            def __enter__(self): return container
            def __exit__(self, *args): pass
        resampler = types.SimpleNamespace(resample=lambda frame: [frame] if frame else [flushed])
        fake_av = types.SimpleNamespace(open=lambda path: OpenAudio(), AudioResampler=lambda **kwargs: resampler)
        with patch.dict(sys.modules, {"av": fake_av}):
            chunks = list(online.audio_chunks(Path("audio.m4a"), threading.Event(), chunk_seconds=1))
        decoded = []
        for _, audio, _ in chunks:
            with wave.open(io.BytesIO(audio), "rb") as wav:
                self.assertEqual(wav.getframerate(), 16000)
                self.assertEqual(wav.getnchannels(), 1)
                decoded.append(wav.readframes(wav.getnframes()))
        self.assertEqual(b"".join(decoded), samples)
        self.assertEqual([start for start, _, _ in chunks], [0, 1, 2])


if __name__ == "__main__":
    unittest.main()
