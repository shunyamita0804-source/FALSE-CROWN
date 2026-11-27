#!/usr/bin/env python3
"""全員のボイスの聞こえる大きさを揃える（2026-11-28 本人の指示「NPCの声はみんな同じくらいの音量に」）。
使い方: python3 -I scripts/level-voices.py
- src/data/voice.json にある全部の音源の大きさ（ラウドネス、LUFS）を測り、再生時の倍率 gain を、全員が TARGET に揃うように書き込む
- 音源そのものは加工しない（倍率は再生の時にかける）。倍率で山が 0 dB を超える分は、再生側の音割れ防止（src/audio/audio.ts）で抑える
"""
import json, os, re, subprocess

TARGET = -19.0
LO, HI = 0.25, 3.0

def measure(p):
    out = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', p, '-af', 'ebur128', '-f', 'null', '-'], capture_output=True, text=True).stderr
    return float(re.findall(r'I:\s+(-?[\d.]+) LUFS', out)[-1])

def main():
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    path = os.path.join(root, 'src', 'data', 'voice.json')
    data = json.load(open(path, encoding='utf-8'))
    data['loudness'] = {'target': TARGET, 'note': '聞こえる大きさ（LUFS）を測り、全員が target に揃う倍率を gain に入れている（scripts/level-voices.py）'}
    n = 0
    for cid, c in data['characters'].items():
        for grp in ('clips', 'extra'):
            for clip in c.get(grp, {}).values():
                lufs = measure(os.path.join(root, 'public', 'assets', c['dir'], clip['file']))
                clip['lufs'] = round(lufs, 1)
                clip['gain'] = round(max(LO, min(HI, 10 ** ((TARGET - lufs) / 20))), 3)
                n += 1
    json.dump(data, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(f'{n} 点の大きさを {TARGET} LUFS に揃えました')

if __name__ == '__main__':
    main()
