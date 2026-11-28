/**
 * S05 ダイスパズル（サブゲーム、2 人）
 * ラウンドごとに、共通のサイコロ 5 個が公開される。2 人は同時に、狙う条件を 1 つ選び、振り直すサイコロを選ぶ（振り直しは 1 回だけ。出目は人ごとに別）。
 * 振り直したあとの 5 個が条件を満たせば 3 点。全 3 ラウンドの合計で勝敗を決める。
 * 同じ条件は 1 人 1 回しか選べない（暫定。自由に選べると、ほとんどの回で 3 点になり、引き分けばかりになった）。
 */
import type { CharId } from '../data/characters';
import type { Rng } from '../core/rng';
import { luckNext, luckPick, newLuckBook, type LuckBook } from '../core/luck';
import { skill, sortGroups, type AiCtx, type MatchEngine } from './types';

export const S05_ROUNDS = 3;
export const S05_MS = 40_000;
export const S05_POINT = 3;

/** 条件：0 合計 20 以上、1 同じ目が 3 個、2 続きの目が 4 個 */
export const S05_CONDS = [0, 1, 2] as const;
export function holds(cond: number, dice: number[]): boolean {
  if (cond === 0) return dice.reduce((a, b) => a + b, 0) >= 20;
  if (cond === 1) return [1, 2, 3, 4, 5, 6].some((v) => dice.filter((d) => d === v).length >= 3);
  const set = new Set(dice);
  return [1, 2, 3].some((lo) => [0, 1, 2, 3].every((k) => set.has(lo + k)));
}

export type S05Move = { t: 'roll'; re: number[]; cond: number } | { t: 'ok' };
export interface S05Result { base: number[]; picks: { re: number[]; cond: number; dice: number[]; ok: boolean }[] }

export interface S05State {
  players: CharId[];
  base: number[][];
  /** 振り直した時の出目（人ごと、サイコロごと。出るまで誰にも見えない） */
  re: number[][][];
  round: number;
  current: (Extract<S05Move, { t: 'roll' }> | null)[];
  phase: 'pick' | 'show' | 'done';
  acks: boolean[];
  /** used[人][条件]：もう選んだ条件 */
  used: boolean[][];
  log: S05Result[];
  points: number[];
  stage: string;
  /** 運の判定の記録と専用の乱数（古い保存には無い。その時は出目から作る） */
  luck?: LuckBook;
}

/** 出目から決まる種（主の乱数を使わずに、運の専用の乱数を始めるため） */
function luckSeed(s: Pick<S05State, 'base' | 're'>): number {
  let h = 2166136261;
  for (const d of [...s.base.flat(), ...s.re.flat(2)]) h = Math.imul(h ^ d, 16777619) >>> 0;
  return h;
}

/**
 * 運の評価：本人がその時選んだ条件（公開）を満たせば 1、満たさなければ 0。
 * 得点は満たすかどうかだけで決まるので、大きい目や近さは評価しない（同じなら最初の出目のまま）。
 */
const luckScore = (cond: number) => (dice: number[]) => (holds(cond, dice) ? 1 : 0);

export interface S05View {
  self: CharId | 'spectator';
  me: number;
  players: CharId[];
  round: number;
  base: number[];
  phase: S05State['phase'];
  submitted: boolean;
  acked: boolean;
  used: boolean[][];
  log: S05Result[];
  points: number[];
}

/** 振り直す組み合わせ（32 通り）ごとに、各条件が成り立つ確率 */
export function chances(base: number[]): { re: number[]; p: number[] }[] {
  const out: { re: number[]; p: number[] }[] = [];
  for (let mask = 0; mask < 32; mask++) {
    const re = [0, 1, 2, 3, 4].filter((i) => mask & (1 << i));
    const total = 6 ** re.length;
    const cnt = [0, 0, 0];
    const dice = [...base];
    for (let k = 0; k < total; k++) {
      let x = k;
      for (const i of re) { dice[i] = (x % 6) + 1; x = Math.floor(x / 6); }
      for (const c of S05_CONDS) if (holds(c, dice)) cnt[c]++;
    }
    out.push({ re, p: cnt.map((c) => c / total) });
  }
  return out;
}

/** ふつうの出目から 1 回振り直した時の、条件ごとの成り立ちやすさ（目安） */
const BASE = [0.5, 0.45, 0.35];

function ai(v: S05View, ctx: AiCtx): S05Move {
  if (v.phase === 'show') return { t: 'ok' };
  const st = skill(ctx.stats.strategy); // 主：狙う条件と振り直しの選択
  const lg = skill(ctx.stats.logic);
  let best: S05Move = { t: 'roll', re: [], cond: 0 };
  let bv = -Infinity;
  const left = S05_CONDS.filter((c) => !v.used[v.me][c]);
  best = { t: 'roll', re: [], cond: left[0] };
  for (const c of chances(v.base)) {
    for (const cond of left) {
      // あとのラウンドに残した時の見込み（ふつうの出目での成り立ちやすさ）を引いて比べる
      const val = c.p[cond] - (left.length > 1 ? BASE[cond] * 0.6 : 0) + ctx.rng.gauss(0, 0.02 + ctx.noise * 0.08 + (1 - st) * 0.07 + (1 - lg) * 0.03);
      if (val > bv) { bv = val; best = { t: 'roll', re: c.re, cond }; }
    }
  }
  return best;
}

export const S05: MatchEngine<S05State, S05Move, S05View> = {
  id: 's05',
  name: 'ダイスパズル',
  kind: 'sub',
  minPlayers: 2,
  maxPlayers: 2,
  summary: '共通のサイコロ 5 個から、狙う条件を選んで振り直す。条件を満たせば 3 点。',
  rules: [
    'ラウンドごとに、共通のサイコロ 5 個が公開されます。',
    '2 人は同時に、狙う条件を 1 つ選び、振り直すサイコロを選びます。振り直しは 1 回だけで、何個でも（0 個でも）選べます。',
    '条件は 3 つ：合計 20 以上、同じ目が 3 個、続きの目が 4 個（例：2、3、4、5）。',
    '振り直したあとの 5 個が、選んだ条件を満たせば 3 点。満たさなければ 0 点です。振り直しの出目は、人ごとに別です。',
    '同じ条件は 1 回しか選べません。3 ラウンドで、3 つの条件を 1 回ずつ狙います。',
    '全 3 ラウンドの合計が多い方が勝ち。同じなら引き分けです。',
    '時間切れの場合：振り直さず、まだ選んでいない条件のうち一番上を選んだことになります。',
  ],
  init(players, rng: Rng) {
    const die = () => rng.int(1, 6);
    const base = Array.from({ length: S05_ROUNDS }, () => Array.from({ length: 5 }, die));
    const re = Array.from({ length: S05_ROUNDS }, () => players.map(() => Array.from({ length: 5 }, die)));
    return { players: [...players], base, re, luck: newLuckBook(luckSeed({ base, re })), round: 0, current: players.map(() => null), phase: 'pick', acks: players.map(() => false), used: players.map(() => [false, false, false]), log: [], points: players.map(() => 0), stage: '0' };
  },
  pending(s) {
    if (s.phase === 'pick') return s.players.filter((_, i) => s.current[i] === null);
    if (s.phase === 'show') return s.players.filter((_, i) => !s.acks[i]);
    return [];
  },
  stage(s) {
    return s.phase === 'done' ? { label: '終了' } : s.phase === 'show' ? { label: `ラウンド ${s.round + 1} の結果`, time: 12_000 } : { label: `ラウンド ${s.round + 1} / ${S05_ROUNDS}`, time: S05_MS };
  },
  validate(s, p, m) {
    const i = s.players.indexOf(p);
    if (!m || i < 0) return false;
    if (s.phase === 'show') return m.t === 'ok' && !s.acks[i];
    return s.phase === 'pick' && m.t === 'roll' && s.current[i] === null && S05_CONDS.includes(m.cond as 0) && !s.used[i][m.cond] && Array.isArray(m.re) && m.re.length <= 5 && new Set(m.re).size === m.re.length && m.re.every((x) => Number.isInteger(x) && x >= 0 && x < 5);
  },
  defaultMove(s, p) {
    return s.phase === 'show' ? { t: 'ok' } : { t: 'roll', re: [], cond: s.used[s.players.indexOf(p)].indexOf(false) };
  },
  submit(s, p, m) {
    if (!this.validate(s, p, m)) throw new Error(`s05: illegal move ${JSON.stringify(m)}`);
    const i = s.players.indexOf(p);
    if (m.t === 'ok') {
      s.acks[i] = true;
      if (!s.acks.every(Boolean)) return;
      s.acks = s.players.map(() => false);
      s.round += 1;
      s.stage = String(s.round);
      s.phase = s.round >= S05_ROUNDS ? 'done' : 'pick';
      return;
    }
    s.current[i] = { t: 'roll', re: [...m.re].sort((a, b) => a - b), cond: m.cond };
    if (s.current.some((c) => c === null)) return;
    const base = s.base[s.round];
    const book = (s.luck ??= newLuckBook(luckSeed(s)));
    const picks = s.current.map((c, k) => {
      // 振り直しの出目にだけ運が効く。発動したら、振り直したサイコロだけをもう 1 回振った出目を 2 つ目の候補にする
      // （共通のサイコロ、相手の出目は変えない。振り直していなければ「候補なし」）
      const rolled = base.map((d, j) => (c!.re.includes(j) ? s.re[s.round][k][j] : d));
      const dice = luckPick(book, s.players[k], rolled, () => (c!.re.length ? base.map((d, j) => (c!.re.includes(j) ? 1 + Math.floor(luckNext(book) * 6) : d)) : undefined), luckScore(c!.cond));
      const ok = holds(c!.cond, dice);
      if (ok) s.points[k] += S05_POINT;
      s.used[k][c!.cond] = true;
      return { re: c!.re, cond: c!.cond, dice, ok };
    });
    s.log.push({ base: [...base], picks });
    s.current = s.players.map(() => null);
    s.phase = 'show';
    s.stage = `${s.round}s`;
  },
  view(s, p) {
    const me = p === 'spectator' ? -1 : s.players.indexOf(p);
    return { self: p, me, players: s.players, round: s.round, base: [...s.base[Math.min(s.round, S05_ROUNDS - 1)]], phase: s.phase, submitted: me >= 0 && s.current[me] !== null, acked: me >= 0 && s.acks[me], used: s.used.map((u) => [...u]), log: s.log, points: [...s.points] };
  },
  ai,
  done(s) {
    return s.phase === 'done';
  },
  scores(s) {
    return Object.fromEntries(s.players.map((p, i) => [p, s.points[i]]));
  },
  ranking(s) {
    return sortGroups(s.players, (p) => s.points[s.players.indexOf(p)]);
  },
};
