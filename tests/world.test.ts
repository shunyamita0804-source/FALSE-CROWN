import { isPrivateRoom } from '../src/world/rooms';
import { describe, expect, it } from 'vitest';
import { ROOMS, ROOM_IDS, buildCollision } from '../src/world/maps';
import { freshState } from './helpers';
import { collisionOf, enterDoor, moveActor, placeIn, setPathTo, setRouteTo } from '../src/world/sim';

function reach(grid: boolean[][], sx: number, sy: number): Set<string> {
  const seen = new Set<string>([`${sx},${sy}`]);
  const q = [[sx, sy]];
  while (q.length) {
    const [x, y] = q.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (ny < 0 || nx < 0 || ny >= grid.length || nx >= grid[0].length || grid[ny][nx] || seen.has(`${nx},${ny}`)) continue;
      seen.add(`${nx},${ny}`);
      q.push([nx, ny]);
    }
  }
  return seen;
}

describe('施設マップ（正式素材に合わせた判定データ）', () => {
  it('全ての部屋で、扉・調査地点・待機地点が歩ける床にあり、床が一続きになっている', () => {
    const problems: string[] = [];
    for (const id of ROOM_IDS) {
      const room = ROOMS[id];
      const grid = buildCollision(room, {});
      const first = room.doors[0].tiles[0];
      const seen = reach(grid, first.x, first.y);
      let free = 0;
      for (let y = 0; y < room.h; y++) for (let x = 0; x < room.w; x++) if (!grid[y][x]) free++;
      if (seen.size !== free) problems.push(`${id}: 孤立した床がある（到達 ${seen.size} / 床 ${free}）`);
      for (const d of room.doors) {
        for (const t of d.tiles) if (grid[t.y]?.[t.x] !== false) problems.push(`${id}.${d.id}: 扉の手前 (${t.x},${t.y}) が歩けない`);
        const v = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[d.dir];
        for (const t of d.tiles) if (grid[t.y + v[1]]?.[t.x + v[0]] === false) problems.push(`${id}.${d.id}: 扉の先 (${t.x + v[0]},${t.y + v[1]}) が床になっている`);
        const target = ROOMS[d.to];
        if (!target) problems.push(`${id}.${d.id}: 行き先 ${d.to} がない`);
        else if (!target.doors.some((x) => x.id === d.toDoor)) problems.push(`${id}.${d.id}: 行き先の扉 ${d.to}.${d.toDoor} がない`);
        else if (target.doors.find((x) => x.id === d.toDoor)!.to !== id) problems.push(`${id}.${d.id}: 行き先の扉が戻ってこない`);
      }
      for (const i of room.inspects) if (grid[i.y]?.[i.x] !== false) problems.push(`${id}: 調査地点 ${i.id} (${i.x},${i.y}) が歩けない`);
      for (const s of room.spots) if (grid[s.y]?.[s.x] !== false) problems.push(`${id}: 待機地点 (${s.x},${s.y}) が歩けない`);
    }
    expect(problems).toEqual([]);
  });

  it('鍵を無視すれば、自室から全ての部屋へ行ける', () => {
    const seen = new Set(['bedroom_hero']);
    const q = ['bedroom_hero'];
    while (q.length) for (const d of ROOMS[q.pop()!].doors) if (!seen.has(d.to)) { seen.add(d.to); q.push(d.to); }
    expect(ROOM_IDS.filter((r) => !seen.has(r))).toEqual([]);
  });

  it('隠し区画は解錠フラグなしでは入れない', () => {
    const locks = Object.fromEntries(ROOM_IDS.flatMap((id) => ROOMS[id].doors.filter((d) => d.lock).map((d) => [`${id}>${d.to}`, d.lock])));
    expect(locks).toMatchObject({
      'library>secret_study': 'h01_open', 'observatory>moon_casino': 'h02_open', 'bathroom>mirror_room': 'h03_open',
      'prison_cells>cell_zero': 'h04_open', 'underground_passage>maze_entry': 'h05_cleared', 'black_door>research_lab': 'h06_open', 'isolation>core': 'h07_cleared',
    });
  });
});


function walk(state: ReturnType<typeof freshState>, id: 'hero', room: string, spot?: { x: number; y: number }): boolean {
  const a = state.actors[id];
  if (!setRouteTo(state, a, room, spot)) return false;
  for (let i = 0; i < 6000; i++) {
    moveActor(state, a, 100, 6);
    if (a.pos.room === room && !a.route.length && !a.path.length && !a.step) {
      if (!spot || (a.pos.x === spot.x && a.pos.y === spot.y)) return true;
      if (!setPathTo(state, a, spot.x, spot.y)) return false;
    }
  }
  return false;
}

describe('施設内の歩行（実際の移動処理で確認）', () => {
  it('解錠済みなら、自室から全ての部屋の全ての調査地点まで歩いて行ける', () => {
    const s = freshState(7);
    for (const id of ROOM_IDS) for (const d of ROOMS[id].doors) if (d.lock) s.flags[d.lock] = true;
    // 他の参加者を通路から退かす（ここでは建物の導線だけを確認する）
    for (const a of Object.values(s.actors)) if (a.id !== 'hero') placeIn(s, a.id, `bedroom_${a.id}`);
    placeIn(s, 'hero', 'bedroom_hero');
    const failed: string[] = [];
    for (const id of ROOM_IDS) {
      if (isPrivateRoom(id) && id !== 'bedroom_hero') continue;
      const room = ROOMS[id];
      for (const ins of room.inspects) if (!walk(s, 'hero', id, { x: ins.x, y: ins.y })) failed.push(`${id}:${ins.id}`);
      for (const sp of room.spots) if (!walk(s, 'hero', id, sp)) failed.push(`${id}:spot(${sp.x},${sp.y})`);
    }
    expect(failed).toEqual([]);
    expect(walk(s, 'hero', 'bedroom_hero')).toBe(true);
  });

  it('扉を通ると行き先の扉の前に出て、引き返すと元の部屋に戻る', () => {
    const s = freshState(3);
    for (const id of ROOM_IDS) for (const d of ROOMS[id].doors) if (d.lock) s.flags[d.lock] = true;
    for (const a of Object.values(s.actors)) if (a.id !== 'hero') placeIn(s, a.id, `bedroom_${a.id}`);
    const bad: string[] = [];
    for (const id of ROOM_IDS) {
      if (isPrivateRoom(id) && id !== 'bedroom_hero') continue;
      for (const d of ROOMS[id].doors) {
        if (isPrivateRoom(d.to) && d.to !== 'bedroom_hero') continue;
        const hero = s.actors.hero;
        hero.pos = { room: id, x: d.tiles[0].x, y: d.tiles[0].y, dir: d.dir };
        hero.step = undefined;
        if (!enterDoor(s, hero, d)) { bad.push(`${id}.${d.id}: 入れない`); continue; }
        const back = ROOMS[d.to].doors.find((x) => x.id === d.toDoor)!;
        if (hero.pos.room !== d.to || !back.tiles.some((t) => t.x === hero.pos.x && t.y === hero.pos.y)) bad.push(`${id}.${d.id}: 出現位置が扉の前ではない`);
        if (collisionOf(s, d.to)[hero.pos.y][hero.pos.x]) bad.push(`${id}.${d.id}: 壁の中に出た`);
        if (!enterDoor(s, hero, back) || hero.pos.room !== id) bad.push(`${id}.${d.id}: 戻れない`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('鍵がない間は隠し区画へ入れず、NPC は解錠後も秘密区画に入らない', () => {
    const s = freshState(5);
    const hero = s.actors.hero;
    const lib = ROOMS.library.doors.find((d) => d.id === 'secret')!;
    hero.pos = { room: 'library', x: lib.tiles[0].x, y: lib.tiles[0].y, dir: 'up' };
    expect(enterDoor(s, hero, lib)).toBe(false);
    s.flags.h01_open = true;
    const npc = s.actors.npc_02_kanzaki;
    npc.pos = { room: 'library', x: lib.tiles[1].x, y: lib.tiles[1].y, dir: 'up' };
    expect(enterDoor(s, npc, lib)).toBe(false);
    expect(enterDoor(s, hero, lib)).toBe(true);
    expect(hero.pos.room).toBe('secret_study');
  });
});
