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

export type ExtraKey = 'smalltalk' | 'propose_nap' | 'greetWary' | 'refuse' | 'accuseBelieve' | 'accuseDoubt' | 'noInfo' | 'busy' | 'toPrison';
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
  smalltalk: ['この施設、妙に静かだ。'], propose_nap: ['互いに手を出さない。それだけ約束しないか。'], greetWary: ['……何の用？'],
  refuse: ['それは断る。'], accuseBelieve: ['……覚えておく。'], accuseDoubt: ['根拠のない話は信じない。'], noInfo: ['今、話せることはない。'],
  busy: ['今は手が離せない。'], toPrison: ['……監獄か。'],
};

const L: Record<NpcId, Partial<Lines>> = {
  npc_02_kanzaki: {
    greetWary: ['君と話す期待値は低い。手短に。'],
    smalltalk: ['この大会の報酬設計は興味深い。協力と裏切りの均衡点が毎日ずれる。', '12人から毎日1人。単純な減算だが、人の判断はそう単純じゃない。'],
    refuse: ['非合理だ。断る。'],
    propose_nap: ['互いに攻撃しない方が損失が小さい。不可侵を提案する。'],
    noInfo: ['共有に値する情報は持っていない。'], accuseBelieve: ['辻褄は合う。確率を更新しておく。'], accuseDoubt: ['証拠がない。その主張は採用できない。'],
    toPrison: ['……計算外だ。だが、まだ終わっていない。'],
  },
  npc_03_kurose: {
    greetWary: ['……あなたの言葉は、一度書面にしたい気分ね。'],
    smalltalk: ['この大会の規則、条文としては穴だらけよ。だからこそ読み甲斐があるけれど。', '「禁止されていないこと」は、すべて許されているの。覚えておいて。'],
    refuse: ['その条件では署名できないわ。'],
    propose_nap: ['不可侵条約を提案するわ。互いに損はないはず。'],
    noInfo: ['今お話しできることはないわ。'], accuseBelieve: ['……証言として記録しておくわ。'], accuseDoubt: ['伝聞は証拠にならないわ。'],
    toPrison: ['判決には従うわ。上訴の手段は、まだあるもの。'],
  },
  npc_04_mido: {
    greetWary: ['お前のような奴に貸す耳はないが……金次第だな。'],
    smalltalk: ['ピースを持つ者が場を支配する。大会も経営も同じだ。', '人は恩ではなく利益で動く。覚えておけ。'],
    refuse: ['話にならん。'],
    propose_nap: ['互いに潰し合うのは無駄だ。手を出すな、私も出さん。'],
    noInfo: ['タダで教える話はない。'], accuseBelieve: ['ほう……使える話だ。'], accuseDoubt: ['証拠もなしに人を動かせると思うな。'],
    toPrison: ['この私が監獄だと……！ 覚えていろ。'],
  },
  npc_05_shiraishi: {
    greetWary: ['……あなた、嘘をつくとき瞬きが増えますよね。'],
    smalltalk: ['人が裏切る瞬間って、表情が少しだけ穏やかになるんですよ。知ってました？', 'みんな緊張してますね。私は……わくわくしてます。'],
    refuse: ['うーん、ごめんなさい。'],
    propose_nap: ['お互い、攻撃しないって約束しません？'],
    noInfo: ['今は内緒です。'], accuseBelieve: ['へえ……興味深いですね。'], accuseDoubt: ['それ、あなたの願望じゃないですか？'],
    toPrison: ['あら、監獄。そちら側も観察してみたかったんです。'],
  },
  npc_06_kiryu: {
    greetWary: ['……お前、信用できねえんだよな。'],
    smalltalk: ['どんなゲームにも定石がある。見つけた奴が勝つ。', '負けるのが一番嫌いなんだ。だから勝つまでやる。'],
    refuse: ['悪いけどパス。'],
    propose_nap: ['お互い攻めない。シンプルにいこう。'],
    noInfo: ['今は特にないな。'], accuseBelieve: ['マジか……覚えとく。'], accuseDoubt: ['証拠もなしに仲間を疑えるかよ。'],
    toPrison: ['くそっ……！ 次は絶対に取り返す。'],
  },
  npc_07_tachibana: {
    greetWary: ['……あなたのやり方は、好きになれないわ。'],
    smalltalk: ['誰かが毎日いなくなる。慣れてはいけないと思うの。', '脱落した人たちは、どこへ行くのかしら……。'],
    refuse: ['ごめんなさい。それはできないわ。'],
    propose_nap: ['お互いを傷つけない。それだけ約束して。'],
    noInfo: ['今は特にないわ。'], accuseBelieve: ['そんな……でも、注意しておくわ。'], accuseDoubt: ['人を悪く言う話を、簡単には信じないわ。'],
    toPrison: ['……大丈夫。まだ終わりじゃないわ。'],
  },
  npc_08_dojima: {
    greetWary: ['お前の動きは見ている。妙な真似はするな。'],
    smalltalk: ['この建物、図面と実際の広さが合わん。どこかに隠し部屋がある。', '消えた人間は、必ずどこかに痕跡を残す。'],
    refuse: ['断る。'],
    propose_nap: ['互いに干渉しない。それでどうだ。'],
    noInfo: ['まだ裏が取れていない。'], accuseBelieve: ['……裏を取ってみる価値はあるな。'], accuseDoubt: ['証拠のない告発は、ただの中傷だ。'],
    toPrison: ['……地下か。調べる手間が省けた。'],
  },
  npc_09_asahina: {
    greetWary: ['……あの、この前の話、私ぜんぶ覚えてますからね。'],
    smalltalk: ['食堂のメニュー、昨日と一品だけ違うんです。気づきました？', 'お兄ちゃんも、ここに来てたはずなんです……。'],
    refuse: ['ごめんなさい、それはちょっと……。'],
    propose_nap: ['お互い攻撃しないって、約束しませんか？'],
    noInfo: ['今は新しい話、ないです。'], accuseBelieve: ['えっ、本当ですか……覚えておきます。'], accuseDoubt: ['それ、前に聞いた話と違います。'],
    toPrison: ['う、うそ……監獄……？'],
  },
  npc_10_kujo: {
    greetWary: ['……お前の手は読めてる。'],
    smalltalk: ['勝負は配られた札じゃない。相手にどう見せるかだ。', 'ここは前より静かだ。……前？ 独り言だ、忘れろ。'],
    refuse: ['降りる。'],
    propose_nap: ['お互い見逃す。悪くない手だろう。'],
    noInfo: ['今は伏せておく。'], accuseBelieve: ['へえ……面白い札だ。'], accuseDoubt: ['その話、ブラフだろう。'],
    toPrison: ['へっ……裏目に出たか。'],
  },
  npc_11_kisaragi: {
    greetWary: ['……あなた、舞台に上がる資格があるのかしら。'],
    smalltalk: ['ここは舞台よ。誰もが役を演じている。あなたの役は何？', '本当の顔なんて、誰にも見せるものじゃないわ。'],
    refuse: ['お断りよ。'],
    propose_nap: ['互いの邪魔はしない。大人の約束よ。'],
    noInfo: ['今は秘密。'], accuseBelieve: ['まあ……面白い筋書きね。'], accuseDoubt: ['その話、演技が下手よ。'],
    toPrison: ['……こんな役、聞いていないわ。'],
  },
  npc_12_kuze: {
    greetWary: ['……君の振る舞いは、少々危ういな。'],
    smalltalk: ['この館の様式は三つの時代が混ざっている。建て増しを重ねた証拠だよ。', '知ることは、時に背負うことでもある。'],
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
