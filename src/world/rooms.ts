/**
 * 個室の割り当て。
 * 生活棟の個室は場所として固定で、誰の部屋かは GameState.rooms（人物 → 寝起きする部屋）で持つ。
 * 部屋番号と持ち主の名前は、この表から画面側がプログラムで表示する（背景画像には書き込まない）。
 * - 開始時：参加者の並び順に、生活棟の部屋を 1 室ずつ割り当てる（参加者数が変わっても表から作り直せる）
 * - 監獄棟へ送られた時：共同牢の中の空いている房を割り当てる（world/cells.ts）。寝起きする部屋は共同牢になる。
 *   生活棟の部屋は本人の名札のまま閉鎖され、戻った時に同じ部屋を使う
 * - 脱落した時：その人の部屋と房は空きになる
 * 以前は房ごとに別の部屋（cell_p01〜）があった。いまは使わない（誰も入れない。古いセーブでそこにいた人は房へ移す）。
 */
import { ALL_IDS, type CharId } from '../data/characters';
import { shortName } from '../core/state';
import type { GameState } from '../core/types';
import { ROOMS } from './maps';
import { CELLS, assignCell, cellOf, cellOwner, isCellRoom, vacateCell, type CellRef } from './cells';

export type Wing = 'living' | 'prison';

export interface PrivateRoom {
  /** 部屋の識別子（L01〜、P01〜） */
  code: string;
  /** 扉に表示する部屋番号 */
  no: string;
  wing: Wing;
  /** マップ上の部屋 ID */
  room: string;
}

const two = (n: number) => String(n).padStart(2, '0');

/** 生活棟の個室。参加者の並び順（ALL_IDS）に 301 号室から割り当てる */
export const LIVING_ROOMS: PrivateRoom[] = ALL_IDS.map((id, i) => ({ code: `L${two(i + 1)}`, no: `3${two(i + 1)}`, wing: 'living', room: `bedroom_${id}` }));
/** 以前の「房ごとの別の部屋」（cell_p01〜）。マップに残っている分だけ。いまは誰にも割り当てない */
export const LEGACY_CELL_ROOMS: PrivateRoom[] = Object.keys(ROOMS).filter((id) => /^cell_p\d+$/.test(id)).sort().map((id) => ({ code: `P${id.slice(6)}`, no: `B${id.slice(6)}`, wing: 'prison', room: id }));
export const PRIVATE_ROOMS: PrivateRoom[] = [...LIVING_ROOMS, ...LEGACY_CELL_ROOMS];
const BY_ROOM: Record<string, PrivateRoom> = Object.fromEntries(PRIVATE_ROOMS.map((r) => [r.room, r]));

/** 開始時の割り当て（人物 → 生活棟の部屋） */
const DEFAULT_ROOM: Record<string, string> = Object.fromEntries(ALL_IDS.map((id, i) => [id, LIVING_ROOMS[i].room]));

export const isPrivateRoom = (roomId: string): boolean => roomId in BY_ROOM;
export const privateRoom = (roomId: string): PrivateRoom | undefined => BY_ROOM[roomId];
const isLegacyCell = (roomId: string): boolean => BY_ROOM[roomId]?.wing === 'prison';
/** 以前の房の部屋に対応する、いまの房（番号が同じもの） */
const legacyCell = (roomId: string): CellRef | undefined => (/^cell_p\d+$/.test(roomId) ? CELLS[Number(roomId.slice(6)) - 1] : undefined);
/** 監獄棟で寝起きする部屋か（房のある共同牢。以前の房の部屋も含む） */
export const isCell = (roomId: string): boolean => isCellRoom(roomId) || isLegacyCell(roomId);
/** 生活棟で本人に割り当てられている部屋（監獄棟にいる間も、名札は残る） */
export const livingRoomOf = (who: CharId): string => DEFAULT_ROOM[who];

function table(state: GameState): Partial<Record<CharId, string>> {
  if (!state.rooms) state.rooms = {};
  return state.rooms;
}

/**
 * その人が、いま寝起きする部屋。生活棟なら自分の個室、監獄棟なら房のある共同牢（どの房かは cellOf）。
 * 棟分けの結果（house）に合わせて、ここで割り当てを更新する：監獄棟なら空いている房、生活棟なら元の部屋。
 * 棟分けが解けた後（house が null）は、最後の割り当てのまま変えない。
 */
export function homeOf(state: GameState, who: CharId): string {
  const rooms = table(state);
  const a = state.actors[who];
  // 古いセーブ：房ごとの別の部屋を割り当てられていた人は、同じ番号の房へ引き継ぐ
  const old = rooms[who];
  if (old && isLegacyCell(old) && !cellOf(state, who) && a?.alive) assignCell(state, who, legacyCell(old));
  if (a?.alive) {
    if (a.house === 'prison') assignCell(state, who);
    else if (a.house === 'living') vacateCell(state, who);
  }
  const cur = cellOf(state, who)?.room ?? DEFAULT_ROOM[who];
  if (rooms[who] !== cur) rooms[who] = cur;
  return cur;
}

/** その部屋を、いま割り当てられている人（空室なら null） */
export function ownerOfRoom(state: GameState, roomId: string): CharId | null {
  if (!isPrivateRoom(roomId) || isLegacyCell(roomId)) return null;
  for (const id of ALL_IDS) if (state.actors[id].alive && homeOf(state, id) === roomId) return id;
  return null;
}

/** 生活棟の部屋で、持ち主が監獄棟へ移っている間の「名札だけ残っている人」 */
export function awayOwner(state: GameState, roomId: string): CharId | null {
  const r = BY_ROOM[roomId];
  if (!r || r.wing !== 'living') return null;
  for (const id of ALL_IDS) if (state.actors[id].alive && DEFAULT_ROOM[id] === roomId && homeOf(state, id) !== roomId) return id;
  return null;
}

export interface RoomPlate {
  no: string;
  /** いまの持ち主（空室なら null） */
  owner: CharId | null;
  /** 持ち主が監獄棟へ移っていて閉鎖中の時の、名札の人 */
  away: CharId | null;
}

/** 扉の脇に出す表示の内容 */
export function plateOf(state: GameState, roomId: string): RoomPlate | null {
  const r = BY_ROOM[roomId];
  if (!r) return null;
  // 以前の房の部屋の扉には、同じ番号の房の持ち主を出す（扉そのものは使わない）
  const lc = legacyCell(roomId);
  if (lc) return { no: lc.no, owner: cellOwner(state, lc.room, lc.cell.id), away: null };
  const owner = ownerOfRoom(state, roomId);
  return { no: r.no, owner, away: owner ? null : awayOwner(state, roomId) };
}

/** 画面に出す部屋の名前。個室は部屋番号と持ち主の名前（空室、閉鎖中も分かるようにする） */
export function roomTitle(state: GameState, roomId: string): string {
  const p = plateOf(state, roomId);
  if (!p) return ROOMS[roomId]?.name ?? '';
  if (isLegacyCell(roomId)) return p.owner === 'hero' ? `${p.no} 自分の房` : p.owner ? `${p.no} ${shortName(state, p.owner)}の房` : `${p.no} 空き`;
  if (p.owner === 'hero') return `${p.no} 自分の個室`;
  if (p.owner) return `${p.no} ${shortName(state, p.owner)}の個室`;
  return p.away ? `${p.no} ${shortName(state, p.away)}の個室（閉鎖中）` : `${p.no} 空室`;
}

/** 主人公がその扉を叩けるか（他の参加者に割り当てられた個室で、まだ招かれていない時） */
export function knockable(state: GameState, roomId: string): boolean {
  if (state.phase === 'curfew') return false;
  const owner = ownerOfRoom(state, roomId);
  if (!owner || owner === 'hero') return false;
  const inv = (state as GameState & { invites?: { host: CharId; guest: CharId; until: number }[] }).invites;
  return !inv?.some((i) => i.host === owner && i.guest === 'hero' && i.until > state.simTime);
}

/** 房の名前（番号と持ち主）。画面側が扉の脇や、調べた時に出す */
export function cellTitle(state: GameState, roomId: string, cellId: string): string {
  const c = CELLS.find((x) => x.room === roomId && x.cell.id === cellId);
  if (!c) return '';
  const owner = cellOwner(state, roomId, cellId);
  return owner === 'hero' ? `${c.no} 自分の房` : owner ? `${c.no} ${shortName(state, owner)}の房` : `${c.no} 空き`;
}
