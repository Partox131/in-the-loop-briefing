#!/usr/bin/env python3
"""Reads lines with Kokoro (open-weight text-to-speech, Apache 2.0, runs on CPU).

    echo '["First line.", "Second line."]' | python3 tts-kokoro.py af_heart out-dir [speed]

Writes out-dir/l0.wav, l1.wav, ... (24 kHz mono). Voices whose name starts
with "b" are British English; the rest American English.
"""
import json, os, sys
import numpy as np
import soundfile as sf
from kokoro import KPipeline

voice, out = sys.argv[1], sys.argv[2]
speed = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
os.makedirs(out, exist_ok=True)
pipe = KPipeline(lang_code='b' if voice.startswith('b') else 'a', repo_id='hexgrad/Kokoro-82M')
for i, text in enumerate(json.load(sys.stdin)):
    parts = [np.asarray(audio) for _, _, audio in pipe(text, voice=voice, speed=speed) if audio is not None]
    sf.write(os.path.join(out, f'l{i}.wav'), np.concatenate(parts) if parts else np.zeros(2400), 24000)
    print(f'l{i}.wav', flush=True)
