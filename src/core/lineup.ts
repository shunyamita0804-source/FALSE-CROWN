/**
 * 大会の競技の割り当て（日程）。大会の始めに全日程を一度に決め、セーブに残す（state.lineup）。
 * - 各日の人数に合う競技だけを候補にし、同じ大会で同じ競技（と同じ系統）は 1 回だけ。
 * - 1 日決めるたびに「残りの日がまだ全部埋まるか」を二部マッチングで確かめ、埋まらなくなる競技は選ばない。
 *   日を決める順番も毎回ばらばらにする（大人数の日から順に決めると、終盤がいつも同じ競技になるため）。
 * - 抽選が成り立つのは「日程が埋まる」ことの確認だけで、競技の面白さや公平さの確認ではない（docs/lineup.md）。
 * 古いセーブ（lineup なし）は CONFIG.schedule の並びのまま。
 */
import LINEUP from '../data/lineup.json';
import { CONFIG, scheduleFor } from '../data/config';
import { Rng } from './rng';
import type { GameState } from './types';

export interface PoolEntry { id: string; players: number[]; family: string }
export interface Pool { mode: 'fixed' | 'draw'; pool: PoolEntry[] }
export interface Lineup { main: string[]; prison: (string | null)[] }

export const MAIN_POOL = LINEUP.main as Pool;
export const PRISON_POOL = LINEUP.prison as Pool;

/** 日ごとの人数（メイン、監獄）。決勝の日（監獄 0 人）は null */
const dayCounts = () => CONFIG.schedule.map((d) => ({ day: d.day, players: d.players, prison: d.prison }));

/** 残りの日（人数の列）に、使っていない系統の競技を重複なしで割り当てられるか */
export function fillable(counts: number[], pool: PoolEntry[], usedFamilies: Set<string>): boolean {
  const cand = pool.filter((e) => !usedFamilies.has(e.family));
  // 系統ごとに 1 つだけ使えるので、系統を「割り当て先」にする
  const fam = new Map<string, Set<number>>();
  for (const e of cand) {
    const s = fam.get(e.family) ?? new Set<number>();
    for (const n of e.players) s.add(n);
    fam.set(e.family, s);
  }
  const fams = [...fam.keys()];
  const owner = new Map<string, number>();
  const tryDay = (i: number, seen: Set<string>): boolean => {
    for (const f of fams) {
      if (!fam.get(f)!.has(counts[i]) || seen.has(f)) continue;
      seen.add(f);
      const o = owner.get(f);
      if (o === undefined || tryDay(o, seen)) { owner.set(f, i); return true; }
    }
    return false;
  };
  return counts.every((_, i) => tryDay(i, new Set()));
}

/**
 * 人数の列に競技を割り当てる。usedFamilies は他の割り当て（メイン）で使った系統。戻り値は日の順の競技 ID。
 * 割り当てられない時は例外（データの誤り。テストで見張る）。
 */
export function drawPool(counts: number[], pool: PoolEntry[], rng: Rng, usedFamilies: Set<string> = new Set()): string[] {
  const used = new Set(usedFamilies);
  if (!fillable(counts, pool, used)) throw new Error('lineup: この候補では日程が埋まりません');
  const out: string[] = new Array(counts.length);
  const order = rng.shuffle(counts.map((_, i) => i));
  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    const rest = order.slice(k + 1).map((j) => counts[j]);
    const cands = rng.shuffle(pool.filter((e) => e.players.includes(counts[i]) && !used.has(e.family)));
    const pick = cands.find((e) => fillable(rest, pool, new Set([...used, e.family])));
    if (!pick) throw new Error('lineup: 割り当ての途中で詰まりました');
    out[i] = pick.id;
    used.add(pick.family);
  }
  return out;
}

/** 大会の全日程を決める（大会の始めに 1 回） */
export function drawLineup(seed: number, main: Pool = MAIN_POOL, prison: Pool = PRISON_POOL): Lineup {
  const rng = Rng.derive(seed, 'lineup');
  const days = dayCounts();
  // 決勝の日は M11 で固定（相談・補助なしの 2 人戦）。抽選するのは決勝より前の日だけ
  const pre = days.filter((d) => d.prison > 0);
  const mainIds = main.mode === 'fixed' ? days.map((d) => scheduleFor(d.day).main) : [...drawPool(pre.map((d) => d.players), main.pool, rng), ...days.filter((d) => d.prison === 0).map((d) => scheduleFor(d.day).main)];
  const fam = new Set(mainIds.map((id) => [...main.pool, ...prison.pool].find((e) => e.id === id)?.family).filter((f): f is string => !!f));
  const prisonDraw = prison.mode === 'fixed' ? pre.map((d) => scheduleFor(d.day).prisonGame as string) : drawPool(pre.map((d) => d.prison), prison.pool, rng, fam);
  const prisonIds = days.map((d) => (d.prison > 0 ? prisonDraw[pre.findIndex((x) => x.day === d.day)] : null));
  return { main: mainIds, prison: prisonIds };
}

const dayIndex = (day: number) => {
  const i = CONFIG.schedule.findIndex((d) => d.day === day);
  return i < 0 ? CONFIG.schedule.length - 1 : i;
};

/** その日のメインマッチ（古いセーブは日程表のまま） */
export function mainOf(state: GameState | null | undefined, day: number): string {
  return state?.lineup?.main[dayIndex(day)] ?? scheduleFor(day).main;
}

/** その日の監獄マッチ（決勝の日は null） */
export function prisonOf(state: GameState | null | undefined, day: number): string | null {
  if (scheduleFor(day).prison === 0) return null;
  return state?.lineup?.prison[dayIndex(day)] ?? scheduleFor(day).prisonGame;
}
