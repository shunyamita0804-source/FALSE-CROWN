#!/usr/bin/env python3
"""家具を外した新しい背景で、前の背景から家具が消えたマスを表にする（絵は読むだけ）。
使い方: python3 -I scripts/freed-tiles.py <前の背景のフォルダ（maps/ と同じ並び）>
- 前の背景と新しい背景を 1 マス（64 ピクセル）ずつ比べ、足元の範囲（マスの下 40 ピクセル）の平均の差が大きいマスを書く
- そのマスにあった前の当たり判定（maps.ts の block）は、もう背景に家具が無いので外す（world/maps.ts の buildCollision）。
  新しい家具の当たり判定は furniture.json と furniture_mask.json が受け持つ
- 出力: src/data/furniture_freed.json
"""
import json, os, sys
from PIL import Image, ImageChops, ImageStat

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
T = 64
LIMIT = 16  # 足元の範囲の平均の差（0〜255）がこれ以上なら「家具が消えた」


def main():
    old_dir = sys.argv[1]
    furn = json.load(open(os.path.join(ROOT, 'src', 'data', 'furniture.json'), encoding='utf-8'))['rooms']
    out = {}
    for rid, f in sorted(furn.items()):
        sub = f['bg'][len('maps/'):] + '.png'
        old = os.path.join(old_dir, sub)
        if not os.path.exists(old):
            continue
        a = Image.open(old).convert('RGB')
        b = Image.open(os.path.join(ROOT, 'public', 'assets', f['bg'] + '.png')).convert('RGB')
        if a.size != b.size:
            continue
        d = ImageChops.difference(a, b).convert('L')
        tiles = []
        for ty in range(b.size[1] // T):
            for tx in range(b.size[0] // T):
                if ImageStat.Stat(d.crop((tx * T, ty * T + 24, tx * T + T, ty * T + T))).mean[0] >= LIMIT:
                    tiles.append(f'{tx},{ty}')
        if tiles:
            out[rid] = tiles
    path = os.path.join(ROOT, 'src', 'data', 'furniture_freed.json')
    json.dump({'note': '前の背景から家具が消えたマス（scripts/freed-tiles.py が作る。手で直さない）', 'rooms': out}, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print({k: len(v) for k, v in out.items()})


if __name__ == '__main__':
    main()
