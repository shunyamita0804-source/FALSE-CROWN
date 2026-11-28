#!/usr/bin/env python3
"""家具の絵が、各マスの足元をどれだけおおうかを表にする（絵は読むだけで、書きかえない）。
使い方: python3 -I scripts/furniture-mask.py
- src/data/furniture.json の配置どおりに家具の絵を並べ、不透明な所を調べる
- 1 マス 64 ピクセル。足元の範囲（マスの左上から 横 14〜50、縦 36〜62）のうち、家具が占める割合（%）を
  src/data/furniture_mask.json に書く（0 のマスは書かない）
- 房の扉（開閉する物）は入れない。扉は world/furnitureGrid.ts が開閉に合わせてふさぐ
家具の絵や配置（furniture.json）が変わったら、これを動かし直す。
"""
import json, os
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
T = 64
FOOT = (14, 36, 50, 62)
ALPHA = 160  # これより薄い所（影）は家具に数えない


def main():
    furn = json.load(open(os.path.join(ROOT, 'src', 'data', 'furniture.json'), encoding='utf-8'))['rooms']
    out = {}
    for rid, f in sorted(furn.items()):
        props = [p for p in f['props'] if not p.get('door')]
        if not props:
            continue
        bg = Image.open(os.path.join(ROOT, 'public', 'assets', f['bg'] + '.png'))
        W, H = bg.size
        mask = Image.new('L', (W, H), 0)
        for p in props:
            for key in [p['img']] + ([p['fg']['img']] if p.get('fg') else []):
                a = Image.open(os.path.join(ROOT, 'public', 'assets', key + '.png')).convert('RGBA').getchannel('A')
                if a.size != (p['w'], p['h']):
                    a = a.resize((p['w'], p['h']))  # 計算の中だけの拡縮
                solid = a.point(lambda v: 255 if v >= ALPHA else 0)
                mask.paste(255, (int(p['x']), int(p['y'])), solid)
        tiles = {}
        for ty in range(H // T):
            for tx in range(W // T):
                box = (tx * T + FOOT[0], ty * T + FOOT[1], tx * T + FOOT[2], ty * T + FOOT[3])
                hist = mask.crop(box).histogram()
                n = (box[2] - box[0]) * (box[3] - box[1])
                pct = round(100 * hist[255] / n)
                if pct > 0:
                    tiles[f'{tx},{ty}'] = pct
        out[rid] = tiles
    data = {'note': '家具の絵が各マスの足元をおおう割合（%）。scripts/furniture-mask.py が作る。手で直さない。', 'rooms': out}
    path = os.path.join(ROOT, 'src', 'data', 'furniture_mask.json')
    with open(path, 'w', encoding='utf-8') as fp:
        fp.write('{\n "note": ' + json.dumps(data['note'], ensure_ascii=False) + ',\n "rooms": {\n')
        fp.write(',\n'.join(f'  {json.dumps(k)}: {json.dumps(v, separators=(",", ":"))}' for k, v in out.items()))
        fp.write('\n }\n}\n')
    print({k: len(v) for k, v in out.items()})


if __name__ == '__main__':
    main()
