/**
 * M11 最後の王座（v11、2 人、決勝）
 * 5 つの種目を決まった順に行い、先に 3 勝した方が優勝する。3 勝した時点で終わる。
 * ① 図形（ピース・アセンブルの 3 問：4×4、5×5、6×6）② 記憶（瞬間記憶の 3 ラウンド）③ 数字の式（ナンバー・リレーの 3 問）
 * ④ 陣取り（六角領域の 2 人版）⑤ カード対決（1〜9 のカード、目標の数に近い方が勝ち、9 ラウンド）
 * 各種目は、これまでの競技と同じ規則と同じ採点で行う。種目が同点の時は、同じ難しさの新しい問題で再戦する。
 * ピースで買える補助、交渉、メダルは無い。CPU も同じ条件。
 */
import type { CharId } from '../data/characters';
import { Rng } from '../core/rng';
import { DUEL } from './duel';
import { M01 } from './m01';
import { M05 } from './m05';
import { M07 } from './m07';
import { P02 } from './p02';
import type { AiCtx, MatchEngine } from './types';

export const NEED = 3;
export const BETWEEN_MS = 30_000;

export interface EventDef {
  id: string;
  name: string;
  engine: MatchEngine;
  /** 決勝で使う分だけ進んだか（ラウンド数を短くするため） */
  finished: (sub: any) => boolean;
  /** 画面に出す「全 n 問」の差し替え */
  patch?: (view: any) => any;
}

const resultsLen = (sub: { players: CharId[]; results: Record<string, unknown[]> }) => sub.results[sub.players[0]].length;

export const EVENTS: EventDef[] = [
  { id: 'm01', name: '図形', engine: M01, finished: (s) => s.phase === 'done' || resultsLen(s) >= 3, patch: (v) => ({ ...v, stages: 3 }) },
  { id: 'p02', name: '記憶', engine: P02, finished: (s) => s.phase === 'done' || resultsLen(s) >= 3, patch: (v) => ({ ...v, rounds: 3 }) },
  { id: 'm05', name: '数字の式', engine: M05, finished: (s) => s.phase === 'done' || resultsLen(s) >= 3, patch: (v) => ({ ...v, rounds: 3, nextRegroup: false }) },
  { id: 'm07', name: '陣取り', engine: M07, finished: (s) => s.phase === 'done' },
  { id: 'duel', name: 'カード対決', engine: DUEL, finished: (s) => s.phase === 'done' },
];

/** ピースで買う補助の手（決勝では使えない） */
const AID_MOVES = new Set(['hint', 'aid', 'boost', 'extra', 'swap']);

export interface M11Result { event: number; rematch: number; winner: number; scores: number[] }
export type M11Move = { t: 'ready' } | Record<string, unknown>;

export interface M11State {
  players: CharId[];
  seed: number;
  event: number;
  rematch: number;
  phase: 'play' | 'between' | 'done';
  sub: any;
  wins: number[];
  results: M11Result[];
  ready: Record<string, boolean>;
  stage: string;
}

export interface M11View {
  self: CharId | 'spectator';
  players: CharId[];
  event: number;
  rematch: number;
  phase: M11State['phase'];
  wins: number[];
  results: M11Result[];
  ready: Record<string, boolean>;
  /** 進行中の種目の画面用の情報（種目の間は null） */
  sub: any;
  subId: string;
}

const ev = (s: Pick<M11State, 'event'>) => EVENTS[Math.min(s.event, EVENTS.length - 1)];
const startSub = (s: M11State) => { s.sub = ev(s).engine.init(s.players, Rng.derive(s.seed, `e${s.event}r${s.rematch}`), { final: true, cards: 9 }); };
const subStage = (s: M11State) => `${s.event}.${s.rematch}.${String(s.sub?.stage ?? '')}.${String(s.sub?.phase ?? '')}.${String(s.sub?.round ?? '')}`;

function closeEvent(s: M11State): void {
  const e = ev(s);
  const rank = e.engine.ranking(s.sub);
  const sc = e.engine.scores(s.sub);
  const scores = s.players.map((p) => sc[p] ?? 0);
  const winner = rank[0].length === 1 ? s.players.indexOf(rank[0][0]) : -1;
  s.results.push({ event: s.event, rematch: s.rematch, winner, scores });
  if (winner >= 0) s.wins[winner] += 1;
  s.ready = Object.fromEntries(s.players.map((p) => [p, false]));
  s.phase = s.wins.some((w) => w >= NEED) || (winner >= 0 && s.event >= EVENTS.length - 1) ? 'done' : 'between';
  s.stage = `${s.event}.${s.rematch}.between`;
}

export const M11: MatchEngine<M11State, M11Move, M11View> = {
  id: 'm11',
  name: '最後の王座',
  kind: 'final',
  minPlayers: 2,
  maxPlayers: 2,
  summary: '5 つの種目（図形、記憶、数字の式、陣取り、カード対決）を順に行い、先に 3 勝した方が優勝する。',
  rules: [
    '2 人で、5 つの種目を決まった順に行います。先に 3 勝した方が優勝です。3 勝した時点で終わります。',
    '① 図形：ピース・アセンブルの 3 問（4×4、5×5、6×6）。合計点の高い方が勝ち。',
    '② 記憶：瞬間記憶の 3 ラウンド（各 6 問）。合計点の高い方が勝ち。',
    '③ 数字の式：ナンバー・リレーの 3 問。目標は、各自が 3 つの候補から選びます。合計点の高い方が勝ち。',
    '④ 陣取り：六角領域の 2 人版（図形タイルは各自 12 枚）。得点の高い方が勝ち。',
    '⑤ カード対決：1〜9 のカードを 1 枚ずつ持ち、公開された目標の数に近いカードを同時に出します。近い方が 1 勝、同じ差は 0.5 勝ずつ。9 ラウンドの勝ち数で決めます。',
    '各種目の規則と採点は、これまでの競技と同じです。同点の時は、それぞれの競技の決め方（正解の数、時間など）で決めます。それでも同じ時は、同じ難しさの新しい問題で再戦します。',
    'ピースで買える補助、交渉、メダルはありません。相手も同じ条件です。',
    '負けた人は、ここで大会を去ります。',
  ],
  init(players, rng) {
    const s: M11State = {
      players: [...players], seed: rng.int(1, 2_000_000_000), event: 0, rematch: 0, phase: 'play', sub: null,
      wins: players.map(() => 0), results: [], ready: Object.fromEntries(players.map((p) => [p, false])), stage: '',
    };
    startSub(s);
    s.stage = subStage(s);
    return s;
  },
  pending(s) {
    if (s.phase === 'done') return [];
    if (s.phase === 'between') return s.players.filter((p) => !s.ready[p]);
    return ev(s).engine.pending(s.sub);
  },
  stage(s) {
    if (s.phase === 'done') return { label: '終了' };
    const e = ev(s);
    if (s.phase === 'between') return { label: `種目 ${s.event + 1} の結果`, time: BETWEEN_MS };
    const st = e.engine.stage(s.sub);
    // 元の競技の「全 n ラウンド」の表示は、決勝では問題数が違うので外す
    return { label: `種目 ${s.event + 1} / ${EVENTS.length}　${e.name}${s.rematch ? '（再戦）' : ''}　${st.label.replace(/\s*\/\s*\d+/, '')}`, time: st.time };
  },
  validate(s, p, m) {
    if (!m || s.phase === 'done' || !s.players.includes(p)) return false;
    if (s.phase === 'between') return (m as { t?: string }).t === 'ready' && !s.ready[p];
    if (AID_MOVES.has(String((m as { t?: string }).t))) return false;
    return ev(s).engine.validate(s.sub, p, m);
  },
  defaultMove(s, p) {
    return s.phase === 'between' ? { t: 'ready' } : ev(s).engine.defaultMove(s.sub, p);
  },
  submit(s, p, m) {
    if (!this.validate(s, p, m)) throw new Error(`m11: illegal move ${JSON.stringify(m).slice(0, 80)}`);
    if (s.phase === 'between') {
      s.ready[p] = true;
      if (!s.players.every((x) => s.ready[x])) return;
      const last = s.results[s.results.length - 1];
      if (last.winner >= 0) { s.event += 1; s.rematch = 0; } else s.rematch += 1;
      s.phase = 'play';
      startSub(s);
      s.stage = subStage(s);
      return;
    }
    const e = ev(s);
    e.engine.submit(s.sub, p, m);
    s.stage = subStage(s);
    if (e.finished(s.sub)) closeEvent(s);
  },
  view(s, p) {
    const e = ev(s);
    let sub: unknown = null;
    if (s.phase === 'play') {
      sub = e.engine.view(s.sub, p);
      if (e.patch) sub = e.patch(sub);
    }
    return { self: p, players: s.players, event: s.event, rematch: s.rematch, phase: s.phase, wins: [...s.wins], results: s.results, ready: { ...s.ready }, sub, subId: e.id };
  },
  ai(v, ctx: AiCtx) {
    if (v.phase !== 'play' || !v.sub) return { t: 'ready' };
    // 補助は買えない：手持ち 0、支払い不可として元の競技の CPU に考えさせる
    return EVENTS.find((x) => x.id === v.subId)!.engine.ai(v.sub, { ...ctx, pieces: 0, spend: () => false }) as M11Move;
  },
  done(s) {
    return s.phase === 'done';
  },
  scores(s) {
    return Object.fromEntries(s.players.map((p, i) => [p, s.wins[i]]));
  },
  ranking(s) {
    const order = s.players.map((_, i) => i).sort((a, b) => s.wins[b] - s.wins[a]);
    return order.map((i) => [s.players[i]]);
  },
};
