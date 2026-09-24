"""Download only the faster-whisper small model files into the selected install folder."""
import sys
from pathlib import Path
from huggingface_hub import hf_hub_download

target = Path(sys.argv[1]).resolve()
target.mkdir(parents=True, exist_ok=True)
for name in ("config.json", "model.bin", "tokenizer.json", "vocabulary.txt"):
    print(f"Downloading {name}...", flush=True)
    hf_hub_download(repo_id="Systran/faster-whisper-small", filename=name, local_dir=target)
print("Model ready.", flush=True)
