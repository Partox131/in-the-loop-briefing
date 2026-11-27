#!/usr/bin/env python3
"""Background music beds for the daily clip, made from scratch (numpy only).

Nothing is sampled or downloaded, so we own every track outright and no
platform can flag it. Each bed is 75 s; the clip step trims and fades it.

    python3 scripts/make-music.py <out-dir>      # writes <name>.wav for each track
"""
import os, sys
import numpy as np

SR = 44100
LEN = 75.0
rng = np.random.default_rng(7)
NOTE = {n: i for i, n in enumerate(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'])}


def hz(name):
    """'A3' -> 220.0"""
    n, o = name[:-1], int(name[-1])
    return 440.0 * 2 ** ((NOTE[n] + 12 * (o + 1) - 69) / 12)


def t_axis(d):
    return np.arange(int(d * SR)) / SR


def env(d, a=0.01, r=0.2, kind='lin'):
    t = t_axis(d)
    e = np.minimum(1, t / max(a, 1e-4))
    rel = np.clip((d - t) / max(r, 1e-4), 0, 1)
    return e * rel


def tone(f, d, harmonics=6, bright=1.0, detune=0.0):
    t = t_axis(d)
    out = np.zeros_like(t)
    for k in range(1, harmonics + 1):
        out += np.sin(2 * np.pi * f * k * (1 + detune) * t + rng.uniform(0, 6.28)) * (bright ** (k - 1)) / k
    return out


def pad(freqs, d, a=1.5, r=1.5, bright=0.5):
    left = sum(tone(f, d, 6, bright, -0.003) for f in freqs)
    right = sum(tone(f, d, 6, bright, 0.003) for f in freqs)
    e = env(d, a, r)
    return np.stack([left * e, right * e]) / len(freqs)


def pluck(f, d=0.6, bright=0.55, decay=5.0):
    t = t_axis(d)
    s = tone(f, d, 5, bright) * np.exp(-decay * t) * np.minimum(1, t / 0.003)
    return np.stack([s, s])


def bell(f, d=2.5):
    t = t_axis(d)
    s = (np.sin(2 * np.pi * f * t) + 0.4 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-3 * t) + 0.2 * np.sin(2 * np.pi * f * 5.4 * t) * np.exp(-6 * t))
    s *= np.exp(-1.6 * t) * np.minimum(1, t / 0.004)
    return np.stack([s, s])


def kick(d=0.4):
    t = t_axis(d)
    f = 45 + 75 * np.exp(-30 * t)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-9 * t)
    return np.stack([s, s])


def hat(d=0.06):
    n = rng.standard_normal(int(d * SR))
    n = np.diff(n, prepend=0) * 0.5
    n = (n + np.roll(n, 1)) * 0.5
    s = n * np.exp(-90 * t_axis(d))
    return np.stack([s, s])


def tick(d=0.03):
    t = t_axis(d)
    s = np.sin(2 * np.pi * 2400 * t) * np.exp(-180 * t)
    return np.stack([s, s])


def reverb(x, secs=2.2, wet=0.25):
    n = int(secs * SR)
    ir_t = np.arange(n) / SR
    out = np.zeros_like(x)
    for ch in range(2):
        ir = rng.standard_normal(n) * np.exp(-3.0 * ir_t / secs * 2.3)
        ir[:int(0.012 * SR)] = 0
        ir /= np.sqrt(np.sum(ir ** 2))
        size = x.shape[1] + n
        nfft = 1 << (size - 1).bit_length()
        wet_sig = np.fft.irfft(np.fft.rfft(x[ch], nfft) * np.fft.rfft(ir, nfft), nfft)[:x.shape[1]]
        out[ch] = x[ch] * (1 - wet) + wet_sig * wet * 1.5
    return out


class Song:
    def __init__(self, bpm):
        self.bpm = bpm
        self.beat = 60.0 / bpm
        self.buf = np.zeros((2, int((LEN + 4) * SR)))

    def add(self, sig, at, gain=1.0, pan=0.0):
        i = int(at * SR)
        if i >= self.buf.shape[1]:
            return
        j = min(self.buf.shape[1], i + sig.shape[1])
        lp, rp = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
        self.buf[0, i:j] += sig[0, : j - i] * gain * lp * 1.414
        self.buf[1, i:j] += sig[1, : j - i] * gain * rp * 1.414

    def bars(self):
        bar = 4 * self.beat
        return int(LEN / bar) + 1, bar


def chord(names):
    return [hz(n) for n in names.split()]


def pulse():
    """Steady newsroom pulse: minor chords, eighth-note bass, soft kick and hats (96 BPM)."""
    s = Song(96)
    prog = ['A2 C3 E3', 'F2 A2 C3', 'C3 E3 G3', 'G2 B2 D3']
    roots = ['A1', 'F1', 'C2', 'G1']
    nbars, bar = s.bars()
    for b in range(nbars):
        t0 = b * bar
        c = b % 4
        s.add(pad([f * 2 for f in chord(prog[c])], bar + 1.2, a=0.6, r=1.0, bright=0.45), t0, 0.22)
        for k in range(8):
            s.add(pluck(hz(roots[c]) * 2, 0.35, 0.5, 9), t0 + k * s.beat / 2, 0.30 if k % 2 == 0 else 0.2)
        if b >= 2:
            for k in (0, 2):
                s.add(kick(), t0 + k * s.beat, 0.55)
            for k in range(4):
                s.add(hat(), t0 + k * s.beat + s.beat / 2, 0.14, 0.3)
    return s.buf


def drift():
    """Calm ambient: slow major-seventh pads and a few bell notes, no drums."""
    s = Song(70)
    prog = ['D3 F#3 A3 C#4', 'B2 D3 F#3 A3', 'G2 B2 D3 F#3', 'A2 C#3 E3 G3']
    bells = ['F#5', 'A5', 'D5', 'E5', 'B4', 'C#5', 'A4', 'D5']
    nbars, bar = s.bars()
    for b in range(nbars):
        t0 = b * bar
        s.add(pad(chord(prog[b % 4]), bar + 2.5, a=2.0, r=2.5, bright=0.4), t0, 0.32)
        s.add(np.stack([tone(chord(prog[b % 4])[0] / 2, bar + 1, 2, 0.3)] * 2) * env(bar + 1, 1.0, 1.5), t0, 0.18)
        s.add(bell(hz(bells[b % 8])), t0 + s.beat * (1 if b % 2 else 2.5), 0.14, (-0.4 if b % 2 else 0.4))
    return s.buf


def tension():
    """Ticking clock over a low drone and slowly shifting minor chords (110 BPM)."""
    s = Song(110)
    prog = ['D3 F3 A3', 'D3 F3 A#3', 'D3 G3 A#3', 'C3 E3 A3']
    nbars, bar = s.bars()
    drone = np.stack([tone(hz('D2'), LEN + 3, 4, 0.4, -0.002), tone(hz('D2'), LEN + 3, 4, 0.4, 0.002)]) * env(LEN + 3, 3, 3)
    s.add(drone, 0, 0.22)
    for b in range(nbars):
        t0 = b * bar
        s.add(pad(chord(prog[b % 4]), bar + 1.0, a=0.8, r=1.0, bright=0.35), t0, 0.16)
        for k in range(16):
            s.add(tick(), t0 + k * s.beat / 4, 0.16 if k % 4 == 0 else 0.07, 0.25)
        if b >= 4:
            for k in range(4):
                s.add(pluck(hz('D2'), 0.3, 0.4, 10), t0 + k * s.beat, 0.35)
        if b >= 8 and b % 2 == 0:
            s.add(kick(0.5), t0, 0.45)
    return s.buf


def bright():
    """Upbeat and light: major chords, plucked arpeggios, soft four-on-the-floor (118 BPM)."""
    s = Song(118)
    prog = ['C3 E3 G3', 'G2 B2 D3', 'A2 C3 E3', 'F2 A2 C3']
    arps = [['C4', 'E4', 'G4', 'E4'], ['B3', 'D4', 'G4', 'D4'], ['A3', 'C4', 'E4', 'C4'], ['A3', 'C4', 'F4', 'C4']]
    roots = ['C2', 'G1', 'A1', 'F1']
    nbars, bar = s.bars()
    for b in range(nbars):
        t0 = b * bar
        c = b % 4
        s.add(pad(chord(prog[c]), bar + 0.8, a=0.3, r=0.8, bright=0.5), t0, 0.14)
        for k in range(8):
            s.add(pluck(hz(arps[c][k % 4]), 0.45, 0.6, 6), t0 + k * s.beat / 2, 0.2, -0.35 if k % 2 else 0.35)
        for k in range(4):
            s.add(pluck(hz(roots[c]), 0.4, 0.5, 6), t0 + k * s.beat, 0.3)
        if b >= 1:
            for k in range(4):
                s.add(kick(0.3), t0 + k * s.beat, 0.45)
                s.add(hat(0.05), t0 + k * s.beat + s.beat / 2, 0.12, -0.3)
            for k in (1, 3):
                s.add(hat(0.12), t0 + k * s.beat, 0.2, 0.2)
    return s.buf


TRACKS = {'pulse': pulse, 'drift': drift, 'tension': tension, 'bright': bright}


def write_wav(path, x):
    import wave
    x = x[:, : int(LEN * SR)]
    x = x / (np.max(np.abs(x)) + 1e-9) * 0.89
    fade = int(2.0 * SR)
    x[:, -fade:] *= np.linspace(1, 0, fade)
    pcm = (x.T * 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    os.makedirs(out, exist_ok=True)
    for name in (sys.argv[2:] or TRACKS):
        x = TRACKS[name]()
        x = reverb(x, 2.4 if name == 'drift' else 1.6, 0.35 if name == 'drift' else 0.22)
        write_wav(os.path.join(out, f'{name}.wav'), x)
        print('wrote', name)
