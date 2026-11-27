/**
 * M02 フラッグ・フラッシュ（v11、11 人、全員個人）
 * 人数と同じ数のラウンドを行い、全員が 1 回ずつ出題者になる。出題者は公開された候補 3 枚から出題セットを 1 枚選ぶ
 * （どれを選んだかは、そのラウンドが終わるまで出題者だけが知っている）。
 * 4×3 の枠に国旗 6〜12 枚を短時間表示して隠し、位置、旗、有無を問う 5 問に答える。出題者も同じ表示を見て答える。
 * 1 問 10 点、全問正解 +10。各ラウンド後に 15 秒の休憩。ピース 1 個で、1 ラウンドだけ表示を 2 秒延ばせる（大会 2 回まで）。
 */
import type { CharId } from '../data/characters';
import { FLAGS } from '../data/flags';
import type { Rng } from '../core/rng';
import { answerOf, cpuAnswer, emptyAnswer, grade, sample, validAnswer, type MemAnswer, type MemQ, type MemSet } from './memory';
import { skill, sortGroups, type AiCtx, type MatchEngine } from './types';

export const W = 4;
export const H = 3;
export const QUESTIONS = 5;
export const Q_MS = 8_000;
export const PICK_MS = 25_000;
export const PREP_MS = 15_000;
export const BREAK_MS = 15_000;
export const BOOST_MS = 2_000;
export const BOOST_COST = 1;
export const BOOST_MAX = 2;
/** 問題ごとの正誤表示などに使う余裕 */
export const SLACK_MS = 6_000;

export type Mix = 'place' | 'item' | 'present' | 'even';
export const MIXES: Mix[] = ['place', 'item', 'present', 'even'];
const MIX_KINDS: Record<Mix, MemQ['kind'][]> = {
  place: ['place', 'place', 'place', 'item', 'present'],
  item: ['item', 'item', 'item', 'place', 'present'],
  present: ['present', 'present', 'present', 'place', 'item'],
  even: ['place', 'place', 'item', 'item', 'present'],
};

export interface Cand {
  mix: Mix;
  n: number;
  showMs: number;
}

export type M02Move =
  | { t: 'pick'; i: number; tell?: Record<string, number> }
  | { t: 'boost' }
  | { t: 'ready' }
  | { t: 'answers'; a: MemAnswer };

export interface M02Result {
  correct: number;
  points: number;
  okMs: number;
  ok: boolean[];
  picks: number[];
}

export interface M02State {
  players: CharId[];
  /** 出題者の順番 */
  order: CharId[];
  round: number;
  phase: 'pick' | 'prep' | 'quiz' | 'break' | 'done';
  cands: Cand[][];
  sets: MemSet[][];
  chosen: number[];
  /** ラウンドごと、出題者が各人に伝えた「選んだ候補」の番号（本当とは限らない） */
  tips: Record<string, number>[];
  boostUsed: Record<string, number>;
  boostOn: Record<string, boolean>;
  ready: Record<string, boolean>;
  current: Record<string, MemAnswer | undefined>;
  results: Record<string, M02Result[]>;
}

export interface M02Last {
  round: number;
  setter: CharId;
  cands: Cand[];
  chosen: number;
  set: MemSet;
  results: Record<string, M02Result>;
  /** 出題者から自分に届いていた情報（候補の番号） */
  tip: number | null;
}

export interface M02View {
  self: CharId | 'spectator';
  players: CharId[];
  order: CharId[];
  round: number;
  rounds: number;
  phase: M02State['phase'];
  setter: CharId;
  /** このラウンドの候補（全員に公開） */
  cands: Cand[];
  /** 選ばれた候補（出題者本人だけ。ほかの人は null） */
  chosen: number | null;
  /** 出題者から届いた情報 */
  tip: number | null;
  /** 回答中の出題セット（表示時間は自分の延長込み） */
  set: MemSet | null;
  boostOn: boolean;
  boostUsed: number;
  submitted: boolean;
  ready: Record<string, boolean>;
  totals: Record<string, number>;
  correct: Record<string, number>;
  last: M02Last | null;
  /** 休憩中、次の出題者だけが先に見られる候補 */
  nextCands: Cand[] | null;
  nextSetter: CharId | null;
}

export const showMsOf = (mix: Mix, n: number) => Math.round((1500 + n * 600) * (mix === 'present' ? 0.65 : 1));

/** 出題セットを作る。同じ旗を 2 つの問題の答えにしない */
export function makeSet(rng: Rng, mix: Mix, n: number): MemSet {
  const ids = FLAGS.map((f) => f.id);
  const shown = sample(rng, ids, n);
  const rest = ids.filter((x) => !shown.includes(x));
  const cells: (string | null)[] = new Array(W * H).fill(null);
  const slots = sample(rng, cells.map((_, i) => i), n);
  shown.forEach((f, i) => { cells[slots[i]] = f; });
  const targets = sample(rng, shown, QUESTIONS);
  const kinds = rng.shuffle([...MIX_KINDS[mix]]);
  const questions: MemQ[] = kinds.map((kind, i) => {
    const item = targets[i];
    if (kind === 'place') return { kind, item };
    if (kind === 'item') {
      // 候補は、盤面にあった別の旗 2 枚と、無かった旗 1 枚を混ぜる
      const others = [...sample(rng, shown.filter((x) => x !== item), 2), ...sample(rng, rest, 1)];
      return { kind, cell: cells.indexOf(item), options: rng.shuffle([item, ...others]) };
    }
    return { kind, options: rng.shuffle([item, ...sample(rng, rest, 3)]) };
  });
  return { board: { w: W, h: H, cells }, showMs: showMsOf(mix, n), qMs: Q_MS, questions };
}

const totalOf = (r: M02Result[]) => r.reduce((n, x) => n + x.points, 0);
const setterOf = (s: M02State, round = s.round) => s.order[Math.min(round, s.order.length - 1)];
const curSet = (s: M02State) => s.sets[s.round][s.chosen[s.round]];
/** 回答の段階の制限時間（表示＋延長＋全問の回答時間＋余裕） */
export const quizMs = (set: MemSet) => set.showMs + BOOST_MS + set.questions.length * set.qMs + SLACK_MS;

function resolve(s: M02State): void {
  const set = curSet(s);
  for (const p of s.players) {
    const a = s.current[p] ?? emptyAnswer(set);
    const g = grade(set, a);
    s.results[p].push({ correct: g.correct, points: g.correct * 10 + (g.correct === set.questions.length ? 10 : 0), okMs: g.okMs, ok: g.ok, picks: [...a.picks] });
  }
  s.current = {};
  s.boostOn = {};
  if (s.round >= s.order.length - 1) {
    s.phase = 'done';
    return;
  }
  s.phase = 'break';
  s.ready = Object.fromEntries(s.players.map((p) => [p, false]));
}

/**
 * CPU。出題者の時は候補を選び、相手との関係に応じて「何を選んだか」を伝える（本当のことも、嘘も、黙ることもある）。
 * 回答は、表示を見た時の記憶を能力（記憶力）から確率で作って答える。伝えられた情報を信じるかは相手への信頼で決める。
 */
function m02Ai(v: M02View, ctx: AiCtx): M02Move {
  const me = ctx.self;
  if (v.phase === 'pick') {
    const i = ctx.rng.int(0, v.cands.length - 1);
    const tell: Record<string, number> = {};
    for (const o of v.players) {
      if (o === me) continue;
      const r = ctx.relation(o);
      const friendly = ctx.allies.includes(o) || r.like >= 35 || r.debt >= 40;
      if (friendly && ctx.rng.chance(0.45 + ctx.personality.loyalty / 200)) tell[o] = i;
      else if ((r.hostility >= 50 || r.threat >= 65) && ctx.rng.chance(0.25 + (100 - ctx.personality.morality) / 250)) tell[o] = (i + ctx.rng.int(1, v.cands.length - 1)) % v.cands.length;
    }
    return { t: 'pick', i, tell };
  }
  if (v.phase === 'prep') {
    if (!v.boostOn && v.boostUsed < BOOST_MAX && ctx.pieces >= BOOST_COST + 2 && ctx.rng.chance(0.08 + ctx.personality.risk / 900) && ctx.spend(BOOST_COST, 'M02 表示延長')) return { t: 'boost' };
    return { t: 'ready' };
  }
  if (v.phase !== 'quiz' || !v.set) return { t: 'ready' };
  const mem = skill(ctx.stats.memory);
  const n = v.set.board.cells.filter((c) => c != null).length;
  const sec = v.set.showMs / 1000;
  // 覚えられる枚数の目安。能力差は小さめにして、回ごとの出来不出来を大きくする
  const cap = 2.9 + mem * 1.2 + sec * 0.2 + ctx.rng.gauss(0, 1.2) - ctx.noise * 0.3;
  let pLoc = Math.max(0.15, Math.min(0.95, cap / n));
  let pSeen = Math.max(0.3, Math.min(0.98, pLoc + 0.22));
  // 何が問われるかを知っている（と信じている）時は、そこに集中する
  let focus: Mix | null = null;
  if (v.chosen != null) focus = v.cands[v.chosen].mix;
  else if (v.tip != null && ctx.relation(v.setter).trust >= 45) focus = v.cands[v.tip].mix;
  if (focus === 'place' || focus === 'item') { pLoc = Math.min(0.96, pLoc + 0.07); pSeen = Math.max(0.3, pSeen - 0.05); }
  else if (focus === 'present') { pSeen = Math.min(0.99, pSeen + 0.12); pLoc = Math.max(0.12, pLoc - 0.08); }
  return { t: 'answers', a: cpuAnswer(v.set, { pSeen, pLoc }, ctx.rng) };
}

export const M02: MatchEngine<M02State, M02Move, M02View> = {
  id: 'm02',
  name: 'フラッグ・フラッシュ',
  kind: 'main',
  minPlayers: 2,
  maxPlayers: 12,
  summary: '短い時間だけ見える国旗の並びを覚え、隠れた後の 5 問に答える。全員が 1 回ずつ出題者になる。',
  rules: [
    '人数と同じ数のラウンドを行い、全員が 1 回ずつ出題者になります。',
    '出題者は、公開された候補 3 枚から出題セットを 1 枚選びます。候補には「何が多く問われるか」と旗の枚数、表示時間が書かれています。本番の並びは選ぶ時には見えません。',
    'どの候補を選んだかは、そのラウンドが終わるまで出題者だけが知っています。出題者は、選んだ候補をほかの人に伝えることができます（本当のことを伝える義務はありません）。',
    '4×3 の枠に国旗 6〜12 枚が短い時間だけ表示され、その後隠れます。出題者を含む全員が同じ表示を見て、5 問に答えます。1 問の制限時間は 8 秒です。',
    '問題は 3 種類です。「位置」＝示された旗があったマスを選ぶ。「旗」＝示されたマスにあった旗を 4 枚から選ぶ。「有無」＝4 枚のうち表示されていた 1 枚を選ぶ。',
    '旗には国名が添えられます。色だけでなく、模様と国名でも見分けられます。',
    '1 問正解で 10 点、5 問すべて正解するとさらに +10 点。未回答と時間切れは 0 点です。',
    '各ラウンドの後に 15 秒の休憩があります。次の出題者は、休憩の間に自分の候補を先に見られます。',
    `ピースを ${BOOST_COST} 個支払うと、そのラウンドだけ表示時間が 2 秒延びます（この競技で ${BOOST_MAX} 回まで。同じラウンドに重ねては使えません）。`,
    '順位は合計点で決まります。同点は、正解した数、正解にかかった時間の合計が短い順で決めます。それでも同じなら共通決定戦です。',
  ],
  init(players, rng) {
    const order = rng.shuffle([...players]);
    const cands: Cand[][] = [];
    const sets: MemSet[][] = [];
    for (let r = 0; r < order.length; r++) {
      const mixes = sample(rng, MIXES, 3);
      const cs = mixes.map((mix) => {
        const n = rng.int(6, 12);
        return { mix, n, showMs: showMsOf(mix, n) };
      });
      cands.push(cs);
      sets.push(cs.map((c) => makeSet(rng, c.mix, c.n)));
    }
    return {
      players: [...players],
      order,
      round: 0,
      phase: 'pick',
      cands,
      sets,
      chosen: order.map(() => -1),
      tips: order.map(() => ({})),
      boostUsed: Object.fromEntries(players.map((p) => [p, 0])),
      boostOn: {},
      ready: {},
      current: {},
      results: Object.fromEntries(players.map((p) => [p, []])),
    };
  },
  pending(s) {
    if (s.phase === 'done') return [];
    if (s.phase === 'pick') return [setterOf(s)];
    if (s.phase === 'quiz') return s.players.filter((p) => !s.current[p]);
    return s.players.filter((p) => !s.ready[p]);
  },
  stage(s) {
    const head = `ラウンド ${s.round + 1} / ${s.order.length}`;
    if (s.phase === 'done') return { label: '終了' };
    if (s.phase === 'pick') return { label: `${head}　出題セットの選択`, time: PICK_MS };
    if (s.phase === 'prep') return { label: `${head}　準備`, time: PREP_MS };
    if (s.phase === 'quiz') return { label: `${head}　記憶と回答`, time: quizMs(curSet(s)) };
    return { label: `休憩（次はラウンド ${s.round + 2}）`, time: BREAK_MS, negotiation: true };
  },
  validate(s, p, m) {
    if (!m || s.phase === 'done' || !s.players.includes(p)) return false;
    if (s.phase === 'pick') {
      if (m.t !== 'pick' || p !== setterOf(s)) return false;
      if (!Number.isInteger(m.i) || m.i < 0 || m.i >= s.cands[s.round].length) return false;
      if (m.tell === undefined) return true;
      if (typeof m.tell !== 'object' || m.tell === null) return false;
      return Object.entries(m.tell).every(([o, i]) => o !== p && s.players.includes(o as CharId) && Number.isInteger(i) && i >= 0 && i < s.cands[s.round].length);
    }
    if (s.phase === 'prep') {
      if (s.ready[p]) return false;
      if (m.t === 'boost') return !s.boostOn[p] && s.boostUsed[p] < BOOST_MAX;
      return m.t === 'ready';
    }
    if (s.phase === 'break') return m.t === 'ready' && !s.ready[p];
    return m.t === 'answers' && !s.current[p] && validAnswer(curSet(s), m.a);
  },
  defaultMove(s) {
    if (s.phase === 'pick') return { t: 'pick', i: 0 };
    if (s.phase === 'quiz') return { t: 'answers', a: emptyAnswer(curSet(s)) };
    return { t: 'ready' };
  },
  submit(s, p, m) {
    if (!this.validate(s, p, m)) throw new Error(`m02: illegal move ${JSON.stringify(m)}`);
    if (m.t === 'pick') {
      s.chosen[s.round] = m.i;
      s.tips[s.round] = { ...(m.tell ?? {}) };
      s.phase = 'prep';
      s.ready = Object.fromEntries(s.players.map((x) => [x, false]));
      return;
    }
    if (m.t === 'boost') {
      s.boostOn[p] = true;
      s.boostUsed[p] += 1;
      return;
    }
    if (m.t === 'ready') {
      s.ready[p] = true;
      if (!s.players.every((x) => s.ready[x])) return;
      if (s.phase === 'prep') s.phase = 'quiz';
      else {
        s.round += 1;
        s.phase = 'pick';
      }
      return;
    }
    s.current[p] = { picks: [...m.a.picks], ms: [...m.a.ms] };
    if (s.players.every((x) => s.current[x])) resolve(s);
  },
  view(s, p) {
    const r = Math.min(s.round, s.order.length - 1);
    const setter = setterOf(s, r);
    const me = p === 'spectator' ? null : p;
    const played = s.results[s.players[0]].length;
    let last: M02Last | null = null;
    if (played > 0) {
      const lr = played - 1;
      last = {
        round: lr,
        setter: s.order[lr],
        cands: s.cands[lr],
        chosen: s.chosen[lr],
        set: s.sets[lr][s.chosen[lr]],
        results: Object.fromEntries(s.players.map((x) => [x, s.results[x][lr]])),
        tip: me && s.tips[lr][me] !== undefined ? s.tips[lr][me] : null,
      };
    }
    const base = s.phase === 'quiz' ? curSet(s) : null;
    const resolved = played > r;
    const nextSetter = s.phase === 'break' ? s.order[s.round + 1] : null;
    return {
      self: p,
      players: s.players,
      order: s.order,
      round: s.round,
      rounds: s.order.length,
      phase: s.phase,
      setter,
      cands: s.cands[r],
      chosen: s.phase !== 'pick' && !resolved && me === setter ? s.chosen[r] : null,
      tip: s.phase !== 'pick' && !resolved && me && s.tips[r][me] !== undefined ? s.tips[r][me] : null,
      set: base ? { ...base, showMs: base.showMs + (me && s.boostOn[me] ? BOOST_MS : 0) } : null,
      boostOn: !!me && !!s.boostOn[me],
      boostUsed: me ? s.boostUsed[me] : BOOST_MAX,
      submitted: !!me && !!s.current[me],
      ready: { ...s.ready },
      totals: Object.fromEntries(s.players.map((x) => [x, totalOf(s.results[x])])),
      correct: Object.fromEntries(s.players.map((x) => [x, s.results[x].reduce((n, y) => n + y.correct, 0)])),
      last,
      nextCands: nextSetter && me === nextSetter ? s.cands[s.round + 1] : null,
      nextSetter,
    };
  },
  ai: m02Ai,
  done(s) {
    return s.phase === 'done';
  },
  scores(s) {
    return Object.fromEntries(s.players.map((p) => [p, totalOf(s.results[p])]));
  },
  ranking(s) {
    const ok = (p: CharId) => s.results[p].reduce((n, x) => n + x.correct, 0);
    const time = (p: CharId) => s.results[p].reduce((n, x) => n + x.okMs, 0);
    return sortGroups(s.players, (p) => totalOf(s.results[p]) * 1000 + ok(p), (p) => -time(p));
  },
};

export { answerOf };

/** 練習に使う出題セット（本番とは別）。旗 6 枚、位置と旗と有無を 1 問ずつ */
export const M02_PRACTICE: MemSet = {
  board: { w: W, h: H, cells: ['jp', null, 'fr', null, null, 'se', null, 'de', 'vn', null, 'ch', null] },
  showMs: 6000,
  qMs: Q_MS,
  questions: [
    { kind: 'place', item: 'se' },
    { kind: 'item', cell: 7, options: ['fr', 'de', 'it', 'jp'] },
    { kind: 'present', options: ['pl', 'th', 'vn', 'gh'] },
  ],
};
