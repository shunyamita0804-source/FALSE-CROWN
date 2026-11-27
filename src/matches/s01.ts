/**
 * S01 数字当て（サブゲーム、2 人）
 * 2 人がそれぞれ、同じ数字を使わない 3 桁の「秘密の数」を決める。そのあと、2 人が同時に相手の数を推理する（最大 8 回）。
 * 推理するたびに、位置も数字も合っている数（ヒット）と、数字だけ合っている数（ブロー）が返る。少ない回数で当てた方が勝ち。
 */
import type { CharId } from '../data/characters';
import type { Rng } from '../core/rng';
import { skill, sortGroups, type AiCtx, type MatchEngine } from './types';

export const S01_MAX = 8;
export const S01_MS = 45_000;

export type S01Move = { t: 'secret'; code: string } | { t: 'guess'; code: string };
export interface S01Guess { code: string; hit: number; blow: number }

export interface S01State {
  players: CharId[];
  phase: 'secret' | 'guess' | 'done';
  secrets: (string | null)[];
  /** guesses[i]：i が相手の数に対して出した推理 */
  guesses: S01Guess[][];
  current: (string | null)[];
  solved: (number | null)[];
  round: number;
  stage: string;
}

export interface S01View {
  self: CharId | 'spectator';
  me: number;
  players: CharId[];
  phase: S01State['phase'];
  mySecret: string | null;
  guesses: S01Guess[][];
  solved: (number | null)[];
  round: number;
  submitted: boolean;
  /** 終了後だけ：2 人の秘密の数 */
  secrets: (string | null)[] | null;
}

export const validCode = (c: unknown): c is string => typeof c === 'string' && /^[0-9]{3}$/.test(c) && new Set(c).size === 3;

export function judge(secret: string, guess: string): { hit: number; blow: number } {
  let hit = 0;
  let blow = 0;
  for (let i = 0; i < 3; i++) {
    if (guess[i] === secret[i]) hit++;
    else if (secret.includes(guess[i])) blow++;
  }
  return { hit, blow };
}

export const ALL_CODES: string[] = (() => {
  const out: string[] = [];
  for (let a = 0; a < 10; a++) for (let b = 0; b < 10; b++) for (let c = 0; c < 10; c++) if (a !== b && b !== c && a !== c) out.push(`${a}${b}${c}`);
  return out;
})();

/** これまでの返事と矛盾しない候補 */
export function candidates(hist: S01Guess[]): string[] {
  return ALL_CODES.filter((c) => hist.every((g) => { const j = judge(c, g.code); return j.hit === g.hit && j.blow === g.blow; }));
}

function ai(v: S01View, ctx: AiCtx): S01Move {
  if (v.phase === 'secret') return { t: 'secret', code: ALL_CODES[ctx.rng.int(0, ALL_CODES.length - 1)] };
  const hist = v.guesses[v.me];
  // 論理が低いと、時々いちばん古い返事を見落とす
  const lg = skill(ctx.stats.logic);
  const use = hist.length > 1 && ctx.rng.chance((1 - lg) * 0.3 + ctx.noise * 0.1) ? hist.slice(1) : hist;
  let cand = candidates(use).filter((c) => !hist.some((g) => g.code === c));
  if (!cand.length) cand = candidates(hist);
  if (!cand.length) cand = ALL_CODES;
  return { t: 'guess', code: cand[ctx.rng.int(0, cand.length - 1)] };
}

export const S01: MatchEngine<S01State, S01Move, S01View> = {
  id: 's01',
  name: '数字当て',
  kind: 'sub',
  minPlayers: 2,
  maxPlayers: 2,
  summary: '相手が決めた 3 桁の数を、返事を手掛かりに当てる。少ない回数で当てた方が勝ち。',
  rules: [
    '2 人がそれぞれ、3 桁の秘密の数を決めます。同じ数字は 2 回使えません。',
    'そのあと、2 人が同時に相手の数を推理します。推理は最大 8 回です。',
    '推理するたびに返事が返ります。「ヒット」は位置も数字も合っている数、「ブロー」は数字だけ合っている数です。',
    '少ない回数で当てた方が勝ち。同じ回数なら引き分け。8 回で当てられなければ負けです。',
    '時間切れの場合：秘密の数は 012、推理は、まだ出していない一番小さい数になります。',
  ],
  init(players) {
    return { players: [...players], phase: 'secret', secrets: [null, null], guesses: [[], []], current: [null, null], solved: [null, null], round: 0, stage: 'secret' };
  },
  pending(s) {
    if (s.phase === 'secret') return s.players.filter((_, i) => s.secrets[i] === null);
    if (s.phase === 'guess') return s.players.filter((_, i) => s.solved[i] === null && s.current[i] === null);
    return [];
  },
  stage(s) {
    return s.phase === 'done' ? { label: '終了' } : s.phase === 'secret' ? { label: '秘密の数を決める', time: S01_MS } : { label: `推理 ${s.round + 1} / ${S01_MAX}`, time: S01_MS };
  },
  validate(s, p, m) {
    const i = s.players.indexOf(p);
    if (!m || i < 0 || !validCode(m.code)) return false;
    if (s.phase === 'secret') return m.t === 'secret' && s.secrets[i] === null;
    return s.phase === 'guess' && m.t === 'guess' && s.solved[i] === null && s.current[i] === null;
  },
  defaultMove(s, p) {
    if (s.phase === 'secret') return { t: 'secret', code: '012' };
    const i = s.players.indexOf(p);
    return { t: 'guess', code: ALL_CODES.find((c) => !s.guesses[i].some((g) => g.code === c))! };
  },
  submit(s, p, m) {
    if (!this.validate(s, p, m)) throw new Error(`s01: illegal move ${JSON.stringify(m)}`);
    const i = s.players.indexOf(p);
    if (m.t === 'secret') {
      s.secrets[i] = m.code;
      if (s.secrets.every((x) => x !== null)) { s.phase = 'guess'; s.stage = 'g0'; }
      return;
    }
    s.current[i] = m.code;
    if (s.players.some((_, k) => s.solved[k] === null && s.current[k] === null)) return;
    for (let k = 0; k < 2; k++) {
      const code = s.current[k];
      if (code === null) continue;
      const j = judge(s.secrets[1 - k]!, code);
      s.guesses[k].push({ code, ...j });
      if (j.hit === 3) s.solved[k] = s.guesses[k].length;
    }
    s.current = [null, null];
    s.round += 1;
    s.stage = `g${s.round}`;
    // 片方が当てたら、もう片方は同じ回数までしか意味がないので、そこで終わる
    if (s.solved.some((x) => x !== null) || s.round >= S01_MAX) s.phase = 'done';
  },
  view(s, p) {
    const me = p === 'spectator' ? -1 : s.players.indexOf(p);
    return {
      self: p, me, players: s.players, phase: s.phase, mySecret: me >= 0 ? s.secrets[me] : null,
      guesses: s.guesses.map((g) => g.map((x) => ({ ...x }))), solved: [...s.solved], round: s.round,
      submitted: me >= 0 && (s.phase === 'secret' ? s.secrets[me] !== null : s.current[me] !== null),
      secrets: s.phase === 'done' ? [...s.secrets] : null,
    };
  },
  ai,
  done(s) {
    return s.phase === 'done';
  },
  scores(s) {
    return Object.fromEntries(s.players.map((p, i) => [p, s.solved[i] === null ? 0 : S01_MAX + 1 - s.solved[i]!]));
  },
  ranking(s) {
    return sortGroups(s.players, (p) => { const k = s.solved[s.players.indexOf(p)]; return k === null ? 0 : S01_MAX + 1 - k; });
  },
};

export type { Rng };
