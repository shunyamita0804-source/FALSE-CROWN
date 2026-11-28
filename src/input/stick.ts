/**
 * アナログスティック（画面左下の固定式）と方向の計算。DOM に依存しないので単体テストできる。
 *
 * フィールドは 1 マスずつ進むので、スティックの向きは 8 方向（斜めを含む）に丸めて 1 歩を決める。
 * 速さは倒し具合によらず一定（無反応領域の外なら同じ速さ）。斜めの 1 歩は √2 倍の距離を同じ速さで歩く（sim.ts）。
 * 人物の向きは、近い 4 方向の歩行の絵で表す。
 */
import type { Dir } from '../core/types';

/** スティックの入力。x は右、y は下が正。大きさは 0〜1 */
export interface Vec { x: number; y: number }

/** 中央の無反応領域（半径に対する割合）。触れただけでは動かない */
export const DEAD_ZONE = 0.28;

/**
 * 指の位置（スティックの中心からのずれ、px）を入力に直す。
 * 無反応領域の内側は null。外側は向きだけを持つ大きさ 1 の値にする（まずは速度一定）。
 */
export function stickVector(dx: number, dy: number, radius: number, dead = DEAD_ZONE): Vec | null {
  const len = Math.hypot(dx, dy);
  if (!(radius > 0) || len < radius * dead) return null;
  return { x: dx / len, y: dy / len };
}

/** 見た目のつまみの位置（半径の外へは出さない） */
export function knobOffset(dx: number, dy: number, radius: number): Vec {
  const len = Math.hypot(dx, dy);
  if (len <= radius || len === 0) return { x: dx, y: dy };
  return { x: (dx / len) * radius, y: (dy / len) * radius };
}

const ANG: Record<Dir, number> = { right: 0, down: 90, left: 180, up: -90 };

function angleOf(v: Vec): number {
  return (Math.atan2(v.y, v.x) * 180) / Math.PI;
}

function angDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * 人物の向き（4 方向）。境目でちらつかないよう、今の向きから 45°＋余裕 の範囲なら向きを変えない。
 * 斜めちょうどの時は今の向きを保つ（今の向きが関係ない方向なら横向きを優先）。
 */
export function face4(v: Vec, prev?: Dir, hysteresis = 12): Dir {
  const a = angleOf(v);
  if (prev && angDiff(a, ANG[prev]) <= 45 + hysteresis) return prev;
  let best: Dir = 'right';
  let bd = 999;
  for (const d of ['right', 'left', 'down', 'up'] as Dir[]) {
    const dd = angDiff(a, ANG[d]);
    if (dd < bd - 1e-9) { bd = dd; best = d; }
  }
  return best;
}

/** 1 歩の向き（8 方向、各成分は -1, 0, 1）。境目では前の 1 歩の向きを少し優先する */
export function octant(v: Vec, prev?: { dx: number; dy: number }, hysteresis = 6): { dx: number; dy: number } {
  const a = angleOf(v);
  if (prev && (prev.dx || prev.dy)) {
    const pa = (Math.atan2(prev.dy, prev.dx) * 180) / Math.PI;
    if (angDiff(a, pa) <= 22.5 + hysteresis) return { dx: prev.dx, dy: prev.dy };
  }
  const k = Math.round(a / 45);
  const r = (k * 45 * Math.PI) / 180;
  return { dx: Math.round(Math.cos(r)), dy: Math.round(Math.sin(r)) };
}

/** キーボードの方向キーの組み合わせを入力に直す（斜めは 2 つ同時押し）。押していなければ null */
export function keysVector(up: boolean, down: boolean, left: boolean, right: boolean): Vec | null {
  const x = (right ? 1 : 0) - (left ? 1 : 0);
  const y = (down ? 1 : 0) - (up ? 1 : 0);
  if (!x && !y) return null;
  const len = Math.hypot(x, y);
  return { x: x / len, y: y / len };
}

/**
 * スティックを押さえている指を 1 本だけ追う。ほかの指（右側のボタン）とは独立。
 * 指を離した、中断された、画面の外へ出た時は必ず解除される。
 */
export class StickTracker {
  private id: number | null = null;
  private v: Vec | null = null;
  private off: Vec = { x: 0, y: 0 };

  /** 指がスティックの上で画面に触れた。すでに別の指で操作中なら無視して false */
  down(id: number, dx: number, dy: number, radius: number): boolean {
    if (this.id !== null) return false;
    this.id = id;
    this.move(id, dx, dy, radius);
    return true;
  }

  /** 指が動いた。中心から離れても、指を離すまでは操作を続ける（つまみは縁で止まる） */
  move(id: number, dx: number, dy: number, radius: number): void {
    if (id !== this.id) return;
    this.off = knobOffset(dx, dy, radius);
    this.v = stickVector(dx, dy, radius);
  }

  up(id: number): void {
    if (id === this.id) this.clear();
  }

  clear(): void {
    this.id = null;
    this.v = null;
    this.off = { x: 0, y: 0 };
  }

  tracking(id: number): boolean {
    return this.id === id;
  }

  get active(): boolean {
    return this.id !== null;
  }

  /** 移動の入力（無反応領域の内側や、触れていなければ null） */
  get vector(): Vec | null {
    return this.v;
  }

  /** つまみの表示位置（px） */
  get knob(): Vec {
    return this.off;
  }
}
