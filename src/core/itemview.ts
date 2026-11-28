/**
 * 手帳「アイテム」タブに出す中身（描画から独立）。
 * ピースの出入りは transfer() が残した記録（fact 'transfer'）だけから組み立て、救いのメダルは日ごとの記録から読む。
 * 開くだけで状態は変えない。
 */
import { CONFIG } from '../data/config';
import type { CharId } from '../data/characters';
import type { RescueState } from './rescue';
import type { GameState, Phase } from './types';

export interface PieceEntry {
  day: number;
  phase: Phase;
  /** 記録の理由（報酬、取引、支払いなど） */
  reason: string;
  /** 入手は正、支出は負 */
  delta: number;
  /** 相手（主催者との出入りなら null） */
  other: CharId | null;
  /** この出入りの後の残高 */
  after: number;
}

export interface PieceLedger {
  balance: number;
  /** 大会の始めの所持数 */
  initial: number;
  /** 新しい順 */
  entries: PieceEntry[];
  totalIn: number;
  totalOut: number;
}

/** id の人のピースの出入り。残高は今の所持数から逆にたどる（記録の外で数が変わっても、今の残高と食い違わない） */
export function pieceLedger(state: GameState, id: CharId = 'hero'): PieceLedger {
  const raw: Omit<PieceEntry, 'after'>[] = [];
  for (const f of state.facts) {
    if (f.type !== 'transfer' || !f.data) continue;
    const from = f.data.from as CharId | 'host';
    const to = f.data.to as CharId | 'host';
    const amount = Number(f.data.amount ?? 0);
    if (!amount || (from !== id && to !== id) || from === to) continue;
    const delta = to === id ? amount : -amount;
    const otherSide = to === id ? from : to;
    raw.push({ day: f.day, phase: f.phase, reason: f.text, delta, other: otherSide === 'host' ? null : otherSide });
  }
  const balance = state.actors[id].pieces;
  let after = balance;
  const entries: PieceEntry[] = [];
  for (let i = raw.length - 1; i >= 0; i--) {
    entries.push({ ...raw[i], after });
    after -= raw[i].delta;
  }
  return {
    balance,
    initial: raw.length ? after : CONFIG.economy.initialPieces,
    entries,
    totalIn: raw.filter((e) => e.delta > 0).reduce((n, e) => n + e.delta, 0),
    totalOut: raw.filter((e) => e.delta < 0).reduce((n, e) => n - e.delta, 0),
  };
}

export type MedalStatus = 'held' | 'used' | 'unused';

export interface MedalEntry {
  day: number;
  status: MedalStatus;
  /** 救った人と、代わりに監獄棟へ行った人（使った時だけ） */
  target?: CharId;
  swapped?: CharId;
  /** 指名したが辞退された人 */
  declined: CharId[];
}

/** id の人が得た救いのメダル（新しい順）。その日の結果発表の場で使わなければ、その日のうちに失効する */
export function medalsOf(state: GameState, id: CharId = 'hero'): MedalEntry[] {
  const list: { day: number; r: RescueState }[] = state.history.filter((d) => d.rescue).map((d) => ({ day: d.day, r: d.rescue! }));
  const today = state.today.rescue;
  if (today && !list.some((x) => x.day === state.day)) list.push({ day: state.day, r: today });
  return list
    .filter((x) => x.r.holder === id)
    .map(({ day, r }) => ({
      day,
      // 記録に「保留」のまま残った過去の日の分は、使われずに失効したものとして扱う
      status: r.status === 'used' ? 'used' : r.status === 'pending' && day === state.day ? 'held' : 'unused',
      target: r.target,
      swapped: r.swapped,
      declined: [...r.declined],
    }) as MedalEntry)
    .sort((a, b) => b.day - a.day);
}
