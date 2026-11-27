/**
 * P02 四つの金庫（4人）
 * 4 つの金庫に、それぞれ異なる 3 桁の暗証番号（数字の重複なし、先頭 0 可）。
 * 順番に、まだ開いていない金庫へ 3 桁を入力する。位置も数字も合った数と、数字だけ合った数が公開される。
 * v02 改訂：金庫ごとの「位置一致の最高記録」を更新すると、増えた分だけ +1 点。開錠は +5 点。
 */
import type { CharId } from '../data/characters';
import type { Rng } from '../core/rng';
import { skill, sortGroups, type AiCtx, type MatchEngine } from './types';

export const SAFES = 4;
export const INPUTS_EACH = 12;
export const OPEN_POINTS = 5;

export type P02Move = { t: 'guess'; safe: number; code: string };

export interface P02Guess {
  by: CharId;
  safe: number;
  code: string;
  hit: number;
  blow: number;
  /** この入力で得た点 */
  gain: number;
}

export interface P02State {
  players: CharId[];
  codes: string[];
  opened: (CharId | null)[];
  best: number[];
  score: Record<string, number>;
  left: Record<string, number>;
  /** 手番の位置（players の添字） */
  turn: number;
  history: P02Guess[];
  stage: 'play' | 'done';
}

export interface P02View {
  self: CharId | 'spectator';
  players: CharId[];
  /** 開いた金庫の番号だけが見える */
  codes: (string | null)[];
  opened: (CharId | null)[];
  best: number[];
  score: Record<string, number>;
  left: Record<string, number>;
  current: CharId | null;
  history: P02Guess[];
  stage: P02State['stage'];
}

/** 数字の重複がない 3 桁の全候補（720 通り） */
export const ALL_CODES: string[] = (() => {
  const out: string[] = [];
  for (let a = 0; a < 10; a++) for (let b = 0; b < 10; b++) for (let c = 0; c < 10; c++) if (a !== b && b !== c && a !== c) out.push(`${a}${b}${c}`);
  return out;
})();

export const validCode = (c: unknown): c is string => typeof c === 'string' && /^\d{3}$/.test(c) && new Set(c).size === 3;

export function judge(code: string, guess: string): { hit: number; blow: number } {
  let hit = 0;
  let blow = 0;
  for (let i = 0; i < 3; i++) {
    if (guess[i] === code[i]) hit++;
    else if (code.includes(guess[i])) blow++;
  }
  return { hit, blow };
}

function advance(s: P02State): void {
  if (s.opened.every((o) => o !== null) || s.players.every((p) => s.left[p] <= 0)) {
    s.stage = 'done';
    return;
  }
  for (let i = 0; i < s.players.length; i++) {
    s.turn = (s.turn + 1) % s.players.length;
    if (s.left[s.players[s.turn]] > 0) return;
  }
  s.stage = 'done';
}

/** 公開された履歴と矛盾しない候補 */
export function candidates(history: P02Guess[], safe: number): string[] {
  const hs = history.filter((g) => g.safe === safe);
  return ALL_CODES.filter((c) => hs.every((g) => {
    const j = judge(c, g.code);
    return j.hit === g.hit && j.blow === g.blow;
  }));
}

function p02Ai(v: P02View, ctx: AiCtx): P02Move {
  const open = v.opened.map((o, i) => (o === null ? i : -1)).filter((i) => i >= 0);
  const mem = skill(ctx.stats.memory);
  // 記憶の欠落：古い履歴の一部を見落とすことがある
  const seen = v.history.filter((_g, i) => i >= v.history.length - 6 || !ctx.rng.chance(ctx.memoryLoss * (1 - mem)));
  let best: { safe: number; code: string; ev: number } | null = null;
  for (const safe of open) {
    let cands = candidates(seen, safe);
    const tried = new Set(v.history.filter((g) => g.safe === safe).map((g) => g.code));
    cands = cands.filter((c) => !tried.has(c));
    if (!cands.length) cands = ALL_CODES.filter((c) => !tried.has(c));
    const code = ctx.rng.pick(cands);
    // 開錠の見込み ×5 点 ＋ 記録更新の見込み
    const pOpen = 1 / cands.length;
    const sample = cands.length > 40 ? Array.from({ length: 40 }, () => ctx.rng.pick(cands)) : cands;
    let rec = 0;
    for (const c of sample) {
      const h = judge(c, code).hit;
      if (h < 3 && h > v.best[safe]) rec += h - v.best[safe];
    }
    const ev = pOpen * OPEN_POINTS + rec / sample.length + ctx.rng.gauss(0, 0.25 * ctx.noise);
    if (!best || ev > best.ev) best = { safe, code, ev };
  }
  return { t: 'guess', safe: best!.safe, code: best!.code };
}

export const P02: MatchEngine<P02State, P02Move, P02View> = {
  id: 'p02',
  name: '四つの金庫',
  kind: 'prison',
  minPlayers: 2,
  maxPlayers: 4,
  summary: '4 つの金庫の暗証番号を、公開される手掛かりから推理して開ける。',
  rules: [
    '金庫が 4 つあります。暗証番号はそれぞれ異なる 3 桁で、同じ数字は 2 度使われません（先頭が 0 のこともあります）。',
    '順番に、まだ開いていない金庫を 1 つ選んで 3 桁を入力します。入力できるのは 1 人 12 回までです。',
    '入力するたびに「位置も数字も合っている数（一致）」と「数字は合っているが位置が違う数（数字のみ）」が全員に公開されます。入力した番号も公開されます。',
    '3 桁すべて一致で開錠し、+5 点。開いた金庫にはもう入力できません。',
    '金庫ごとに「一致の最高記録」があります（最初は 0）。開いていない金庫で記録を 1 か 2 に更新すると、増えた分だけ +1 点です。',
    '同じ金庫に、すでに入力された番号をもう一度入力することはできません。',
    '4 つすべてが開くか、全員が 12 回の入力を終えたら終了です。合計点の最下位が脱落します。同点は共通決定戦で決めます。',
    '時間切れの場合：開いていない最初の金庫に、まだ入力されていない最も小さい番号を入力します。',
  ],
  init(players, rng) {
    const codes: string[] = [];
    while (codes.length < SAFES) {
      const c = rng.pick(ALL_CODES);
      if (!codes.includes(c)) codes.push(c);
    }
    return {
      players: [...players],
      codes,
      opened: Array.from({ length: SAFES }, () => null),
      best: Array.from({ length: SAFES }, () => 0),
      score: Object.fromEntries(players.map((p) => [p, 0])),
      left: Object.fromEntries(players.map((p) => [p, INPUTS_EACH])),
      turn: 0,
      history: [],
      stage: 'play',
    };
  },
  pending(s) {
    return s.stage === 'done' ? [] : [s.players[s.turn]];
  },
  stage(s) {
    if (s.stage === 'done') return { label: '終了' };
    return { label: `${s.history.length + 1} 手目`, time: 45_000 };
  },
  validate(s, p, m) {
    if (s.stage !== 'play' || !m || m.t !== 'guess' || s.players[s.turn] !== p || s.left[p] <= 0) return false;
    if (!Number.isInteger(m.safe) || m.safe < 0 || m.safe >= SAFES || s.opened[m.safe] !== null || !validCode(m.code)) return false;
    return !s.history.some((g) => g.safe === m.safe && g.code === m.code);
  },
  defaultMove(s) {
    const safe = s.opened.findIndex((o) => o === null);
    const tried = new Set(s.history.filter((g) => g.safe === safe).map((g) => g.code));
    return { t: 'guess', safe, code: ALL_CODES.find((c) => !tried.has(c))! };
  },
  submit(s, p, m) {
    if (!this.validate(s, p, m)) throw new Error(`p02: illegal move ${JSON.stringify(m)}`);
    const { hit, blow } = judge(s.codes[m.safe], m.code);
    let gain = 0;
    if (hit === 3) {
      gain = OPEN_POINTS;
      s.opened[m.safe] = p;
    } else if (hit > s.best[m.safe]) {
      gain = hit - s.best[m.safe];
      s.best[m.safe] = hit;
    }
    s.score[p] += gain;
    s.left[p] -= 1;
    s.history.push({ by: p, safe: m.safe, code: m.code, hit, blow, gain });
    advance(s);
  },
  view(s, p) {
    return {
      self: p,
      players: s.players,
      codes: s.codes.map((c, i) => (s.opened[i] !== null || s.stage === 'done' ? c : null)),
      opened: [...s.opened],
      best: [...s.best],
      score: { ...s.score },
      left: { ...s.left },
      current: s.stage === 'done' ? null : s.players[s.turn],
      history: s.history,
      stage: s.stage,
    };
  },
  ai: p02Ai,
  done(s) {
    return s.stage === 'done';
  },
  scores(s) {
    return { ...s.score };
  },
  ranking(s) {
    return sortGroups(s.players, (p) => s.score[p]);
  },
};

export type { Rng };
