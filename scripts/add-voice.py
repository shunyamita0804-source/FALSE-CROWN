#!/usr/bin/env python3
"""汎用ボイスの納品物を取り込む。
使い方: python3 -I scripts/add-voice.py <展開したフォルダ> <キャラクター ID>
- フォルダ内の管理表（CSV）と MP3 10 点を照合し、public/assets/audio/voice/<ID>/ へ無加工で複写する
- src/data/voice.json に、ファイル名、台詞、再生時の音量補正（0.7〜1.4）を書き込む
- 管理表と音源が合わない時は、何も書き込まずに終了する
- 追加ボイス（11〜15：自己紹介、勝利、敗北、脱落、裏切り）の納品物は、登録済みのキャラクターの extra に足す（既存の 10 点は変えない）
"""
import csv, glob, json, os, re, shutil, subprocess, sys

EXTRA = ['introduction', 'victory', 'defeat', 'elimination', 'betrayal']
ALIAS = {'intro': 'introduction'}
BASIC = ['greeting', 'hello', 'understand', 'accept', 'refuse', 'thinking', 'surprise', 'happy', 'disappointed', 'thanks']

def main():
    src, cid = sys.argv[1], sys.argv[2]
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    csvs = glob.glob(os.path.join(src, '**', '*.csv'), recursive=True)
    if len(csvs) != 1:
        sys.exit(f'管理表（CSV）が 1 つではありません: {csvs}')
    base = os.path.dirname(csvs[0])
    rows = list(csv.DictReader(open(csvs[0], encoding='utf-8-sig')))
    fkey = next((k for k in rows[0] if k in ('file', 'filename')), None)
    tkey = next((k for k in rows[0] if k in ('text', 'dialogue', 'line')), None)
    if not fkey or not tkey:
        sys.exit(f'管理表の列名が分かりません: {list(rows[0])}')
    addon = all(ALIAS.get(re.sub(r'^\d+_', '', r[fkey].strip()[:-4]), re.sub(r'^\d+_', '', r[fkey].strip()[:-4])) in EXTRA for r in rows)
    CATS = EXTRA if addon else BASIC
    clips, problems = {}, []
    for r in rows:
        f = r[fkey].strip()
        cat = re.sub(r'^\d+_', '', f[:-4])
        cat = ALIAS.get(cat, cat)
        p = os.path.join(base, f)
        if cat not in CATS: problems.append(f'分類が不明: {f}'); continue
        if not os.path.exists(p): problems.append(f'音源が無い: {f}'); continue
        out = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', p, '-af', 'volumedetect', '-f', 'null', '-'], capture_output=True, text=True).stderr
        m1, m2 = re.search(r'mean_volume: (-?[\d.]+)', out), re.search(r'max_volume: (-?[\d.]+)', out)
        dur = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p], capture_output=True, text=True).stdout.strip()
        if not m1 or not dur: problems.append(f'音声として読めない: {f}'); continue
        mean, mx = float(m1.group(1)), float(m2.group(1))
        gain = max(0.7, min(1.4, 10 ** ((-19 - mean) / 20), 10 ** (-mx / 20) * 0.97))
        clips[cat] = {'file': f, 'text': r[tkey].strip(), 'gain': round(gain, 2), '_src': p, '_dur': float(dur)}
    extra = sorted(set(os.path.basename(x) for x in glob.glob(os.path.join(base, '*.mp3'))) - set(c['file'] for c in clips.values()))
    if extra: problems.append(f'管理表に無い音源: {extra}')
    missing = [c for c in CATS if c not in clips]
    if missing: problems.append(f'足りない分類: {missing}')
    if problems:
        sys.exit('取り込みを中止しました。\n' + '\n'.join(problems))
    dst = os.path.join(root, 'public', 'assets', 'audio', 'voice', cid)
    os.makedirs(dst, exist_ok=True)
    for cat in CATS:
        c = clips[cat]
        shutil.copyfile(c.pop('_src'), os.path.join(dst, c['file']))
        print(f"{c['file']:22s} {c.pop('_dur'):.2f}s gain {c['gain']:.2f}  {c['text']}")
    path = os.path.join(root, 'src', 'data', 'voice.json')
    data = json.load(open(path, encoding='utf-8'))
    if addon:
        if cid not in data['characters']:
            sys.exit(f'{cid} の基本ボイスが未登録です')
        data['characters'][cid]['extra'] = {cat: clips[cat] for cat in CATS}
    else:
        keep = data['characters'].get(cid, {}).get('extra')
        data['characters'][cid] = {'dir': f'audio/voice/{cid}', 'clips': {cat: clips[cat] for cat in CATS}}
        if keep: data['characters'][cid]['extra'] = keep
    json.dump(data, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(f'{cid}: {len(CATS)} 点を取り込みました')
    subprocess.run(['python3', '-I', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'level-voices.py')], check=True)

main()
