#!/usr/bin/env python3
"""当たり判定の確認図を作る（確認専用。ゲームには入れない）。
使い方:
  DUMP_GRID=/tmp/grid.json npx vitest run tests/mapaudit.test.ts
  python3 -I scripts/collision-review.py /tmp/grid.json <出力フォルダ> [部屋の名前…]
背景と家具を重ね（絵は読むだけ）、その上に 赤=歩けないマス、緑=出入口、黄=調べる地点、
青=NPC のたまり場、水色=席の前に立つマス、だいだいの線=家具の接地範囲、紫の線=閉じた房の扉 を描く。
"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
T = 64
ARROW = {'up': '^', 'down': 'v', 'left': '<', 'right': '>'}


def font(n):
    for p in ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',):
        if os.path.exists(p):
            return ImageFont.truetype(p, n)
    return ImageFont.load_default()


def asset(rel):
    return Image.open(os.path.join(ROOT, 'public', 'assets', rel + '.png')).convert('RGBA')


def main():
    dump = json.load(open(sys.argv[1], encoding='utf-8'))
    out = sys.argv[2]
    only = set(sys.argv[3:])
    furn = json.load(open(os.path.join(ROOT, 'src', 'data', 'furniture.json'), encoding='utf-8'))['rooms']
    os.makedirs(out, exist_ok=True)
    f1, f2 = font(15), font(22)
    for rid, r in dump.items():
        if only and rid not in only:
            continue
        f = furn[rid]
        img = asset(f['bg'])
        layers = []
        for p in f['props']:
            key = p['img']
            if p.get('door'):
                key = p['door']['open'] if r['gates'].get(p['id']) else p['door']['closed']
            layers.append((p['depth'], key, p))
            if p.get('fg'):
                layers.append((p['fg']['depth'], p['fg']['img'], p))
        for _, key, p in sorted(layers, key=lambda v: v[0]):
            im = asset(key)
            if im.size != (p['w'], p['h']):
                im = im.resize((p['w'], p['h']))  # 確認図の中だけの拡縮（元の絵は変えない）
            img.alpha_composite(im, (int(p['x']), int(p['y'])))
        if r.get('overlay'):
            img.alpha_composite(asset(r['overlay']))
        base = Image.new('RGBA', img.size, (20, 20, 28, 255))
        base.alpha_composite(img)
        ov = Image.new('RGBA', img.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(ov)
        g = r['grid']
        for y, row in enumerate(g):
            for x, b in enumerate(row):
                if b:
                    d.rectangle([x * T, y * T, x * T + T - 1, y * T + T - 1], fill=(230, 40, 40, 95))
                d.rectangle([x * T, y * T, x * T + T - 1, y * T + T - 1], outline=(255, 255, 255, 60))
        for c in f['colliders']:
            if c.get('when'):
                continue
            d.polygon([tuple(p) for p in c['poly']], outline=(255, 160, 0, 255))
        for p in f['props']:
            if p.get('door') and p['door'].get('closedPoly'):
                d.polygon([tuple(q) for q in p['door']['closedPoly']], outline=(255, 0, 255, 255))
        for x, y in r['approach']:
            d.rectangle([x * T + 6, y * T + 6, x * T + T - 7, y * T + T - 7], outline=(0, 240, 255, 255), width=3)
        for s in f['seats']:
            d.ellipse([s['a'][0] - 5, s['a'][1] - 5, s['a'][0] + 5, s['a'][1] + 5], fill=(0, 240, 255, 255))
            d.line([tuple(s['a']), tuple(s['hip'])], fill=(0, 240, 255, 200), width=2)
        for s in r['spots']:
            d.ellipse([s['x'] * T + 16, s['y'] * T + 16, s['x'] * T + 47, s['y'] * T + 47], fill=(60, 110, 255, 200))
        for i in r['inspects']:
            d.rectangle([i['x'] * T + 12, i['y'] * T + 12, i['x'] * T + 51, i['y'] * T + 51], fill=(255, 225, 0, 190))
            d.text((i['x'] * T + 14, i['y'] * T + 22), i['id'][-7:], font=f1, fill=(0, 0, 0, 255))
        for dr in r['doors']:
            for t in dr['tiles']:
                d.rectangle([t['x'] * T + 3, t['y'] * T + 3, t['x'] * T + T - 4, t['y'] * T + T - 4], outline=(40, 255, 80, 255), width=4)
                d.text((t['x'] * T + 22, t['y'] * T + 16), ARROW[dr['dir']], font=f2, fill=(40, 255, 80, 255))
        for x in range(len(g[0])):
            d.text((x * T + 20, 2), str(x), font=f2, fill=(255, 255, 255, 255), stroke_width=2, stroke_fill=(0, 0, 0, 255))
        for y in range(len(g)):
            d.text((2, y * T + 20), str(y), font=f2, fill=(255, 255, 255, 255), stroke_width=2, stroke_fill=(0, 0, 0, 255))
        base.alpha_composite(ov)
        base.convert('RGB').save(os.path.join(out, rid + '.png'))
        print(rid)


if __name__ == '__main__':
    main()
