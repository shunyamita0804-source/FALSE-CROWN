#!/usr/bin/env python3
"""BGM の聞こえる大きさを揃え、声より小さく鳴るようにする（2026-11-28 本人の指示「BGM がでかい、ボイスが小さい」）。
使い方: python3 -I scripts/level-bgm.py
- src/data/bgm.json の各場面の曲の大きさ（LUFS、曲全体）を測り、TARGET に揃う再生時の倍率 gain を書き込む
- 声は -19 LUFS に揃えてある（scripts/level-voices.py）。BGM はそれより 4 LU 小さい -23 LUFS に揃える
- 音源そのものは加工しない（倍率は再生の時にかける）
"""
import json, os, re, subprocess

TARGET = -23.0
LO, HI = 0.08, 1.6

def measure(p):
    out = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', p, '-af', 'ebur128', '-f', 'null', '-'], capture_output=True, text=True).stderr
    return float(re.findall(r'I:\s+(-?[\d.]+) LUFS', out)[-1])

def main():
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    path = os.path.join(root, 'src', 'data', 'bgm.json')
    data = json.load(open(path, encoding='utf-8'))
    cache = {}
    for sid, sc in data['scenes'].items():
        if not sc.get('file'):
            continue
        f = sc['file']
        if f not in cache:
            cache[f] = measure(os.path.join(root, 'public', 'assets', 'audio', 'bgm', f))
        lufs = cache[f]
        sc['lufs'] = round(lufs, 1)
        sc['gain'] = round(max(LO, min(HI, 10 ** ((TARGET - lufs) / 20))), 3)
        print(f'{sid:13s} {f:32s} {lufs:6.1f} LUFS  gain {sc["gain"]}')
    data['loudness'] = {'target': TARGET, 'note': '曲全体の大きさ（LUFS）を測り、全曲が target に揃う倍率を gain に入れている（scripts/level-bgm.py）。声（-19 LUFS）より小さく鳴る。'}
    json.dump(data, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    open(path, 'a', encoding='utf-8').write('\n')

main()
