/**
 * 六角形の盤面の共通部品（M07 六角領域、P07 ブラック＆ホワイト）。
 * マスは軸座標 (q, r) で表す。半径 R の盤面は |q|、|r|、|q + r| がどれも R 以下のマスの集まり。
 */
export interface HexGrid {
  radius: number;
  /** マス番号 → 座標 */
  cells: [number, number][];
  /** "q,r" → マス番号 */
  index: Map<string, number>;
  /** マス番号 → 隣のマス番号（盤面の中だけ） */
  adj: number[][];
}

/** 6 方向（時計回り） */
export const DIRS: [number, number][] = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];

const grids = new Map<number, HexGrid>();

export function hexGrid(radius: number): HexGrid {
  const hit = grids.get(radius);
  if (hit) return hit;
  const cells: [number, number][] = [];
  for (let r = -radius; r <= radius; r++) for (let q = -radius; q <= radius; q++) if (Math.abs(q + r) <= radius) cells.push([q, r]);
  const index = new Map<string, number>();
  cells.forEach(([q, r], i) => index.set(`${q},${r}`, i));
  const adj = cells.map(([q, r]) => DIRS.map(([dq, dr]) => index.get(`${q + dq},${r + dr}`)).filter((x): x is number => x !== undefined));
  const g: HexGrid = { radius, cells, index, adj };
  grids.set(radius, g);
  return g;
}

export const cellAt = (g: HexGrid, q: number, r: number): number => g.index.get(`${q},${r}`) ?? -1;
/** 中心からの距離 */
export const ringOf = (g: HexGrid, c: number): number => { const [q, r] = g.cells[c]; return Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)); };
/** 60 度の回転（時計回り）を n 回 */
export function rot60(q: number, r: number, n: number): [number, number] {
  let a = q;
  let b = r;
  for (let i = 0; i < ((n % 6) + 6) % 6; i++) [a, b] = [-b, a + b];
  return [a, b];
}
/** 画面上の位置（とがった頂点が上の向き。1 辺の長さを 1 とする） */
export const hexXY = (q: number, r: number): [number, number] => [Math.sqrt(3) * (q + r / 2), 1.5 * r];
/** 画面上の位置（平らな辺が上の向き。1 辺の長さを 1 とする） */
export const hexXYFlat = (q: number, r: number): [number, number] => [1.5 * q, Math.sqrt(3) * (r + q / 2)];
