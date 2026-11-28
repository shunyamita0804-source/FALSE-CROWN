import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FURNITURE } from '../src/world/furniture.ts';
import { furnitureTiles } from '../src/world/furnitureGrid.ts';
import { ROOMS, buildCollision } from '../src/world/maps.ts';

/** 館内マップの点検（2026-11-28）。出入口のまわりと、NPC のたまり場の決まり */
const rooms = Object.values(ROOMS);
/** 絵の家具が出入口の前にあり、絵の直しを待っている物（docs/assets/needed_art.md） */
const WAIT_ART = ['prison_cells:cell5'];
const DIR = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] } as const;

function reach(room: (typeof rooms)[number]): Set<string> {
  const g = buildCollision(room);
  const st = room.doors[0].tiles[0];
  const seen = new Set([`${st.x},${st.y}`]);
  const q = [st];
  while (q.length) {
    const p = q.shift()!;
    for (const [dx, dy] of Object.values(DIR)) {
      const x = p.x + dx, y = p.y + dy;
      if (x < 0 || y < 0 || x >= room.w || y >= room.h || g[y][x] || seen.has(`${x},${y}`)) continue;
      seen.add(`${x},${y}`);
      q.push({ x, y });
    }
  }
  return seen;
}

/** 確認図（scripts/collision-review.py）のために、マスの表を書き出す。DUMP_GRID=書き出し先 を付けた時だけ */
const dumpTo = process.env.DUMP_GRID;
if (dumpTo) {
  const out: Record<string, unknown> = {};
  for (const id of Object.keys(FURNITURE)) {
    const r = ROOMS[id];
    const ft = furnitureTiles(id);
    out[id] = {
      grid: buildCollision(r), doors: r.doors.map((d) => ({ id: d.id, dir: d.dir, tiles: d.tiles })), inspects: r.inspects.map((i) => ({ id: i.id, x: i.x, y: i.y })),
      spots: r.spots, approach: ft.approach.map((t) => [t.x, t.y]), gates: Object.fromEntries(ft.gates.map((g) => [g.prop, g.initial === 'open'])), overlay: r.overlay?.image,
    };
  }
  writeFileSync(dumpTo, JSON.stringify(out));
}

describe('館内マップの点検', () => {
  it('どの部屋も、全部の出入口と調べる地点に、最初の出入口から歩いて行ける', () => {
    for (const r of rooms) {
      const ok = reach(r);
      for (const d of r.doors) for (const t of d.tiles) expect(ok.has(`${t.x},${t.y}`), `${r.id} の ${d.id}`).toBe(true);
      for (const i of r.inspects) expect(ok.has(`${i.x},${i.y}`), `${r.id} の ${i.id}`).toBe(true);
    }
  });

  it('NPC のたまり場は、歩ける床で、出入口から 3 マス以上離れ、出入口の正面の通り道（奥へ 4 マス）に無い', () => {
    const bad: string[] = [];
    for (const r of rooms) {
      const g = buildCollision(r);
      const lane = new Set<string>();
      for (const d of r.doors) {
        const [dx, dy] = DIR[d.dir];
        for (const t of d.tiles) for (let k = 0; k <= 4; k++) lane.add(`${t.x - dx * k},${t.y - dy * k}`);
      }
      for (const s of r.spots) {
        if (g[s.y][s.x]) bad.push(`${r.id} (${s.x},${s.y}) が床でない`);
        const dm = Math.min(...r.doors.flatMap((d) => d.tiles.map((t) => Math.abs(t.x - s.x) + Math.abs(t.y - s.y))));
        if (dm < 3) bad.push(`${r.id} (${s.x},${s.y}) が出入口に近い`);
        if (lane.has(`${s.x},${s.y}`)) bad.push(`${r.id} (${s.x},${s.y}) が出入口の通り道`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('入ってすぐの所（出入口の奥 1 マス）は、ふさがれていない（絵の直しを待つ物は除く）', () => {
    const bad: string[] = [];
    for (const r of rooms) {
      const g = buildCollision(r);
      for (const d of r.doors) {
        const [dx, dy] = DIR[d.dir];
        const free = d.tiles.filter((t) => [1].every((k) => !g[t.y - dy * k]?.[t.x - dx * k]));
        if (!free.length && !WAIT_ART.includes(`${r.id}:${d.id}`)) bad.push(`${r.id} の ${d.id}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
