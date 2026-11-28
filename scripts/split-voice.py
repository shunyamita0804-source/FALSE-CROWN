#!/usr/bin/env python3
"""1 競技分を 1 本にまとめた説明の声を、説明ごとに区切る（2026-11-28 本人の指示「1競技分の説明を一つの音声ファイルに」）。
使い方: python3 -I scripts/split-voice.py m08
- 対応表 docs/voice/<競技>_segments.csv（段階 ID、開始秒、終了秒、字幕）を読み、
  元の音声 resources/voice_original/<競技>.mp3 を、その区間ごとに public/assets/audio/voice/gm/<競技>/NN_<段階>.mp3 へ切り出す。
- 切り出しは再圧縮しない（ffmpeg の -c copy。音そのものは変えない）。
- src/data/tutorial_voice.json の matches.<競技>.steps を、対応表の順に書き直す（fits は残す）。大きさは、そのあと scripts/level-voices.py で揃える。
"""
import csv, json, os, subprocess, sys

def main():
    mid = sys.argv[1]
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    rows = list(csv.DictReader(open(os.path.join(root, 'docs', 'voice', f'{mid}_segments.csv'), encoding='utf-8')))
    src = os.path.join(root, 'resources', 'voice_original', f'{mid}.mp3')
    out_dir = os.path.join(root, 'public', 'assets', 'audio', 'voice', 'gm', mid)
    os.makedirs(out_dir, exist_ok=True)
    tpath = os.path.join(root, 'src', 'data', 'tutorial_voice.json')
    tv = json.load(open(tpath, encoding='utf-8'))
    old = tv['matches'].get(mid, {}).get('steps', {})
    steps = {}
    for i, r in enumerate(rows):
        sid = r['step']
        name = f'{i + 1:02d}_{sid}.mp3'
        a, b = float(r['start']), float(r['end'])
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{a:.2f}', '-to', f'{b:.2f}', '-i', src, '-c', 'copy', os.path.join(out_dir, name)], check=True)
        s = {'file': name, 'text': r['text'], 'gain': 1.0, 'lufs': 0, 'from': a, 'to': b}
        if old.get(sid, {}).get('fits'): s['fits'] = old[sid]['fits']
        steps[sid] = s
    m = tv['matches'].setdefault(mid, {'dir': f'audio/voice/gm/{mid}', 'slots': {}})
    m['dir'] = f'audio/voice/gm/{mid}'
    m['source'] = f'resources/voice_original/{mid}.mp3（区間は docs/voice/{mid}_segments.csv）'
    m['steps'] = steps
    m.setdefault('slots', {})
    json.dump(tv, open(tpath, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(f'{mid}: {len(steps)} 区間を切り出しました')

main()
