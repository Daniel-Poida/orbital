#!/usr/bin/env python3
"""Генерирует демо-ассеты для планет: семплы (WAV), текстуры планет и фоны (PNG).

Чистый Python без numpy и PIL, чтобы запускалось где угодно:
    /usr/bin/python3 tools/gen_assets.py
"""
import math
import os
import random
import struct
import wave
import zlib

SR = 22050
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "planets")


# ---------- WAV ----------

def write_wav(path, samples):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    peak = max(1e-9, max(abs(s) for s in samples))
    gain = 0.92 / peak if peak > 0.92 else 1.0
    frames = bytearray()
    for s in samples:
        v = int(max(-1.0, min(1.0, s * gain)) * 32767)
        frames += struct.pack("<h", v)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(bytes(frames))


def seconds(n):
    return int(round(n * SR))


def noise(rng):
    return rng.uniform(-1.0, 1.0)


def note(midi):
    return 440.0 * 2 ** ((midi - 69) / 12.0)


def kick(dur=0.45):
    out, ph = [], 0.0
    for i in range(seconds(dur)):
        t = i / SR
        f = 45 + 160 * math.exp(-t * 28)
        ph += 2 * math.pi * f / SR
        a = math.exp(-t * 7.5)
        click = math.exp(-t * 400) * 0.6
        out.append(math.sin(ph) * a + click * math.sin(2 * math.pi * 1200 * t))
    return out


def snare(rng, dur=0.26):
    out = []
    for i in range(seconds(dur)):
        t = i / SR
        out.append(noise(rng) * math.exp(-t * 17) * 0.8 + math.sin(2 * math.pi * 186 * t) * math.exp(-t * 32) * 0.6)
    return out


def hat(rng, dur=0.1, decay=70):
    out, prev = [], 0.0
    for i in range(seconds(dur)):
        t = i / SR
        n = noise(rng)
        hp = n - prev
        prev = n
        out.append(hp * math.exp(-t * decay))
    return out


def clap(rng, dur=0.28):
    out = []
    for i in range(seconds(dur)):
        t = i / SR
        a = 0.0
        for k in range(3):
            tt = t - 0.011 * k
            if tt >= 0:
                a += math.exp(-tt * 70)
        a += math.exp(-max(0.0, t - 0.03) * 13) * 0.6
        out.append(noise(rng) * a * 0.5)
    return out


def perc(dur=0.32, f0=240, f1=150):
    out, ph = [], 0.0
    for i in range(seconds(dur)):
        t = i / SR
        f = f1 + (f0 - f1) * math.exp(-t * 18)
        ph += 2 * math.pi * f / SR
        out.append(math.sin(ph) * math.exp(-t * 9))
    return out


def vox_tone(t, f, vib=5.0):
    fm = f * (1 + 0.006 * math.sin(2 * math.pi * vib * t))
    w = [(1, 0.6), (2, 1.0), (3, 0.7), (4, 0.25), (5, 0.12)]
    return sum(a * math.sin(2 * math.pi * fm * k * t) for k, a in w) / 2.7


def vox_chop(midi, dur=0.36):
    out = []
    for i in range(seconds(dur)):
        t = i / SR
        a = min(1.0, t / 0.02) * math.exp(-max(0.0, t - 0.12) * 9)
        out.append(vox_tone(t, note(midi)) * a)
    return out


def riser(rng, dur=0.55):
    out, prev = [], 0.0
    for i in range(seconds(dur)):
        t = i / SR
        n = noise(rng)
        lp = prev + (n - prev) * min(1.0, 0.05 + t / dur)
        prev = lp
        a = (t / dur) ** 2 if t < dur * 0.9 else math.exp(-(t - dur * 0.9) * 80)
        out.append(lp * a * 0.9)
    return out


def bass_stab(midi, dur=0.34):
    out, f = [], note(midi)
    for i in range(seconds(dur)):
        t = i / SR
        a = math.exp(-t * 7)
        nh = 2 + int(8 * math.exp(-t * 10))
        s = sum(math.sin(2 * math.pi * f * k * t) / k for k in range(1, nh + 1))
        out.append(s * a * 0.6)
    return out


# ---------- Кольца (длинные лупы) ----------

def pad_loop(chords, bpm, bars=4):
    bar = 240.0 / bpm
    total = seconds(bar * bars)
    out = [0.0] * total
    for b, chord in enumerate(chords[:bars]):
        start = seconds(bar * b)
        end = min(total, seconds(bar * (b + 1)))
        for i in range(start, end):
            t = (i - start) / SR
            a = min(1.0, t / 0.35) * min(1.0, (bar - t) / 0.3)
            s = 0.0
            for m in chord:
                f = note(m)
                for det in (-0.004, 0.004):
                    ff = f * (1 + det)
                    s += (math.sin(2 * math.pi * ff * (i / SR)) + 0.4 * math.sin(2 * math.pi * ff * 2 * (i / SR))
                          + 0.15 * math.sin(2 * math.pi * ff * 3 * (i / SR)))
            out[i] += s * a / (len(chord) * 2 * 1.55) * 0.5
    return out


def bass_loop(chords, bpm, bars=4):
    bar = 240.0 / bpm
    eighth = bar / 8
    total = seconds(bar * bars)
    out = [0.0] * total
    for b, chord in enumerate(chords[:bars]):
        root = chord[0] - 12
        for n in range(8):
            midi = root if n % 4 != 3 else root + 7
            st = seconds(bar * b + eighth * n)
            f = note(midi)
            for i in range(st, min(total, st + seconds(eighth * 0.9))):
                t = (i - st) / SR
                a = min(1.0, t / 0.005) * math.exp(-t * 6)
                nh = 2 + int(7 * math.exp(-t * 12))
                s = sum(math.sin(2 * math.pi * f * k * t) / k for k in range(1, nh + 1))
                out[i] += s * a * 0.55
    return out


def vox_loop(chords, bpm, bars=4):
    bar = 240.0 / bpm
    quarter = bar / 4
    total = seconds(bar * bars)
    out = [0.0] * total
    for b, chord in enumerate(chords[:bars]):
        seq = [chord[0], chord[1], chord[2], chord[1]]
        for n, midi in enumerate(seq):
            st = seconds(bar * b + quarter * n)
            for i in range(st, min(total, st + seconds(quarter))):
                t = (i - st) / SR
                a = min(1.0, t / 0.03) * min(1.0, (quarter - t) / 0.08)
                out[i] += vox_tone(t, note(midi + 12)) * a * 0.5
    return out


def arp_loop(chords, bpm, bars=4):
    bar = 240.0 / bpm
    sixteenth = bar / 16
    total = seconds(bar * bars)
    out = [0.0] * total
    for b, chord in enumerate(chords[:bars]):
        seq = [chord[0], chord[2], chord[1], chord[2]] * 4
        for n, midi in enumerate(seq):
            st = seconds(bar * b + sixteenth * n)
            f = note(midi + 12)
            for i in range(st, min(total, st + seconds(sixteenth * 1.5))):
                t = (i - st) / SR
                a = min(1.0, t / 0.003) * math.exp(-t * 14)
                out[i] += (math.sin(2 * math.pi * f * t) + 0.3 * math.sin(2 * math.pi * f * 3 * t)) * a * 0.35
    return out


def keys_loop(chords, bpm, bars=4):
    bar = 240.0 / bpm
    eighth = bar / 8
    total = seconds(bar * bars)
    out = [0.0] * total
    for b, chord in enumerate(chords[:bars]):
        for n in (1, 3, 5, 7):
            st = seconds(bar * b + eighth * n)
            for i in range(st, min(total, st + seconds(eighth * 0.8))):
                t = (i - st) / SR
                a = min(1.0, t / 0.004) * math.exp(-t * 7)
                s_ = 0.0
                for m in chord:
                    f = note(m)
                    s_ += sum(math.sin(2 * math.pi * f * k * t) / (k * k) for k in (1, 2, 3, 4))
                out[i] += s_ * a / len(chord) * 0.45
    return out


def air_loop(rng, bpm, bars=4):
    bar = 240.0 / bpm
    total = seconds(bar * bars)
    out = [0.0] * total
    prev = 0.0
    for i in range(total):
        t = i / SR
        n = noise(rng)
        pos = (t % (bar * 2)) / (bar * 2)
        lp = prev + (n - prev) * (0.02 + 0.3 * pos)
        prev = lp
        swell = math.sin(math.pi * pos) ** 2
        out[i] = lp * swell * 0.5
    return out


# ---------- PNG ----------

def write_png(path, w, h, pixel_fn):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        for x in range(w):
            r, g, b = pixel_fn(x, y)
            raw += bytes((clamp8(r), clamp8(g), clamp8(b)))

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 6))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def clamp8(v):
    return max(0, min(255, int(v)))


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def lerp(a, b, t):
    return a + (b - a) * t


def lerp_rgb(c1, c2, t):
    return tuple(lerp(c1[i], c2[i], t) for i in range(3))


class ValueNoise:
    def __init__(self, rng, size):
        self.size = size
        self.grid = [[rng.random() for _ in range(size)] for _ in range(size)]

    def at(self, u, v):
        gx = u * self.size
        gy = v * self.size
        x0, y0 = int(gx) % self.size, int(gy) % self.size
        x1, y1 = (x0 + 1) % self.size, (y0 + 1) % self.size
        fx, fy = gx - int(gx), gy - int(gy)
        fx = fx * fx * (3 - 2 * fx)
        fy = fy * fy * (3 - 2 * fy)
        a = lerp(self.grid[y0][x0], self.grid[y0][x1], fx)
        b = lerp(self.grid[y1][x0], self.grid[y1][x1], fx)
        return lerp(a, b, fy)


def planet_texture(path, palette, rng, size=512):
    n1, n2 = ValueNoise(rng, 6), ValueNoise(rng, 24)
    cols = [hex_rgb(c) for c in palette]

    def px(x, y):
        u, v = x / size, y / size
        band = math.sin(v * math.pi * 7 + n1.at(u, v) * 4.0) * 0.5 + 0.5
        t = band * 0.7 + n2.at(u, v) * 0.3
        t = max(0.0, min(0.999, t)) * (len(cols) - 1)
        i = int(t)
        return lerp_rgb(cols[i], cols[i + 1], t - i)

    write_png(path, size, size, px)


def background(path, top, bottom, glow, rng, size=512):
    n = ValueNoise(rng, 5)
    c_top, c_bot, c_glow = hex_rgb(top), hex_rgb(bottom), hex_rgb(glow)
    stars = [(rng.random(), rng.random(), rng.uniform(0.3, 1.0)) for _ in range(260)]

    def px(x, y):
        u, v = x / size, y / size
        base = lerp_rgb(c_top, c_bot, v)
        neb = max(0.0, n.at(u, v) - 0.45) * 1.6
        base = lerp_rgb(base, c_glow, neb * 0.45)
        for sx, sy, b in stars:
            d = (sx - u) ** 2 + (sy - v) ** 2
            if d < 1.6e-6:
                base = lerp_rgb(base, (255, 255, 255), b * (1 - d / 1.6e-6))
        return base

    write_png(path, size, size, px)


# ---------- Планеты ----------

PLANETS = []
_OLD_DEMO = [
    {
        "id": "demo-a",
        "bpm": 110,
        "chords": [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]],
        "vox": 72,
        "bass": 36,
        "palette": ["#3a1b0f", "#d8541f", "#ffb347", "#fff1c2"],
        "bg": ("#120a1e", "#2b0f22", "#ff6a3d"),
        "seed": 7,
    },
    {
        "id": "demo-b",
        "bpm": 95,
        "chords": [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 55, 59]],
        "vox": 69,
        "bass": 33,
        "palette": ["#06142e", "#1d5ea8", "#3fd0c9", "#e6fbff"],
        "bg": ("#030916", "#0b1f3a", "#2fd3ff"),
        "seed": 42,
    },
]


def main():
    for p in PLANETS:
        rng = random.Random(p["seed"])
        d = os.path.join(ROOT, p["id"])
        s = os.path.join(d, "samples")
        print("planet", p["id"])
        write_wav(os.path.join(s, "kick.wav"), kick())
        write_wav(os.path.join(s, "snare.wav"), snare(rng))
        write_wav(os.path.join(s, "hat.wav"), hat(rng))
        write_wav(os.path.join(s, "open-hat.wav"), hat(rng, 0.3, 14))
        write_wav(os.path.join(s, "clap.wav"), clap(rng))
        write_wav(os.path.join(s, "perc.wav"), perc())
        write_wav(os.path.join(s, "vox-1.wav"), vox_chop(p["vox"]))
        write_wav(os.path.join(s, "vox-2.wav"), vox_chop(p["vox"] + 7))
        write_wav(os.path.join(s, "bass.wav"), bass_stab(p["bass"]))
        write_wav(os.path.join(s, "fx.wav"), riser(rng))
        write_wav(os.path.join(s, "ring-pad.wav"), pad_loop(p["chords"], p["bpm"]))
        write_wav(os.path.join(s, "ring-bass.wav"), bass_loop(p["chords"], p["bpm"]))
        write_wav(os.path.join(s, "ring-vox.wav"), vox_loop(p["chords"], p["bpm"]))
        write_wav(os.path.join(s, "ring-arp.wav"), arp_loop(p["chords"], p["bpm"]))
        write_wav(os.path.join(s, "ring-keys.wav"), keys_loop(p["chords"], p["bpm"]))
        write_wav(os.path.join(s, "ring-air.wav"), air_loop(rng, p["bpm"]))
        if not os.path.exists(os.path.join(d, "planet.png")):
            planet_texture(os.path.join(d, "planet.png"), p["palette"], rng)
        if not os.path.exists(os.path.join(d, "bg.png")):
            background(os.path.join(d, "bg.png"), *p["bg"], rng)
    print("done")


if __name__ == "__main__":
    main()
