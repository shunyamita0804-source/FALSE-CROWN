/**
 * 建物改修の家具を、歩行のマス（1 マス 64 ピクセル）に直す。
 * 歩けないマス：
 * - 家具の接地範囲（furniture.json の colliders）が、マスや足元を大きくおおう
 * - 家具の絵が、足元を半分以上おおう（furniture_mask.json。scripts/furniture-mask.py が絵から作る）
 * 必ず歩けるマス：
 * - 席の前に立つマス（seats の a）。家具に囲まれている時は、家具のすき間を 1 本だけ通り道として空ける
 * - 房の中の立つ位置（房の内側、寝台の前、丸椅子の前）
 * 房の扉（props[].door）は、閉じている間だけ戸口のマスをふさぐ。
 * DOM にも Phaser にも依存しない。
 */
import maskTable from '../data/furniture_mask.json';
import { furnitureOf, type RoomFurniture } from './furniture';

const T = 64;
/** マス全体のうち、接地範囲がおおう割合がこれ以上なら歩けない */
export const COVER_ALL = 0.34;
/** 足元のうち、接地範囲がおおう割合がこれ以上なら歩けない */
export const COVER_FOOT = 0.5;
/** 足元のうち、家具の絵がおおう割合（%）がこれ以上なら歩けない */
export const COVER_MASK = 50;
/** 足元の範囲（マスの左上からのピクセル）。人物の足はマスの下から 10 ピクセルに立つ */
const FOOT = { x0: 14, y0: 36, x1: 50, y1: 62 };
const MASK = (maskTable as unknown as { rooms: Record<string, Record<string, number>> }).rooms;

export interface Tile { x: number; y: number }
/** 房の扉が開いているか（房の ID で答える） */
export type GateFn = (cellId: string) => boolean;

const key = (x: number, y: number) => `${x},${y}`;
const NEAR = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const tileOf = (px: number, py: number): Tile => ({ x: Math.floor(px / T), y: Math.floor(py / T) });

function inside(poly: number[][], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** 四角 (x0,y0)-(x1,y1) のうち、多角形がおおう割合（4 ピクセルごとの点で数える） */
function cover(poly: number[][], x0: number, y0: number, x1: number, y1: number): number {
  let n = 0;
  let hit = 0;
  for (let y = y0 + 2; y < y1; y += 4) for (let x = x0 + 2; x < x1; x += 4) { n++; if (inside(poly, x, y)) hit++; }
  return n ? hit / n : 0;
}

/** 接地範囲の多角形が、そのマスをふさぐか */
export function polyBlocks(poly: number[][], tx: number, ty: number): boolean {
  const px = tx * T;
  const py = ty * T;
  return cover(poly, px, py, px + T, py + T) >= COVER_ALL || cover(poly, px + FOOT.x0, py + FOOT.y0, px + FOOT.x1, py + FOOT.y1) >= COVER_FOOT;
}

/** 接地範囲の多角形がふさぐマスの一覧 */
export function polyTiles(poly: number[][]): Tile[] {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const out: Tile[] = [];
  for (let ty = Math.floor(Math.min(...ys) / T); ty <= Math.floor(Math.max(...ys) / T); ty++)
    for (let tx = Math.floor(Math.min(...xs) / T); tx <= Math.floor(Math.max(...xs) / T); tx++) if (polyBlocks(poly, tx, ty)) out.push({ x: tx, y: ty });
  return out;
}

export interface GateTile extends Tile { cell: string; prop: string; initial: 'open' | 'closed' }
export interface FurnitureTiles {
  /** 家具でふさがるマス（下の「空けるマス」は除いてある） */
  blocked: Tile[];
  /** 席の前に立つマス（房の中の席は除く） */
  approach: Tile[];
  /** 家具にふさがれないマス：寝台や洗面台などの前に立つ位置 */
  keep: Tile[];
  /** 房の戸口のマス（扉が閉じている間はふさがる） */
  gates: GateTile[];
  /** 房の中で歩けるマス（内側の立つ位置、寝台の前、丸椅子の前） */
  cellFloor: Tile[];
}

const cache = new Map<string, FurnitureTiles>();
const EMPTY: FurnitureTiles = { blocked: [], approach: [], keep: [], gates: [], cellFloor: [] };
const uniq = (ts: Tile[]) => [...new Map(ts.map((t) => [key(t.x, t.y), t])).values()];

function build(roomId: string, f: RoomFurniture): FurnitureTiles {
  const approach = uniq(f.seats.filter((s) => !s.cell).map((s) => tileOf(s.a[0], s.a[1])));
  const keep = uniq(f.anchors.filter((a) => !a.cell).map((a) => tileOf(a.ax, a.ay)));
  const cellFloor = uniq([
    ...f.cells.map((c) => tileOf(c.inside[0], c.inside[1])),
    ...f.anchors.filter((a) => a.cell).map((a) => tileOf(a.ax, a.ay)),
    ...f.seats.filter((s) => s.cell).map((s) => tileOf(s.a[0], s.a[1])),
  ]);
  const gates: GateTile[] = [];
  for (const p of f.props) {
    if (!p.door?.closedPoly?.length) continue;
    const cx = p.door.closedPoly.reduce((a, q) => a + q[0], 0) / p.door.closedPoly.length;
    const cy = p.door.closedPoly.reduce((a, q) => a + q[1], 0) / p.door.closedPoly.length;
    gates.push({ ...tileOf(cx, cy), cell: p.door.cell ?? p.cell ?? p.id, prop: p.id, initial: p.door.initial });
  }
  const free = new Set([...approach, ...keep, ...cellFloor, ...gates].map((t) => key(t.x, t.y)));
  const gateProps = new Set(gates.map((g) => g.prop));
  const byPoly = f.colliders.filter((c) => !c.when && !gateProps.has(c.id)).flatMap((c) => polyTiles(c.poly));
  const byMask = Object.entries(MASK[roomId] ?? {}).filter(([, pct]) => pct >= COVER_MASK).map(([k]) => ({ x: Number(k.split(',')[0]), y: Number(k.split(',')[1]) }));
  const blocked = uniq([...byPoly, ...byMask]).filter((t) => !free.has(key(t.x, t.y)));
  return { blocked, approach, keep, gates, cellFloor };
}

/** その部屋の家具のマス（家具の無い部屋は空） */
export function furnitureTiles(roomId: string): FurnitureTiles {
  const f = furnitureOf(roomId);
  if (!f) return EMPTY;
  let c = cache.get(roomId);
  if (!c) cache.set(roomId, (c = build(roomId, f)));
  return c;
}

/** 扉の開閉を 1 行にまとめた鍵（当たり判定の表を作り直すかどうかの比較に使う） */
export function gateKey(roomId: string, open?: GateFn): string {
  return furnitureTiles(roomId).gates.map((g) => ((open ? open(g.cell) : g.initial === 'open') ? 'o' : 'c')).join('');
}

export interface FurnitureFix {
  /** 席の前へ行くために空けた、家具のすき間のマス */
  links: Tile[];
  /** 家具に三方を囲まれた行き止まりで、ふさいだマス */
  pockets: Tile[];
}
const fixCache = new Map<string, FurnitureFix>();

/** 部屋の決まり（world/maps.ts）のうち、ここで使う分 */
export interface RoomHint {
  id: string;
  /** 出入口のマス（ここから歩いて行ける範囲を調べる） */
  starts: Tile[];
  /** ふさいではいけないマス（出入口、調べる地点、たまり場） */
  protect: Tile[];
}

function reachFrom(g: boolean[][], starts: Tile[]): Set<string> {
  const seen = new Set<string>();
  const q: Tile[] = [];
  for (const s of starts) if (g[s.y]?.[s.x] === false && !seen.has(key(s.x, s.y))) { seen.add(key(s.x, s.y)); q.push(s); }
  while (q.length) {
    const p = q.shift()!;
    for (const [dx, dy] of NEAR) {
      const x = p.x + dx;
      const y = p.y + dy;
      if (g[y]?.[x] !== false || seen.has(key(x, y))) continue;
      seen.add(key(x, y));
      q.push({ x, y });
    }
  }
  return seen;
}

/** 扉を全部閉じた状態の表 g から、行き止まりのふさぎと、席への通り道を決める */
function fixes(g0: boolean[][], room: RoomHint, ft: FurnitureTiles): FurnitureFix {
  const g = g0.map((r) => [...r]);
  const furn = new Set(ft.blocked.map((t) => key(t.x, t.y)));
  const keepFree = new Set([...room.protect, ...ft.approach, ...ft.keep, ...ft.cellFloor, ...ft.gates].map((t) => key(t.x, t.y)));
  // 1. 家具のとなりの、三方をふさがれた行き止まりをふさぐ（椅子と椅子の間など）
  const pockets: Tile[] = [];
  for (let changed = true; changed;) {
    changed = false;
    for (let y = 0; y < g.length; y++) for (let x = 0; x < g[0].length; x++) {
      if (g[y][x] || keepFree.has(key(x, y))) continue;
      const near = NEAR.map(([dx, dy]) => ({ x: x + dx, y: y + dy }));
      if (near.filter((n) => g[n.y]?.[n.x] !== false).length < 3 || !near.some((n) => furn.has(key(n.x, n.y)))) continue;
      g[y][x] = true;
      furn.add(key(x, y));
      pockets.push({ x, y });
      changed = true;
    }
  }
  // 2. 出入口から行けない「席の前」へ、家具のおおいが少ないマスを通って道を空ける
  const mask = MASK[room.id] ?? {};
  const links: Tile[] = [];
  for (const a of ft.approach) {
    if (g[a.y]?.[a.x] !== false) continue; // 床の外（絵の壁の中）の席は、ここでは扱わない
    const reach = reachFrom(g, room.starts);
    if (reach.has(key(a.x, a.y))) continue;
    const dist = new Map<string, number>([[key(a.x, a.y), 0]]);
    const from = new Map<string, string>();
    const open: Tile[] = [a];
    let goal: string | null = null;
    while (open.length) {
      open.sort((p, q) => dist.get(key(p.x, p.y))! - dist.get(key(q.x, q.y))!);
      const p = open.shift()!;
      const pk = key(p.x, p.y);
      if (reach.has(pk)) { goal = pk; break; }
      for (const [dx, dy] of NEAR) {
        const n = { x: p.x + dx, y: p.y + dy };
        const nk = key(n.x, n.y);
        const walk = g[n.y]?.[n.x] === false;
        if (!walk && !furn.has(nk)) continue; // 壁や固定の設備は通さない
        const d = dist.get(pk)! + 1 + (walk ? 0 : (mask[nk] ?? 100));
        if (d < (dist.get(nk) ?? Infinity)) { dist.set(nk, d); from.set(nk, pk); open.push(n); }
      }
    }
    for (let k = goal ? from.get(goal) : undefined; k; k = from.get(k)) {
      const [x, y] = k.split(',').map(Number);
      if (g[y][x]) { g[y][x] = false; links.push({ x, y }); }
    }
  }
  return { links, pockets };
}

/** その部屋で、家具のすき間に空けた通り道と、ふさいだ行き止まり（buildCollision を 1 回呼んだ後に決まる） */
export function furnitureFix(roomId: string): FurnitureFix {
  return fixCache.get(roomId) ?? { links: [], pockets: [] };
}

/**
 * 衝突の表（true = 歩けない）に、家具を反映する。
 * open を渡さない時は、扉は最初の状態（initial）で決める。
 */
export function applyFurniture(g: boolean[][], room: RoomHint, open?: GateFn): void {
  const ft = furnitureTiles(room.id);
  if (ft === EMPTY) return;
  const set = (t: Tile, v: boolean) => { if (g[t.y]?.[t.x] !== undefined) g[t.y][t.x] = v; };
  for (const t of ft.cellFloor) set(t, false);
  for (const t of ft.blocked) set(t, true);
  for (const gt of ft.gates) set(gt, true);
  let fix = fixCache.get(room.id);
  if (!fix) fixCache.set(room.id, (fix = fixes(g, room, ft)));
  for (const t of fix.pockets) set(t, true);
  for (const t of fix.links) set(t, false);
  for (const gt of ft.gates) set(gt, !(open ? open(gt.cell) : true));
}

/**
 * ピクセルの位置（席や寝台の「立つ位置」）に、いちばん近い歩けるマス。
 * その位置のマスが歩けるなら、そのマス。壁や家具の中なら、足元がいちばん近いマス。
 */
export function standTile(g: boolean[][], px: number, py: number): Tile | null {
  const t = tileOf(px, py);
  if (g[t.y]?.[t.x] === false) return t;
  let best: Tile | null = null;
  let bd = Infinity;
  for (let y = Math.max(0, t.y - 3); y <= Math.min(g.length - 1, t.y + 3); y++) for (let x = Math.max(0, t.x - 3); x <= Math.min(g[0].length - 1, t.x + 3); x++) {
    if (g[y][x]) continue;
    const d = Math.hypot(x * T + T / 2 - px, y * T + T - 10 - py);
    if (d < bd) { bd = d; best = { x, y }; }
  }
  return best;
}
