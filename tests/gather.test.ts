import { describe, expect, it } from 'vitest';
import { aliveIds, rel } from '../src/core/state';
import { finishGather, GATHER, heroMayEnter, heroNextDoor, newGather, npcsArrived, routeFor, tickGather, runGatherOffscreen } from '../src/core/gather';
import { gatherLine, gatherMood } from '../src/core/gathertalk';
import { ROOMS } from '../src/world/maps';
import { homeOf } from '../src/world/rooms';
import { placeHome, placeIn } from '../src/world/sim';
import type { NpcId } from '../src/data/characters';
import type { GameState } from '../src/core/types';
import { freshState } from './helpers';

/** 生活の場所のどこか（自室・リビング・遊戯室・浴室・中央ホール）に散らばせる */
const SPOTS = ['dining', 'game_room', 'bathroom', 'living_hallway', 'main_hall'];
function scatter(s: GameState): void {
  aliveIds(s).forEach((id, i) => {
    if (i % 3 === 0) placeHome(s, id);
    else placeIn(s, id, SPOTS[i % SPOTS.length].replace(/^bathroom$/, ROOMS.bathroom ? 'bathroom' : 'dining'));
  });
}

/** 主人公を会場まで歩かせずに、NPC だけ動かす（主人公は会場にいる扱い） */
function walkNpcs(s: GameState, g: ReturnType<typeof newGather>, maxMs = GATHER.limitMs): number {
  g.started = true;
  let t = 0;
  while (t < maxMs && !npcsArrived(g, s)) { s.simTime += 100; tickGather(s, g, 100); t += 100; }
  return t;
}

describe('競技会場への集合移動', () => {
  it('どの部屋からでも、会場まで歩いて行ける道がある', () => {
    const s = freshState(1);
    for (const id of Object.keys(ROOMS)) {
      const room = ROOMS[id];
      if (room.area === 'secret' || room.area === 'prison' || /^bedroom_|^cell_/.test(id)) continue;
      const reached = routeFor(s, 'hero', id, 'main_arena');
      // つながっていない部屋（外した部屋）は通常の動線にないので数えない
      if (!reached) continue;
      expect(reached[reached.length - 1] ?? 'main_arena').toBe('main_arena');
    }
    for (const id of aliveIds(s)) expect(routeFor(s, id, homeOf(s, id), 'main_arena'), id).not.toBeNull();
  });

  it('NPC は散らばった場所から各自で歩き、期限内に全員が会場の席に着く（救済なしで）', () => {
    for (const seed of [2, 5, 11]) {
      const s = freshState(seed);
      s.phase = 'gather';
      scatter(s);
      placeIn(s, 'hero', 'main_arena');
      const g = newGather(s, 'main', 'main_arena', aliveIds(s));
      const ms = walkNpcs(s, g);
      expect(npcsArrived(g, s), `seed ${seed}`).toBe(true);
      expect(ms).toBeLessThan(GATHER.limitMs);
      expect(g.rescued, `seed ${seed}`).toBeLessThanOrEqual(1);
      for (const id of aliveIds(s)) if (id !== 'hero') {
        expect(s.actors[id].pos.room).toBe('main_arena');
        expect(!!s.actors[id].seat, `${seed} ${id}`).toBe(true);
      }
    }
  });

  it('一列ではなく、歩き出す時刻と速さが人ごとに違う', () => {
    const s = freshState(3);
    scatter(s);
    const g = newGather(s, 'main', 'main_arena', aliveIds(s));
    const dep = Object.values(g.depart);
    const pace = Object.values(g.pace);
    expect(new Set(dep).size).toBeGreaterThan(dep.length / 2);
    expect(Math.max(...pace) - Math.min(...pace)).toBeGreaterThan(0.05);
  });

  it('主人公は会場への道の扉だけ通れる（寄り道できない）。会場に着いたら出られない', () => {
    const s = freshState(4);
    placeIn(s, 'hero', 'dining');
    const g = newGather(s, 'main', 'main_arena', aliveIds(s));
    const next = heroNextDoor(s, g);
    expect(next).not.toBeNull();
    expect(heroMayEnter(s, g, next!.to)).toBe(true);
    for (const d of ROOMS.dining.doors) if (d.to !== next!.to) expect(heroMayEnter(s, g, d.to), d.to).toBe(false);
    placeIn(s, 'hero', 'main_arena');
    for (const d of ROOMS.main_arena.doors) expect(heroMayEnter(s, g, d.to)).toBe(false);
  });

  it('監獄マッチでは監獄棟の参加者だけが会場へ、生活棟の人はリビングへ向かう', () => {
    const s = freshState(6);
    s.phase = 'gatherPrison';
    const ids = aliveIds(s);
    const prisoners = ids.slice(0, 4);
    for (const id of ids) s.actors[id].house = prisoners.includes(id) ? 'prison' : 'living';
    // 房と生活棟へ
    for (const id of ids) placeHome(s, id);
    for (const id of prisoners) placeIn(s, id, homeOf(s, id));
    const g = newGather(s, 'prison', 'prison_arena', prisoners);
    runGatherOffscreen(s, g);
    for (const id of prisoners) expect(s.actors[id].pos.room, id).toBe('prison_arena');
    for (const id of ids.filter((x) => !prisoners.includes(x) && x !== 'hero')) expect(s.actors[id].pos.room, id).toBe('dining');
  });

  it('集合期限には、まだ着いていない人を会場の席へ安全に移す（失格にはしない）', () => {
    const s = freshState(7);
    scatter(s);
    const g = newGather(s, 'main', 'main_arena', aliveIds(s));
    g.started = true;
    finishGather(s, g);
    for (const id of aliveIds(s)) {
      expect(s.actors[id].alive).toBe(true);
      expect(s.actors[id].pos.room).toBe('main_arena');
    }
    expect(Object.values(s.actors).filter((a) => a.seat).length).toBeGreaterThanOrEqual(Math.min(aliveIds(s).length, 8));
  });

  it('道の無い所に閉じ込められた人は、すぐ会場へ移される', () => {
    const s = freshState(8);
    scatter(s);
    const npc = aliveIds(s).find((id) => id !== 'hero')!;
    // 会場への道が無い部屋（外した部屋や、NPC の通れない隠し部屋）に置く
    const trap = Object.keys(ROOMS).find((r) => !/^bedroom_|^cell_/.test(r) && routeFor(s, npc, r, 'main_arena') === null)!;
    expect(trap).toBeTruthy();
    placeIn(s, npc, trap);
    placeIn(s, 'hero', 'main_arena');
    const g = newGather(s, 'main', 'main_arena', aliveIds(s));
    g.depart[npc] = 0;
    g.started = true;
    for (let t = 0; t < 1000; t += 100) { s.simTime += 100; tickGather(s, g, 100); }
    expect(s.actors[npc].pos.room).toBe('main_arena');
  });

  it('集合中の会話は関係の値を動かさず、2 度目は短い返事だけ。約束のある相手は約束に触れる', () => {
    const s = freshState(9);
    const g = newGather(s, 'main', 'main_arena', aliveIds(s));
    const npc = aliveIds(s).find((id) => id !== 'hero') as NpcId;
    const before = JSON.stringify(rel(s, npc, 'hero'));
    const m1 = gatherMood(s, g, npc);
    expect(m1).not.toBe('again');
    expect(gatherLine(s, npc, m1, 'テスト').length).toBeGreaterThan(0);
    g.talked.push(npc);
    expect(gatherMood(s, g, npc)).toBe('again');
    expect(JSON.stringify(rel(s, npc, 'hero'))).toBe(before);
    const other = aliveIds(s).filter((id) => id !== 'hero')[1] as NpcId;
    s.deals.push({ id: 'd1', kind: 'pledge', from: 'hero', to: other, payNow: 0, payOnSuccess: 0, untilDay: s.day + 2, status: 'active', day: s.day } as never);
    expect(gatherMood(s, g, other)).toBe('pledge');
    expect(gatherLine(s, other, 'pledge', 'テスト')).toMatch(/約束/);
  });

  it('集合中の台詞に、ルールの中身や作戦の言葉は入っていない', async () => {
    const data = (await import('../src/data/gather_talk.json')).default as Record<string, Record<string, string[]> | string>;
    for (const [id, tab] of Object.entries(data)) {
      if (typeof tab === 'string') continue;
      for (const lines of Object.values(tab)) for (const l of lines) expect(l, id).not.toMatch(/作戦|秘密|攻略|正解|ヒント/);
    }
  });
});
