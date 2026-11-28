/**
 * 席の予約と着席（建物改修の家具。席の表は data/furniture.json）。
 * - 席は 1 つずつ予約する（GameState.seatsTaken）。1 人が持てる席は 1 つだけ
 * - 先に予約してから席の「立つ位置」のマスへ歩き、着いたら座る。立つ時、部屋を出る時、脱落した時に予約を放す
 * - 人が減っても席そのものは残る（空席になるだけ）。席の数は表から数える
 * - 座っている間、人物の pos は席の「立つ位置」のマスのまま（話しかける時の位置になる）
 * DOM にも Phaser にも依存しない。
 */
import { ALL_IDS, type CharId } from '../data/characters';
import type { Dir, GameState } from '../core/types';
import { seatKey, seatsOf, type Facing, type Seat } from './furniture';

const TILE = 64;

export interface Tile { x: number; y: number }
export type SeatRole = 'player' | 'free';

/** 席を選ぶ時の条件 */
export interface SeatPick {
  /** この席を指定する（省くと、空いている席から決まった規則で選ぶ） */
  id?: string;
  /** 'player' は競技の参加者席だけ、'free' はそれ以外の席だけ。省くと 'free' */
  role?: SeatRole;
  /** このマスに近い席を選ぶ（省くと表の順で最初の空席） */
  near?: Tile;
  /** 使える席かどうか（立つ位置へ歩いて行けるか、本人の房の椅子か、など。呼ぶ側が決める） */
  usable?: (seat: Seat) => boolean;
}

/** 席の「立つ位置」のマス */
export const seatTile = (seat: Seat): Tile => ({ x: Math.floor(seat.a[0] / TILE), y: Math.floor(seat.a[1] / TILE) });
/** 席の腰の位置のマス（椅子そのものがあるマス） */
export const seatHipTile = (seat: Seat): Tile => ({ x: Math.floor(seat.hip[0] / TILE), y: Math.floor(seat.hip[1] / TILE) });

const roleOf = (seat: Seat): SeatRole => (seat.role === 'player' ? 'player' : 'free');
const findSeat = (room: string, id: string): Seat | undefined => seatsOf(room).find((s) => s.id === id);

/** 座った時の向き（斜めは上下に寄せる） */
export function seatDir(f: Facing): Dir {
  if (f === 'E') return 'right';
  if (f === 'W') return 'left';
  return f.startsWith('N') ? 'up' : 'down';
}

function table(state: GameState): Record<string, CharId> {
  if (!state.seatsTaken) state.seatsTaken = {};
  return state.seatsTaken;
}

/** その席を取っている人（空席なら null） */
export function seatTaker(state: GameState, room: string, seatId: string): CharId | null {
  return state.seatsTaken?.[seatKey(room, seatId)] ?? null;
}

/** その人が取っている席（予約中か着席中。無ければ null） */
export function seatOf(state: GameState, who: CharId): { room: string; seat: Seat } | null {
  const t = state.seatsTaken;
  if (!t) return null;
  for (const key in t) {
    if (t[key] !== who) continue;
    const i = key.indexOf(':');
    const room = key.slice(0, i);
    const seat = findSeat(room, key.slice(i + 1));
    if (seat) return { room, seat };
  }
  return null;
}

/** その部屋の空席（role を省くと全部の席から） */
export function freeSeats(state: GameState, room: string, role?: SeatRole): Seat[] {
  return seatsOf(room).filter((s) => (!role || roleOf(s) === role) && !seatTaker(state, room, s.id));
}

/** 予約を放す（座っていれば立つ）。取っていなければ何もしない */
export function releaseSeat(state: GameState, who: CharId): void {
  const t = state.seatsTaken;
  if (t) for (const key in t) if (t[key] === who) delete t[key];
  const a = state.actors[who];
  if (a?.seat) a.seat = undefined;
}

/** 立つ（予約も放す） */
export const standUp = releaseSeat;

/**
 * 席を予約する。確かめるのと取るのを 1 回の呼び出しで済ませるので、同じ席を 2 人が取ることはない。
 * すでに別の席を持っていれば、先にそれを放す。取れた席を返す（取れなければ null で、何も変えない）。
 */
export function reserveSeat(state: GameState, who: CharId, room: string, pick?: string | SeatPick): Seat | null {
  const a = state.actors[who];
  if (!a?.alive) return null;
  const opt: SeatPick = typeof pick === 'string' ? { id: pick } : pick ?? {};
  const mine = seatOf(state, who);
  const open = (s: Seat) => {
    const by = seatTaker(state, room, s.id);
    return (!by || by === who) && (!opt.usable || opt.usable(s));
  };
  let seat: Seat | undefined;
  if (opt.id) {
    const s = findSeat(room, opt.id);
    if (s && open(s)) seat = s;
  } else {
    const role = opt.role ?? 'free';
    const cands = seatsOf(room).filter((s) => roleOf(s) === role && open(s));
    if (opt.near && cands.length) {
      const d = (s: Seat) => { const t = seatTile(s); return Math.abs(t.x - opt.near!.x) + Math.abs(t.y - opt.near!.y); };
      // 同じ近さなら表の順（sort は順番を保つ）
      seat = cands.slice().sort((p, q) => d(p) - d(q))[0];
    } else seat = cands[0];
  }
  if (!seat) return null;
  if (mine && (mine.room !== room || mine.seat.id !== seat.id)) releaseSeat(state, who);
  table(state)[seatKey(room, seat.id)] = who;
  return seat;
}

/** 予約した席の「立つ位置」に着いていれば座る。座れたら true */
export function sitDown(state: GameState, who: CharId): boolean {
  const a = state.actors[who];
  const mine = seatOf(state, who);
  if (!a?.alive || !mine || a.step) return false;
  const t = seatTile(mine.seat);
  if (a.pos.room !== mine.room || a.pos.x !== t.x || a.pos.y !== t.y) return false;
  a.seat = { room: mine.room, id: mine.seat.id };
  a.pos.dir = seatDir(mine.seat.facing);
  a.path = [];
  a.route = [];
  a.moving = false;
  return true;
}

/** 歩かせずに、その場で席へ着かせる（競技の集合など、場面の切り替えで使う）。座れたら true */
export function seatActor(state: GameState, who: CharId, room: string, pick?: string | SeatPick): boolean {
  const a = state.actors[who];
  const seat = reserveSeat(state, who, room, pick);
  if (!a || !seat) return false;
  const t = seatTile(seat);
  a.pos = { room, x: t.x, y: t.y, dir: seatDir(seat.facing) };
  a.step = undefined;
  return sitDown(state, who);
}

/**
 * 競技の参加者を、参加者席（role が 'player' の席）へ着かせる。
 * 並びは参加者の決まった順（ALL_IDS）で、席は表の順。人数より席が多ければ残りは空席、席が足りない人は立ったまま。
 * 座れなかった人を返す。
 */
export function seatPlayers(state: GameState, room: string, ids: CharId[]): CharId[] {
  const order = ids.slice().sort((p, q) => ALL_IDS.indexOf(p) - ALL_IDS.indexOf(q));
  const left: CharId[] = [];
  for (const id of order) if (!seatActor(state, id, room, { role: 'player' })) left.push(id);
  return left;
}

/** 全員を立たせる（room を指定すると、その部屋の席だけ） */
export function standAll(state: GameState, room?: string): void {
  const t = state.seatsTaken;
  if (!t) return;
  for (const key of Object.keys(t)) if (!room || key.startsWith(`${room}:`)) releaseSeat(state, t[key]);
}

/**
 * 席の表の点検（毎回の進行と、部屋の移動のあとに呼ぶ）。
 * 脱落した人、その部屋にいない人、表に無い席の予約を消し、席から離れた人の「座っている」印を外す。
 */
export function sweepSeats(state: GameState): void {
  const t = state.seatsTaken;
  if (t) {
    for (const key of Object.keys(t)) {
      const who = t[key];
      const a = state.actors[who];
      const i = key.indexOf(':');
      const room = key.slice(0, i);
      const seat = findSeat(room, key.slice(i + 1));
      if (!a?.alive || !seat || a.pos.room !== room) { delete t[key]; continue; }
      if (a.seat) {
        const tile = seatTile(seat);
        // 座っているはずなのに席から離れている（場面の切り替えで動かされた、など）
        if (a.seat.room !== room || a.seat.id !== seat.id || a.pos.x !== tile.x || a.pos.y !== tile.y || a.step) delete t[key];
      }
    }
  }
  for (const id of ALL_IDS) {
    const a = state.actors[id];
    if (a?.seat && (!a.alive || t?.[seatKey(a.seat.room, a.seat.id)] !== id)) a.seat = undefined;
  }
}

/**
 * 立っているマスと向きから、座れる空席を探す（主人公の「座る」）。
 * - 席の「立つ位置」のマスに立っている時
 * - 正面のマスが椅子で、その「立つ位置」がすぐ隣（または同じマス）の時
 */
export function seatTargetAt(state: GameState, room: string, tile: Tile, dir: Dir, usable?: (seat: Seat) => boolean): Seat | null {
  const ok = (s: Seat) => !seatTaker(state, room, s.id) && roleOf(s) === 'free' && (!usable || usable(s));
  const seats = seatsOf(room).filter(ok);
  const here = seats.find((s) => { const t = seatTile(s); return t.x === tile.x && t.y === tile.y; });
  if (here) return here;
  const f = { x: tile.x + (dir === 'left' ? -1 : dir === 'right' ? 1 : 0), y: tile.y + (dir === 'up' ? -1 : dir === 'down' ? 1 : 0) };
  return seats.find((s) => {
    const h = seatHipTile(s);
    const t = seatTile(s);
    return h.x === f.x && h.y === f.y && Math.abs(t.x - tile.x) + Math.abs(t.y - tile.y) <= 1;
  }) ?? null;
}
