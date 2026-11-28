import { describe, expect, it } from 'vitest';
import { aliveIds } from '../src/core/state';
import { tickNpcs } from '../src/npc/brain';
import { ROOMS } from '../src/world/maps';
import { homeOf } from '../src/world/rooms';
import { homeSpot, placeIn, setRouteTo } from '../src/world/sim';
import { freshState } from './helpers';

/** 扉のマスからのいちばん近い距離 */
const doorDist = (room: string, x: number, y: number) => Math.min(...ROOMS[room].doors.flatMap((d) => d.tiles).map((t) => Math.abs(t.x - x) + Math.abs(t.y - y)));

describe('部屋に着いた人が入口に固まらない', () => {
  it('廊下からそろって食堂へ来た NPC は、入口で立ち食いせず、全員が席に座って食べる', () => {
    for (const seed of [1, 4, 9]) {
      const s = freshState(seed);
      s.phase = 'morning';
      const npcs = aliveIds(s).filter((id) => id !== 'hero');
      npcs.forEach((id, i) => {
        placeIn(s, id, 'common_hall', { x: 10 + (i % 6), y: 6 + Math.floor(i / 6) });
        s.actors[id].goal = { kind: 'goto', room: 'dining', spot: ROOMS.dining.spots[i % ROOMS.dining.spots.length], note: 'meal', until: s.simTime + 120_000 };
        setRouteTo(s, s.actors[id], 'dining');
      });
      const ate: Record<string, { x: number; y: number; seat: boolean }> = {};
      for (let t = 0; t < 60_000; t += 100) {
        s.simTime += 100;
        tickNpcs(s, 100, false);
        for (const id of npcs) {
          const a = s.actors[id];
          if (!ate[id] && a.bubble?.text === '🍽') ate[id] = { x: a.pos.x, y: a.pos.y, seat: !!a.seat };
        }
      }
      expect(Object.keys(ate).length).toBe(npcs.length);
      for (const id of npcs) {
        expect(ate[id].seat, `${seed} ${id}`).toBe(true);
        expect(doorDist('dining', ate[id].x, ate[id].y)).toBeGreaterThan(2);
      }
    }
  });

  it('別の部屋へ過ごしに行った NPC は、扉をくぐったマスで止まらず、部屋の中の地点まで歩く', () => {
    const s = freshState(3);
    s.phase = 'free';
    const npcs = aliveIds(s).filter((id) => id !== 'hero');
    npcs.forEach((id, i) => {
      placeIn(s, id, 'dining', { x: 6 + (i % 6), y: 14 + Math.floor(i / 6) });
      s.actors[id].goal = { kind: 'wander', room: 'game_room', spot: ROOMS.game_room.spots[i % ROOMS.game_room.spots.length], until: s.simTime + 120_000, seat: '-' };
      setRouteTo(s, s.actors[id], 'game_room');
    });
    const at: Record<string, { x: number; y: number }> = {};
    for (let t = 0; t < 60_000; t += 100) {
      s.simTime += 100;
      tickNpcs(s, 100, false);
      for (const id of npcs) {
        const a = s.actors[id];
        if (!at[id] && a.goal?.note === 'at' && a.pos.room === 'game_room') at[id] = { x: a.pos.x, y: a.pos.y };
      }
    }
    const ids = Object.keys(at);
    expect(ids.length).toBeGreaterThanOrEqual(npcs.length - 1);
    // 入口のすぐそば（扉から 2 マス以内）で過ごし始めた人は、ほとんどいない
    expect(ids.filter((id) => doorDist('game_room', at[id].x, at[id].y) <= 2).length).toBeLessThanOrEqual(1);
  });

  it('自分の部屋へ戻った NPC は、扉の前ではなく部屋の中で過ごす', () => {
    const s = freshState(5);
    s.phase = 'free';
    const id = aliveIds(s).filter((x) => x !== 'hero')[0];
    const room = homeOf(s, id);
    const door = ROOMS[room].doors[0];
    placeIn(s, id, door.to);
    s.actors[id].goal = { kind: 'rest', room, spot: homeSpot(s, id).spot, until: s.simTime + 120_000 };
    setRouteTo(s, s.actors[id], room);
    for (let t = 0; t < 40_000 && s.actors[id].goal?.note !== 'at'; t += 100) {
      s.simTime += 100;
      tickNpcs(s, 100, false);
    }
    const a = s.actors[id];
    expect(a.pos.room).toBe(room);
    expect(a.goal?.note).toBe('at');
    const sp = homeSpot(s, id).spot!;
    expect(Math.abs(a.pos.x - sp.x) + Math.abs(a.pos.y - sp.y)).toBeLessThanOrEqual(1);
  });
});
