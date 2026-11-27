import { describe, expect, it } from 'vitest';
import { ALL_IDS } from '../src/data/characters';
import { ROOMS } from '../src/world/maps';
import { actorsIn, moveActor, placeIn, setRouteTo, speedOf } from '../src/world/sim';
import { freshState } from './helpers';

describe('入口の詰まり', () => {
  it('主人公が食堂の扉の前に立っていても、出ていく NPC は列になって止まらず、全員が部屋を出られる', () => {
    const s = freshState(5);
    const room = ROOMS.dining;
    const door = room.doors[0];
    const npcs = ALL_IDS.filter((x) => x !== 'hero').slice(0, 8);
    for (const id of ALL_IDS) placeIn(s, id, 'observatory');
    // 主人公は扉の前のマスに立ったまま動かない
    s.actors.hero.pos = { room: 'dining', x: door.tiles[0].x, y: door.tiles[0].y, dir: 'up' };
    npcs.forEach((id, i) => {
      placeIn(s, id, 'dining', { x: 6 + i * 2, y: 10 });
      expect(setRouteTo(s, s.actors[id], door.to)).toBe(true);
    });
    for (let t = 0; t < 40_000; t += 50) for (const id of npcs) moveActor(s, s.actors[id], 50, speedOf(id));
    expect(actorsIn(s, 'dining').map((a) => a.id)).toEqual(['hero']);
  });

  it('扉の前のマスが両方とも人で埋まっていても、隣から通れる', () => {
    const s = freshState(6);
    const room = ROOMS.dining;
    const door = room.doors[0];
    for (const id of ALL_IDS) placeIn(s, id, 'observatory');
    const [a, b, c] = ALL_IDS.filter((x) => x !== 'hero');
    door.tiles.slice(0, 2).forEach((t, i) => { s.actors[[a, b][i]].pos = { room: 'dining', x: t.x, y: t.y, dir: 'up' }; });
    if (door.tiles.length > 2) return;
    placeIn(s, c, 'dining', { x: 10, y: 10 });
    setRouteTo(s, s.actors[c], door.to);
    for (let t = 0; t < 30_000; t += 50) moveActor(s, s.actors[c], 50, speedOf(c));
    expect(s.actors[c].pos.room).not.toBe('dining');
  });
});
