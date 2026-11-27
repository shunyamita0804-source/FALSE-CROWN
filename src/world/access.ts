import type { CharId } from '../data/characters';
import type { GameState } from '../core/types';
import { ROOMS, type RoomDef } from './maps';

/**
 * 立入制限（暫定 D-WORLD-01）:
 * - 個室は本人のみ
 * - 棟分け後（house 設定中）は、生活棟側は 3F〜1F、監獄棟側は B1 のみ
 * - 秘密区画は解錠フラグが立っていて、かつプレイヤーのみ（NPC は NPC 用の代替経路で情報を得る）
 * - 鍵付きの扉はフラグが必要
 */
export function canEnter(state: GameState, who: CharId, roomId: string, lock?: string): boolean {
  const room = ROOMS[roomId];
  if (!room) return false;
  if (lock && !state.flags[lock]) return false;
  if (roomId.startsWith('bedroom_')) return roomId === `bedroom_${who}`;
  const a = state.actors[who];
  if (room.area === 'secret') return who === 'hero';
  if (a.house === 'living') return room.area !== 'prison';
  if (a.house === 'prison') return room.area === 'prison';
  return true;
}

export function passFn(state: GameState, who: CharId) {
  return (room: RoomDef, lock?: string) => canEnter(state, who, room.id, lock);
}

/** 入れない理由（プレイヤー向けの説明） */
export function denyReason(state: GameState, roomId: string, lock?: string): string {
  const room = ROOMS[roomId];
  if (roomId.startsWith('bedroom_')) return '他の参加者の個室には入れない。';
  if (lock && !state.flags[lock]) return room.area === 'secret' ? '' : '鍵がかかっている。';
  const h = state.actors.hero.house;
  if (h === 'living' && room.area === 'prison') return '生活棟の参加者は、いま監獄棟へ下りられない。';
  if (h === 'prison' && room.area !== 'prison') return '監獄棟の鉄扉は固く閉ざされている。';
  return '今は入れない。';
}
