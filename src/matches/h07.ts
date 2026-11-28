/**
 * H07 十二の証明（裏ゲーム、1 人）
 * 12 人それぞれについて、CROWN 計画との関わりを 3 つの札から選び、その根拠になる資料を 12 枚から選ぶ。
 * 全部合えば成功。違っている時は、どの人の項目に食い違いがあるかだけが分かる。何度でも出し直せる。
 */
import type { CharId } from '../data/characters';
import { EVIDENCE, H07_QUESTIONS } from '../story/hiddendata';
import { skill, sortGroups, type AiCtx, type MatchEngine } from './types';

export const H07_MS = 480_000;
export interface H07Answer { opt: number; ev: string }
export type H07Move = { t: 'answer'; a: H07Answer[] } | { t: 'giveup' };
export interface H07State { players: CharId[]; tries: number; wrong: number[] | null; last: H07Answer[] | null; solved: boolean; phase: 'play' | 'done'; stage: string }
export interface H07View {
  self: CharId | 'spectator';
  people: { id: string; name: string; options: string[] }[];
  evidence: { id: string; text: string }[];
  tries: number;
  /** 直前に出した答えで、食い違いのあった人の番号 */
  wrong: number[] | null;
  last: H07Answer[] | null;
  solved: boolean;
  phase: H07State['phase'];
}

export const h07Wrong = (a: H07Answer[]): number[] => H07_QUESTIONS.map((q, i) => (a[i] && a[i].opt === q.answer && a[i].ev === q.evidence[0] ? -1 : i)).filter((i) => i >= 0);

function ai(v: H07View, ctx: AiCtx): H07Move {
  const lg = skill(ctx.stats.logic);
  const mem = skill(ctx.stats.memory); // 副：読んだ資料の記憶
  // 資料には名前が書いてあるので、読めば合う。読み違いが時々ある。食い違いを指摘された項目は読み直す
  return { t: 'answer', a: H07_QUESTIONS.map((q, i) => {
    if (v.last && v.wrong && !v.wrong.includes(i)) return v.last[i];
    const slip = ctx.rng.chance((1 - lg) * 0.09 + (1 - mem) * 0.03 + ctx.noise * 0.05);
    return { opt: slip ? ctx.rng.int(0, 2) : q.answer, ev: q.evidence[0] };
  }) };
}

export const H07: MatchEngine<H07State, H07Move, H07View> = {
  id: 'h07',
  name: '十二の証明',
  kind: 'hidden',
  minPlayers: 1,
  maxPlayers: 1,
  summary: '12 人と計画との関わりを、資料を根拠にして 1 人ずつ結び付ける。',
  rules: [
    '12 人それぞれについて、計画との関わりを 3 つの札から選びます。',
    'その根拠になる資料を、12 枚の中から 1 枚選びます。資料はタップすると読めます。',
    '12 人ぶんを選んだら「照らし合わせる」。全部合えば成功です。',
    '違っている時は、どの人の項目に食い違いがあるかだけが分かります。何度でも出し直せます。',
    '制限時間は 8 分。時間切れでも、あとでもう一度挑めます。',
  ],
  init(players) {
    return { players: [...players], tries: 0, wrong: null, last: null, solved: false, phase: 'play', stage: '0' };
  },
  pending(s) {
    return s.phase === 'done' ? [] : [...s.players];
  },
  stage(s) {
    return s.phase === 'done' ? { label: '終了' } : { label: '12 人の資料', time: H07_MS };
  },
  validate(s, p, m) {
    if (!m || s.phase !== 'play' || !s.players.includes(p)) return false;
    return m.t === 'giveup' || (m.t === 'answer' && Array.isArray(m.a) && m.a.length === H07_QUESTIONS.length && m.a.every((x) => x && Number.isInteger(x.opt) && x.opt >= 0 && x.opt < 3 && EVIDENCE.some((e) => e.id === x.ev)));
  },
  defaultMove() {
    return { t: 'giveup' };
  },
  submit(s, p, m) {
    if (!this.validate(s, p, m)) throw new Error('h07: illegal move');
    if (m.t === 'giveup') { s.phase = 'done'; return; }
    s.tries += 1;
    s.last = m.a.map((x) => ({ opt: x.opt, ev: x.ev }));
    s.wrong = h07Wrong(m.a);
    if (!s.wrong.length) { s.solved = true; s.phase = 'done'; }
  },
  view(s, p) {
    return {
      self: p, people: H07_QUESTIONS.map((q, i) => ({ id: EVIDENCE[i].person, name: q.prompt, options: q.options })), evidence: EVIDENCE.map((e) => ({ id: e.id, text: e.text })),
      tries: s.tries, wrong: s.wrong ? [...s.wrong] : null, last: s.last ? s.last.map((x) => ({ ...x })) : null, solved: s.solved, phase: s.phase,
    };
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
