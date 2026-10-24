#!/usr/bin/env python3
"""Word-timed transcripts for reel subtitles: python3 transcribe.py <dir> <file.mp4>... -> <file>.words.json"""
import json, subprocess, sys
import numpy as np
from faster_whisper import WhisperModel
d, names = sys.argv[1], sys.argv[2:]
print("files:", names, flush=True)
print("loading model", flush=True)
m = WhisperModel("medium.en", device="cpu", compute_type="int8")
for name in names:
    p = f"{d}/{name}"
    print("transcribing", p, flush=True)
    pcm = subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-i", p, "-f", "s16le", "-ac", "1", "-ar", "16000", "-"], capture_output=True, check=True).stdout
    audio = np.frombuffer(pcm, np.int16).astype(np.float32) / 32768.0
    segs, info = m.transcribe(audio, word_timestamps=True, vad_filter=True)
    segs = list(segs); print("got", len(segs), flush=True)
    out = [{"start": s.start, "end": s.end, "text": s.text.strip(),
            "words": [{"w": w.word.strip(), "s": w.start, "e": w.end, "p": w.probability} for w in (s.words or [])]} for s in segs]
    json.dump({"file": name, "segments": out}, open(p.rsplit(".", 1)[0] + ".words.json", "w"), indent=1)
    print(name, len(out), "segments", flush=True)
