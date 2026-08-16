"""Generate the Library's PNG icons with no dependencies (pure zlib PNG writer).
Run:  python tools/make_icons.py
Draws a dark rounded tile with a 2x2 grid of app tiles (a "library" glyph)."""
import math, os, struct, zlib

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'icons')
os.makedirs(OUT, exist_ok=True)

BG_TOP = (0x16, 0x1b, 0x27)
BG_BOT = (0x0b, 0x0d, 0x13)
TILES = [(0x7a, 0xa2, 0xff), (0xff, 0xb8, 0x4a), (0x4f, 0xd2, 0x8a), (0xe0, 0x8c, 0xff)]


def sd_round_rect(px, py, cx, cy, hw, hh, r):
    dx = abs(px - cx) - (hw - r)
    dy = abs(py - cy) - (hh - r)
    ax, ay = max(dx, 0.0), max(dy, 0.0)
    return math.hypot(ax, ay) + min(max(dx, dy), 0.0) - r


def coverage(d):  # 1 inside, 0 outside, ~1px anti-aliased edge
    return min(1.0, max(0.0, 0.5 - d))


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def render(size, maskable=False, square=False):
    rows = []
    bg_r = 0 if (maskable or square) else size * 0.22   # iOS masks apple-touch-icon itself; give it a full-bleed square
    glyph_scale = 0.60 if maskable else 0.66   # maskable: keep glyph inside the safe zone
    cell = size * glyph_scale / 2.0
    gap = size * 0.045
    tile_half = (cell - gap) / 2.0
    tile_r = tile_half * 0.34
    centers = []
    for gy in (-0.5, 0.5):
        for gx in (-0.5, 0.5):
            centers.append((size / 2 + gx * cell, size / 2 + gy * cell))
    for y in range(size):
        row = bytearray([0])  # filter type 0
        for x in range(size):
            px, py = x + 0.5, y + 0.5
            bg = lerp(BG_TOP, BG_BOT, y / size)
            a_bg = coverage(sd_round_rect(px, py, size / 2, size / 2, size / 2, size / 2, bg_r))
            r, g, b = bg
            for (cx, cy), col in zip(centers, TILES):
                a = coverage(sd_round_rect(px, py, cx, cy, tile_half, tile_half, tile_r))
                if a > 0:
                    r = int(round(r + (col[0] - r) * a)); g = int(round(g + (col[1] - g) * a)); b = int(round(b + (col[2] - b) * a))
            alpha = int(round(255 * a_bg))
            row += bytes((r, g, b, alpha))
        rows.append(bytes(row))
    return b''.join(rows)


def png(size, data):
    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(data, 9)) + chunk(b'IEND', b'')


for name, size, maskable, square in [('icon-180.png', 180, False, True), ('icon-192.png', 192, False, False), ('icon-512.png', 512, False, False), ('icon-maskable-512.png', 512, True, False)]:
    p = os.path.join(OUT, name)
    with open(p, 'wb') as f:
        f.write(png(size, render(size, maskable, square)))
    print('wrote', p, os.path.getsize(p), 'bytes')
