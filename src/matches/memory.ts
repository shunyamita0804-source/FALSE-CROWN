/**
 * 記憶の競技（M02 フラッグ・フラッシュ、P02 瞬間記憶）で共用する部品。
 * 盤面を短時間見せて隠し、位置や図柄を問う。問題には正解を持たせず、盤面から求める（採点もここで行う）。
 * CPU は盤面を見た時の「記憶」を能力に応じて確率で作り、覚えていない所は見えている選択肢から推測する。
 */
import type { Rng } from '../core/rng';

export type Item = string;

export interface MemBoard {
  w: number;
  h: number;
  /** 各マスの図柄（空きは null） */
  cells: (Item | null)[];
}

export type MemQ =
  /** この図柄があったマスをタップする */
  | { kind: 'place'; item: Item }
  /** このマスにあった図柄を、候補から選ぶ */
  | { kind: 'item'; cell: number; options: Item[] }
  /** 表示されていた図柄を、候補から選ぶ（候補のうち 1 つだけが盤面にあった） */
  | { kind: 'present'; options: Item[] };

export interface MemSet {
  board: MemBoard;
  showMs: number;
  qMs: number;
  questions: MemQ[];
}

/** 回答。picks は問題ごとの選んだ番号（マス番号または候補の番号。未回答は -1）、ms は問題ごとの回答時間 */
export interface MemAnswer {
  picks: number[];
  ms: number[];
}

export interface MemGrade {
  ok: boolean[];
  correct: number;
  /** 正解した問題にかかった時間の合計 */
  okMs: number;
}

/** 問題の正解（盤面から求める） */
export function answerOf(board: MemBoard, q: MemQ): number {
  if (q.kind === 'place') return board.cells.indexOf(q.item);
  if (q.kind === 'item') return q.options.indexOf(board.cells[q.cell] as Item);
  return q.options.findIndex((o) => board.cells.includes(o));
}

export function validAnswer(set: MemSet, a: unknown): a is MemAnswer {
  const x = a as MemAnswer;
  if (!x || !Array.isArray(x.picks) || !Array.isArray(x.ms)) return false;
  if (x.picks.length !== set.questions.length || x.ms.length !== set.questions.length) return false;
  return set.questions.every((q, i) => {
    const p = x.picks[i];
    const max = q.kind === 'place' ? set.board.cells.length : q.options.length;
    const ms = x.ms[i];
    return Number.isInteger(p) && p >= -1 && p < max && typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 && ms <= set.qMs + 1000;
  });
}

export function grade(set: MemSet, a: MemAnswer | undefined): MemGrade {
  const ok = set.questions.map((q, i) => !!a && a.picks[i] >= 0 && a.picks[i] === answerOf(set.board, q));
  return { ok, correct: ok.filter(Boolean).length, okMs: ok.reduce((n, o, i) => n + (o ? Math.min(set.qMs, a!.ms[i]) : 0), 0) };
}

export const emptyAnswer = (set: MemSet): MemAnswer => ({ picks: set.questions.map(() => -1), ms: set.questions.map(() => set.qMs) });

/** 問題の妥当性（生成の検査用）：正解がちょうど 1 つあること */
export function wellFormed(set: MemSet): boolean {
  const { board } = set;
  if (board.cells.length !== board.w * board.h) return false;
  return set.questions.every((q) => {
    if (q.kind === 'place') return board.cells.filter((c) => c === q.item).length === 1;
    if (new Set(q.options).size !== q.options.length) return false;
    if (q.kind === 'item') return board.cells[q.cell] != null && q.options.filter((o) => o === board.cells[q.cell]).length === 1;
    return q.options.filter((o) => board.cells.includes(o)).length === 1;
  });
}

export interface MemModel {
  /** 図柄が「あった」ことを覚えている確率 */
  pSeen: number;
  /** あったことを覚えている図柄の、位置まで覚えている確率 */
  pLoc: number;
  /** 位置を覚えていないマスについて、図柄の特徴の一部だけ覚えている確率（attrs がある時） */
  pPart?: number;
  /** 図柄の特徴（形、色など）。一部だけ覚えている時の絞り込みに使う */
  attrs?: (item: Item) => string[];
}

/**
 * CPU の回答。盤面は「表示された時に見たもの」で、model の確率で覚えている部分だけを使う。
 * 覚えていない問題は、覚えている内容と矛盾しない候補から無作為に選ぶ。
 */
export function cpuAnswer(set: MemSet, model: MemModel, rng: Rng): MemAnswer {
  const { board } = set;
  const seen = board.cells.map((c) => c != null && rng.chance(model.pSeen));
  const loc = board.cells.map((c, i) => c != null && seen[i] && rng.chance(model.pLoc));
  const part = board.cells.map((c, i) => {
    if (c == null || loc[i] || !model.attrs || !rng.chance(model.pPart ?? 0)) return null;
    return rng.pick(model.attrs(c));
  });
  const knownItems = new Set(board.cells.filter((_, i) => loc[i]) as Item[]);
  const picks: number[] = [];
  const ms: number[] = [];
  for (const q of set.questions) {
    let sure = false;
    let pick = -1;
    if (q.kind === 'place') {
      const at = board.cells.indexOf(q.item);
      if (loc[at]) { pick = at; sure = true; }
      else {
        // 位置を覚えている別の図柄のマスは除いて推測する
        const cand = board.cells.map((_, i) => i).filter((i) => !loc[i]);
        pick = rng.pick(cand);
      }
    } else if (q.kind === 'item') {
      if (loc[q.cell]) { pick = q.options.indexOf(board.cells[q.cell] as Item); sure = true; }
      else {
        const hintAttr = part[q.cell];
        let cand = q.options.map((_, i) => i);
        if (hintAttr && model.attrs) cand = cand.filter((i) => model.attrs!(q.options[i]).includes(hintAttr));
        else if (!model.attrs) cand = cand.filter((i) => !knownItems.has(q.options[i])); // 別のマスにあったと覚えている図柄は除く
        if (!cand.length) cand = q.options.map((_, i) => i);
        pick = rng.pick(cand);
      }
    } else {
      const at = q.options.findIndex((o) => board.cells.includes(o));
      const cellAt = board.cells.indexOf(q.options[at]);
      if (seen[cellAt]) { pick = at; sure = true; }
      else pick = rng.int(0, q.options.length - 1);
    }
    picks.push(pick);
    const sec = sure ? 1.6 + rng.next() * 1.8 : 3 + rng.next() * 3.2;
    ms.push(Math.round(Math.min(set.qMs - 300, sec * 1000)));
  }
  return { picks, ms };
}

/** n 個を重複なく選ぶ */
export function sample<T>(rng: Rng, arr: readonly T[], n: number): T[] {
  return rng.shuffle([...arr]).slice(0, n);
}
