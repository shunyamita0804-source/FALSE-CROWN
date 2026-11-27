/**
 * H08 神の方程式（裏ゲーム、1 人、段階ごとに保存）
 * 5 つの段階を順に解く：①数字を文字に直す、②数の列、③ 3 つの箱、④全部の印を通る道、⑤記録の読み取り。
 * 段階ごとに 3 分。時間切れは中断で、次は解けた段階の続きから始められる。間違えても入れ直せる。
 */
import type { CharId } from '../data/characters';
import type { Rng } from '../core/rng';
import { H08_CIPHER, H08_FINAL, H08_LOGIC, H08_SEQ } from '../story/hiddendata';
import { makeMaze, solveFrom, trace, type Maze } from './p06';
import { sortGroups, type MatchEngine } from './types';

export const H08_MS = 180_000;
export const H08_STAGES = 5;

export type H08Move = { t: 'text'; v: string } | { t: 'num'; v: number } | { t: 'pick'; i: number } | { t: 'path'; path: number[] } | { t: 'pause' };
export interface H08State { players: CharId[]; idx: number; from: number; maze: Maze; misses: number; phase: 'play' | 'done'; stage: string }
export interface H08View {
  self: CharId | 'spectator';
  idx: number;
  total: number;
  cipher: number[];
  seq: { prompt: string; seq: number[] };
  logic: { prompt: string; lines: string[]; options: string[] };
  maze: Maze;
  final: { prompt: string; options: string[] };
  misses: number;
  phase: H08State['phase'];
}

/** 大文字と小文字、全角と半角をそろえる */
export const normalize = (v: string) => v.normalize('NFKC').replace(/\s+/g, '').toUpperCase();

function ai(v: H08View): H08Move {
  if (v.idx === 0) return { t: 'text', v: v.cipher.map((n) => String.fromCharCode(64 + n)).join('') };
  if (v.idx === 1) return { t: 'num', v: v.seq.seq[v.seq.seq.length - 1] + 32 };
  if (v.idx === 2) return { t: 'pick', i: H08_LOGIC.answer };
  if (v.idx === 3) { const r = solveFrom(v.maze, [v.maze.start]); return r.path ? { t: 'path', path: r.path } : { t: 'pause' }; }
  return { t: 'pick', i: H08_FINAL.answer };
}

export const H08: MatchEngine<H08State, H08Move, H08View> = {
  id: 'h08',
  name: '神の方程式',
  kind: 'hidden',
  minPlayers: 1,
  maxPlayers: 1,
  summary: '観測端末の 5 つの段階を順に解く。解けた段階は保存される。',
  rules: [
    '観測端末の 5 つの段階を、順に解きます。',
    '①数字を文字に直す。②数の列の次の数。③ 3 つの箱の問い。④全部の印を通って出口へ行く道。⑤記録の読み取り。',
    '段階ごとに 3 分。間違えても、時間のあるかぎり入れ直せます。',
    '解けた段階は保存されます。時間切れや中断のあとは、続きの段階から始められます。',
    '5 つとも解けば成功です。',
  ],
  init(players, rng: Rng, opts) {
    const from = Math.max(0, Math.min(H08_STAGES - 1, Number(opts?.from ?? 0)));
    return { players: [...players], idx: from, from, maze: makeMaze(rng, 5), misses: 0, phase: 'play', stage: String(from) };
  },
  pending(s) {
    return s.phase === 'done' ? [] : [...s.players];
  },
  stage(s) {
    return s.phase === 'done' ? { label: '終了' } : { label: `段階 ${s.idx + 1} / ${H08_STAGES}`, time: H08_MS };
  },
  validate(s, p, m) {
    if (!m || s.phase !== 'play' || !s.players.includes(p)) return false;
    if (m.t === 'pause') return true;
    if (s.idx === 0) return m.t === 'text' && typeof m.v === 'string' && m.v.length <= 20;
    if (s.idx === 1) return m.t === 'num' && Number.isInteger(m.v) && m.v >= 0 && m.v < 10000;
    if (s.idx === 2 || s.idx === 4) return m.t === 'pick' && Number.isInteger(m.i) && m.i >= 0 && m.i < 3;
    return m.t === 'path' && Array.isArray(m.path) && m.path.length <= 60;
  },
  defaultMove() {
    return { t: 'pause' };
  },
  submit(s, p, m) {
    if (!this.validate(s, p, m)) throw new Error('h08: illegal move');
    if (m.t === 'pause') { s.phase = 'done'; return; }
    let ok = false;
    if (m.t === 'text') ok = normalize(m.v) === H08_CIPHER.answer;
    else if (m.t === 'num') ok = m.v === H08_SEQ.answer;
    else if (m.t === 'pick') ok = m.i === (s.idx === 2 ? H08_LOGIC.answer : H08_FINAL.answer);
    else { const r = trace(s.maze, m.path); ok = r.done && r.valid === m.path.length; }
    if (!ok) { s.misses += 1; return; }
    s.idx += 1;
    s.stage = String(s.idx);
    if (s.idx >= H08_STAGES) s.phase = 'done';
  },
  view(s, p) {
    return {
      self: p, idx: s.idx, total: H08_STAGES, cipher: H08_CIPHER.nums, seq: { prompt: H08_SEQ.prompt, seq: H08_SEQ.seq },
      logic: { prompt: H08_LOGIC.prompt, lines: H08_LOGIC.lines, options: H08_LOGIC.options }, maze: s.maze, final: { prompt: H08_FINAL.prompt, options: H08_FINAL.options },
      misses: s.misses, phase: s.phase,
    };
  },
  ai,
  done(s) {
    return s.phase === 'done';
  },
  scores(s) {
    return Object.fromEntries(s.players.map((p) => [p, s.idx]));
  },
  ranking(s) {
    return sortGroups(s.players, () => s.idx);
  },
};
