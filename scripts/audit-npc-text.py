"""
参加者（NPC）の改名・再設定に向けて、名前や経歴に触れている文章を洗い出す。
使い方：python3 -I scripts/audit-npc-text.py [出力先フォルダ]
出力：npc_text_audit.csv（1 行 1 文。どの人の、どのファイルの、どの文か、何に触れているか）
名前は src/data/npc_names.json の表示名で探す（改名後に流しても、新しい名前の直書きを探せる）。
経歴の言葉は下の BACKGROUND と JAPAN_SPECIFIC に書く（設定を変えたら直す）。
"""
import csv, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'docs')
def rd(p): return open(os.path.join(ROOT, p), encoding='utf-8').read()
def js(p): return json.loads(rd(p))

NAMES = js('src/data/npc_names.json')['characters']
IDS = list(NAMES)
SHORT = {i: NAMES[i]['ja']['short'] for i in IDS}
FULL = {i: NAMES[i]['ja']['name'] for i in IDS}
# 改名前の名前（previous）も探す（旧名の残りを見つけるため）
OLD = {i: NAMES[i].get('previous', {}) for i in IDS}

# 人ごとの経歴（職業・秘密）に結びつく言葉。職業や秘密を変えると、書き直しが要る文
BACKGROUND = {
  'npc_02_kanzaki': ['数学', '数理', '計算', '期待値', '確率', 'モデル', '変数', '証明', '均衡', '定理', '方程式'],
  'npc_03_kurose': ['弁護', '条文', '契約', '署名', '書面', '証言', '判決', '上訴', '法廷', '条約', '委任', '被害'],
  'npc_04_mido': ['経営', '会社', '出資', '投資', '社長', '料理人', '部下', '商売', '市場'],
  'npc_05_shiraishi': ['心理', '研究', '実験', '観察', '被験', '論文', '裏切りの'],
  'npc_06_kiryu': ['ゲーマー', 'プロ', '配信', 'ランク', 'チーム', '練習', '過去の大会', 'ゲーム資料'],
  'npc_07_tachibana': ['医師', '医者', '患者', '診療', '診察', '担当医', '薬', '病', '怪我', '眠', '食べ'],
  'npc_08_dojima': ['刑事', '捜査', '事件', '失踪', '行方', '現場', '張り込み', '聞き込み', '署', '警察', '犯人'],
  'npc_09_asahina': ['大学生', '大学', '授業', 'お兄ちゃん', '兄', '家族', '覚え'],
  'npc_10_kujo': ['ギャンブ', '雀', '卓', '賭け', '賭', 'ブラフ', '牌', '勝負師', 'カード', '配当', 'ディーラー'],
  'npc_11_kisaragi': ['女優', '俳優', '演技', '舞台', '役者', '台本', '観客', '芝居', 'カメラ', '依頼'],
  'npc_12_kuze': ['教授', '教鞭', '大学', '学生', '書物', '講義', '研究', '様式', '建物', '若い人', '創設'],
}
# 日本に固有の物事（世界観を日本から離す時に、名前以外で直す所）
JAPAN_SPECIFIC = ['雀士', '麻雀', '雀', '卓を囲', '億', '将棋', '囲碁', '花札', '円', '神社', '畳', '着物', '浴衣', '弁当', '味噌', '温泉', '正月', '先輩', '後輩', 'お兄ちゃん', 'ちゃん付け', '漢字', 'ふりがな']

rows = []
def add(npc, src, key, text, voiced=''):
    rows.append({'npc': npc, 'source': src, 'key': key, 'text': text, 'voiced': voiced})

# 会話（仕様 v03 の台詞）
for e in js('src/data/dialogue.json')['entries']:
    add(e['npcId'], 'src/data/dialogue.json', e['id'], e['text'])
# 補助台詞
lines = rd('src/npc/lines.ts')
cur = None
for ln in lines.split('\n'):
    m = re.match(r'\s*(npc_\d\d_\w+): \{', ln)
    if m: cur = m.group(1); continue
    if cur and re.match(r'\s*\},?\s*$', ln): cur = None; continue
    if cur:
        for km in re.finditer(r"(\w+): \[([^\]]*)\]", ln):
            for i, tm in enumerate(re.finditer(r"'([^']*)'", km.group(2))):
                add(cur, 'src/npc/lines.ts', f'{cur}.{km.group(1)}.{i+1}', tm.group(1))
# 物語の出来事
for ev in js('src/data/story_events.json').get('events', []):
    for i, l in enumerate(ev.get('lines', [])):
        if str(l.get('speaker', '')).startswith('npc_'):
            add(l['speaker'], 'src/data/story_events.json', f"{ev['id']}.{i+1}", l['text'])
# 開会式（話す人は src/ui/ceremony.ts、文は locales）
ui = js('src/locales/ja/ui.json')
for m in re.finditer(r"who: '(npc_\w+)', text: t\('([^']+)'\)", rd('src/ui/ceremony.ts')):
    add(m.group(1), 'src/locales/ja/ui.json（開会式）', m.group(2), ui.get(m.group(2), ''))
# 音声の台本（字幕と一致させる文）
vo = js('src/data/voice.json')['characters']
for cid, c in vo.items():
    for k, v in list(c.get('clips', {}).items()) + list(c.get('extra', {}).items()):
        add(cid, 'src/data/voice.json（音声）', f"{cid}.{k}（{c['dir']}/{v['file']}）", v.get('text', ''), 'yes')
# 自己紹介の仮字幕
for cid, v in js('src/data/introductions.json')['entries'].items():
    if cid.startswith('npc_'): add(cid, 'src/data/introductions.json', cid, v['text'])
# 手帳・裏ゲームの資料
hd = rd('src/story/hiddendata.ts')
for m in re.finditer(r"\{ id: '(E\d\d)', person: '(npc_\w+)', subject: '([^']+)', text: '([^']+)' \}", hd):
    add(m.group(2), 'src/story/hiddendata.ts（手帳の資料）', m.group(1), m.group(4))
# 人物の設定（名簿・関係一覧・図鑑に出る）
ch = rd('src/data/characters.ts')
for m in re.finditer(r"id: '(npc_\w+)', gender: '(\w)', age: (\d+), job: '([^']+)'.*?profile: '([^']+)',\s*secret: '([^']+)'", ch, re.S):
    add(m.group(1), 'src/data/characters.ts', f'{m.group(1)}.job', m.group(4))
    add(m.group(1), 'src/data/characters.ts', f'{m.group(1)}.profile', m.group(5))
    add(m.group(1), 'src/data/characters.ts', f'{m.group(1)}.secret', m.group(6))
for p in js('src/data/npc_profiles.json')['profiles']:
    add(p['id'], 'src/data/npc_profiles.json', f"{p['id']}.goal", p.get('goal', ''))

def flags(r):
    t = r['text']; f = []
    names = [w for i in IDS for w in (FULL[i].replace(' ', ''), FULL[i], SHORT[i], OLD[i].get('name', '').replace(' ', ''), OLD[i].get('short', '')) if w and w in t]
    if names: f.append('名前:' + '・'.join(sorted(set(names), key=names.index)))
    elif re.search(r'\{(name|short|kana):', t): f.append('名前:差し込み（表から自動）')
    jp = [w for w in JAPAN_SPECIFIC if w in t]
    if jp: f.append('日本固有:' + '・'.join(jp))
    bg = [w for w in BACKGROUND.get(r['npc'], []) if w in t]
    if bg: f.append('経歴:' + '・'.join(bg))
    return f

os.makedirs(OUT, exist_ok=True)
path = os.path.join(OUT, 'npc_text_audit.csv')
with open(path, 'w', encoding='utf-8-sig', newline='') as fp:
    w = csv.writer(fp)
    w.writerow(['内部ID', '名前', 'ファイル', '場所', '音声あり', '名前', '日本固有', '経歴（職業・秘密）', '文'])
    n = {'名前': 0, '日本固有': 0, '経歴': 0}
    for r in rows:
        f = flags(r)
        col = {k: next((x.split(':', 1)[1] for x in f if x.startswith(k)), '') for k in n}
        for k in n:
            if col[k]: n[k] += 1
        w.writerow([r['npc'], FULL.get(r['npc'], ''), r['source'], r['key'], r['voiced'], col['名前'], col['日本固有'], col['経歴'], r['text']])
print(f'{len(rows)} 文 → {path}')
print('、'.join(f'{k} {v} 文' for k, v in n.items()))

# ---- 音声の録り直しの判定 ----
# 名乗っている（spokenName がある）声は、改名すれば必ず録り直し。
# 職業・経歴を変える時だけ要る声と、聞き直しが要る声は、下の表に手で書く（台詞を読んで決めた）。
JOB_REQUIRED = {('npc_11_kisaragi', 'betrayal'): '「女優の私が」と職業を言う'}
JOB_REVIEW = {
  ('npc_02_kanzaki', 'defeat'): '「計算が甘かった」（数学者らしい言い方）',
  ('npc_05_shiraishi', 'victory'): '「皆さんの考えていることが分かった」（心理学者らしい言い方）',
  ('npc_08_dojima', 'victory'): '「長年の経験も」（元刑事の年季）',
  ('npc_08_dojima', 'betrayal'): '「人を見る目が鈍った」（元刑事らしい言い方）',
  ('npc_12_kuze', 'victory'): '「私の仮説は」（学者らしい言い方）',
}
# 自己紹介の書き直しの注意
INTRO_NOTE = {'npc_12_kuze': '元大学教授（退職済み）に統一。新しい自己紹介は過去形（例「大学で教鞭を執っておりました」）'}
# 本人の予定（2026-11-28）：この 4 人は声そのものを作り直し、15 種すべてを新規収録。残り 7 人は今の声を使い続け、自己紹介だけ録り直す。
# 職業・能力・関係・秘密は今の設定を引き継ぐ。新しい名前は npc_names.json（2026-11-28 確定）。
NEW_VOICE = {'npc_02_kanzaki', 'npc_03_kurose', 'npc_07_tachibana', 'npc_08_dojima'}
vpath = os.path.join(OUT, 'voice_rerecord.csv')
cnt = {}
with open(vpath, 'w', encoding='utf-8-sig', newline='') as fp:
    w = csv.writer(fp)
    w.writerow(['内部ID', '旧名', '新しい名前', '音声ファイル', '種類', '台詞', '今回の予定', '改名で録り直し', '職業・経歴を変える時', '理由'])
    for cid, c in vo.items():
        for k, v in list(c.get('clips', {}).items()) + list(c.get('extra', {}).items()):
            text = v.get('text', '')
            rename = '要' if v.get('spokenName') else '不要'
            if v.get('spokenName'):
                job, why = '要', f"名前「{v['spokenName']}」を名乗る（職業も言う）"
            elif (cid, k) in JOB_REQUIRED:
                job, why = '要', JOB_REQUIRED[(cid, k)]
            elif (cid, k) in JOB_REVIEW:
                job, why = '聞き直し', JOB_REVIEW[(cid, k)]
            elif '未確認' in text:
                job, why = '不要', '新規収録で置き換えるので確認不要（本人、2026-11-28）'
            else:
                job, why = '不要', ''
            if cid in NEW_VOICE: plan = '新規収録（声を作り直す）'
            elif v.get('spokenName') and re.sub(r'[\s・]+', '', v['spokenName']) == re.sub(r'[\s・]+', '', FULL.get(cid, '')): plan = '録り直し済み（新しい名前の自己紹介、2026-11-28 受領）'
            elif v.get('spokenName'): plan = '録り直し（新しい名前の自己紹介）' + (f'。{INTRO_NOTE[cid]}' if cid in INTRO_NOTE else '')
            else: plan = '今の声を使い続ける'
            cnt[plan] = cnt.get(plan, 0) + 1
            w.writerow([cid, OLD.get(cid, {}).get('name', ''), FULL.get(cid, ''), f"{c['dir']}/{v['file']}", k, text, plan, rename, job, why])
print('音声：' + '、'.join(f'{k} {v} 本' for k, v in cnt.items()) + f' → {vpath}')
