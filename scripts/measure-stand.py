"""待機画像（stand.png）と歩行画像（walk.png）の基準位置を計測し、描画補正の表を作る。
画像そのものは変更しない。使い方: python3 scripts/measure-stand.py
出力: src/data/stand_align.json（キャラごと、方向ごとの 頭部中心 x、足元 y、表示倍率）と計測結果の表示。
"""
import glob, json, os
import numpy as np
from PIL import Image

DIRS = ['down', 'up', 'left', 'right']

def measure(cell):
    ys, xs = np.where(cell > 8)
    top, bot = int(ys.min()), int(ys.max())
    head = xs[ys <= top + int((bot - top) * 0.25)]
    return {'top': top, 'bot': bot, 'hc': (int(head.min()) + int(head.max())) / 2, 'h': bot - top + 1}

out = {}
worst = {'head': 0.0, 'foot': 0, 'f13': 10**9}
for d in sorted(glob.glob('public/assets/characters/*/')):
    cid = os.path.basename(d.rstrip('/'))
    if not os.path.exists(d + 'walk.png') or not os.path.exists(d + 'stand.png'):
        continue
    # 2 倍の新しい絵（walk@2x.png）の人は、足元・中心を納品の基準どおりにそろえてあるので補正しない（旧素材用の補正を重ねない）
    if os.path.exists(d + 'walk@2x.png'):
        continue
    wim = np.array(Image.open(d + 'walk.png').convert('RGBA'))
    w = wim[:, :, 3]
    st = np.array(Image.open(d + 'stand.png').convert('RGBA'))[:, :, 3]
    row = {}
    for r, dn in enumerate(DIRS):
        ws = [measure(w[r * 128:(r + 1) * 128, c * 96:(c + 1) * 96]) for c in range(4)]
        s = measure(st[0:128, r * 96:(r + 1) * 96])
        worst['head'] = max(worst['head'], max(abs(x['hc'] - 48) for x in ws))
        worst['foot'] = max(worst['foot'], max(abs(x['bot'] - 120) for x in ws))
        f1 = wim[r * 128:(r + 1) * 128, 0:96].astype(int)
        f3 = wim[r * 128:(r + 1) * 128, 192:288].astype(int)
        worst['f13'] = min(worst['f13'], int((np.abs(f1 - f3).sum(axis=2) > 0).sum()))
        k = round(min(1.08, max(0.96, ws[0]['h'] / s['h'])), 3)
        row[dn] = {'x': s['hc'], 'y': s['bot'], 'k': k}
        print(f"{cid:18s} {dn:5s} stand head x {s['hc']:5.1f} foot y {s['bot']:3d} height {s['h']:3d} | walk head x {sum(x['hc'] for x in ws) / 4:5.1f} foot y {ws[0]['bot']} height {ws[0]['h']} | k {k}")
    out[cid] = row
print('walk: max head-centre deviation from 48 =', worst['head'], 'px, max foot deviation from 120 =', worst['foot'], 'px, min changed pixels between frame 1 and 3 =', worst['f13'])
json.dump(out, open('src/data/stand_align.json', 'w'), indent=1)
