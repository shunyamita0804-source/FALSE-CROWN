/**
 * S04 記憶カード（サブゲーム、2 人）
 * 12 枚（6 組）のカードを伏せて並べる。自分の番に 2 枚めくり、同じ絵なら 2 枚とも取って、もう一度めくる。違えば伏せて交代。
 * 全部のカードが取られたら終わり。取った組の多い方が勝ち。
 */
import type { CharId } from '../data/characters';
import type { Rng } from '../core/rng';
import { skill, sortGroups, type AiCtx, type MatchEngine } from './types';

export const S04_CARDS = 12;
export const S04_MS = 20_000;
export const S04_SHOW_MS = 6_000;

export type S04Move = { t: 'flip'; cell: number } | { t: 'ok' };
export interface S04Show { who: number; a: number; b: number; fa: number; fb: number; hit: boolean }

export interface S04State {
  players: CharId[];
  faces: number[];
  /** -1 場にある、0 か 1 取った人 */
  owner: number[];
  turn: number;
  first: number;
  phase: 'flip' | 'show' | 'done';
  show: S04Show | null;
  acks: boolean[];
  pairs: number[];
  /** これまでにめくられたカード（2 人とも見ている） */
  seen: { cell: number; face: number }[];
  turns: number;
  stage: string;
}

export interface S04View {
  self: CharId | 'spectator';
  me: number;
  players: CharId[];
  owner: number[];
  turn: number;
  /** 表になっているカード（めくった 1 枚目、結果の確認中の 2 枚） */
  open: { cell: number; face: number }[];
  phase: S04State['phase'];
  show: S04Show | null;
  acked: boolean;
  pairs: number[];
  seen: { cell: number; face: number }[];
}

function ai(v: S04View, ctx: AiCtx): S04Move {
  if (v.phase === 'show') return { t: 'ok' };
  const field = v.owner.map((o, i) => (o === -1 ? i : -1)).filter((i) => i >= 0);
  const first = v.open.length === 1 ? v.open[0] : null;
  // 覚えているカード：めくられたことのあるカードのうち、忘れていないもの（記憶が低いほど、古いものほど忘れる）
  const mem = skill(ctx.stats.memory);
  const ob = skill(ctx.stats.observation); // 副：図柄の見分け
  const known = new Map<number, number>();
  const n = v.seen.length;
  v.seen.forEach((sn, i) => {
    if (v.owner[sn.cell] !== -1) return;
    const age = n - 1 - i;
    const forget = Math.min(0.9, ctx.memoryLoss + (1 - mem) * 0.1 + (1 - ob) * 0.03 + age * (0.01 + (1 - mem) * 0.035));
    // 同じ場面では同じ答えになるよう、カードと場面から決まる値で判定する
    const roll = ((sn.cell * 73 + i * 31 + n * 17 + ctx.self.length * 7) % 100) / 100;
    if (roll >= forget) known.set(sn.cell, sn.face);
  });
  const pick = (arr: number[]) => arr[ctx.rng.int(0, arr.length - 1)];
  if (first) {
    known.delete(first.cell);
    const mate = [...known.entries()].find(([, f]) => f === first.face);
    if (mate) return { t: 'flip', cell: mate[0] };
    const unknown = field.filter((c) => c !== first.cell && !known.has(c));
    return { t: 'flip', cell: pick(unknown.length ? unknown : field.filter((c) => c !== first.cell)) };
  }
  const byFace = new Map<number, number[]>();
  for (const [c, f] of known) byFace.set(f, [...(byFace.get(f) ?? []), c]);
  const pair = [...byFace.values()].find((cs) => cs.length >= 2);
  if (pair) return { t: 'flip', cell: pair[0] };
  const unknown = field.filter((c) => !known.has(c));
  return { t: 'flip', cell: pick(unknown.length ? unknown : field) };
}

export const S04: MatchEngine<S04State, S04Move, S04View> = {
  id: 's04',
  name: '記憶カード',
  kind: 'sub',
  minPlayers: 2,
  maxPlayers: 2,
  summary: '伏せたカードを 2 枚めくり、同じ絵なら取れる。取った組の多い方が勝ち。',
  rules: [
    '12 枚（6 組）のカードを伏せて並べます。絵は、形と記号の両方で見分けられます。',
    '自分の番に 2 枚めくります。同じ絵なら 2 枚とも取って、もう一度めくれます。',
    '違う絵なら、2 枚とも伏せて相手の番になります。めくられたカードは 2 人とも見られます。',
    '全部のカードが取られたら終わり。取った組の多い方が勝ち、同じ数なら引き分けです。',
    '時間切れの場合：場にあるカードのうち、一番左上がめくられます。',
  ],
  init(players, rng: Rng) {
    const faces = rng.shuffle(Array.from({ length: S04_CARDS }, (_, i) => Math.floor(i / 2)));
    return { players: [...players], faces, owner: Array(S04_CARDS).fill(-1), turn: 0, first: -1, phase: 'flip', show: null, acks: [false, false], pairs: [0, 0], seen: [], turns: 0, stage: '0' };
  },
  pending(s) {
    if (s.phase === 'flip') return [s.players[s.turn]];
    if (s.phase === 'show') return s.players.filter((_, i) => !s.acks[i]);
    return [];
  },
  stage(s) {
    return s.phase === 'done' ? { label: '終了' } : s.phase === 'show' ? { label: 'めくった結果', time: S04_SHOW_MS } : { label: s.first < 0 ? '1 枚目をめくる' : '2 枚目をめくる', time: S04_MS };
  },
  validate(s, p, m) {
    const i = s.players.indexOf(p);
    if (!m || i < 0) return false;
    if (s.phase === 'show') return m.t === 'ok' && !s.acks[i];
    return s.phase === 'flip' && m.t === 'flip' && i === s.turn && Number.isInteger(m.cell) && s.owner[m.cell] === -1 && m.cell !== s.first;
  },
  defaultMove(s) {
    if (s.phase === 'show') return { t: 'ok' };
    return { t: 'flip', cell: s.owner.findIndex((o, i) => o === -1 && i !== s.first) };
  },
  submit(s, p, m) {
    if (!this.validate(s, p, m)) throw new Error(`s04: illegal move ${JSON.stringify(m)}`);
    const i = s.players.indexOf(p);
    if (m.t === 'ok') {
      s.acks[i] = true;
      if (!s.acks.every(Boolean)) return;
      const sh = s.show!;
      s.show = null;
      s.acks = [false, false];
      if (!sh.hit) s.turn = 1 - s.turn;
      s.turns += 1;
      s.stage = `t${s.turns}`;
      s.phase = s.owner.every((o) => o !== -1) ? 'done' : 'flip';
      return;
    }
    s.seen.push({ cell: m.cell, face: s.faces[m.cell] });
    if (s.first < 0) {
      s.first = m.cell;
      s.stage = `t${s.turns}b`;
      return;
    }
    const a = s.first;
    const b = m.cell;
    const hit = s.faces[a] === s.faces[b];
    if (hit) { s.owner[a] = s.turn; s.owner[b] = s.turn; s.pairs[s.turn] += 1; }
    s.show = { who: s.turn, a, b, fa: s.faces[a], fb: s.faces[b], hit };
    s.first = -1;
    s.phase = 'show';
    s.stage = `t${s.turns}s`;
  },
  view(s, p) {
    const me = p === 'spectator' ? -1 : s.players.indexOf(p);
    const open = s.show ? [{ cell: s.show.a, face: s.show.fa }, { cell: s.show.b, face: s.show.fb }] : s.first >= 0 ? [{ cell: s.first, face: s.faces[s.first] }] : [];
    return { self: p, me, players: s.players, owner: [...s.owner], turn: s.turn, open, phase: s.phase, show: s.show, acked: me >= 0 && s.acks[me], pairs: [...s.pairs], seen: s.seen.map((x) => ({ ...x })) };
  },
  ai,
  done(s) {
    return s.phase === 'done';
  },
  scores(s) {
    return Object.fromEntries(s.players.map((p, i) => [p, s.pairs[i]]));
  },
  ranking(s) {
    return sortGroups(s.players, (p) => s.pairs[s.players.indexOf(p)]);
  },
};
