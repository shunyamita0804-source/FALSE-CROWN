/**
 * 監獄棟の房（共同牢の絵の中にある、格子の扉つきの区画）の割り当てと、格子の扉の開け閉め。
 * - 房の一覧は data/furniture.json の cells から作る（数を決め打ちしない）
 * - 誰がどの房かは GameState.cells（人物 → 房）で持つ。1 人に 1 房
 * - 格子の扉：消灯の間、人が入っている房は閉まる。それ以外（昼間、空いている房）は開いている
 * DOM にも Phaser にも依存しない。
 */
import { ALL_IDS, type CharId } from '../data/characters';
import type { GameState } from '../core/types';
import { FURNITURE, type Anchor, type Cell, type Seat } from './furniture';

const TILE = 64;
const two = (n: number) => String(n).padStart(2, '0');

export interface CellRef {
  /** 房のある部屋（マップ上の部屋 ID） */
  room: string;
  cell: Cell;
  /** 扉の脇に出す番号（B01〜） */
  no: string;
}

/** 房の割り当ての鍵（部屋と房で 1 つ） */
export const cellKey = (room: string, cellId: string) => `${room}:${cellId}`;

/** すべての房（表の順。番号は通しで振る） */
export const CELLS: CellRef[] = Object.entries(FURNITURE)
  .flatMap(([room, f]) => (f.cells ?? []).map((cell) => ({ room, cell })))
  .map((c, i) => ({ ...c, no: `B${two(i + 1)}` }));
/** 房のある部屋 */
export const CELL_ROOMS: string[] = [...new Set(CELLS.map((c) => c.room))];
const BY_KEY: Record<string, CellRef> = Object.fromEntries(CELLS.map((c) => [cellKey(c.room, c.cell.id), c]));

export const isCellRoom = (roomId: string): boolean => CELL_ROOMS.includes(roomId);
export const cellsIn = (roomId: string): CellRef[] => CELLS.filter((c) => c.room === roomId);
export const cellRef = (roomId: string, cellId: string): CellRef | undefined => BY_KEY[cellKey(roomId, cellId)];

function table(state: GameState): Partial<Record<CharId, string>> {
  if (!state.cells) state.cells = {};
  return state.cells;
}

/** その人に割り当てられている房（無ければ null） */
export function cellOf(state: GameState, who: CharId): CellRef | null {
  const key = state.cells?.[who];
  return (key && BY_KEY[key]) || null;
}

/** その房を割り当てられている人（空いていれば null。脱落した人は数えない） */
export function cellOwner(state: GameState, roomId: string, cellId: string): CharId | null {
  const key = cellKey(roomId, cellId);
  const t = state.cells;
  if (!t) return null;
  for (const id of ALL_IDS) if (t[id] === key && state.actors[id]?.alive) return id;
  return null;
}

/**
 * 房を割り当てる（すでにあれば、そのまま返す）。
 * 空いている房を、使う設定の房（enabled）から先に、表の順で選ぶ。全部ふさがっている時（想定外の人数）は最後の房を共用する。
 * prefer を渡すと、その房が空いていれば優先する（古いセーブの引き継ぎ用）。
 */
export function assignCell(state: GameState, who: CharId, prefer?: CellRef): CellRef | null {
  const cur = cellOf(state, who);
  if (cur) return cur;
  if (!CELLS.length) return null;
  const free = (c: CellRef) => !cellOwner(state, c.room, c.cell.id);
  const pick = (prefer && free(prefer) ? prefer : undefined) ?? CELLS.find((c) => c.cell.enabled && free(c)) ?? CELLS.find(free) ?? CELLS[CELLS.length - 1];
  table(state)[who] = cellKey(pick.room, pick.cell.id);
  return pick;
}

/** 房を返す（生活棟へ戻った時） */
export function vacateCell(state: GameState, who: CharId): void {
  if (state.cells) delete state.cells[who];
}

/**
 * 格子の扉が開いているか。
 * 消灯の間、人が入っている房だけ閉まる。昼間と夜の自由時間、空いている房は開いている。
 */
export function gateOpen(state: GameState, roomId: string, cellId: string): boolean {
  return !(state.phase === 'curfew' && cellOwner(state, roomId, cellId));
}

/** 格子の扉の家具（開いた絵と閉じた絵を持つ） */
export function gateProp(roomId: string, cellId: string) {
  const c = cellRef(roomId, cellId);
  return c ? FURNITURE[roomId]?.props.find((p) => p.id === c.cell.door) : undefined;
}

/** 扉が閉じている時にふさがるマス */
export function gateTiles(roomId: string, cellId: string): { x: number; y: number }[] {
  const poly = gateProp(roomId, cellId)?.door?.closedPoly;
  if (!poly?.length) return [];
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const out: { x: number; y: number }[] = [];
  // 端がちょうどマスの境目の時に隣のマスまで取らないよう、1 ピクセル内側で数える
  for (let y = Math.floor(Math.min(...ys) / TILE); y <= Math.floor((Math.max(...ys) - 1) / TILE); y++) {
    for (let x = Math.floor(Math.min(...xs) / TILE); x <= Math.floor((Math.max(...xs) - 1) / TILE); x++) out.push({ x, y });
  }
  return out;
}

/** その部屋で、いま閉じている扉がふさぐマス */
export function closedGateTiles(state: GameState, roomId: string): { x: number; y: number }[] {
  if (state.phase !== 'curfew' || !isCellRoom(roomId)) return [];
  return cellsIn(roomId).filter((c) => !gateOpen(state, roomId, c.cell.id)).flatMap((c) => gateTiles(roomId, c.cell.id));
}

/** 房の寝台（横になる位置） */
export function cellBed(c: CellRef): Anchor | undefined {
  return FURNITURE[c.room]?.anchors.find((a) => a.cell === c.cell.id && a.kind === 'lie');
}

/** 房の中の位置（マス）：寝台の脇、房の中の立つ位置の順に候補を返す */
export function cellSpots(c: CellRef): { x: number; y: number }[] {
  const bed = cellBed(c);
  const out: { x: number; y: number }[] = [];
  if (bed) out.push({ x: Math.floor(bed.ax / TILE), y: Math.floor(bed.ay / TILE) });
  out.push({ x: Math.floor(c.cell.inside[0] / TILE), y: Math.floor(c.cell.inside[1] / TILE) });
  return out;
}

/** その椅子を使ってよいか（房の中の椅子は、その房の人だけ） */
export function seatAllowed(state: GameState, who: CharId, roomId: string, seat: Seat): boolean {
  if (!seat.cell) return true;
  const c = cellOf(state, who);
  return !!c && c.room === roomId && c.cell.id === seat.cell;
}

function inPoly(poly: number[][], px: number, py: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** そのマス（の中心）が入っている房 */
export function cellAtTile(roomId: string, x: number, y: number): CellRef | null {
  const px = x * TILE + TILE / 2;
  const py = y * TILE + TILE / 2;
  return cellsIn(roomId).find((c) => inPoly(c.cell.floor, px, py)) ?? null;
}

export interface CellPlate {
  cell: string;
  no: string;
  /** いまの持ち主（空いていれば null） */
  owner: CharId | null;
  open: boolean;
  /** 表示の基準にする位置（扉の外側の立つ位置。マップの原寸ピクセル） */
  x: number;
  y: number;
}

/** 房ごとの表示の内容（番号、持ち主、扉の開け閉め）。画面側が扉の脇に出す */
export function cellPlates(state: GameState, roomId: string): CellPlate[] {
  return cellsIn(roomId).map((c) => ({
    cell: c.cell.id, no: c.no, owner: cellOwner(state, roomId, c.cell.id), open: gateOpen(state, roomId, c.cell.id), x: c.cell.outside[0], y: c.cell.outside[1],
  }));
}
