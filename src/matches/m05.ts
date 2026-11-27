/**
 * M05 ナンバー・リレー（v11、8 人、4 人 × 2 組）
 * 8 ラウンド。全員に同じ数字カード 6 枚。組ごとの出題担当が、公開の目標候補 3 つから 1 つを選ぶ。
 * カード（各 1 回まで）と ＋ − × ÷、括弧で、目標と一致する式を組む。計算は分数のまま厳密に行う。0 で割ることはできない。
 * 正解 40 点、使ったカード 1 枚 2 点（最大 12）、残り時間で最大 8 点、組の全員が正解なら全員に +10。
 * 出題担当は準備の間に先にカードを見られる。見た内容を組の人に先に教えるかどうかは担当が決める。
 * 4 ラウンドの後に組替え。順位は個人の合計点、正解数、解答時間の合計の順。
 */
import type { CharId } from '../data/characters';
import type { Rng } from '../core/rng';
import { skill, sortGroups, type AiCtx, type MatchEngine } from './types';

export const ROUNDS = 8;
export const SOLVE_MS = 90_000;
export const PREP_MS = 20_000;
export const PICK_MS = 20_000;
export const CORRECT = 40;
export const PER_CARD = 2;
export const CARD_MAX = 12;
export const TIME_MAX = 8;
export const TEAM_BONUS = 10;
export const EXTRA_COST = 1;
export const EXTRA_MAX = 2;
export const HAND = 6;

/** 式の 1 つの部品。数はカードの番号（0 から）、それ以外は記号 */
export type Tok = number | '+' | '-' | '*' | '/' | '(' | ')';
export interface Rat { n: number; d: number }

const gcd = (a: number, b: number): number => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a || 1; };
const rat = (n: number, d = 1): Rat => { if (d < 0) { n = -n; d = -d; } const g = gcd(n, d); return { n: n / g, d: d / g }; };
const ops = {
  '+': (a: Rat, b: Rat) => rat(a.n * b.d + b.n * a.d, a.d * b.d),
  '-': (a: Rat, b: Rat) => rat(a.n * b.d - b.n * a.d, a.d * b.d),
  '*': (a: Rat, b: Rat) => rat(a.n * b.n, a.d * b.d),
  '/': (a: Rat, b: Rat) => (b.n === 0 ? null : rat(a.n * b.d, a.d * b.n)),
} as const;

/** 式を計算する。書きかけ、同じカードの使い回し、0 での割り算は null */
export function evalToks(toks: Tok[], cards: number[]): Rat | null {
  const used = new Set<number>();
  let i = 0;
  const atom = (): Rat | null => {
    const tk = toks[i];
    if (tk === '(') {
      i++;
      const v = sum();
      if (v === null || toks[i] !== ')') return null;
      i++;
      return v;
    }
    if (typeof tk !== 'number' || !Number.isInteger(tk) || tk < 0 || tk >= cards.length || used.has(tk)) return null;
    used.add(tk);
    i++;
    return rat(cards[tk]);
  };
  const prod = (): Rat | null => {
    let v = atom();
    while (v !== null && (toks[i] === '*' || toks[i] === '/')) {
      const op = toks[i++] as '*' | '/';
      const r = atom();
      if (r === null) return null;
      v = ops[op](v, r);
    }
    return v;
  };
  function sum(): Rat | null {
    let v = prod();
    while (v !== null && (toks[i] === '+' || toks[i] === '-')) {
      const op = toks[i++] as '+' | '-';
      const r = prod();
      if (r === null) return null;
      v = ops[op](v, r);
    }
    return v;
  }
  const v = sum();
  return v !== null && i === toks.length ? v : null;
}

export const cardsUsed = (toks: Tok[]) => toks.filter((x) => typeof x === 'number').length;

export function scoreAnswer(cards: number[], target: number, toks: Tok[], ms: number): { correct: boolean; used: number; points: number } {
  const v = evalToks(toks, cards);
  const correct = !!v && v.d === 1 && v.n === target;
  if (!correct) return { correct: false, used: 0, points: 0 };
  const used = cardsUsed(toks);
  return { correct, used, points: CORRECT + Math.min(CARD_MAX, used * PER_CARD) + Math.round((TIME_MAX * Math.max(0, SOLVE_MS - ms)) / SOLVE_MS) };
}

// ---- 探索（問題作りと CPU が使う。CPU は自分に見えているカードと目標だけを渡す） ----

interface Val { n: number; d: number; toks: Tok[]; lv: 0 | 1 | 2 }
const key = (n: number, d: number) => `${n}/${d}`;
const wrap = (v: Val, need: boolean): Tok[] => (need ? ['(', ...v.toks, ')'] : v.toks);

function combine(a: Val, b: Val, out: Map<string, Val>): void {
  const put = (r: Rat | null, toks: () => Tok[], lv: 1 | 2) => {
    if (!r || r.n <= 0 || r.d > 60 || r.n > 20000) return;
    const k = key(r.n, r.d);
    if (!out.has(k)) out.set(k, { n: r.n, d: r.d, toks: toks(), lv });
  };
  put(ops['+'](a, b), () => [...a.toks, '+', ...b.toks], 2);
  put(ops['*'](a, b), () => [...wrap(a, a.lv === 2), '*', ...wrap(b, b.lv === 2)], 1);
  put(ops['-'](a, b), () => [...a.toks, '-', ...wrap(b, b.lv === 2)], 2);
  put(ops['-'](b, a), () => [...b.toks, '-', ...wrap(a, a.lv === 2)], 2);
  put(ops['/'](a, b), () => [...wrap(a, a.lv === 2), '/', ...wrap(b, b.lv >= 1)], 1);
  put(ops['/'](b, a), () => [...wrap(b, b.lv === 2), '/', ...wrap(a, a.lv >= 1)], 1);
}

const bits = (m: number) => { let c = 0; for (; m; m &= m - 1) c++; return c; };

/** カードの組ごとに、作れる数の表を作る（4 枚まで） */
function tables(cards: number[]): Map<string, Val>[] {
  const n = cards.length;
  const tab: Map<string, Val>[] = new Array<Map<string, Val>>(1 << n);
  for (let m = 1; m < 1 << n; m++) {
    const c = bits(m);
    if (c > 4) continue;
    const out = new Map<string, Val>();
    if (c === 1) {
      const i = Math.log2(m);
      out.set(key(cards[i], 1), { n: cards[i], d: 1, toks: [i], lv: 0 });
    } else {
      for (let a = (m - 1) & m; a > 0; a = (a - 1) & m) {
        const b = m ^ a;
        if (a < b) continue;
        for (const va of tab[a].values()) for (const vb of tab[b].values()) combine(va, vb, out);
      }
    }
    tab[m] = out;
  }
  return tab;
}

const cache = new Map<string, Record<number, Tok[]>>();

/** 目標を作る式を、使うカードの枚数ごとに 1 つずつ求める（見つかった枚数だけ） */
export function solutions(cards: number[], target: number): Record<number, Tok[]> {
  const ck = `${cards.join(',')}=${target}`;
  const hit = cache.get(ck);
  if (hit) return hit;
  const n = cards.length;
  const tab = tables(cards);
  const found: Record<number, Tok[]> = {};
  const tk = key(target, 1);
  const T: Val = { n: target, d: 1, toks: [], lv: 0 };
  for (let m = 1; m < 1 << n; m++) {
    const c = bits(m);
    if (found[c]) continue;
    if (c <= 4) {
      const v = tab[m].get(tk);
      if (v) found[c] = v.toks;
      continue;
    }
    // 5 枚以上：2 つの組に分け、片方の値から、もう片方に必要な値を逆算して探す
    search: for (let a = (m - 1) & m; a > 0; a = (a - 1) & m) {
      const b = m ^ a;
      if (bits(a) > 4 || bits(b) > 4 || bits(a) < bits(b)) continue;
      for (const va of tab[a].values()) {
        const tries: [Rat | null, (vb: Val) => Tok[]][] = [
          [ops['-'](T, va), (vb) => [...va.toks, '+', ...vb.toks]],
          [ops['-'](va, T), (vb) => [...va.toks, '-', ...wrap(vb, vb.lv === 2)]],
          [ops['+'](T, va), (vb) => [...vb.toks, '-', ...wrap(va, va.lv === 2)]],
          [ops['/'](T, va), (vb) => [...wrap(va, va.lv === 2), '*', ...wrap(vb, vb.lv === 2)]],
          [ops['/'](va, T), (vb) => [...wrap(va, va.lv === 2), '/', ...wrap(vb, vb.lv >= 1)]],
          [ops['*'](T, va), (vb) => [...wrap(vb, vb.lv === 2), '/', ...wrap(va, va.lv >= 1)]],
        ];
        for (const [need, make] of tries) {
          if (!need || need.n <= 0) continue;
          const vb = tab[b].get(key(need.n, need.d));
          if (vb) {
            found[c] = make(vb);
            break search;
          }
        }
      }
    }
  }
  if (cache.size > 400) cache.clear();
  cache.set(ck, found);
  return found;
}

export interface M05Round {
  cards: number[];
  /** 追加カード（買った人だけが 7 枚目として使える。全員同じ数） */
  extra: number;
  /** 公開の目標候補 3 つ */
  cands: number[];
}

const BIG = [10, 12, 15, 20, 25];

/** 1 ラウンド分の問題。候補はどれも「2 枚では作れず、3 枚で作れる」数にそろえる */
export function makeRound(rng: Rng): M05Round {
  for (let attempt = 0; attempt < 300; attempt++) {
    const small = rng.shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const cards = [...small.slice(0, 4), ...rng.shuffle([...BIG]).slice(0, 2)].sort((a, b) => a - b);
    const extra = small[4];
    const tab = tables(cards);
    const min: Record<number, number> = {};
    for (let m = 1; m < 1 << cards.length; m++) {
      const c = bits(m);
      if (c > 3) continue;
      for (const v of tab[m].values()) if (v.d === 1 && v.n >= 31 && v.n <= 160) min[v.n] = Math.min(min[v.n] ?? 9, c);
    }
    const pool = rng.shuffle(Object.keys(min).map(Number).filter((x) => min[x] === 3 && x % 5 !== 0));
    const cands: number[] = [];
    for (const x of pool) {
      if (cands.every((y) => Math.abs(y - x) >= 6)) cands.push(x);
      if (cands.length === 3) break;
    }
    if (cands.length === 3) return { cards, extra, cands: cands.sort((a, b) => a - b) };
  }
  throw new Error('m05: 問題を作れませんでした');
}

export type M05Move =
  | { t: 'set'; pick: number; tell: boolean }
  | { t: 'extra' }
  | { t: 'ready' }
  | { t: 'answer'; toks: Tok[]; ms: number };

export interface M05Result {
  team: number;
  setter: boolean;
  target: number;
  toks: Tok[];
  cards: number[];
  correct: boolean;
  used: number;
  ms: number;
  points: number;
  bonus: number;
}

export interface M05State {
  players: CharId[];
  /** 前半と後半の組 */
  halves: CharId[][][];
  round: number;
  phase: 'pick' | 'prep' | 'solve' | 'done';
  rounds: M05Round[];
  /** 組ごとの出題担当の選択（このラウンド） */
  pick: number[];
  tell: boolean[];
  /** 出題担当が選び終えたか */
  set: boolean[];
  ready: Record<string, boolean>;
  /** 追加カードを買ったラウンド */
  extra: Record<string, number[]>;
  current: Record<string, { toks: Tok[]; ms: number } | undefined>;
  results: Record<string, M05Result[]>;
}

export interface M05View {
  self: CharId | 'spectator';
  players: CharId[];
  round: number;
  rounds: number;
  phase: M05State['phase'];
  teams: CharId[][];
  team: number;
  setter: CharId | null;
  isSetter: boolean;
  cands: number[];
  /** 見えているカード（解く段階は全員。準備の段階は、出題担当と、担当から教わった人だけ） */
  cards: number[] | null;
  /** 目標（解く段階は確定。準備の段階は、担当の今の選択。教わっていない人は null） */
  target: number | null;
  pick: number;
  tell: boolean;
  setDone: boolean;
  /** 出題担当が選んでいる間（担当以外は待つ） */
  waitingPick: boolean;
  told: boolean;
  hasExtra: boolean;
  extraUsed: number;
  extraCard: number | null;
  submitted: boolean;
  ready: Record<string, boolean>;
  results: Record<string, M05Result[]>;
  totals: Record<string, number>;
  /** 直前のラウンドの解答例（使う枚数の多い順に 2 つまで） */
  lastExample: { target: number; cards: number[]; sols: Tok[][] } | null;
  nextRegroup: boolean;
}

const totalOf = (r: M05Result[]) => r.reduce((n, x) => n + x.points + x.bonus, 0);
const teamsOf = (s: M05State, round = s.round) => s.halves[Math.min(round, ROUNDS - 1) < ROUNDS / 2 ? 0 : 1];
const teamIdx = (s: M05State, p: CharId, round = s.round) => teamsOf(s, round).findIndex((tm) => tm.includes(p));
const setterOf = (s: M05State, team: number, round = s.round): CharId => { const tm = teamsOf(s, round)[team]; return tm[(round % (ROUNDS / 2)) % tm.length]; };
const handOf = (s: M05State, p: CharId, round = s.round): number[] => { const r = s.rounds[round]; return s.extra[p].includes(round) ? [...r.cards, r.extra] : r.cards; };

function m05Ai(v: M05View, ctx: AiCtx): M05Move {
  const logic = skill(ctx.stats.logic);
  if (v.phase === 'pick') {
    if (v.cards) {
      // 担当：自分が一番多くのカードを使えそうな候補を選ぶ（見えているのは自分のカードだけ）
      const cap = 3 + Math.round(logic * 2);
      let pick = 0;
      let best = -1;
      v.cands.forEach((c, i) => {
        const sols = solutions(v.cards!, c);
        const size = Math.max(0, ...Object.keys(sols).map(Number).filter((k) => k <= cap)) + ctx.rng.gauss(0, 0.6);
        if (size > best) { best = size; pick = i; }
      });
      const mates = v.teams[v.team].filter((p) => p !== ctx.self);
      const trust = mates.reduce((n, p) => n + ctx.relation(p).trust - ctx.relation(p).hostility, 0) / Math.max(1, mates.length);
      const pr = 0.45 + (ctx.personality.loyalty - 50) / 170 + (trust - 35) / 110 + (mates.some((p) => ctx.allies.includes(p)) ? 0.2 : 0) - (ctx.personality.ambition - 50) / 300;
      return { t: 'set', pick, tell: ctx.rng.chance(Math.max(0.08, Math.min(0.95, pr))) };
    }
    return { t: 'set', pick: 0, tell: false };
  }
  if (v.phase === 'prep') {
    if (!v.hasExtra && v.extraUsed < EXTRA_MAX && v.round >= 3 && ctx.pieces >= EXTRA_COST + 3 && ctx.rng.chance(0.06 + ctx.personality.risk / 900) && ctx.spend(EXTRA_COST, 'M05 追加カード')) return { t: 'extra' };
    return { t: 'ready' };
  }
  if (v.phase !== 'solve' || !v.cards || v.target === null) return { t: 'ready' };
  const sols = solutions(v.cards, v.target);
  const sizes = Object.keys(sols).map(Number).sort((a, b) => a - b);
  // 何枚まで使う式を探し切れるか（能力で変わる）。先に見ていた人は、その分だけ早い
  const cap = Math.max(2, Math.min(7, Math.round(2.5 + logic * 2.1 + ctx.rng.gauss(0, 0.8) - ctx.noise * 0.4)));
  const head = v.isSetter || v.told ? 12 : 0;
  const slip = ctx.rng.chance(0.07 + (1 - logic) * 0.27);
  const usable = sizes.filter((k) => k <= cap);
  for (let i = usable.length - 1; i >= 0 && !slip; i--) {
    const k = usable[i];
    const sec = Math.max(6, 16 + k * 9 + (1 - logic) * 30 + ctx.rng.gauss(0, 9) - head);
    if (sec < SOLVE_MS / 1000 - 2) return { t: 'answer', toks: sols[k], ms: Math.round(sec * 1000) };
  }
  return { t: 'answer', toks: [], ms: SOLVE_MS };
}

export const M05: MatchEngine<M05State, M05Move, M05View> = {
  id: 'm05',
  name: 'ナンバー・リレー',
  kind: 'main',
  minPlayers: 4,
  maxPlayers: 8,
  summary: '数字カードと四則で目標の数を作る。組の出題担当が目標を選び、全員が同じカードで解く。',
  rules: [
    '全 8 ラウンド。2 つの組に分かれます（4 ラウンドの後に組替え）。得点と順位は個人ごとです。',
    '全員に同じ数字カード 6 枚が配られます。目標の候補 3 つは公開され、組ごとの出題担当が 1 つを選びます。担当は順番に交代し、全員が 2 回ずつ務めます。',
    'カードと ＋ − × ÷、括弧を使って、目標と同じ数になる式を組みます。カードは 1 枚につき 1 回まで。全部を使う必要はありません。',
    '割り算は割り切れなくても構いません（途中は分数のまま正確に計算します）。0 で割ることはできません。',
    '制限時間は 90 秒。正解 40 点、使ったカード 1 枚につき 2 点（最大 12 点）、残り時間に応じて最大 8 点。',
    '組の全員が正解すると、その組の全員に +10 点。',
    '出題担当は、準備の 20 秒の間にカードを先に見られます。見た内容（カードと選んだ目標）を組の人へ先に教えるかどうかは、担当が決めます。',
    'ラウンドの間の 20 秒は話せます。解いている間は話せません。',
    `ピース ${EXTRA_COST} 個で、そのラウンドだけ追加の数字カード 1 枚を使えます（1 ラウンド 1 回、全体で ${EXTRA_MAX} 回まで。追加の数は全員同じ）。`,
    '同点は、正解の数、解答時間の合計が短い順で決めます。それでも同じなら共通決定戦です。',
    '時間切れの場合：その時点の式が目標と一致していれば正解、していなければ 0 点です。',
  ],
  init(players, rng) {
    const order = rng.shuffle([...players]);
    const half = Math.ceil(order.length / 2);
    const a = order.slice(0, half);
    const b = order.slice(half);
    const ha = Math.ceil(a.length / 2);
    const hb = Math.floor(b.length / 2);
    // 組替え：新しい組は、前半の両方の組から同じ人数ずつ
    const x = [...a.slice(0, ha), ...b.slice(0, hb)];
    const y = [...a.slice(ha), ...b.slice(hb)];
    return {
      players: [...players],
      halves: [[a, b], [x, y]],
      round: 0,
      phase: 'pick',
      rounds: Array.from({ length: ROUNDS }, () => makeRound(rng)),
      pick: [0, 0],
      tell: [false, false],
      set: [false, false],
      ready: Object.fromEntries(players.map((p) => [p, false])),
      extra: Object.fromEntries(players.map((p) => [p, []])),
      current: {},
      results: Object.fromEntries(players.map((p) => [p, []])),
    };
  },
  pending(s) {
    if (s.phase === 'done') return [];
    if (s.phase === 'pick') return [0, 1].filter((ti) => !s.set[ti] && teamsOf(s)[ti].length).map((ti) => setterOf(s, ti));
    if (s.phase === 'prep') return s.players.filter((p) => !s.ready[p]);
    return s.players.filter((p) => !s.current[p]);
  },
  stage(s) {
    if (s.phase === 'done') return { label: '終了' };
    const head = `ラウンド ${s.round + 1} / ${ROUNDS}`;
    if (s.phase === 'pick') return { label: `${head}　出題`, time: PICK_MS };
    return s.phase === 'prep' ? { label: `${head}　準備`, time: PREP_MS, negotiation: true } : { label: head, time: SOLVE_MS };
  },
  validate(s, p, m) {
    if (!m || s.phase === 'done' || !s.players.includes(p)) return false;
    if (s.phase === 'pick') {
      const tm = teamIdx(s, p);
      return m.t === 'set' && setterOf(s, tm) === p && !s.set[tm] && Number.isInteger(m.pick) && m.pick >= 0 && m.pick < 3 && typeof m.tell === 'boolean';
    }
    if (s.phase === 'prep') {
      if (s.ready[p]) return false;
      if (m.t === 'ready') return true;
      return m.t === 'extra' && !s.extra[p].includes(s.round) && s.extra[p].length < EXTRA_MAX;
    }
    if (s.current[p] || m.t !== 'answer' || !Array.isArray(m.toks) || m.toks.length > 40) return false;
    if (m.toks.some((x) => typeof x === 'number' ? !Number.isInteger(x) || x < 0 || x >= handOf(s, p).length : !['+', '-', '*', '/', '(', ')'].includes(x))) return false;
    return typeof m.ms === 'number' && Number.isFinite(m.ms) && m.ms >= 0 && m.ms <= SOLVE_MS + 1000;
  },
  defaultMove(s) {
    if (s.phase === 'pick') return { t: 'set', pick: 0, tell: false };
    return s.phase === 'prep' ? { t: 'ready' } : { t: 'answer', toks: [], ms: SOLVE_MS };
  },
  submit(s, p, m) {
    if (!this.validate(s, p, m)) throw new Error(`m05: illegal move ${JSON.stringify(m)}`);
    if (m.t === 'extra') {
      // 代金の支払いは呼び出し側（画面と CPU）が同じ価格で行う
      s.extra[p].push(s.round);
      return;
    }
    if (m.t === 'set') {
      const tm = teamIdx(s, p);
      s.pick[tm] = m.pick;
      s.tell[tm] = m.tell;
      s.set[tm] = true;
      if ([0, 1].every((ti) => s.set[ti] || !teamsOf(s)[ti].length)) s.phase = 'prep';
      return;
    }
    if (m.t === 'ready') {
      s.ready[p] = true;
      if (s.players.every((x) => s.ready[x])) s.phase = 'solve';
      return;
    }
    s.current[p] = { toks: [...m.toks], ms: Math.min(SOLVE_MS, m.ms) };
    if (!s.players.every((x) => s.current[x])) return;
    const teams = teamsOf(s);
    teams.forEach((tm, ti) => {
      const target = s.rounds[s.round].cands[s.pick[ti]];
      const res = tm.map((x) => {
        const cards = handOf(s, x);
        const cur = s.current[x]!;
        const sc = scoreAnswer(cards, target, cur.toks, cur.ms);
        return { team: ti, setter: setterOf(s, ti) === x, target, toks: cur.toks, cards, correct: sc.correct, used: sc.used, ms: cur.ms, points: sc.points, bonus: 0 } satisfies M05Result;
      });
      const all = res.every((r) => r.correct);
      tm.forEach((x, i) => s.results[x].push({ ...res[i], bonus: all ? TEAM_BONUS : 0 }));
    });
    s.current = {};
    if (s.round >= ROUNDS - 1) {
      s.phase = 'done';
      return;
    }
    s.round += 1;
    s.phase = 'pick';
    s.pick = [0, 0];
    s.tell = [false, false];
    s.set = [false, false];
    s.ready = Object.fromEntries(s.players.map((x) => [x, false]));
  },
  view(s, p) {
    const r = Math.min(s.round, ROUNDS - 1);
    const me = p === 'spectator' ? null : p;
    const teams = teamsOf(s, r);
    const team = me ? teamIdx(s, me, r) : 0;
    const setter = s.phase === 'done' ? null : setterOf(s, team, r);
    const isSetter = !!me && setter === me;
    const before = s.phase === 'pick' || s.phase === 'prep';
    const told = !!me && !isSetter && s.phase === 'prep' && s.tell[team];
    const solving = s.phase === 'solve';
    const sees = !!me && (solving || (before && isSetter) || told);
    const n = s.results[s.players[0]].length;
    let lastExample: M05View['lastExample'] = null;
    if (n > 0 && me) {
      const lr = s.results[me][n - 1];
      const sols = solutions(s.rounds[n - 1].cards, lr.target);
      const sizes = Object.keys(sols).map(Number).sort((a, b) => b - a);
      lastExample = { target: lr.target, cards: s.rounds[n - 1].cards, sols: sizes.slice(0, 2).map((k) => sols[k]) };
    }
    return {
      self: p,
      players: s.players,
      round: s.round,
      rounds: ROUNDS,
      phase: s.phase,
      teams,
      team,
      setter,
      isSetter,
      cands: s.rounds[r].cands,
      cards: sees ? handOf(s, me!, r) : null,
      target: solving || (s.phase === 'prep' && (isSetter || told)) ? s.rounds[r].cands[s.pick[team]] : null,
      waitingPick: s.phase === 'pick' && !isSetter,
      pick: isSetter ? s.pick[team] : 0,
      tell: isSetter ? s.tell[team] : false,
      setDone: s.set[team],
      told,
      hasExtra: !!me && s.extra[me].includes(r),
      extraUsed: me ? s.extra[me].length : 0,
      extraCard: me && s.extra[me].includes(r) && sees ? s.rounds[r].extra : null,
      submitted: !!me && !!s.current[me],
      ready: { ...s.ready },
      results: s.results,
      totals: Object.fromEntries(s.players.map((x) => [x, totalOf(s.results[x])])),
      lastExample,
      nextRegroup: before && s.round === ROUNDS / 2,
    };
  },
  ai: m05Ai,
  done(s) {
    return s.phase === 'done';
  },
  scores(s) {
    return Object.fromEntries(s.players.map((p) => [p, totalOf(s.results[p])]));
  },
  ranking(s) {
    const correct = (p: CharId) => s.results[p].filter((r) => r.correct).length;
    const time = (p: CharId) => s.results[p].reduce((n, r) => n + (r.correct ? r.ms : SOLVE_MS), 0);
    return sortGroups(s.players, (p) => totalOf(s.results[p]) * 100 + correct(p), (p) => -time(p));
  },
  allyValue(s, a, b) {
    return teamIdx(s, a) === teamIdx(s, b) ? 8 : 0;
  },
};

/** 説明と練習に使う問題（本番とは別）。例：(8 − 3) × 9 ＝ 45、6 枚なら 3 + 8 × (9 − 4) + 12 − 10 */
export const M05_PRACTICE = { cards: [3, 4, 8, 9, 10, 12], target: 45 };

const SYM: Record<string, string> = { '+': '＋', '-': '−', '*': '×', '/': '÷', '(': '（', ')': '）' };
/** 式を画面用の文字にする */
export const exprText = (toks: Tok[], cards: number[]): string => toks.map((x) => (typeof x === 'number' ? String(cards[x]) : SYM[x])).join(' ');
