"""Synthesize the music bed and sound effects for the Inkcast demo film (numpy/scipy only).

Usage: python3 scripts/sound.py   (from apps/demo-film; run narration.py first)
Everything is original synthesis at 48 kHz stereo. The bed ducks under the narration
lines placed by narration.py, and resolves on the end card.
"""
import json
from pathlib import Path

import numpy as np
import scipy.signal as ss
from scipy.io import wavfile

SR = 48000
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public' / 'audio'
TOTAL = 40.5
BPM = 100
BEAT = 60 / BPM
BAR = 4 * BEAT
rng = np.random.default_rng(7)


def t(d):
    return np.arange(int(d * SR)) / SR


def mtof(m):
    return 440 * 2 ** ((m - 69) / 12)


def bp(x, lo, hi):
    return ss.sosfilt(ss.butter(2, [lo, hi], 'bandpass', fs=SR, output='sos'), x)


def lp(x, f):
    return ss.sosfilt(ss.butter(2, f, 'lowpass', fs=SR, output='sos'), x)


def hp(x, f):
    return ss.sosfilt(ss.butter(2, f, 'highpass', fs=SR, output='sos'), x)


def write(name, x):
    x = np.asarray(x, dtype=np.float64)
    if x.ndim == 1:
        x = np.stack([x, x], 1)
    x = x / max(1e-9, np.abs(x).max()) * 0.89
    wavfile.write(OUT / f'{name}.wav', SR, (x * 32767).astype(np.int16))


def add(buf, x, at):
    i = int(at * SR)
    n = min(len(x), len(buf) - i)
    if n > 0:
        buf[i:i + n] += x[:n]


# ---------------------------------------------------------------- instruments
def pluck(m, d=0.9, bright=1.0):
    """Marimba-ish: a sine pair with a fast attack and wooden overtone."""
    x = t(d)
    f = mtof(m)
    env = np.exp(-x * 6.5) * (1 - np.exp(-x * 900))
    tone = np.sin(2 * np.pi * f * x) + 0.35 * bright * np.sin(2 * np.pi * f * 4 * x) * np.exp(-x * 30)
    return tone * env


def pad(ms, d):
    x = t(d)
    env = np.minimum(1, x / 0.6) * np.minimum(1, (d - x) / 0.8)
    y = sum(np.sin(2 * np.pi * mtof(m) * x * (1 + det)) for m in ms for det in (-0.0025, 0.0025))
    return lp(y * env, 1800) / (2 * len(ms))


def kick():
    x = t(0.35)
    f = 50 + 70 * np.exp(-x * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-x * 9)


def shaker():
    x = t(0.09)
    return hp(rng.standard_normal(len(x)), 6000) * np.exp(-x * 60) * 0.3


def snap():
    x = t(0.18)
    return bp(rng.standard_normal(len(x)), 1200, 5000) * np.exp(-x * 28) * 0.5


# ---------------------------------------------------------------- bed
CHORDS = [  # Fmaj7, Am7, Bbmaj7, C(add9)
    [53, 57, 60, 64],
    [57, 60, 64, 67],
    [58, 62, 65, 69],
    [60, 64, 67, 74],
]
ARP = [0, 2, 1, 3, 2, 1, 3, 2]


def bed():
    n = int(TOTAL * SR)
    music, drums = np.zeros(n), np.zeros(n)
    end_at = 33.6
    bar = 0
    while bar * BAR < end_at:
        t0 = bar * BAR
        ch = CHORDS[bar % 4]
        add(music, pad(ch, BAR + 0.3) * 0.5, t0)
        add(music, pluck(ch[0] - 24, 1.4, 0.2) * 0.55, t0)
        if t0 >= BAR * 0.99:  # the first bar is just pad and a single pluck line
            for k, idx in enumerate(ARP):
                add(music, pluck(ch[idx] + 12, 0.7) * 0.28, t0 + k * BEAT / 2)
        if t0 >= 2 * BAR * 0.99:
            for b in range(4):
                if b in (0, 2):
                    add(drums, kick() * 0.7, t0 + b * BEAT)
                if b in (1, 3):
                    add(drums, snap() * 0.6, t0 + b * BEAT)
                for h in range(2):
                    add(drums, shaker(), t0 + b * BEAT + h * BEAT / 2 + BEAT / 4)
        bar += 1
    # Resolve on the end card: a held Fmaj9 with a sparkle arpeggio.
    final = [41, 53, 57, 60, 64, 67]
    add(music, pad(final, TOTAL - end_at) * 0.9, end_at)
    for k, m in enumerate([72, 76, 79, 84]):
        add(music, pluck(m, 2.0) * 0.3, end_at + 0.1 + k * 0.12)
    mix = music + drums * 0.8
    # Duck under the narration.
    data = json.loads((ROOT / 'src' / 'words.json').read_text())
    gain = np.ones(n)
    for ln in data['lines']:
        a, b = ln['at'] - 0.15, ln['at'] + (ln['to'] - ln['from']) + 0.2
        gain[int(a * SR):int(b * SR)] = 0.45
    gain = np.convolve(gain, np.ones(int(0.12 * SR)) / int(0.12 * SR), mode='same')
    mix *= gain
    fade = np.minimum(1, np.minimum(np.arange(n) / (0.4 * SR), (n - np.arange(n)) / (2.5 * SR)))
    # Gentle stereo width from a short delay on one side.
    left = mix * fade
    right = np.concatenate([np.zeros(int(0.011 * SR)), left[:-int(0.011 * SR)]])
    return np.stack([left, 0.85 * right + 0.15 * left], 1)


# ---------------------------------------------------------------- effects
def pen(d=0.7, seed=1):
    r = np.random.default_rng(seed)
    x = t(d)
    strokes = np.zeros(len(x))
    pos = 0.0
    while pos < d:
        ln = r.uniform(0.05, 0.16)
        seg = (x >= pos) & (x < pos + ln)
        strokes[seg] = np.sin(np.pi * (x[seg] - pos) / ln) * r.uniform(0.5, 1)
        pos += ln + r.uniform(0.01, 0.04)
    return bp(r.standard_normal(len(x)), 2500, 7500) * strokes * 0.6


def pop_():
    x = t(0.14)
    f = 900 * np.exp(-x * 18) + 300
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-x * 30)


def whoosh():
    x = t(0.8)
    env = np.sin(np.pi * x / 0.8) ** 2
    sweep = np.interp(x, [0, 0.8], [400, 3000])
    y = rng.standard_normal(len(x))
    out = np.zeros_like(y)
    for i in range(0, len(x), 2400):  # a stepped band sweep is enough for a soft air move
        seg = slice(i, i + 2400)
        c = sweep[i]
        out[seg] = bp(y[seg], c * 0.6, c * 1.6)
    return lp(out, 6000) * env * 0.5


def type_():
    out = np.zeros(int(0.9 * SR))
    for k in range(10):
        x = t(0.03)
        add(out, bp(rng.standard_normal(len(x)), 2000, 6000) * np.exp(-x * 160), k * 0.075 + rng.uniform(0, 0.02))
    return out


def chime():
    x = t(2.4)
    y = sum(a * np.sin(2 * np.pi * mtof(m) * x) * np.exp(-x * dcy) for m, a, dcy in [(84, 0.6, 2.2), (91, 0.35, 3), (96, 0.2, 4)])
    return y * (1 - np.exp(-x * 400))


def stamp():
    x = t(0.25)
    return lp(rng.standard_normal(len(x)), 900) * np.exp(-x * 25) + 0.6 * kick()[:len(x)]


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    write('bed', bed())
    write('pen', pen())
    write('pen_long', pen(1.4, 3))
    write('pop', pop_())
    write('whoosh', whoosh())
    write('type', type_())
    write('chime', chime())
    write('stamp', stamp())
    print('wrote', sorted(p.name for p in OUT.glob('*.wav')))
