#!/usr/bin/env python3
"""Делает текстуры планет бесшовными по горизонтали (левый и правый край совпадают).

Работает с PNG, которые пишет gen_assets (RGB, 8 бит, без чересстрочности).
    /usr/bin/python3 tools/seamless.py planets/*/planet.png
"""
import struct
import sys
import zlib

sys.path.insert(0, __import__('os').path.dirname(__file__))
from gen_assets import write_png


def read_png(path):
    data = open(path, 'rb').read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    pos, idat, w, h = 8, b'', None, None
    while pos < len(data):
        ln, = struct.unpack('>I', data[pos:pos + 4]); tag = data[pos + 4:pos + 8]; body = data[pos + 8:pos + 8 + ln]
        if tag == b'IHDR':
            w, h, depth, ctype = struct.unpack('>IIBB', body[:10])
            assert depth == 8 and ctype == 2, 'нужен RGB 8 бит'
        elif tag == b'IDAT':
            idat += body
        pos += 12 + ln
    raw = zlib.decompress(idat)
    stride = w * 3
    rows, prev = [], bytearray(stride)
    for y in range(h):
        f = raw[y * (stride + 1)]
        line = bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        for i in range(stride):
            a = line[i - 3] if i >= 3 else 0
            b = prev[i]
            c = prev[i - 3] if i >= 3 else 0
            if f == 1: line[i] = (line[i] + a) & 255
            elif f == 2: line[i] = (line[i] + b) & 255
            elif f == 3: line[i] = (line[i] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c; pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(line); prev = line
    return w, h, rows


def main(paths):
    for path in paths:
        w, h, rows = read_png(path)
        half = w // 2

        def px(x, y):
            r = rows[y]
            # Вес 1 в центре, 0 у краёв: края берутся из сдвинутой на полширины копии и совпадают.
            t = 1 - abs(x - (w - 1) / 2) / ((w - 1) / 2)
            t = t * t * (3 - 2 * t)
            x2 = (x + half) % w
            return tuple(r[x * 3 + k] * t + r[x2 * 3 + k] * (1 - t) for k in range(3))

        write_png(path, w, h, px)
        print('seamless', path)


if __name__ == '__main__':
    main(sys.argv[1:])
