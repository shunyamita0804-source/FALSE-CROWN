/**
 * 個室の割り当て。
 * 個室（生活棟の 12 室、監獄棟の 11 室）は場所として固定で、誰の部屋かは GameState.rooms（人物 → 部屋）で持つ。
 * 部屋番号と持ち主の名前は、この表から画面側がプログラムで表示する（背景画像には書き込まない）。
 * - 開始時：参加者の並び順に、生活棟の部屋を 1 室ずつ割り当てる（参加者数が変わっても表から作り直せる）
 * - 監獄棟へ送られた時：監獄棟の空いている部屋を割り当てる。生活棟の部屋は本人の名札のまま閉鎖され、戻った時に同じ部屋を使う
 * - 脱落した時：その人の部屋は空室になる
 */
import { ALL_IDS, type CharId } from '../data/characters';
import { shortName } from '../core/state';
import type { GameState } from '../core/types';
import { ROOMS } from './maps';

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

/** 監獄棟の個室の数（共同牢の背景に描かれている区画の数） */
export const PRISON_ROOM_COUNT = 11;

const two = (n: number) => String(n).padStart(2, '0');

/** 生活棟の個室。参加者の並び順（ALL_IDS）に 301 号室から割り当てる */
export const LIVING_ROOMS: PrivateRoom[] = ALL_IDS.map((id, i) => ({ code: `L${two(i + 1)}`, no: `3${two(i + 1)}`, wing: 'living', room: `bedroom_${id}` }));
export const PRISON_ROOMS: PrivateRoom[] = Array.from({ length: PRISON_ROOM_COUNT }, (_, i) => ({ code: `P${two(i + 1)}`, no: `B${two(i + 1)}`, wing: 'prison', room: `cell_p${two(i + 1)}` }));
export const PRIVATE_ROOMS: PrivateRoom[] = [...LIVING_ROOMS, ...PRISON_ROOMS];
const BY_ROOM: Record<string, PrivateRoom> = Object.fromEntries(PRIVATE_ROOMS.map((r) => [r.room, r]));

/** 開始時の割り当て（人物 → 生活棟の部屋） */
const DEFAULT_ROOM: Record<string, string> = Object.fromEntries(ALL_IDS.map((id, i) => [id, LIVING_ROOMS[i].room]));

export const isPrivateRoom = (roomId: string): boolean => roomId in BY_ROOM;
export const privateRoom = (roomId: string): PrivateRoom | undefined => BY_ROOM[roomId];
export const isCell = (roomId: string): boolean => BY_ROOM[roomId]?.wing === 'prison';
/** 生活棟で本人に割り当てられている部屋（監獄棟にいる間も、名札は残る） */
export const livingRoomOf = (who: CharId): string => DEFAULT_ROOM[who];

type WithRooms = GameState & { rooms?: Partial<Record<CharId, string>> };

function table(state: GameState): Partial<Record<CharId, string>> {
  const st = state as WithRooms;
  if (!st.rooms) st.rooms = {};
  return st.rooms;
}

/**
 * その人に、いま割り当てられている個室（寝起きする部屋）。
 * 棟分けの結果（house）に合わせて、ここで割り当てを更新する：監獄棟なら空いている監獄棟の部屋、生活棟なら元の部屋。
 * 棟分けが解けた後（house が null）は、最後の割り当てのまま変えない。
 */
export function homeOf(state: GameState, who: CharId): string {
  const rooms = table(state);
  const a = state.actors[who];
  let cur = rooms[who] ?? DEFAULT_ROOM[who];
  if (a?.alive) {
    if (a.house === 'prison' && !isCell(cur)) {
      const taken = new Set(ALL_IDS.filter((id) => id !== who && state.actors[id].alive).map((id) => rooms[id]));
      // 空きがない時（想定外の人数）は、最後の部屋を共用する
      cur = (PRISON_ROOMS.find((r) => !taken.has(r.room)) ?? PRISON_ROOMS[PRISON_ROOMS.length - 1]).room;
    } else if (a.house === 'living' && isCell(cur)) cur = DEFAULT_ROOM[who];
  }
  if (rooms[who] !== cur) rooms[who] = cur;
  return cur;
}

/** その部屋を、いま割り当てられている人（空室なら null） */
export function ownerOfRoom(state: GameState, roomId: string): CharId | null {
  if (!isPrivateRoom(roomId)) return null;
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
  const owner = ownerOfRoom(state, roomId);
  return { no: r.no, owner, away: owner ? null : awayOwner(state, roomId) };
}

/** 画面に出す部屋の名前。個室は部屋番号と持ち主の名前（空室、閉鎖中も分かるようにする） */
export function roomTitle(state: GameState, roomId: string): string {
  const p = plateOf(state, roomId);
  if (!p) return ROOMS[roomId]?.name ?? '';
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
