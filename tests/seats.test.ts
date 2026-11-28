import { describe, expect, it } from 'vitest';
import { aliveIds } from '../src/core/state';
import { eliminate, gatherAt } from '../src/core/tournament';
import { ALL_IDS, type CharId } from '../src/data/characters';
import { tickNpcs } from '../src/npc/brain';
import { FURNITURE, seatsOf } from '../src/world/furniture';
import { freeSeats, releaseSeat, reserveSeat, seatOf, seatTaker, sitDown, seatTile } from '../src/world/seats';
import { collisionOf, moveActor, nearbyAction, placeIn, setPathTo } from '../src/world/sim';
import { freshState } from './helpers';

const K = 'npc_02_kanzaki' as CharId;
const M = 'npc_04_mido' as CharId;

describe('席（建物改修の家具）', () => {
  it('席の表：食堂は 12 席、競技場の参加者席は 12 席。どの席も立つ位置へ歩いて行ける', () => {
    expect(seatsOf('dining').length).toBe(12);
    expect(seatsOf('main_arena').filter((s) => s.role === 'player').length).toBe(12);
    const s = freshState(1);
    const bad: string[] = [];
    for (const room of Object.keys(FURNITURE)) {
      const g = collisionOf(s, room);
      for (const seat of seatsOf(room)) { if (seat.cell) continue; const t = seatTile(seat); if (g[t.y]?.[t.x] !== false) bad.push(`${room}:${seat.id} (${t.x},${t.y})`); }
    }
    expect(bad).toEqual([]);
  });

  it('1 つの席は 1 人だけ。1 人が持てる席も 1 つ。立つと空席に戻る', () => {
    const s = freshState(2);
    placeIn(s, K, 'dining');
    placeIn(s, M, 'dining');
    const a = reserveSeat(s, K, 'dining', 'D01')!;
    expect(a.id).toBe('D01');
    expect(reserveSeat(s, M, 'dining', 'D01')).toBeNull();
    expect(seatTaker(s, 'dining', 'D01')).toBe(K);
    reserveSeat(s, K, 'dining', 'D02');
    expect(seatTaker(s, 'dining', 'D01')).toBeNull();
    expect(seatOf(s, K)?.seat.id).toBe('D02');
    expect(freeSeats(s, 'dining').length).toBe(11);
    releaseSeat(s, K);
    expect(freeSeats(s, 'dining').length).toBe(12);
  });

  it('席の立つ位置へ歩いて着くと座り、歩き出すと立つ。部屋を出ると席が空く', () => {
    const s = freshState(3);
    placeIn(s, K, 'dining');
    const seat = reserveSeat(s, K, 'dining', { near: { x: 14, y: 12 } })!;
    const t = seatTile(seat);
    expect(setPathTo(s, s.actors[K], t.x, t.y)).toBe(true);
    for (let i = 0; i < 400 && (s.actors[K].path.length || s.actors[K].step); i++) moveActor(s, s.actors[K], 50, 3);
    expect(sitDown(s, K)).toBe(true);
    expect(s.actors[K].seat).toEqual({ room: 'dining', id: seat.id });
    placeIn(s, K, 'common_hall');
    expect(s.actors[K].seat).toBeUndefined();
    expect(seatTaker(s, 'dining', seat.id)).toBeNull();
  });

  it('競技場へ集まると、参加者は参加者席に 1 人 1 席で座る。脱落した人の席は空席になる', () => {
    const s = freshState(4);
    gatherAt(s, 'main_arena');
    const seated = ALL_IDS.filter((id) => s.actors[id].seat);
    expect(seated.length).toBe(Math.min(ALL_IDS.length, 12));
    expect(new Set(seated.map((id) => s.actors[id].seat!.id)).size).toBe(seated.length);
    for (const id of seated) expect(seatsOf('main_arena').find((q) => q.id === s.actors[id].seat!.id)?.role).toBe('player');
    eliminate(s, K);
    expect(s.actors[K].seat).toBeUndefined();
    expect(freeSeats(s, 'main_arena', 'player').length).toBe(12 - seated.length + 1);
  });

  it('食堂へ食事に来た NPC は、空いた席に座って食べる（同じ席に 2 人座らない）。食べ終わると立つ', () => {
    const s = freshState(7);
    s.phase = 'morning';
    const npcs = aliveIds(s).filter((id) => id !== 'hero');
    npcs.forEach((id, i) => {
      placeIn(s, id, 'dining', { x: 2 + ((i * 5) % 26), y: 12 + (i % 2) });
      s.actors[id].goal = { kind: 'goto', room: 'dining', note: 'meal', until: s.simTime + 120_000 };
    });
    let most = 0;
    for (let t = 0; t < 120_000; t += 100) {
      s.simTime += 100;
      tickNpcs(s, 100, false);
      const keys = npcs.map((id) => s.actors[id].seat).filter((x) => x).map((x) => `${x!.room}:${x!.id}`);
      expect(new Set(keys).size).toBe(keys.length);
      most = Math.max(most, keys.length);
    }
    expect(most).toBeGreaterThanOrEqual(Math.min(npcs.length, 12) - 2);
    expect(npcs.filter((id) => s.actors[id].seat).length).toBeLessThan(most);
  });

  it('主人公：空いた椅子の前で「座る」、座っていれば「立つ」', () => {
    const s = freshState(5);
    const seat = seatsOf('dining')[0];
    const t = seatTile(seat);
    s.actors.hero.pos = { room: 'dining', x: t.x, y: t.y, dir: 'down' };
    const act = nearbyAction(s);
    expect(act?.kind).toBe('sit');
    reserveSeat(s, 'hero', 'dining', seat.id);
    expect(sitDown(s, 'hero')).toBe(true);
    expect(nearbyAction(s)?.kind).toBe('stand');
  });
});
