/**
 * ポリオミノの敷き詰めパズル（M01 ピース・アセンブル、練習問題で共用）。
 * 問題は「先に盤面を全ピースで敷き詰めてから、ばらす」逆生成なので、必ず解ける。別解も正解として受け付ける。
 * ピースは 90 度回転できる。裏返しはできない。
 */
import type { Rng } from '../core/rng';

export type Cell = [number, number];

export interface Puzzle {
  w: number;
  h: number;
  /** 置けないマス（穴）。添字は y * w + x */
  holes: boolean[];
  /** 各ピースの形（左上に寄せた座標）。配られた向きは解の向きとは限らない */
  pieces: Cell[][];
}

export interface Placement {
  piece: number;
  /** 配られた向きから時計回りに 90 度ずつ回した回数（0〜3） */
  rot: number;
  x: number;
  y: number;
}

export const norm = (cells: Cell[]): Cell[] => {
  const mx = Math.min(...cells.map((c) => c[0]));
  const my = Math.min(...cells.map((c) => c[1]));
  return cells.map(([x, y]) => [x - mx, y - my] as Cell).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
};

/** 時計回りに 90 度回す */
export const rot90 = (cells: Cell[]): Cell[] => norm(cells.map(([x, y]) => [-y, x] as Cell));

export function rotated(cells: Cell[], rot: number): Cell[] {
  let c = norm(cells);
  for (let i = 0; i < ((rot % 4) + 4) % 4; i++) c = rot90(c);
  return c;
}

const keyOf = (cells: Cell[]) => cells.map((c) => c.join(',')).join(';');

/** 回転で重複しない向きの一覧 */
export function orientations(cells: Cell[]): { rot: number; cells: Cell[] }[] {
  const out: { rot: number; cells: Cell[] }[] = [];
  const seen = new Set<string>();
  for (let r = 0; r < 4; r++) {
    const c = rotated(cells, r);
    const k = keyOf(c);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ rot: r, cells: c });
  }
  return out;
}

export const freeCount = (p: Puzzle) => p.holes.filter((x) => !x).length;

/** 配置の検査。重なり、枠外、穴の上は不正。戻り値は覆ったマスの数（不正なら -1） */
export function coverage(p: Puzzle, placed: Placement[]): number {
  if (!Array.isArray(placed)) return -1;
  const used = new Set<number>();
  const grid = new Array<boolean>(p.w * p.h).fill(false);
  let n = 0;
  for (const pl of placed) {
    if (!pl || !Number.isInteger(pl.piece) || pl.piece < 0 || pl.piece >= p.pieces.length || used.has(pl.piece)) return -1;
    if (!Number.isInteger(pl.rot) || !Number.isInteger(pl.x) || !Number.isInteger(pl.y)) return -1;
    used.add(pl.piece);
    for (const [cx, cy] of rotated(p.pieces[pl.piece], pl.rot)) {
      const x = pl.x + cx;
      const y = pl.y + cy;
      if (x < 0 || y < 0 || x >= p.w || y >= p.h) return -1;
      const i = y * p.w + x;
      if (p.holes[i] || grid[i]) return -1;
      grid[i] = true;
      n++;
    }
  }
  return n;
}

export const isComplete = (p: Puzzle, placed: Placement[]) => coverage(p, placed) === freeCount(p);

/** 1 つ置けるか（すでに置いてあるものと重ならないか） */
export function canPlace(p: Puzzle, placed: Placement[], pl: Placement): boolean {
  return coverage(p, [...placed.filter((x) => x.piece !== pl.piece), pl]) >= 0;
}

export interface Spec {
  w: number;
  h: number;
  holes: number;
  pieces: number;
}

/** ステージごとの盤面の大きさ（4×4 から 6×6 へ） */
export const STAGE_SPECS: Spec[] = [
  { w: 4, h: 4, holes: 1, pieces: 4 },
  { w: 5, h: 4, holes: 2, pieces: 5 },
  { w: 5, h: 5, holes: 2, pieces: 6 },
  { w: 6, h: 5, holes: 3, pieces: 7 },
  { w: 6, h: 5, holes: 1, pieces: 7 },
  { w: 6, h: 6, holes: 4, pieces: 8 },
];

const NB: Cell[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** 盤面を逆生成する。solution は生成時の敷き詰め（状態にだけ持ち、参加者には見せない） */
export function generate(rng: Rng, spec: Spec): { puzzle: Puzzle; solution: Placement[] } {
  const { w, h } = spec;
  for (let attempt = 0; attempt < 400; attempt++) {
    const holes = new Array<boolean>(w * h).fill(false);
    // 穴は離して置く（穴だらけの列を作らない）
    let placedHoles = 0;
    for (let g = 0; g < 60 && placedHoles < spec.holes; g++) {
      const i = rng.int(0, w * h - 1);
      if (holes[i]) continue;
      const x = i % w;
      const y = Math.floor(i / w);
      if (NB.some(([dx, dy]) => x + dx >= 0 && x + dx < w && y + dy >= 0 && y + dy < h && holes[(y + dy) * w + (x + dx)])) continue;
      holes[i] = true;
      placedHoles++;
    }
    if (placedHoles < spec.holes) continue;
    const owner = new Array<number>(w * h).fill(-1);
    const free = holes.map((x, i) => (x ? -1 : i)).filter((i) => i >= 0);
    // 空きマスが一続きでなければやり直す
    const seen = new Set<number>([free[0]]);
    const q = [free[0]];
    while (q.length) {
      const c = q.pop()!;
      for (const [dx, dy] of NB) {
        const x = (c % w) + dx;
        const y = Math.floor(c / w) + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const i = y * w + x;
        if (holes[i] || seen.has(i)) continue;
        seen.add(i);
        q.push(i);
      }
    }
    if (seen.size !== free.length) continue;
    const seeds = rng.shuffle([...free]).slice(0, spec.pieces);
    const size = new Array<number>(spec.pieces).fill(1);
    seeds.forEach((c, k) => { owner[c] = k; });
    const maxSize = Math.min(6, Math.ceil(free.length / spec.pieces) + 2);
    let left = free.length - spec.pieces;
    let stuck = false;
    while (left > 0) {
      // 小さい領域を優先して広げる
      const cand: { k: number; i: number }[] = [];
      for (const c of free) {
        if (owner[c] < 0) continue;
        const k = owner[c];
        if (size[k] >= maxSize) continue;
        for (const [dx, dy] of NB) {
          const x = (c % w) + dx;
          const y = Math.floor(c / w) + dy;
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          const i = y * w + x;
          if (!holes[i] && owner[i] < 0) cand.push({ k, i });
        }
      }
      if (!cand.length) { stuck = true; break; }
      const minSize = Math.min(...cand.map((c) => size[c.k]));
      const pick = rng.pick(cand.filter((c) => size[c.k] <= minSize + 1));
      owner[pick.i] = pick.k;
      size[pick.k]++;
      left--;
    }
    if (stuck || size.some((n) => n < 2)) continue;
    // 1 マスの違いもない同じ形ばかりにならないよう、種類が少なすぎる盤面は避ける
    const shapes: Cell[][] = [];
    const solution: Placement[] = [];
    const order = rng.shuffle(size.map((_, k) => k));
    const kinds = new Set<string>();
    order.forEach((k, idx) => {
      const cells = free.filter((c) => owner[c] === k).map((c) => [c % w, Math.floor(c / w)] as Cell);
      const mx = Math.min(...cells.map((c) => c[0]));
      const my = Math.min(...cells.map((c) => c[1]));
      const base = norm(cells);
      // 配る向きは無作為に回す。解の向きへ戻す回転数を求める
      const turn = rng.int(0, 3);
      const dealt = rotated(base, turn);
      const back = [0, 1, 2, 3].find((r) => keyOf(rotated(dealt, r)) === keyOf(base))!;
      shapes.push(dealt);
      solution.push({ piece: idx, rot: back, x: mx, y: my });
      kinds.add(orientations(base).map((o) => keyOf(o.cells)).sort()[0]);
    });
    if (kinds.size < Math.min(3, spec.pieces - 1)) continue;
    const puzzle: Puzzle = { w, h, holes, pieces: shapes };
    if (!isComplete(puzzle, solution)) continue;
    return { puzzle, solution };
  }
  throw new Error('poly: 盤面を生成できませんでした');
}

export interface SolveResult {
  solved: boolean;
  placed: Placement[];
  /** 試した配置の数（探索の手間） */
  nodes: number;
  /** 探索の途中で最も多く覆えた配置（解けなかった時に提出する） */
  best: Placement[];
}

/**
 * バックトラックで解く。見えている盤面とピースの形だけを使う（解は参照しない）。
 * fixed はすでに置くと決めたピース（ヒントで位置が分かったもの）。budget を超えたら打ち切る。
 */
export function solve(p: Puzzle, budget: number, rng?: Rng, fixed: Placement[] = []): SolveResult {
  const grid = [...p.holes];
  const used = new Array<boolean>(p.pieces.length).fill(false);
  const placed: Placement[] = [];
  for (const f of fixed) {
    if (!canPlace(p, placed, f)) continue;
    placed.push(f);
    used[f.piece] = true;
    for (const [cx, cy] of rotated(p.pieces[f.piece], f.rot)) grid[(f.y + cy) * p.w + f.x + cx] = true;
  }
  const oris = p.pieces.map((c) => orientations(c));
  let order = p.pieces.map((_, i) => i);
  if (rng) order = rng.shuffle(order);
  let nodes = 0;
  let best: Placement[] = [...placed];
  let bestCover = -1;
  const cover = () => placed.reduce((n, pl) => n + p.pieces[pl.piece].length, 0);
  const rec = (): boolean => {
    const first = grid.indexOf(false);
    if (first < 0) return true;
    const fx = first % p.w;
    const fy = Math.floor(first / p.w);
    for (const k of order) {
      if (used[k]) continue;
      for (const o of oris[k]) {
        // 行優先で最初の空きマスに、ピースの最初のマスを合わせる
        const [ax, ay] = o.cells[0];
        const x = fx - ax;
        const y = fy - ay;
        if (++nodes > budget) return false;
        let ok = true;
        for (const [cx, cy] of o.cells) {
          const xx = x + cx;
          const yy = y + cy;
          if (xx < 0 || yy < 0 || xx >= p.w || yy >= p.h || grid[yy * p.w + xx]) { ok = false; break; }
        }
        if (!ok) continue;
        for (const [cx, cy] of o.cells) grid[(y + cy) * p.w + x + cx] = true;
        used[k] = true;
        placed.push({ piece: k, rot: o.rot, x, y });
        const c = cover();
        if (c > bestCover) { bestCover = c; best = [...placed]; }
        if (rec()) return true;
        if (nodes > budget) return false;
        placed.pop();
        used[k] = false;
        for (const [cx, cy] of o.cells) grid[(y + cy) * p.w + x + cx] = false;
      }
    }
    return false;
  };
  const solved = rec();
  return { solved, placed: solved ? [...placed] : best, nodes, best: solved ? [...placed] : best };
}
