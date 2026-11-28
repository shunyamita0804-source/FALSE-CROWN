// 新しい館の構成（2026-11-28 本人承認）の動線と、古いセーブの移し替えの確認
import { describe, expect, it } from 'vitest';
import { ROOMS, ROOM_IDS, RETIRED_ROOMS, isRetired } from '../src/world/maps';
import { passFn } from '../src/world/access';
import { roomRoute } from '../src/world/path';
import { placeIn, relocateStranded } from '../src/world/sim';
import { assignCell } from '../src/world/cells';
import { homeOf } from '../src/world/rooms';
import { freshState } from './helpers';
import type { CharId } from '../src/data/characters';

const via = (r: string[] | null) => (r === null ? null : Math.max(0, r.length - 1));

describe('新しい館の動線', () => {
  it('生活棟の人は、自室からリビング・遊戯室・シャワー・競技会場へ短い道で行ける', () => {
    const s = freshState(1);
    s.actors.hero.house = 'living';
    const pass = passFn(s, 'hero');
    // 途中で通る部屋の数（行き先は数えない）
    expect(via(roomRoute('bedroom_hero', 'dining', pass))).toBe(1);
    expect(via(roomRoute('bedroom_hero', 'game_room', pass))).toBe(2);
    expect(via(roomRoute('bedroom_hero', 'bathroom', pass))).toBe(2);
    expect(via(roomRoute('bedroom_hero', 'main_arena', pass))).toBe(3);
    // 生活棟の人は監獄棟へ入れない
    expect(roomRoute('bedroom_hero', 'prison_cells', pass)).toBeNull();
  });

  it('監獄棟の人は、房から監獄マッチ会場へ直接行け、監獄棟の外へは出られない', () => {
    const s = freshState(2);
    const id = 'npc_02_kanzaki' as CharId;
    s.actors[id].house = 'prison';
    assignCell(s, id);
    const pass = passFn(s, id);
    expect(via(roomRoute('prison_cells', 'prison_arena', pass))).toBe(0);
    expect(roomRoute('prison_cells', 'main_hall', pass)).toBeNull();
    expect(roomRoute('prison_cells', 'dining', pass)).toBeNull();
  });

  it('棟分けの無い時は、中央ホールの鉄扉で両棟がつながる（今までの決まりのまま）', () => {
    const s = freshState(3);
    s.actors.hero.house = null;
    expect(roomRoute('dining', 'prison_cells', passFn(s, 'hero'))).not.toBeNull();
  });

  it('外した部屋へは、使い続ける部屋のどの扉からも行けない', () => {
    for (const id of ROOM_IDS) {
      if (isRetired(id)) continue;
      for (const d of ROOMS[id].doors) expect(isRetired(d.to), `${id}.${d.id} → ${d.to}`).toBe(false);
    }
  });
});

describe('古いセーブの移し替え', () => {
  it('外した部屋にいた人は、入れる部屋へ移り、自分の寝起きする場所へ歩いて戻れる', () => {
    const s = freshState(4);
    const npcs = Object.keys(s.actors).filter((k) => k !== 'hero') as CharId[];
    // 生活棟の人を外した部屋へ置く（2F、展望室、交換所、B2 の地下）
    const spots = ['garden', 'common_hall', 'observatory', 'shop', 'moon_casino', 'mirror_room', 'research_lab'];
    s.actors.hero.house = 'living';
    placeIn(s, 'hero', 'moon_casino');
    spots.forEach((r, i) => { s.actors[npcs[i]].house = 'living'; placeIn(s, npcs[i], r); });
    // 監獄棟の人を、外した地下の部屋へ置く
    const pris = npcs.slice(spots.length, spots.length + 3);
    pris.forEach((id, i) => { s.actors[id].house = 'prison'; assignCell(s, id); placeIn(s, id, ['prison_hallway', 'old_archive', 'underground_passage'][i]); });
    // 外した部屋へ向かう予定も持たせておく
    s.actors[npcs[npcs.length - 1]].goal = { kind: 'wander', room: 'common_lounge', spot: { x: 5, y: 5 }, until: s.simTime + 60_000 } as never;
    relocateStranded(s);
    for (const id of Object.keys(s.actors) as CharId[]) {
      const a = s.actors[id];
      if (!a.alive) continue;
      expect(isRetired(a.pos.room), `${id} は ${a.pos.room}`).toBe(false);
      expect(roomRoute(a.pos.room, homeOf(s, id), passFn(s, id)), `${id}: ${a.pos.room} から帰れない`).not.toBeNull();
    }
    expect(s.actors.hero.pos.room).toBe(RETIRED_ROOMS.moon_casino);
    expect(s.actors[npcs[npcs.length - 1]].goal).toBeUndefined();
    for (const id of pris) expect(s.actors[id].pos.room).toBe('prison_cells');
  });

  it('入れない部屋に囲まれて帰れない所にいる人も、寝起きする場所へ移す', () => {
    const s = freshState(5);
    // 生活棟の人が第零牢（出口は共同牢だけ）に残っている
    s.actors.hero.house = 'living';
    placeIn(s, 'hero', 'cell_zero');
    relocateStranded(s);
    expect(s.actors.hero.pos.room).toBe('bedroom_hero');
  });
});
