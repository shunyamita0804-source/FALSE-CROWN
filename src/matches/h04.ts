/**
 * H04 囚人の遺言（裏ゲーム、1 人）
 * 集めた 5 通の手紙を読み、5 つの問いの答えの札を、それぞれの枠に置く。4 問以上合えば成功。
 */
import type { CharId } from '../data/characters';
import { H04_PASS, H04_QUESTIONS, LETTERS } from '../story/hiddendata';
import { skill, sortGroups, type AiCtx, type MatchEngine } from './types';

export const H04_MS = 300_000;
export type H04Move = { t: 'answer'; a: number[] } | { t: 'giveup' };
export interface H04State { players: CharId[]; answers: number[] | null; correct: number; phase: 'play' | 'done'; stage: string }
export interface H04View {
  self: CharId | 'spectator';
  letters: { id: string; title: string; text: string }[];
  questions: { prompt: string; options: string[] }[];
  /** 終了後だけ：出した答えと、問いごとの正誤 */
  answers: number[] | null;
  marks: boolean[] | null;
  correct: number;
  pass: number;
  phase: H04State['phase'];
}

function ai(_v: H04View, ctx: AiCtx): H04Move {
  const lg = skill(ctx.stats.logic);
  return { t: 'answer', a: H04_QUESTIONS.map((q) => (ctx.rng.chance(0.75 + lg * 0.22 - ctx.noise * 0.1) ? q.answer : ctx.rng.int(0, q.options.length - 1))) };
}

export const H04: MatchEngine<H04State, H04Move, H04View> = {
  id: 'h04',
  name: '囚人の遺言',
  kind: 'hidden',
  minPlayers: 1,
  maxPlayers: 1,
  summary: '5 通の手紙を読み比べて、5 つの問いに答える。4 問以上合えば成功。',
  rules: [
    '集めた 5 通の手紙を読み比べて、5 つの問いに答えます。',
    '問いごとに 3 枚の札があります。答えの札をタップして選びます。選び直せます。',
    '手紙は、番号をタップするといつでも読めます。',
    '5 問とも選んだら「答えを出す」。4 問以上合えば成功です。',
    '制限時間は 5 分。失敗した時は、次の日にもう一度挑めます。',
  ],
  init(players) {
    return { players: [...players], answers: null, correct: 0, phase: 'play', stage: '0' };
  },
  pending(s) {
    return s.phase === 'done' ? [] : [...s.players];
  },
  stage(s) {
    return s.phase === 'done' ? { label: '終了' } : { label: '5 つの問い', time: H04_MS };
  },
  validate(s, p, m) {
    if (!m || s.phase !== 'play' || !s.players.includes(p)) return false;
    return m.t === 'giveup' || (m.t === 'answer' && Array.isArray(m.a) && m.a.length === H04_QUESTIONS.length && m.a.every((x, i) => Number.isInteger(x) && x >= 0 && x < H04_QUESTIONS[i].options.length));
  },
  defaultMove() {
    return { t: 'giveup' };
  },
  submit(s, p, m) {
    if (!this.validate(s, p, m)) throw new Error('h04: illegal move');
    if (m.t === 'answer') { s.answers = [...m.a]; s.correct = m.a.filter((x, i) => x === H04_QUESTIONS[i].answer).length; }
    s.phase = 'done';
  },
  view(s, p) {
    return {
      self: p, letters: LETTERS, questions: H04_QUESTIONS.map((q) => ({ prompt: q.prompt, options: q.options })),
      answers: s.phase === 'done' ? s.answers : null, marks: s.phase === 'done' && s.answers ? s.answers.map((x, i) => x === H04_QUESTIONS[i].answer) : null,
      correct: s.correct, pass: H04_PASS, phase: s.phase,
    };
  },
  ai,
  done(s) {
    return s.phase === 'done';
  },
  scores(s) {
    return Object.fromEntries(s.players.map((p) => [p, s.correct]));
  },
  ranking(s) {
    return sortGroups(s.players, () => s.correct);
  },
};
export const h04Passed = (s: H04State) => s.correct >= H04_PASS;
