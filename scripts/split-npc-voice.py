#!/usr/bin/env python3
"""参加者 1 人分の 15 種のセリフを 1 本にまとめた声を、セリフごとに区切る（2026-11-28 本人の指示、ヴィクター・ヨウコの新ボイス）。
使い方: python3 -I scripts/split-npc-voice.py npc_08_dojima
- 対応表 docs/voice/<内部ID>_lines.csv（key、file、声のある区間 voiced_from/voiced_to、切り出す区間 start/end、台本 text）を読み、
  元の音声 resources/voice_original/<内部ID>.mp3 を public/assets/audio/voice/<内部ID>/<file> へ切り出す。
- 区間は音声認識の結果を台本で束ねて決め、切れ目は前後のセリフとの無音の真ん中（語頭・語尾・息を切らない）。
- 切り出しは再圧縮しない（ffmpeg の -c copy）。
- src/data/voice.json のその人の text を台本に、自己紹介の spokenName をいまの名前（npc_names.json）にする。大きさは、そのあと scripts/level-voices.py で測って揃える。
"""
import csv, json, os, subprocess, sys

def main():
    cid = sys.argv[1]
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    rows = list(csv.DictReader(open(os.path.join(root, 'docs', 'voice', f'{cid}_lines.csv'), encoding='utf-8')))
    src = os.path.join(root, 'resources', 'voice_original', f'{cid}.mp3')
    vpath = os.path.join(root, 'src', 'data', 'voice.json')
    data = json.load(open(vpath, encoding='utf-8'))
    names = json.load(open(os.path.join(root, 'src', 'data', 'npc_names.json'), encoding='utf-8'))
    c = data['characters'][cid]
    out_dir = os.path.join(root, 'public', 'assets', c['dir'])
    clips = {**{k: ('clips', v) for k, v in c.get('clips', {}).items()}, **{k: ('extra', v) for k, v in c.get('extra', {}).items()}}
    for r in rows:
        grp, clip = clips[r['key']]
        if clip['file'] != r['file']: sys.exit(f"{r['key']}: ファイル名が voice.json（{clip['file']}）と違う")
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', r['start'], '-to', r['end'], '-i', src, '-c', 'copy', os.path.join(out_dir, r['file'])], check=True, stdin=subprocess.DEVNULL)
        clip['text'] = r['text']
        if 'spokenName' in clip: clip['spokenName'] = names['characters'][cid]['ja']['name']
    c['source'] = f'resources/voice_original/{cid}.mp3（区間は docs/voice/{cid}_lines.csv）'
    json.dump(data, open(vpath, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(f'{cid}: {len(rows)} 本を切り出しました')

main()
