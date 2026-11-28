/**
 * H01 賢者の金庫（裏ゲーム、1 人）
 * 6 つの条件から、6 桁の数を割り出す。入力は 5 回まで、制限時間 3 分。全部の桁が合えば開く。
 */
import type { CharId } from '../data/characters';
import { H01_ANSWER, H01_CLUES } from '../story/hiddendata';
import { sortGroups, type AiCtx, type MatchEngine } from './types';

export const H01_MS = 180_000;
export const H01_MAX = 5;

export type H01Move = { t: 'try'; code: string } | { t: 'giveup' };
export interface H01State { players: CharId[]; tries: string[]; solved: boolean; phase: 'play' | 'done'; stage: string }
export interface H01View { self: CharId | 'spectator'; clues: string[]; tries: string[]; left: number; solved: boolean; phase: H01State['phase'] }

const valid = (c: unknown): c is string => typeof c === 'string' && /^[1-6]{6}$/.test(c) && new Set(c).size === 6;

/** 条件をすべて満たす数（1 つだけになることをテストで確かめる） */
export function h01Candidates(clues = H01_CLUES.map((_, i) => i)): string[] {
  const out: string[] = [];
  const rec = (d: number[]) => {
    if (d.length === 6) { if (clues.every((i) => H01_CLUES[i].ok(d))) out.push(d.join('')); return; }
    for (let x = 1; x <= 6; x++) if (!d.includes(x)) rec([...d, x]);
  };
  rec([]);
  return out;
}

function ai(v: H01View, ctx: AiCtx): H01Move {
  const cand = h01Candidates().filter((c) => !v.tries.includes(c));
  return cand.length ? { t: 'try', code: cand[ctx.rng.int(0, cand.length - 1)] } : { t: 'giveup' };
}

export const H01: MatchEngine<H01State, H01Move, H01View> = {
  id: 'h01',
  name: '賢者の金庫',
  kind: 'hidden',
  minPlayers: 1,
  maxPlayers: 1,
  summary: '6 つの条件から、金庫の 6 桁の数を割り出す。',
  rules: [
    '金庫を開ける 6 桁の数を、6 つの条件から割り出します。',
    '数字は 1 から 6 を 1 回ずつ使います。',
    '入力は 5 回まで。制限時間は 3 分です。全部の桁が合えば開きます。',
    '違っていた時、どの桁が違うかは分かりません。条件を読み直してください。',
    '時間切れ、または 5 回とも違った時は失敗です。時間をおいて、もう一度挑めます。',
  ],
  init(players) {
    return { players: [...players], tries: [], solved: false, phase: 'play', stage: '0' };
  },
  pending(s) {
    return s.phase === 'done' ? [] : [...s.players];
  },
  stage(s) {
    return s.phase === 'done' ? { label: '終了' } : { label: `入力 ${s.tries.length + 1} / ${H01_MAX}`, time: H01_MS };
  },
  validate(s, p, m) {
    if (!m || s.phase !== 'play' || !s.players.includes(p)) return false;
    return m.t === 'giveup' || (m.t === 'try' && valid(m.code) && !s.tries.includes(m.code));
  },
  defaultMove() {
    return { t: 'giveup' };
  },
  submit(s, p, m) {
    if (!this.validate(s, p, m)) throw new Error('h01: illegal move');
    if (m.t === 'giveup') { s.phase = 'done'; return; }
    s.tries.push(m.code);
    if (m.code === H01_ANSWER) { s.solved = true; s.phase = 'done'; } else if (s.tries.length >= H01_MAX) s.phase = 'done';
  },
  view(s, p) {
    return { self: p, clues: H01_CLUES.map((c) => c.text), tries: [...s.tries], left: H01_MAX - s.tries.length, solved: s.solved, phase: s.phase };
  },
  ai,
  done(s) {
    return s.phase === 'done';
  },
  scores(s) {
    return Object.fromEntries(s.players.map((p) => [p, s.solved ? 1 : 0]));
  },
  ranking(s) {
    return sortGroups(s.players, () => (s.solved ? 1 : 0));
  },
};
