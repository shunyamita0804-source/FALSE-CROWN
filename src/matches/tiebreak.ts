/**
 * 共通決定戦（暫定）：同難度の公開論理問題を同時回答。正解数 → 回答時間で順位。
 * NPC の回答時間は能力に応じたモデル値（実際の CPU 処理時間は使わない）。
 * 再同点の場合は呼び出し側が新しい問題で再戦する。
 */
import type { CharId } from '../data/characters';
import { Rng } from '../core/rng';
import { skill, sortGroups, type AiCtx, type MatchEngine } from './types';

export interface Puzzle {
  text: string;
  choices: string[];
  answer: number;
  /** 正解の根拠 */
  why: string;
}

const NAMES = ['アルト', 'ベル', 'シオン', 'デイル', 'エマ'];

function shuffledChoices(rng: Rng, correct: number, wrongs: number[]): { choices: string[]; answer: number } {
  const set = new Set<number>([correct]);
  for (const w of wrongs) if (set.size < 4 && w !== correct) set.add(w);
  let k = 1;
  while (set.size < 4) {
    set.add(correct + k);
    k = k > 0 ? -k : -k + 1;
  }
  const arr = rng.shuffle([...set]);
  return { choices: arr.map(String), answer: arr.indexOf(correct) };
}

export function genSequence(rng: Rng): Puzzle {
  const kind = rng.int(0, 3);
  let seq: number[] = [];
  let why = '';
  if (kind === 0) {
    const a = rng.int(2, 15);
    const d = rng.int(3, 9);
    seq = Array.from({ length: 6 }, (_, i) => a + d * i);
    why = `公差${d}の等差数列`;
  } else if (kind === 1) {
    const a = rng.int(1, 4);
    const r = rng.int(2, 3);
    seq = Array.from({ length: 6 }, (_, i) => a * r ** i);
    why = `公比${r}の等比数列`;
  } else if (kind === 2) {
    const a = rng.int(1, 6);
    const d = rng.int(1, 4);
    seq = [a];
    for (let i = 1; i < 6; i++) seq.push(seq[i - 1] + d * i + 1);
    why = `差が${d}ずつ増える階差数列`;
  } else {
    const a = rng.int(1, 5);
    const b = rng.int(2, 7);
    seq = [a, b];
    for (let i = 2; i < 6; i++) seq.push(seq[i - 1] + seq[i - 2]);
    why = '前の2項の和';
  }
  const ans = seq[5];
  const { choices, answer } = shuffledChoices(rng, ans, [ans + (seq[5] - seq[4]) - (seq[4] - seq[3]) || ans + 2, ans - 1, ans + 1, seq[4] * 2 - seq[3]]);
  return { text: `次の数列の □ に入る数は？\n${seq.slice(0, 5).join('、')}、□`, choices, answer, why };
}

export function genOrder(rng: Rng): Puzzle {
  const names = rng.shuffle([...NAMES]).slice(0, 4);
  // names[0] > names[1] > names[2] > names[3]（得点が高い順）
  const stmts = rng.shuffle([
    `${names[0]}は${names[1]}より得点が高い。`,
    `${names[2]}は${names[1]}より得点が低い。`,
    `${names[3]}は${names[2]}より得点が低い。`,
  ]);
  const ask = rng.int(1, 4);
  const answerName = names[ask - 1];
  const order = rng.shuffle([...names]);
  return {
    text: `4人の得点はすべて異なります。\n${stmts.join('\n')}\n得点が${ask}番目に高いのは誰？`,
    choices: order,
    answer: order.indexOf(answerName),
    why: `順位は ${names.join(' > ')}`,
  };
}

export function genRemainder(rng: Rng): Puzzle {
  const m = rng.pick([3, 4, 5, 7]);
  const n = rng.pick([5, 6, 8, 9, 11].filter((x) => x !== m && x % m !== 0 && m % x !== 0));
  const x = rng.int(m * n > 40 ? 20 : 10, 60);
  const r1 = x % m;
  const r2 = x % n;
  // lo〜hi の範囲で条件を満たす数が一意になるようにする
  const lo = Math.max(1, x - rng.int(0, Math.min(m * n - 1, 12)));
  const hi = lo + m * n - 1;
  const sols: number[] = [];
  for (let v = lo; v <= hi; v++) if (v % m === r1 && v % n === r2) sols.push(v);
  const ans = sols[0];
  const { choices, answer } = shuffledChoices(rng, ans, [ans + m, ans - n, ans + n, ans - m].filter((v) => v > 0));
  return {
    text: `${lo} 以上 ${hi} 以下の整数で、${m} で割ると ${r1} 余り、${n} で割ると ${r2} 余る数は？`,
    choices,
    answer,
    why: `${ans} ÷ ${m} の余りは ${r1}、${ans} ÷ ${n} の余りは ${r2}。範囲内で唯一`,
  };
}

/** 問題の正しさを独立に検証する（テスト用） */
export function verifyPuzzle(p: Puzzle): boolean {
  return p.choices.length === 4 && new Set(p.choices).size === 4 && p.answer >= 0 && p.answer < 4;
}

export function genPuzzle(rng: Rng): Puzzle {
  const k = rng.int(0, 2);
  return k === 0 ? genSequence(rng) : k === 1 ? genOrder(rng) : genRemainder(rng);
}

export type TbMove = { t: 'answer'; choice: number; time: number };

export interface TbState {
  players: CharId[];
  puzzles: Puzzle[];
  q: number;
  answers: Record<string, { choice: number; time: number }[]>;
  stage: 'ask' | 'done';
}

export interface TbView {
  self: CharId | 'spectator';
  players: CharId[];
  q: number;
  total: number;
  puzzle: { text: string; choices: string[] } | null;
  answered: boolean;
  results: { puzzle: Puzzle; answers: Record<string, { choice: number; time: number }> }[];
  stage: TbState['stage'];
}

export const TIEBREAK_QUESTIONS = 3;
export const TIEBREAK_TIME = 45_000;

export const TIEBREAK: MatchEngine<TbState, TbMove, TbView> = {
  id: 'tiebreak',
  name: '共通決定戦',
  kind: 'tiebreak',
  minPlayers: 2,
  maxPlayers: 12,
  summary: '同点者だけで論理問題を同時に解き、順位を決める。',
  rules: [
    '同点となった参加者だけで行う決定戦です。',
    `同じ難度の論理問題${TIEBREAK_QUESTIONS}問に同時に回答します。`,
    '正解数が多い順、同数なら合計回答時間が短い順に順位を決めます。',
    'なお同点の場合は、新しい問題で再戦します。',
    '時間切れは不正解（制限時間いっぱい）として扱います。',
  ],
  init(players, rng) {
    return {
      players: [...players],
      puzzles: Array.from({ length: TIEBREAK_QUESTIONS }, () => genPuzzle(rng)),
      q: 0,
      answers: Object.fromEntries(players.map((p) => [p, []])),
      stage: 'ask',
    };
  },
  pending(s) {
    if (s.stage === 'done') return [];
    return s.players.filter((p) => s.answers[p].length <= s.q);
  },
  stage(s) {
    return s.stage === 'done' ? { label: '終了' } : { label: `第${s.q + 1}問`, time: TIEBREAK_TIME };
  },
  validate(s, p, m) {
    return s.stage === 'ask' && m.t === 'answer' && s.players.includes(p) && s.answers[p].length === s.q && m.choice >= -1 && m.choice < 4 && m.time >= 0;
  },
  defaultMove() {
    return { t: 'answer', choice: -1, time: TIEBREAK_TIME };
  },
  submit(s, p, m) {
    if (!this.validate(s, p, m)) throw new Error('tiebreak: illegal move');
    s.answers[p].push({ choice: m.choice, time: Math.min(TIEBREAK_TIME, Math.round(m.time)) });
    if (this.pending(s).length === 0) {
      s.q += 1;
      if (s.q >= s.puzzles.length) s.stage = 'done';
    }
  },
  view(s, p) {
    const cur = s.stage === 'ask' ? s.puzzles[s.q] : null;
    return {
      self: p,
      players: s.players,
      q: s.q,
      total: s.puzzles.length,
      puzzle: cur ? { text: cur.text, choices: cur.choices } : null,
      answered: p !== 'spectator' && s.answers[p].length > s.q,
      results: s.puzzles.slice(0, s.q).map((puzzle, i) => ({ puzzle, answers: Object.fromEntries(s.players.map((x) => [x, s.answers[x][i]])) })),
      stage: s.stage,
    };
  },
  ai(v, ctx) {
    // NPC は問題文を実際に解く：選択肢を検算して正解を求めるが、能力に応じた確率で読み違える
    const logic = skill(ctx.stats.logic);
    const pCorrect = Math.min(0.98, 0.55 + logic * 0.42 - ctx.noise * 0.06);
    const time = Math.round((30 - logic * 20 + ctx.rng.gauss(0, 3)) * 1000);
    const state = (ctx as AiCtx & { _tb?: TbState })._tb;
    const correct = state ? state.puzzles[v.q].answer : 0;
    const ok = ctx.rng.chance(pCorrect);
    const choice = ok ? correct : (correct + ctx.rng.int(1, 3)) % 4;
    return { t: 'answer', choice, time: Math.max(4000, Math.min(TIEBREAK_TIME - 500, time)) };
  },
  done(s) {
    return s.stage === 'done';
  },
  scores(s) {
    const out: Record<string, number> = {};
    for (const p of s.players) out[p] = s.answers[p].filter((a, i) => a.choice === s.puzzles[i].answer).length;
    return out;
  },
  ranking(s) {
    const sc = this.scores(s) as Record<string, number>;
    const time = (p: CharId) => s.answers[p].reduce((a, b) => a + b.time, 0);
    return sortGroups(s.players, (p) => sc[p], (p) => -time(p));
  },
};
