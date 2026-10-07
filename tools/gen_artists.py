#!/usr/bin/env python3
"""Генерирует стилизованные демо-планеты для артистов (звуки, текстуры, фоны, planet.json).

Это НЕ записи артистов, а синтетические семплы в духе жанра. Настоящие звуки
подменяются через редактор планет или заменой файлов в papке планеты.
    /usr/bin/python3 tools/gen_artists.py
"""
import json
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_assets import (SR, ROOT, write_wav, seconds, noise, note, kick, snare, hat, clap, perc,
                        vox_tone, vox_chop, riser, bass_stab, pad_loop, bass_loop, vox_loop, arp_loop,
                        keys_loop, air_loop, write_png, hex_rgb, lerp_rgb, ValueNoise, background)


# ---------- Дополнительный синтез ----------

def dist(x, drive=4.0):
    return math.tanh(x * drive) / math.tanh(drive)


def saw(f, t, nh):
    return sum(math.sin(2 * math.pi * f * k * t) / k for k in range(1, nh + 1))


def chug(midi, dur=0.22, mute=28.0, drive=6.0):
    """Заглушённый ладонью дисторшн-аккорд (джент)."""
    out, f = [], note(midi)
    for i in range(seconds(dur)):
        t = i / SR
        env = min(1.0, t / 0.002) * math.exp(-t * mute)
        nh = 2 + int(14 * math.exp(-t * 20))
        s = saw(f, t, nh) * 0.7 + saw(f * 1.5, t, max(2, nh // 2)) * 0.35
        out.append(dist(s, drive) * env * 0.8)
    return out


def open_chord(midis, dur=0.6, drive=5.0):
    out = []
    for i in range(seconds(dur)):
        t = i / SR
        env = min(1.0, t / 0.004) * math.exp(-t * 4)
        s = sum(saw(note(m), t, 8) for m in midis) / len(midis)
        out.append(dist(s, drive) * env * 0.8)
    return out


def china(rng, dur=0.9):
    out, prev = [], 0.0
    for i in range(seconds(dur)):
        t = i / SR
        n = noise(rng)
        hp = n - prev * 0.6
        prev = n
        metal = sum(math.sin(2 * math.pi * f * t) for f in (3170, 4230, 5570, 7110)) * 0.08
        out.append((hp * 0.8 + metal) * math.exp(-t * 4.5))
    return out


def tight_kick(dur=0.3):
    out, ph = [], 0.0
    for i in range(seconds(dur)):
        t = i / SR
        f = 52 + 220 * math.exp(-t * 45)
        ph += 2 * math.pi * f / SR
        out.append(dist(math.sin(ph), 2.5) * math.exp(-t * 12) + math.exp(-t * 600) * 0.7 * math.sin(2 * math.pi * 2400 * t))
    return out


def kick808(dur=0.9):
    out, ph = [], 0.0
    for i in range(seconds(dur)):
        t = i / SR
        f = 38 + 90 * math.exp(-t * 30)
        ph += 2 * math.pi * f / SR
        out.append(dist(math.sin(ph), 1.8) * math.exp(-t * 3.2))
    return out


def industrial_snare(rng, dur=0.3):
    out = []
    for i in range(seconds(dur)):
        t = i / SR
        clang = sum(math.sin(2 * math.pi * f * t) for f in (410, 870, 1335)) * 0.25 * math.exp(-t * 25)
        out.append(dist(noise(rng) * math.exp(-t * 14) * 0.8 + clang, 3.0))
    return out


def blast(rng, bpm, hits=8):
    step = 60.0 / bpm / 8  # 32-е доли
    total = seconds(step * hits)
    out = [0.0] * total
    k, s = tight_kick(0.15), snare(rng, 0.12)
    for n in range(hits):
        src = k if n % 2 == 0 else s
        st = seconds(step * n)
        for j, v in enumerate(src):
            if st + j < total:
                out[st + j] += v * 0.8
    return out


def squeal(dur=0.5, f0=2200, f1=900):
    out = []
    for i in range(seconds(dur)):
        t = i / SR
        f = f1 + (f0 - f1) * math.exp(-t * 4) * (1 + 0.03 * math.sin(2 * math.pi * 6 * t))
        out.append(dist(math.sin(2 * math.pi * f * t) + 0.5 * math.sin(2 * math.pi * f * 2 * t), 5) * math.exp(-t * 4))
    return out


def pig_squeal(rng, dur=0.45):
    out = []
    for i in range(seconds(dur)):
        t = i / SR
        f = 700 * math.exp(-t * 3) + 140
        s = saw(f, t, 10) * 0.6 + noise(rng) * 0.3
        out.append(dist(s, 8) * min(1.0, t / 0.01) * math.exp(-t * 5))
    return out


def coo(dur=0.42):
    out = []
    for i in range(seconds(dur)):
        t = i / SR
        f = note(60) * (1 + 0.04 * math.sin(2 * math.pi * 9 * t))
        env = min(1.0, t / 0.03) * math.exp(-max(0.0, t - 0.2) * 12) * (0.75 + 0.25 * math.sin(2 * math.pi * 18 * t))
        out.append(vox_tone(t, f / 2, 0) * env)
    return out


def flap(rng, dur=0.4):
    out, prev = [], 0.0
    for i in range(seconds(dur)):
        t = i / SR
        n = noise(rng)
        lp = prev + (n - prev) * 0.25
        prev = lp
        out.append(lp * abs(math.sin(2 * math.pi * 16 * t)) * math.exp(-t * 5))
    return out


def growl(rng, dur=0.5):
    out, prev = [], 0.0
    for i in range(seconds(dur)):
        t = i / SR
        n = noise(rng)
        lp = prev + (n - prev) * 0.12
        prev = lp
        pulse = 0.5 + 0.5 * math.sin(2 * math.pi * 72 * t)
        out.append(dist(lp * pulse * 2, 4) * min(1.0, t / 0.02) * math.exp(-t * 4))
    return out


def stab(midis, dur=0.2):
    out = []
    for i in range(seconds(dur)):
        t = i / SR
        env = min(1.0, t / 0.003) * math.exp(-t * 14)
        s = sum(saw(note(m), t, 10) + saw(note(m) * 1.004, t, 10) for m in midis) / (len(midis) * 2)
        out.append(s * env * 0.9)
    return out


def siren(dur=0.5):
    out = []
    for i in range(seconds(dur)):
        t = i / SR
        f = 600 + 400 * math.sin(2 * math.pi * 3 * t)
        out.append(dist(math.sin(2 * math.pi * f * t), 3) * math.exp(-t * 3) * 0.8)
    return out


def laser(dur=0.18):
    out, ph = [], 0.0
    for i in range(seconds(dur)):
        t = i / SR
        f = 200 + 3000 * math.exp(-t * 25)
        ph += 2 * math.pi * f / SR
        out.append(math.sin(ph) * math.exp(-t * 15))
    return out


def pluck(midi, rng, dur=0.5, damp=0.996):
    """Карплус-Стронг: струна."""
    f = note(midi)
    n = max(2, int(SR / f))
    buf = [noise(rng) for _ in range(n)]
    out = []
    idx = 0
    for i in range(seconds(dur)):
        v = buf[idx]
        nxt = buf[(idx + 1) % n]
        buf[idx] = (v + nxt) * 0.5 * damp
        out.append(v)
        idx = (idx + 1) % n
    return out


def synth_pluck(midi, dur=0.35):
    out, f = [], note(midi)
    for i in range(seconds(dur)):
        t = i / SR
        env = math.exp(-t * 9)
        nh = 1 + int(10 * math.exp(-t * 14))
        out.append(saw(f, t, nh) * env * 0.6)
    return out


def tambourine(rng, dur=0.25):
    out, prev = [], 0.0
    for i in range(seconds(dur)):
        t = i / SR
        n = noise(rng)
        hp = n - prev
        prev = n
        jing = sum(math.sin(2 * math.pi * f * t) for f in (5200, 6800, 8100)) * 0.1
        out.append((hp * 0.6 + jing) * math.exp(-t * 16) * (0.7 + 0.3 * math.sin(2 * math.pi * 40 * t)))
    return out


def reverse_fx(rng, dur=0.5):
    r = riser(rng, dur)
    return r[::-1]


def soft_kick(dur=0.4):
    out, ph = [], 0.0
    for i in range(seconds(dur)):
        t = i / SR
        f = 48 + 110 * math.exp(-t * 22)
        ph += 2 * math.pi * f / SR
        out.append(math.sin(ph) * math.exp(-t * 6))
    return out


def rim(dur=0.08):
    out = []
    for i in range(seconds(dur)):
        t = i / SR
        out.append((math.sin(2 * math.pi * 1700 * t) + 0.5 * math.sin(2 * math.pi * 3100 * t)) * math.exp(-t * 70))
    return out


# ---------- Лупы ----------

def place(out, src, st, gain=1.0):
    for j, v in enumerate(src):
        k = st + j
        if k >= len(out):
            break
        out[k] += v * gain


def riff_loop(patterns, midis, bpm, mute=28.0, drive=6.0, bars=4):
    """patterns: список строк по 16 символов на такт ('x' удар, 'o' открытый, '-' пауза)."""
    bar = 240.0 / bpm
    step = bar / 16
    total = seconds(bar * bars)
    out = [0.0] * total
    cache = {}
    for b in range(bars):
        pat = patterns[b % len(patterns)]
        midi = midis[b % len(midis)]
        for n, ch in enumerate(pat[:16]):
            if ch == '-':
                continue
            key = (midi, ch)
            if key not in cache:
                cache[key] = chug(midi, 0.2, mute, drive) if ch == 'x' else open_chord([midi, midi + 7], 0.5, drive)
            place(out, cache[key], seconds(bar * b + step * n), 0.9)
    return out


def drum_loop(kit, pattern, bpm, bars=4):
    """kit: dict name->samples; pattern: dict name->строка из 16 символов."""
    bar = 240.0 / bpm
    step = bar / 16
    total = seconds(bar * bars)
    out = [0.0] * total
    for b in range(bars):
        for name, pat in pattern.items():
            src = kit[name]
            p = pat[b % len(pat)] if isinstance(pat, list) else pat
            for n, ch in enumerate(p[:16]):
                if ch != '-':
                    place(out, src, seconds(bar * b + step * n), 0.9 if ch == 'x' else 0.5)
    return out


def lead_loop(seq, bpm, bars=4, octave=0, vib=5.5):
    """seq: список (midi, длительность в 8-х) на такт, повторяется."""
    bar = 240.0 / bpm
    eighth = bar / 8
    total = seconds(bar * bars)
    out = [0.0] * total
    pos = 0.0
    idx = 0
    while pos < bar * bars:
        midi, ln = seq[idx % len(seq)]
        idx += 1
        d = eighth * ln
        if midi is None:
            pos += d
            continue
        st = seconds(pos)
        f = note(midi + 12 * octave)
        for i in range(st, min(total, st + seconds(d))):
            t = (i - st) / SR
            env = min(1.0, t / 0.02) * min(1.0, max(0.0, (d - t) / 0.06))
            fm = f * (1 + 0.008 * math.sin(2 * math.pi * vib * t) * min(1.0, t / 0.25))
            out[i] += dist(math.sin(2 * math.pi * fm * t) + 0.4 * math.sin(2 * math.pi * fm * 2 * t) + 0.2 * math.sin(2 * math.pi * fm * 3 * t), 2.5) * env * 0.5
        pos += d
    return out


def supersaw_loop(chords, bpm, bars=4, pump=True, rhythm='8ths'):
    bar = 240.0 / bpm
    beat = bar / 4
    eighth = bar / 8
    total = seconds(bar * bars)
    out = [0.0] * total
    for b, chord in enumerate(chords[:bars]):
        start = seconds(bar * b)
        end = min(total, seconds(bar * (b + 1)))
        for i in range(start, end):
            t = i / SR
            tl = t - bar * b
            gate = 1.0
            if rhythm == '8ths':
                ph = (tl % eighth) / eighth
                gate = 1.0 if ph < 0.6 else max(0.0, 1 - (ph - 0.6) / 0.1)
            pmp = 1.0
            if pump:
                pb = (tl % beat) / beat
                pmp = min(1.0, pb / 0.3) ** 1.5 * 0.85 + 0.15
            s = 0.0
            for m in chord:
                f = note(m)
                for det in (-0.01, -0.004, 0.004, 0.01):
                    s += saw(f * (1 + det), t, 6)
            out[i] = s / (len(chord) * 4 * 2.2) * gate * pmp * 0.7
    return out


def drone_loop(rng, bpm, bars=4, f=55.0):
    bar = 240.0 / bpm
    eighth = bar / 8
    total = seconds(bar * bars)
    out = [0.0] * total
    prev = 0.0
    for i in range(total):
        t = i / SR
        n = noise(rng)
        lp = prev + (n - prev) * 0.04
        prev = lp
        pe = (t % eighth) / eighth
        gate = math.exp(-pe * 6)
        out[i] = dist(lp * 2.5 * gate + 0.3 * math.sin(2 * math.pi * f * t) * gate, 3) * 0.6
    return out


# ---------- Текстуры ----------

def planet_texture_styled(path, palette, rng, style='bands', size=512):
    n1, n2 = ValueNoise(rng, 6), ValueNoise(rng, 24)
    cols = [hex_rgb(c) for c in palette]

    def pick(t):
        t = max(0.0, min(0.999, t)) * (len(cols) - 1)
        i = int(t)
        return lerp_rgb(cols[i], cols[i + 1], t - i)

    def px(x, y):
        u, v = x / size, y / size
        if style == 'cells':
            t = n1.at(u, v) * 0.8 + n2.at(u, v) * 0.2
            t = math.floor(t * 6) / 6 + (n2.at(u * 2, v * 2) - 0.5) * 0.08
        elif style == 'swirl':
            ang = math.atan2(v - 0.5, u - 0.5)
            r = math.hypot(u - 0.5, v - 0.5)
            t = math.sin(ang * 3 + r * 18 + n1.at(u, v) * 3) * 0.5 + 0.5
            t = t * 0.75 + n2.at(u, v) * 0.25
        elif style == 'stripes':
            t = (math.sin(v * math.pi * 14 + n1.at(u, v) * 1.2) * 0.5 + 0.5)
            t = 1.0 if t > 0.55 else 0.0
            t = t * 0.85 + n2.at(u, v) * 0.15
            band = int(v * 7) % 3 / 2.0
            t = (t + band) / 2
        else:
            band = math.sin(v * math.pi * 7 + n1.at(u, v) * 4.0) * 0.5 + 0.5
            t = band * 0.7 + n2.at(u, v) * 0.3
        return pick(t)

    write_png(path, size, size, px)


# ---------- Планеты ----------

def artist_planets():
    rng = random.Random(2026)
    P = []

    # 1. Exploration One — инструментальный джент/прог, холодный космос, геометрия
    bpm = 140
    chords = [[52, 55, 59], [50, 53, 57], [48, 52, 55], [51, 55, 58]]
    kit = {
        'kick': tight_kick(), 'snare': industrial_snare(rng), 'hat': hat(rng, 0.07, 90), 'china': china(rng),
    }
    P.append({
        'id': 'exploration-one', 'name': 'Exploration One', 'artist': '', 'bpm': bpm,
        'trackUrl': 'https://explorationone.bandcamp.com/',
        'colors': {'accent': '#4fd1ff', 'orbit': '#4a5a6e', 'ray': '#d8f3ff', 'text': '#e8f4ff'},
        'palette': ['#05080d', '#1b2a3a', '#3f7f9f', '#9fe8ff'], 'style': 'cells',
        'bg': ('#03060b', '#0b1420', '#2a6f9f'),
        'samples': [
            ('Бочка', '#4fd1ff', kit['kick']), ('Снейр', '#dfe9f3', kit['snare']), ('Хэт', '#9fb8cc', kit['hat']),
            ('Чайна', '#ffffff', kit['china']), ('Чаг низ', '#2f6f9f', chug(40, 0.22)), ('Чаг верх', '#5ea8d8', chug(47, 0.2)),
            ('Скрим-флажолет', '#b8ecff', squeal()), ('Индастриал-хит', '#7f8fa0', industrial_snare(rng, 0.5)),
            ('Саб-дроп', '#1f3f5f', kick808(1.2)), ('Глитч', '#c0f0ff', laser(0.12)),
        ],
        'rings': [
            ('Джент-рифф', '#4fd1ff', riff_loop(['x-x-x--xx-x-x--x', 'x-x-x--x--x-xo--'], [40, 40, 38, 43], bpm)),
            ('Космо-пад', '#8fb8ff', pad_loop([[m + 12 for m in c] for c in chords], bpm)),
            ('Лид', '#d8f3ff', lead_loop([(76, 2), (79, 1), (78, 1), (74, 2), (None, 1), (71, 1)], bpm, octave=-1)),
            ('Индастриал-дрон', '#4a5a6e', drone_loop(rng, bpm, f=note(28))),
            ('Арп', '#9fe8ff', arp_loop(chords, bpm)),
            ('Ударные', '#6f8090', drum_loop(kit, {'kick': 'x--x--x---x-x---', 'snare': '----x-------x---', 'hat': 'x-x-x-x-x-x-x-x-'}, bpm)),
        ],
    })

    # 2. Pigeon Slayers — металкор/деткор, голуби, серый с перламутром и красным глазом
    bpm = 130
    chords = [[50, 53, 57], [48, 51, 55], [46, 50, 53], [49, 53, 56]]
    kit = {'kick': tight_kick(0.25), 'snare': snare(rng, 0.2), 'hat': hat(rng, 0.06, 110), 'china': china(rng, 0.7)}
    P.append({
        'id': 'pigeon-slayers', 'name': 'Pigeon Slayers', 'artist': '', 'bpm': bpm,
        'trackUrl': 'https://pigeonslayers.bandcamp.com/',
        'colors': {'accent': '#ff3b3b', 'orbit': '#7a7f86', 'ray': '#e9ecef', 'text': '#f2f2f2'},
        'palette': ['#1a1b1e', '#5b5f66', '#9aa0a8', '#55d6a0', '#8f6bff', '#9aa0a8'], 'style': 'swirl',
        'bg': ('#0a0a0c', '#1c1d22', '#55d6a0'),
        'samples': [
            ('Бочка', '#ff3b3b', kit['kick']), ('Снейр', '#e9ecef', kit['snare']), ('Чайна', '#ffffff', kit['china']),
            ('Бласт', '#ff8a80', blast(rng, bpm)), ('Брейкдаун', '#55d6a0', chug(38, 0.5, 9.0, 8.0)),
            ('Визг', '#8f6bff', pig_squeal(rng)), ('Голубь', '#9aa0a8', coo()), ('Крылья', '#c9ced6', flap(rng)),
            ('Гроул', '#5b5f66', growl(rng)), ('Хэт', '#dfe3e8', kit['hat']),
        ],
        'rings': [
            ('Брейкдаун-рифф', '#55d6a0', riff_loop(['x---x-----x---x-', 'x-----x---x-x---'], [38, 38, 36, 41], bpm, 10.0, 8.0)),
            ('Тремоло', '#8f6bff', riff_loop(['xxxxxxxxxxxxxxxx'], [50, 48, 46, 49], bpm, 60.0, 6.0)),
            ('Бласт-бит', '#ff8a80', drum_loop(kit, {'kick': 'x-x-x-x-x-x-x-x-', 'snare': '-x-x-x-x-x-x-x-x', 'china': 'x-------x-------'}, bpm)),
            ('Гроул-дрон', '#5b5f66', drone_loop(rng, bpm, f=note(26))),
            ('Лид-визг', '#e9ecef', lead_loop([(74, 3), (77, 1), (76, 2), (72, 2), (None, 2), (70, 4), (None, 2)], bpm, octave=0, vib=7)),
            ('Голубиный хор', '#9aa0a8', vox_loop([[m + 12 for m in c] for c in chords], bpm)),
        ],
    })

    # 3. Canavar Contact — Devil Dance Music: джент + EDM + индастриал, неон-красный на чёрном
    bpm = 128
    chords = [[50, 53, 57], [48, 51, 55], [46, 50, 53], [45, 48, 52]]
    kit = {'kick': kick808(0.5), 'snare': industrial_snare(rng), 'hat': hat(rng, 0.05, 140), 'clap': clap(rng)}
    P.append({
        'id': 'canavar-contact', 'name': 'Canavar Contact', 'artist': '', 'bpm': bpm,
        'trackUrl': 'https://canavarcontact.bandcamp.com/',
        'colors': {'accent': '#ff2d55', 'orbit': '#6b2a44', 'ray': '#ffd1e0', 'text': '#fff0f5'},
        'palette': ['#0a0004', '#3b0014', '#b3003b', '#ff2d55', '#ffb3c6'], 'style': 'swirl',
        'bg': ('#07000a', '#20020f', '#ff2d55'),
        'samples': [
            ('808', '#ff2d55', kick808()), ('Снейр', '#ffd1e0', kit['snare']), ('Хэт', '#ff8fb1', kit['hat']),
            ('Клэп', '#ffb3c6', kit['clap']), ('Стаб', '#ff5c8a', stab([62, 65, 69])), ('Чаг', '#b3003b', chug(38, 0.2, 30.0, 7.0)),
            ('Сирена', '#ff7aa8', siren()), ('Райзер', '#c0c0c0', riser(rng)), ('Хэй', '#ffe0ea', vox_chop(67, 0.25)),
            ('Лазер', '#ffffff', laser()),
        ],
        'rings': [
            ('EDM-лид', '#ff2d55', supersaw_loop([[m + 12 for m in c] for c in chords], bpm)),
            ('Индастриал-бас', '#b3003b', riff_loop(['x-x-x-x-x-x-x-x-'], [38, 36, 34, 33], bpm, 18.0, 9.0)),
            ('Чаг-луп', '#ff5c8a', riff_loop(['x-xx-x-xx-x-x-xx'], [38, 38, 36, 33], bpm, 30.0, 7.0)),
            ('Пампинг-пад', '#ff8fb1', supersaw_loop(chords, bpm, pump=True, rhythm='hold')),
            ('Драм-машина', '#ffd1e0', drum_loop(kit, {'kick': 'x---x---x---x---', 'clap': '----x-------x---', 'hat': '--x---x---x---x-'}, bpm)),
            ('Арп', '#ffb3c6', arp_loop(chords, bpm)),
        ],
    })

    # 4. Борец в Пижаме — альтернатива, «Неония»: неон-розовый и бирюза, пижамные полоски
    bpm = 118
    chords = [[60, 64, 67, 71], [57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 65]]
    kit = {'kick': soft_kick(), 'snare': snare(rng, 0.22), 'hat': hat(rng, 0.09, 60), 'rim': rim(), 'clap': clap(rng), 'tamb': tambourine(rng)}
    P.append({
        'id': 'borets-v-pizhame', 'name': 'Борец в Пижаме', 'artist': '', 'bpm': bpm,
        'trackUrl': 'https://music.apple.com/ru/album/1517188643',
        'colors': {'accent': '#ff5fd2', 'orbit': '#7a5f8f', 'ray': '#c9fff4', 'text': '#fff0fb'},
        'palette': ['#2a1a3a', '#ff5fd2', '#2a1a3a', '#5ff2ff', '#2a1a3a', '#ffe66d'], 'style': 'stripes',
        'bg': ('#120a24', '#2d1050', '#ff5fd2'),
        'samples': [
            ('Бочка', '#ff5fd2', kit['kick']), ('Снейр', '#ffe66d', kit['snare']), ('Хэт', '#c9fff4', kit['hat']),
            ('Рим', '#ffb3ec', kit['rim']), ('Клэп', '#ffd9f5', kit['clap']), ('Бубен', '#fff3a0', kit['tamb']),
            ('Гитара', '#5ff2ff', pluck(64, rng)), ('Синт-плак', '#9d7bff', synth_pluck(72)),
            ('Оу', '#ff8fe0', vox_chop(69, 0.4)), ('Реверс', '#b8b8ff', reverse_fx(rng)),
        ],
        'rings': [
            ('Неон-пад', '#ff5fd2', pad_loop(chords, bpm)),
            ('Бас', '#9d7bff', bass_loop(chords, bpm)),
            ('Гитарный арп', '#5ff2ff', arp_loop(chords, bpm)),
            ('Оу-хор', '#ff8fe0', vox_loop(chords, bpm)),
            ('Клавиши', '#ffe66d', keys_loop(chords, bpm)),
            ('Ударные', '#c9fff4', drum_loop(kit, {'kick': 'x---x---x---x-x-', 'snare': '----x-------x---', 'hat': 'x-x-x-x-x-x-x-x-', 'tamb': '--x---x---x---x-'}, bpm)),
        ],
    })

    # 5. CHOMACHASM — информации в сети не нашлось; взят образ «пропасти»: чёрный, глубокий фиолет, кислотный зелёный
    bpm = 100
    chords = [[45, 48, 52], [43, 46, 50], [41, 45, 48], [44, 48, 51]]
    kit = {'kick': kick808(0.6), 'snare': industrial_snare(rng), 'hat': hat(rng, 0.06, 120), 'china': china(rng, 0.8)}
    P.append({
        'id': 'chomachasm', 'name': 'CHOMACHASM', 'artist': '', 'bpm': bpm,
        'trackUrl': '',
        'colors': {'accent': '#a6ff00', 'orbit': '#3a2f5a', 'ray': '#e8ffd0', 'text': '#f0f0ff'},
        'palette': ['#000000', '#120820', '#3a1d6e', '#a6ff00'], 'style': 'cells',
        'bg': ('#000000', '#0e0618', '#7a2cff'),
        'samples': [
            ('Бочка', '#a6ff00', kit['kick']), ('Снейр', '#e8ffd0', kit['snare']), ('Хэт', '#8fa0b0', kit['hat']),
            ('Чайна', '#ffffff', kit['china']), ('Чаг', '#7a2cff', chug(36, 0.3, 14.0, 8.0)), ('Гроул', '#3a2f5a', growl(rng)),
            ('Сирена', '#c6ff5a', siren()), ('Лазер', '#d9ffb0', laser()), ('Райзер', '#9a9aa0', riser(rng)),
            ('Бездна', '#2a1a4a', kick808(1.4)),
        ],
        'rings': [
            ('Дрон', '#3a2f5a', drone_loop(rng, bpm, f=note(24))),
            ('Рифф', '#7a2cff', riff_loop(['x---x---x-x-----', 'x---x-----x---xo'], [36, 36, 34, 32], bpm, 12.0, 8.0)),
            ('Пад', '#a6ff00', pad_loop(chords, bpm)),
            ('Арп', '#c6ff5a', arp_loop(chords, bpm)),
            ('Ударные', '#8fa0b0', drum_loop(kit, {'kick': 'x-----x-x-------', 'snare': '----x-------x---', 'hat': 'x-x-x-x-x-x-x-x-'}, bpm)),
            ('Воздух', '#e8ffd0', air_loop(rng, bpm)),
        ],
    })
    return P, rng


PRESETS = {"exploration-one": {"o": "0--0--0---0-0---.----1-------1---.2-2-2-2-2-2-2-2-.4-------5---4---", "r": [0, 1]}, "pigeon-slayers": {"o": "0---0-----0---0-.--------1-------.2-------2-------.------6-------5-", "r": [0]}, "canavar-contact": {"o": "0---0---0---0---.----3-------3---.--2---2---2---2-.4-----4-----4---", "r": [0, 1]}, "borets-v-pizhame": {"o": "0---0---0---0-0-.----1-------1---.2-2-2-2-2-2-2-2-", "r": [0, 2]}, "chomachasm": {"o": "0-----0-0-------.--------1-------.2---2---2---2---.9---------------", "r": [0, 1]}}


def slug(s):
    tr = {'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e', 'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'c', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya'}
    out = ''.join(tr.get(c, c) for c in s.lower())
    out = ''.join(c if c.isalnum() else '-' for c in out)
    while '--' in out:
        out = out.replace('--', '-')
    return out.strip('-') or 'x'


def main():
    planets, rng = artist_planets()
    for p in planets:
        d = os.path.join(ROOT, p['id'])
        s = os.path.join(d, 'samples')
        print('planet', p['id'], flush=True)
        cfg = {
            'id': p['id'], 'name': p['name'], 'artist': p['artist'], 'bpm': p['bpm'], 'trackUrl': p['trackUrl'],
            'texture': 'planet.png', 'background': 'bg.png', 'colors': p['colors'], 'samples': [], 'rings': [],
        }
        if p['id'] in PRESETS:
            cfg['preset'] = PRESETS[p['id']]
        cfg['track'] = ''
        cfg.pop('artist', None)
        for i, (name, color, data) in enumerate(p['samples']):
            f = f'samples/d{i + 1:02d}-{slug(name)}.wav'
            write_wav(os.path.join(d, f), data)
            cfg['samples'].append({'id': slug(name), 'name': name, 'file': f, 'color': color})
        for i, (name, color, data) in enumerate(p['rings']):
            f = f'samples/r{i + 1:02d}-{slug(name)}.wav'
            write_wav(os.path.join(d, f), data)
            cfg['rings'].append({'id': slug(name), 'name': name, 'file': f, 'bars': 4, 'color': color})
        if not os.path.exists(os.path.join(d, 'planet.png')):
            planet_texture_styled(os.path.join(d, 'planet.png'), p['palette'], rng, p['style'])
        if not os.path.exists(os.path.join(d, 'bg.png')):
            background(os.path.join(d, 'bg.png'), *p['bg'], rng)
        with open(os.path.join(d, 'planet.json'), 'w', encoding='utf-8') as fh:
            json.dump(cfg, fh, ensure_ascii=False, indent=2)
    idx_path = os.path.join(ROOT, 'index.json')
    idx = json.load(open(idx_path, encoding='utf-8'))
    have = {x['id'] for x in idx['planets']}
    for p in planets:
        if p['id'] not in have:
            idx['planets'].append({'id': p['id'], 'name': p['name'], 'artist': p['artist']})
    with open(idx_path, 'w', encoding='utf-8') as fh:
        json.dump(idx, fh, ensure_ascii=False, indent=2)
    print('done')


if __name__ == '__main__':
    main()
