/**
 * カード対決（M11 最後の王座の第 5 種目、H02 月下の賭場で共用。2 人）
 * 各自、1 から n までのカードを 1 枚ずつ持つ（決勝は 9 枚、賭場は 5 枚）。全 n ラウンド。
 * ラウンドごとに、目標の数（1 から n が 1 回ずつ、順番はくじ）が公開される。2 人が同時にカードを 1 枚出し、目標との差が小さい方が 1 勝。
 * 差が同じ時は 0.5 勝ずつ。出したカードは戻らない。勝ち数の多い方が勝ち。
 */
import type { CharId } from '../data/characters';
import type { Rng } from '../core/rng';
import { skill, sortGroups, type AiCtx, type MatchEngine } from './types';

export const MOVE_MS = 20_000;

export type DuelMove = { t: 'play'; card: number };
export interface DuelRound { target: number; cards: number[]; gain: number[] }

export interface DuelState {
  players: CharId[];
  n: number;
  targets: number[];
  round: number;
  hands: number[][];
  current: (number | null)[];
  wins: number[];
  log: DuelRound[];
  phase: 'play' | 'done';
  stage: string;
}

export interface DuelView {
  self: CharId | 'spectator';
  me: number;
  players: CharId[];
  n: number;
  round: number;
  phase: DuelState['phase'];
  /** 今のラウンドの目標（これから出る目標は見えない） */
  target: number | null;
  /** まだ出ていない目標の数（順番は分からない） */
  left: number[];
  hands: number[][];
  submitted: boolean;
  wins: number[];
  log: DuelRound[];
}

/** その目標に card を出した時、相手の手札に対して勝てる見込み（相手は目標に近いカードを出しやすいと見る） */
function winChance(card: number, target: number, opp: number[]): number {
  const mine = Math.abs(card - target);
  let sum = 0;
  let wsum = 0;
  for (const o of opp) {
    const d = Math.abs(o - target);
    const w = 1 / (1 + d * d);
    sum += w * (mine < d ? 1 : mine === d ? 0.5 : 0);
    wsum += w;
  }
  return wsum ? sum / wsum : 0.5;
}

/** CPU：今の目標で勝てる見込みと、そのカードを残した時にこれからの目標で役立つ度合いを比べて選ぶ */
function duelAi(v: DuelView, ctx: AiCtx): DuelMove {
  const hand = v.hands[v.me];
  const opp = v.hands[1 - v.me];
  if (hand.length === 1 || v.target === null) return { t: 'play', card: hand[0] };
  const st = skill(ctx.stats.strategy);
  const future = v.left;
  // 同じ考え方の 2 人が毎回同じカードを出すと引き分けが続くので、評価の高いカードほど出やすい、という選び方にする
  const temp = 0.12 + ctx.noise * 0.2 + (1 - st) * 0.15;
  const vals = hand.map((c) => {
    const now = winChance(c, v.target!, opp);
    // このカードを残した場合に、これからの目標で見込める勝ち（一番合う目標 1 つ分）
    const keep = future.length ? Math.max(...future.map((f) => winChance(c, f, opp))) : 0;
    return now - keep * (0.45 + st * 0.35);
  });
  const top = Math.max(...vals);
  const w = vals.map((x) => Math.exp((x - top) / temp));
  let r = ctx.rng.next() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < hand.length; i++) { r -= w[i]; if (r <= 0) return { t: 'play', card: hand[i] }; }
  return { t: 'play', card: hand[hand.length - 1] };
}

export const DUEL: MatchEngine<DuelState, DuelMove, DuelView> = {
  id: 'duel',
  name: 'カード対決',
  kind: 'sub',
  minPlayers: 2,
  maxPlayers: 2,
  summary: '公開された目標の数に近いカードを、2 人が同時に出す。近い方が 1 勝。',
  rules: [
    '各自、1 から 9 までのカードを 1 枚ずつ持ちます（賭場では 1 から 5）。',
    'ラウンドごとに目標の数が公開されます。目標は 1 から 9 が 1 回ずつで、順番はくじです。',
    '2 人が同時にカードを 1 枚出し、目標との差が小さい方が 1 勝。差が同じ時は 0.5 勝ずつです。',
    '出したカードは戻りません。相手の残りのカードは、いつでも見られます。',
    '全ラウンドが終わって、勝ち数の多い方が勝ちです。',
    '時間切れの場合：手札の一番小さいカードが出ます。',
  ],
  init(players, rng: Rng, opts) {
    const n = Number(opts?.cards ?? 9);
    const full = () => Array.from({ length: n }, (_, i) => i + 1);
    return { players: [...players], n, targets: rng.shuffle(full()), round: 0, hands: [full(), full()], current: [null, null], wins: [0, 0], log: [], phase: 'play', stage: '0' };
  },
  pending(s) {
    return s.phase === 'done' ? [] : s.players.filter((_, i) => s.current[i] === null);
  },
  stage(s) {
    return s.phase === 'done' ? { label: '終了' } : { label: `ラウンド ${s.round + 1} / ${s.n}`, time: MOVE_MS };
  },
  validate(s, p, m) {
    const i = s.players.indexOf(p);
    return !!m && s.phase === 'play' && i >= 0 && s.current[i] === null && m.t === 'play' && s.hands[i].includes(m.card);
  },
  defaultMove(s, p) {
    return { t: 'play', card: Math.min(...s.hands[s.players.indexOf(p)]) };
  },
  submit(s, p, m) {
    if (!this.validate(s, p, m)) throw new Error(`duel: illegal move ${JSON.stringify(m)}`);
    const i = s.players.indexOf(p);
    s.current[i] = m.card;
    if (s.current.some((c) => c === null)) return;
    const cards = s.current as number[];
    const target = s.targets[s.round];
    const d = cards.map((c) => Math.abs(c - target));
    const gain = d[0] < d[1] ? [1, 0] : d[0] > d[1] ? [0, 1] : [0.5, 0.5];
    s.wins = [s.wins[0] + gain[0], s.wins[1] + gain[1]];
    s.hands = s.hands.map((h, k) => h.filter((c) => c !== cards[k]));
    s.log.push({ target, cards: [...cards], gain });
    s.current = [null, null];
    s.round += 1;
    s.stage = String(s.round);
    if (s.round >= s.n) s.phase = 'done';
  },
  view(s, p) {
    const me = p === 'spectator' ? -1 : s.players.indexOf(p);
    return {
      self: p, me, players: s.players, n: s.n, round: s.round, phase: s.phase,
      target: s.phase === 'play' ? s.targets[s.round] : null,
      left: s.targets.slice(s.round + 1).sort((a, b) => a - b),
      hands: s.hands.map((h) => [...h]), submitted: me >= 0 && s.current[me] !== null,
      wins: [...s.wins], log: s.log,
    };
  },
  ai: duelAi,
  done(s) {
    return s.phase === 'done';
  },
  scores(s) {
    return Object.fromEntries(s.players.map((p, i) => [p, s.wins[i]]));
  },
  ranking(s) {
    return sortGroups(s.players, (p) => s.wins[s.players.indexOf(p)]);
  },
};

/** H02 月下の賭場：カード対決を 1 から 5 のカードで行う（賭けるピースは、競技の外で扱う） */
export const H02: MatchEngine<DuelState, DuelMove, DuelView> = {
  ...DUEL,
  id: 'h02',
  name: '月下の賭場',
  kind: 'hidden',
  summary: '仮面のディーラーと、1 から 5 のカードで勝負する。目標の数に近いカードを同時に出す。',
  rules: [
    '始める前に、賭けるピース（1 から 3）を決めます。ディーラーも同じ数を出します。',
    '2 人とも、1 から 5 のカードを 1 枚ずつ持ちます。全 5 ラウンドです。',
    'ラウンドごとに目標の数が公開されます。目標は 1 から 5 が 1 回ずつで、順番はくじです。',
    '2 人が同時にカードを 1 枚出し、目標との差が小さい方が 1 勝。差が同じ時は 0.5 勝ずつです。',
    '勝ち数の多い方が、賭けたピースを全部受け取ります。同じ勝ち数なら、賭けたピースは戻ります。',
    '時間切れの場合：手札の一番小さいカードが出ます。',
  ],
  init(players, rng, opts) {
    return DUEL.init(players, rng, { ...opts, cards: 5 });
  },
};
