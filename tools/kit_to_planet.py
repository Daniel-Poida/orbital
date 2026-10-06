#!/usr/bin/env python3
"""Превращает папку артиста из artist-kit в планету в planets/<id>/.

    /usr/bin/python3 tools/kit_to_planet.py "artist-kit/Pigeon Slayers" pigeon-slayers

Читает анкету, копирует картинки и звуки, пишет planet.json, добавляет планету в index.json.
Если планета уже есть, цвета звуков сохраняются по совпадению подписей.
"""
import json
import os
import re
import shutil
import sys
import wave

HERE = os.path.dirname(os.path.abspath(__file__))
PLANETS = os.path.normpath(os.path.join(HERE, '..', 'planets'))
AUDIO = ('.wav', '.m4a', '.mp3', '.aac')
IMAGES = ('.png', '.jpg', '.jpeg', '.webp')
PALETTE = ['#ff4d3d', '#ffb347', '#fff1c2', '#ffe08a', '#ff8fb1', '#d98cff', '#6fd3ff', '#3fb0ff', '#7cff8a', '#c8c8c8', '#ff9a5c', '#9cff7a']
TR = dict(zip('абвгдеёжзийклмнопрстуфхцчшщъыьэюя',
              ['a', 'b', 'v', 'g', 'd', 'e', 'e', 'zh', 'z', 'i', 'y', 'k', 'l', 'm', 'n', 'o', 'p', 'r', 's', 't', 'u', 'f', 'h', 'c', 'ch', 'sh', 'sch', '', 'y', '', 'e', 'yu', 'ya']))


def slug(s):
    s = ''.join(TR.get(c, c) for c in s.lower())
    s = re.sub(r'[^a-z0-9]+', '-', s).strip('-')
    return s or 'x'


def read_anketa(path):
    out = {}
    if not os.path.exists(path):
        return out
    for line in open(path, encoding='utf-8'):
        line = line.strip()
        if not line or line.startswith('#') or ':' not in line:
            continue
        k, v = line.split(':', 1)
        out[k.strip().lower()] = v.strip()
    return out


def parse_name(fn):
    """«03 Гитарный арп (4 такта).wav» -> (3, 'Гитарный арп', 4)."""
    base = os.path.splitext(fn)[0]
    m = re.match(r'^\s*(\d+)\s*[-_.]?\s*(.*)$', base)
    num, rest = (int(m.group(1)), m.group(2)) if m else (999, base)
    bars = None
    b = re.search(r'\((\d+)\s*такт[а-я]*\)', rest)
    if b:
        bars = int(b.group(1))
        rest = rest[:b.start()].strip()
    return num, rest.strip() or base, bars


def wav_seconds(path):
    try:
        with wave.open(path) as w:
            return w.getnframes() / float(w.getframerate())
    except Exception:
        return None


def files(folder, exts):
    if not os.path.isdir(folder):
        return []
    return sorted((f for f in os.listdir(folder) if f.lower().endswith(exts) and not f.startswith('.')), key=lambda f: parse_name(f)[0])


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    kit, pid = sys.argv[1], slug(sys.argv[2])
    a = read_anketa(os.path.join(kit, 'анкета.txt'))
    bpm = int(re.sub(r'[^0-9]', '', a.get('темп', '')) or 0)
    if not bpm:
        sys.exit('В анкете не указан темп')
    dst = os.path.join(PLANETS, pid)
    old = {}
    if os.path.exists(os.path.join(dst, 'planet.json')):
        old = json.load(open(os.path.join(dst, 'planet.json'), encoding='utf-8'))
    old_colors = {x['name']: x['color'] for x in old.get('samples', []) + old.get('rings', [])}
    oc = old.get('colors', {})

    if os.path.isdir(os.path.join(dst, 'samples')):
        shutil.rmtree(os.path.join(dst, 'samples'))
    os.makedirs(os.path.join(dst, 'samples'), exist_ok=True)

    cfg = {
        'id': pid, 'name': a.get('артист') or old.get('name') or pid, 'track': a.get('название песни', ''),
        'bpm': bpm, 'trackUrl': a.get('ссылка на трек', ''), 'texture': None, 'background': None,
        'colors': {
            'accent': a.get('цвет акцента') or oc.get('accent', '#ff7a3d'),
            'orbit': a.get('цвет орбит') or oc.get('orbit', '#8f7a6b'),
            'ray': a.get('цвет луча') or oc.get('ray', '#ffffff'),
            'text': a.get('цвет текста') or oc.get('text', '#f4f2ff'),
        },
        'samples': [], 'rings': [],
    }
    tex = os.path.join(kit, 'textures')
    for f in files(tex, IMAGES):
        stem = os.path.splitext(f)[0].lower()
        ext = os.path.splitext(f)[1].lower()
        if stem.startswith('planet'):
            cfg['texture'] = 'planet' + ext; shutil.copy(os.path.join(tex, f), os.path.join(dst, cfg['texture']))
        elif stem.startswith('background') or stem.startswith('bg'):
            cfg['background'] = 'bg' + ext; shutil.copy(os.path.join(tex, f), os.path.join(dst, cfg['background']))

    warnings = []
    for i, f in enumerate(files(os.path.join(kit, 'drums'), AUDIO)):
        _, name, _ = parse_name(f)
        out = f"samples/d{i + 1:02d}-{slug(name)}{os.path.splitext(f)[1].lower()}"
        shutil.copy(os.path.join(kit, 'drums', f), os.path.join(dst, out))
        sec = wav_seconds(os.path.join(dst, out))
        if sec and sec > 1.2:
            warnings.append(f'ударка «{name}» длится {sec:.2f} с, лучше до 1 с')
        cfg['samples'].append({'id': slug(name), 'name': name, 'file': out, 'color': old_colors.get(name, PALETTE[i % len(PALETTE)])})
    for i, f in enumerate(files(os.path.join(kit, 'loops'), AUDIO)):
        _, name, bars = parse_name(f)
        out = f"samples/r{i + 1:02d}-{slug(name)}{os.path.splitext(f)[1].lower()}"
        shutil.copy(os.path.join(kit, 'loops', f), os.path.join(dst, out))
        sec = wav_seconds(os.path.join(dst, out))
        bar = 240.0 / bpm
        if not bars:
            bars = max(1, round(sec / bar)) if sec else 4
        if sec and abs(sec - bars * bar) > 0.05:
            warnings.append(f'луп «{name}»: {sec:.3f} с, а {bars} т. при {bpm} BPM = {bars * bar:.3f} с')
        cfg['rings'].append({'id': slug(name), 'name': name, 'file': out, 'bars': bars, 'color': old_colors.get(name, PALETTE[(i + 5) % len(PALETTE)])})

    if not cfg['samples']:
        sys.exit('В папке drums нет звуков')
    with open(os.path.join(dst, 'planet.json'), 'w', encoding='utf-8') as fh:
        json.dump(cfg, fh, ensure_ascii=False, indent=2)
    idx_path = os.path.join(PLANETS, 'index.json')
    idx = json.load(open(idx_path, encoding='utf-8'))
    entry = {'id': pid, 'name': cfg['name'], 'track': cfg['track']}
    idx['planets'] = [entry if p['id'] == pid else p for p in idx['planets']]
    if not any(p['id'] == pid for p in idx['planets']):
        idx['planets'].append(entry)
    with open(idx_path, 'w', encoding='utf-8') as fh:
        json.dump(idx, fh, ensure_ascii=False, indent=2)
    print(f"planets/{pid}: {len(cfg['samples'])} звуков, {len(cfg['rings'])} лупов")
    for w in warnings:
        print('  внимание:', w)


if __name__ == '__main__':
    main()
