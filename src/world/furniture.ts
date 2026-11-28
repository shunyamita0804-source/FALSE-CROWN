/**
 * 建物改修の家具、席、当たり判定（data/furniture.json。scripts/import-redesign.py が作る）。
 * 座標はマップの原寸ピクセル（1 マス 64 ピクセル、左上が原点）。
 * - 家具は「後ろの絵 img」と「前の絵 fg」に分かれている物がある。座った人は、その間に描く
 * - 席の hip は腰（座面）の位置、a は立つ位置（足元）
 * DOM にも Phaser にも依存しない。
 */
import table from '../data/furniture.json';

export type Facing = 'N' | 'S' | 'E' | 'W' | 'NE' | 'NW' | 'SE' | 'SW';
export interface FurnitureProp {
  id: string; img: string; x: number; y: number; w: number; h: number; depth: number;
  fg?: { img: string; depth: number };
  door?: { cell?: string; open: string; closed: string; initial: 'open' | 'closed'; closedPoly: number[][] };
  cell?: string;
}
export interface Seat {
  id: string; prop: string; hip: [number, number]; facing: Facing; a: [number, number];
  depth?: number; foot?: [number, number]; role?: 'player'; cell?: string;
}
export interface Collider { id: string; poly: number[][]; when?: string }
export interface Cell { id: string; row: 'upper' | 'lower'; door: string; enabled: boolean; inside: [number, number]; outside: [number, number]; floor: number[][] }
export interface Anchor { id: string; kind: string; x: number; y: number; ax: number; ay: number; facing?: Facing; cell?: string }
export interface RoomFurniture {
  bg: string; props: FurnitureProp[]; seats: Seat[]; colliders: Collider[]; cells: Cell[]; anchors: Anchor[];
  exits: { id: string; poly: number[][]; a?: [number, number] }[]; walkable: number[][][];
  board?: { x: number; y: number; width: number; height: number };
}

export const FURNITURE = (table as unknown as { rooms: Record<string, RoomFurniture> }).rooms;

export const furnitureOf = (roomId: string): RoomFurniture | undefined => FURNITURE[roomId];
export const seatsOf = (roomId: string): Seat[] => FURNITURE[roomId]?.seats ?? [];
/** 席の予約の鍵（部屋と席で 1 つ） */
export const seatKey = (roomId: string, seatId: string) => `${roomId}:${seatId}`;

/** 席の前後の描き順：前の絵があればその直前、無ければ席の値か家具の少し手前 */
export function seatDepth(roomId: string, seat: Seat): number {
  const p = FURNITURE[roomId]?.props.find((q) => q.id === seat.prop);
  if (p?.fg) return p.fg.depth - 1;
  return seat.depth ?? (p ? p.depth + 1 : seat.hip[1]);
}
