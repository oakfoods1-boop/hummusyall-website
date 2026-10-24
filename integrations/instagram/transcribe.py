#!/usr/bin/env python3
"""Word-timed transcripts for reel subtitles: python3 transcribe.py <dir> <file.mp4>... -> <file>.words.json"""
import json, sys
from faster_whisper import WhisperModel
d, names = sys.argv[1], sys.argv[2:]
m = WhisperModel("medium.en", device="cpu", compute_type="int8")
for name in names:
    p = f"{d}/{name}"
    segs, info = m.transcribe(p, word_timestamps=True, vad_filter=True)
    out = [{"start": s.start, "end": s.end, "text": s.text.strip(),
            "words": [{"w": w.word.strip(), "s": w.start, "e": w.end, "p": w.probability} for w in (s.words or [])]} for s in segs]
    json.dump({"file": name, "segments": out}, open(p.rsplit(".", 1)[0] + ".words.json", "w"), indent=1)
    print(name, len(out), "segments", flush=True)
