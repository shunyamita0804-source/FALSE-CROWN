/**
 * NPC の台詞。判断はロジック側で先に確定し、その結果に対応する場面キーの台詞だけを選ぶ。
 * 主データは仕様 v03 の 03_DIALOGUE.json（11人×47件＝517件）。そこに無い場面は補助台詞（EXTRA）を使う。
 * 同じ NPC・場面で直近 3 件は避ける。secret は解放条件を満たした時だけ呼び出し側が指定する。
 */
import dialogue from '../data/dialogue.json';
import type { NpcId } from '../data/characters';
import { Rng } from '../core/rng';
import type { GameState } from '../core/types';

export type DialogueEvent =
  | 'greeting' | 'alliance_offer' | 'accept' | 'reject_price' | 'reject_principle' | 'counter' | 'info_offer' | 'trust_high' | 'trust_low'
  | 'betrayal_observed' | 'main_win' | 'main_low' | 'prison_before' | 'prison_survive' | 'eliminated' | 'secret' | 'npc_trade' | 'investigate'
  | 'loan_request' | 'repay_refused' | 'gift_received' | 'promise_fulfilled' | 'report_received' | 'plan_request' | 'success_payment'
  | 'day_end' | 'final_before' | 'subgame_invite' | 'hidden_invite' | 'info_uncertain' | 'exit' | 'timeout';

export type ExtraKey = 'smalltalk' | 'propose_nap' | 'pledge_offer' | 'pledge_ok' | 'tip_give' | 'tip_again' | 'tip_refuse' | 'tip_thanks' | 'hint_yes' | 'hint_no' | 'hint_vague' | 'consult_yes' | 'consult_no' | 'stage_good' | 'stage_bad' | 'coop_cancel' | 'greetWary' | 'refuse' | 'accuseBelieve' | 'accuseDoubt' | 'noInfo' | 'busy' | 'toPrison';
export type LineKey = DialogueEvent | ExtraKey;

interface Entry { id: string; npcId: string; event: string; text: string; condition: Record<string, unknown> }
const ENTRIES = (dialogue as { entries: Entry[] }).entries;
const TABLE = new Map<string, Entry[]>();
for (const e of ENTRIES) {
  const k = `${e.npcId}:${e.event}`;
  if (!TABLE.has(k)) TABLE.set(k, []);
  TABLE.get(k)!.push(e);
}
export const DIALOGUE_COUNT = ENTRIES.length;

type Lines = Record<ExtraKey, string[]>;
const base: Lines = {
  smalltalk: ['今日の競技、どう思う？'], propose_nap: ['互いに手を出さない。それだけ約束しないか。'], greetWary: ['……何の用？'],
  refuse: ['それは断る。'], accuseBelieve: ['……覚えておく。'], accuseDoubt: ['根拠のない話は信じない。'], noInfo: ['今、話せることはない。'],
  busy: ['今は手が離せない。'], toPrison: ['……監獄か。'],
  // 生活中の緩い約束（2026-11-28）
  pledge_offer: ['次のゲーム、同じ場になったら協力しない？', '何が出るかは分からないけど、そのときは組めたらいいな。'],
  pledge_ok: ['うん、次は協力しよう。中身はルールを聞いてから決めよう。', 'いいよ。どんな競技か分かったら、また話そう。'],
  // 作戦時間（ルール説明の後）
  tip_give: ['私のやり方でよければ、教えるよ。'], tip_again: ['それはさっき話したよ。'], tip_refuse: ['自分のやり方は、まだ人に話したくない。', '悪いけど、そこは自分で見つけて。'],
  tip_thanks: ['なるほど、参考にする。'],
  hint_yes: ['ああ、ヒントは買うつもり。'], hint_no: ['ヒントは買わない。自分の力で解く。'], hint_vague: ['さあ、どうだろうね。', 'それは秘密にしておく。'],
  consult_yes: ['いいよ。相談室で話そう。'], consult_no: ['今はやめておく。', 'ごめん、先に話す相手がいる。'],
  stage_good: ['今のは間に合った。いい流れだ。'], stage_bad: ['今のは間に合わなかった。次で取り返す。'],
  coop_cancel: ['……そう。分かった。'],
};

const L: Record<NpcId, Partial<Lines>> = {
  npc_02_kanzaki: {
    pledge_offer: ['次の競技で同じ場になったら、組む価値があるか検討しよう。'],
    greetWary: ['君と話す期待値は低い。手短に。'],
    smalltalk: ['この大会の報酬設計は興味深い。協力と裏切りの均衡点が毎日ずれる。', '12人から毎日1人。単純な減算だが、人の判断はそう単純じゃない。', '朝は図書室が静かでいい。考えごとに向いている。', '食堂のコーヒーは悪くない。頭を使う前に一杯飲むことにしている。', '君は直感派か、計算派か。組む相手の型は知っておきたい。'],
    refuse: ['非合理だ。断る。'],
    propose_nap: ['互いに攻撃しない方が損失が小さい。不可侵を提案する。'],
    noInfo: ['共有に値する情報は持っていない。'], accuseBelieve: ['辻褄は合う。確率を更新しておく。'], accuseDoubt: ['証拠がない。その主張は採用できない。'],
    toPrison: ['……計算外だ。だが、まだ終わっていない。'],
  },
  npc_03_kurose: {
    pledge_offer: ['次の競技で協力しましょう。条件は、ルールを聞いてから決める約束で。'],
    greetWary: ['……あなたの言葉は、一度書面にしたい気分ね。'],
    smalltalk: ['この大会の規則、条文としては穴だらけよ。だからこそ読み甲斐があるけれど。', '「禁止されていないこと」は、すべて許されているの。覚えておいて。', 'ここの紅茶、葉がいいわね。休憩の質は判断の質に直結するのよ。', '約束は口頭でも約束。私は覚えている方よ。', '休廷中みたいなものね、自由時間って。少し肩の力を抜きましょう。'],
    refuse: ['その条件では署名できないわ。'],
    propose_nap: ['不可侵条約を提案するわ。互いに損はないはず。'],
    noInfo: ['今お話しできることはないわ。'], accuseBelieve: ['……証言として記録しておくわ。'], accuseDoubt: ['伝聞は証拠にならないわ。'],
    toPrison: ['判決には従うわ。上訴の手段は、まだあるもの。'],
  },
  npc_04_mido: {
    pledge_offer: ['次の勝負、私の側に付く気はないか。中身は後で詰めればいい。'],
    greetWary: ['お前のような奴に貸す耳はないが……金次第だな。'],
    smalltalk: ['ピースを持つ者が場を支配する。大会も経営も同じだ。', '人は恩ではなく利益で動く。覚えておけ。', 'ここの食事は悪くない。料理人の腕は確かだ。', '十億か。使い道はもう決めてある。お前はどうだ。', '若いのに度胸があるな。うちの会社に欲しいくらいだ。'],
    refuse: ['話にならん。'],
    propose_nap: ['互いに潰し合うのは無駄だ。手を出すな、私も出さん。'],
    noInfo: ['タダで教える話はない。'], accuseBelieve: ['ほう……使える話だ。'], accuseDoubt: ['証拠もなしに人を動かせると思うな。'],
    toPrison: ['この私が監獄だと……！ 覚えていろ。'],
  },
  npc_05_shiraishi: {
    pledge_offer: ['ねえ、次のゲームで一緒になったら、協力しようよ。'],
    greetWary: ['……あなた、嘘をつくとき瞬きが増えますよね。'],
    smalltalk: ['人が裏切る瞬間って、表情が少しだけ穏やかになるんですよ。知ってました？', 'みんな緊張してますね。私は……わくわくしてます。', '庭園、もう行きました？ 人間観察にちょうどいいベンチがあるんです。', 'あなた、嘘をつくとき左を見る癖がありますね。……冗談です。', '甘いもの、好きですか？ 食堂の焼き菓子がおいしいんですよ。'],
    refuse: ['うーん、ごめんなさい。'],
    propose_nap: ['お互い、攻撃しないって約束しません？'],
    noInfo: ['今は内緒です。'], accuseBelieve: ['へえ……興味深いですね。'], accuseDoubt: ['それ、あなたの願望じゃないですか？'],
    toPrison: ['あら、監獄。そちら側も観察してみたかったんです。'],
  },
  npc_06_kiryu: {
    pledge_offer: ['次の勝負、同じ卓なら組もうぜ。作戦はルールを見てからだ。'],
    greetWary: ['……お前、信用できねえんだよな。'],
    smalltalk: ['どんなゲームにも定石がある。見つけた奴が勝つ。', '負けるのが一番嫌いなんだ。だから勝つまでやる。', '遊戯室、見た？ あとで一局やろうぜ。', '昨日ほとんど寝てない。ルールを考えてたら朝だった。', '大会って、始まる前のこの感じが一番好きなんだよな。'],
    refuse: ['悪いけどパス。'],
    propose_nap: ['お互い攻めない。シンプルにいこう。'],
    noInfo: ['今は特にないな。'], accuseBelieve: ['マジか……覚えとく。'], accuseDoubt: ['証拠もなしに仲間を疑えるかよ。'],
    toPrison: ['くそっ……！ 次は絶対に取り返す。'],
  },
  npc_07_tachibana: {
    pledge_offer: ['次の競技、一緒になったら助け合いませんか。'],
    greetWary: ['……あなたのやり方は、好きになれないわ。'],
    smalltalk: ['ちゃんと食べて、ちゃんと眠ること。勝負はそれからです。', '皆さん顔色はいいみたい。少し安心しました。', '食堂のスープ、やさしい味でしたよ。おすすめです。', '緊張したら、ゆっくり息を吐いてみてください。意外と効きますから。', '競い合う相手でも、挨拶くらいは笑顔でしたいですね。'],
    refuse: ['ごめんなさい。それはできないわ。'],
    propose_nap: ['お互いを傷つけない。それだけ約束して。'],
    noInfo: ['今は特にないわ。'], accuseBelieve: ['そんな……でも、注意しておくわ。'], accuseDoubt: ['人を悪く言う話を、簡単には信じないわ。'],
    toPrison: ['……大丈夫。まだ終わりじゃないわ。'],
  },
  npc_08_dojima: {
    pledge_offer: ['次の競技で一緒になったら、手を貸してくれないか。'],
    greetWary: ['お前の動きは見ている。妙な真似はするな。'],
    smalltalk: ['人の話は最後まで聞く。癖みたいなもんだ。', '相手の言葉より、手元を見ろ。嘘はだいたいそこに出る。', '朝は走らんと調子が出ない。廊下を何往復かしてきた。', 'ここの飯はうまい。張り込みの弁当とは大違いだ。', '組むなら、裏切らん奴がいい。お前はどうだ。'],
    refuse: ['断る。'],
    propose_nap: ['互いに干渉しない。それでどうだ。'],
    noInfo: ['まだ裏が取れていない。'], accuseBelieve: ['……裏を取ってみる価値はあるな。'], accuseDoubt: ['証拠のない告発は、ただの中傷だ。'],
    toPrison: ['……地下か。調べる手間が省けた。'],
  },
  npc_09_asahina: {
    pledge_offer: ['次のゲーム、一緒だったら協力しようね。'],
    greetWary: ['……あの、この前の話、私ぜんぶ覚えてますからね。'],
    smalltalk: ['食堂のメニュー、昨日と一品だけ違うんです。気づきました？', 'みんなの名前と顔、もう全部覚えましたよ！', '展望室、夜は星がきれいなんですって。あとで行ってみませんか。', '十億円あったら何します？ わたしはまず学費かなあ。', '緊張するけど、ちょっと修学旅行みたいで楽しいです。'],
    refuse: ['ごめんなさい、それはちょっと……。'],
    propose_nap: ['お互い攻撃しないって、約束しませんか？'],
    noInfo: ['今は新しい話、ないです。'], accuseBelieve: ['えっ、本当ですか……覚えておきます。'], accuseDoubt: ['それ、前に聞いた話と違います。'],
    toPrison: ['う、うそ……監獄……？'],
  },
  npc_10_kujo: {
    pledge_offer: ['次の勝負、同じ場なら一口乗らないか。'],
    greetWary: ['……お前の手は読めてる。'],
    smalltalk: ['勝負は配られた札じゃない。相手にどう見せるかだ。', '運は平等だ。違うのは、張り方と降り方だけさ。', '遊戯室の卓、なかなかいい造りだ。あとで一勝負どうだ。', '食堂の酒はうまいが、勝負の前は飲まねえ。それが流儀でな。', 'お前、顔に出るタイプだな。直しておけよ。'],
    refuse: ['降りる。'],
    propose_nap: ['お互い見逃す。悪くない手だろう。'],
    noInfo: ['今は伏せておく。'], accuseBelieve: ['へえ……面白い札だ。'], accuseDoubt: ['その話、ブラフだろう。'],
    toPrison: ['へっ……裏目に出たか。'],
  },
  npc_11_kisaragi: {
    pledge_offer: ['次の舞台、同じなら共演しましょう？'],
    greetWary: ['……あなた、舞台に上がる資格があるのかしら。'],
    smalltalk: ['ここは舞台よ。誰もが役を演じている。あなたの役は何？', '本当の顔なんて、誰にも見せるものじゃないわ。', 'ラウンジの照明、顔がきれいに見えるの。気に入ったわ。', '台本のない芝居って、こんなに楽しいのね。', '観客がいると思って振る舞うの。そうすると背筋が伸びるでしょう？'],
    refuse: ['お断りよ。'],
    propose_nap: ['互いの邪魔はしない。大人の約束よ。'],
    noInfo: ['今は秘密。'], accuseBelieve: ['まあ……面白い筋書きね。'], accuseDoubt: ['その話、演技が下手よ。'],
    toPrison: ['……こんな役、聞いていないわ。'],
  },
  npc_12_kuze: {
    pledge_offer: ['次の競技で一緒になったら、知恵を持ち寄ろうではないか。'],
    greetWary: ['……君の振る舞いは、少々危ういな。'],
    smalltalk: ['この館の様式は三つの時代が混ざっている。建て増しを重ねた証拠だよ。', '若い人と卓を囲むのは久しぶりでな。楽しませてもらっておる。', '図書室の蔵書はなかなかのものだ。古い棋譜まで揃っておる。', '勝ち負けも大事だが、よい勝負をしたいものじゃ。', 'お茶でもどうかな。考えごとには休憩が要る。'],
    refuse: ['それは遠慮しておこう。'],
    propose_nap: ['互いに手を出さぬ、という約束はどうかな。'],
    noInfo: ['今は語るべきことがない。'], accuseBelieve: ['ふむ……心に留めておこう。'], accuseDoubt: ['根拠なき断定は、学問の敵だよ。'],
    toPrison: ['……これも、巡り合わせか。'],
  },
};


function esc(s: string): string {
  return s.replace(/[<>&]/g, (c) => ({ '<': '＜', '>': '＞', '&': '＆' })[c] ?? c);
}

/**
 * 台詞を選ぶ。state を渡すと使用履歴（直近3件を避ける）を保存する。
 * {name} は相手の呼び名、{x} は可変部分（金額など）。
 */
export function say(state: GameState | null, id: NpcId, key: LineKey, vars: { name?: string; x?: string } = {}): string {
  const entries = TABLE.get(`${id}:${key}`);
  let pool: { id: string; text: string }[];
  if (entries?.length) pool = entries;
  else {
    const arr = L[id]?.[key as ExtraKey] ?? base[key as ExtraKey] ?? ['……。'];
    pool = arr.map((text, i) => ({ id: `${id}.${key}.x${i}`, text }));
  }
  let pick = pool[0];
  if (state) {
    const hk = `${id}:${key}`;
    const hist = (state.lineHist[hk] ??= []);
    const fresh = pool.filter((e) => !hist.includes(e.id));
    const cands = fresh.length ? fresh : pool;
    const rng = Rng.derive(state.seed, `line:${hk}:${state.counter++}`);
    pick = rng.pick(cands);
    hist.push(pick.id);
    while (hist.length > Math.min(3, pool.length - 1)) hist.shift();
  }
  return pick.text.replace('{name}', esc(vars.name ?? 'あなた')).replace('{x}', esc(vars.x ?? ''));
}

export function hasLine(id: NpcId, key: LineKey): boolean {
  return !!TABLE.get(`${id}:${key}`)?.length;
}
