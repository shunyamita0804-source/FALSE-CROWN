import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { ALL_IDS } from '../src/data/characters';
import { hexGrid, ringOf, rot60 } from '../src/matches/hex';
import { G, M07, SHAPES, START_TILES, alternatives, beaconCell, canPlace, cellsOf, isCenter, linked, placements, scoreOf, startCell, type M07State } from '../src/matches/m07';
import { simulate } from './helpers';

const SIX = ALL_IDS.slice(0, 6);
const S = '/tmp/claude-0/-home-claude/ced3d2db-bac9-5d25-8782-91ee7ff6cc58/scratchpad';

describe('M07 六角領域', () => {
  it('盤面：半径 4 は 61 マス、中央は 7 マス。開始点と目印は 60 度回すと隣の席に重なる', () => {
    expect(G.cells.length).toBe(61);
    expect(hexGrid(3).cells.length).toBe(37);
    expect(G.cells.filter((_, c) => isCenter(c)).length).toBe(6);
    for (let seat = 0; seat < 6; seat++) {
      const [q, r] = G.cells[startCell(seat)];
      const [a, b] = rot60(q, r, 1);
      expect(G.cells[startCell((seat + 1) % 6)].map((x) => x + 0)).toEqual([a + 0, b + 0]);
      expect(ringOf(G, startCell(seat))).toBe(4);
      expect(ringOf(G, beaconCell(seat))).toBe(2);
      const [bq, br] = G.cells[beaconCell(seat)];
      const dist = (x: number, y: number) => Math.max(Math.abs(x - bq), Math.abs(y - br), Math.abs(x + y - bq - br));
      expect(dist(q, r)).toBe(3);
      expect(dist(a, b)).toBe(3);
    }
  });

  it('タイル：12 枚、面積 33。形は全部つながっていて、6 回まわすと元に戻る', () => {
    expect(START_TILES.length).toBe(12);
    expect(START_TILES.reduce((n, t) => n + SHAPES[t].length, 0)).toBe(33);
    for (const [name, cells] of Object.entries(SHAPES)) {
      const key = (q: number, r: number) => `${q},${r}`;
      const set = new Set(cells.map(([q, r]) => key(q, r)));
      const seen = new Set([key(...cells[0])]);
      const q = [cells[0]];
      while (q.length) { const [a, b] = q.pop()!; for (const [da, db] of [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]]) { const k = key(a + da, b + db); if (set.has(k) && !seen.has(k)) { seen.add(k); q.push([a + da, b + db]); } } }
      expect(seen.size, name).toBe(cells.length);
      for (const [a, b] of cells) expect(rot60(a, b, 6)).toEqual([a, b]);
    }
    expect(alternatives('line4').sort()).toEqual(['bolt4', 'hook4', 'rhomb4', 'star4']);
    expect(alternatives('one')).toEqual([]);
  });

  it('置けるのは、空きマスで、自分の領域に接する時だけ。盤面の外には置けない', () => {
    const s = M07.init(SIX, Rng.from(1)) as M07State;
    s.order = [...SIX];
    const a = SIX[0];
    const start = startCell(0);
    expect(s.owner[start]).toBe(0);
    expect(cellsOf('line4', 0, start)).toBeNull();
    const far = G.cells.findIndex(([q, r]) => q === 0 && r === 0);
    expect(canPlace(s.owner, 0, cellsOf('one', 0, far))).toBe(false);
    const all = placements(s.owner, 0, s.tiles[a]);
    expect(all.length).toBeGreaterThan(10);
    for (const pl of all) expect(canPlace(s.owner, 0, pl.cells)).toBe(true);
    expect(M07.validate(s, SIX[1], { t: 'place', tile: 0, rot: 0, at: 0 })).toBe(false);
    const big = all.find((x) => x.cells.length === 4)!;
    expect(M07.validate(s, a, { t: 'place', tile: big.tile, rot: big.rot, at: big.at })).toBe(false); // 第 1 巡は 1 マスのタイルだけ
    const pl = all.find((x) => x.cells.length === 1)!;
    M07.submit(s, a, { t: 'place', tile: pl.tile, rot: pl.rot, at: pl.at });
    expect(s.tiles[a].length).toBe(11);
    expect(scoreOf(s.owner, 0).cells).toBe(2);
    expect(M07.view(s, SIX[1]).toMove).toBe(SIX[1]);
    expect(M07.validate(s, SIX[1], { t: 'aid', tile: 0, to: 'two' })).toBe(false);
    expect(M07.validate(s, SIX[1], { t: 'aid', tile: 8, to: 'bolt4' })).toBe(true);
  });

  it('連結目標：開始点から目印まで自分のマスがつながると +5。中央のマスは +2', () => {
    const owner = new Array<number>(61).fill(-1);
    const at = (q: number, r: number) => G.cells.findIndex(([a, b]) => a === q && b === r);
    for (const [q, r] of [[4, 0], [3, 1], [1, 1], [1, 0]]) owner[at(q, r)] = 0;
    expect(linked(owner, 0)).toBe(false);
    expect(scoreOf(owner, 0)).toEqual({ cells: 4, center: 1, link: false, points: 6 });
    owner[at(2, 1)] = 0;
    expect(linked(owner, 0)).toBe(true);
    expect(scoreOf(owner, 0).points).toBe(5 + 2 + 5);
    expect(canPlace(owner, 0, [at(0, 0)])).toBe(false); // 塔には置けない
    owner[at(1, 1)] = 1;
    expect(linked(owner, 0)).toBe(false);
  });

  it('CPU だけで最後まで進む。席による有利不利が大きくない', () => {
    const rows: string[] = [];
    const seatPts = new Array<number>(6).fill(0);
    const seatWin = new Array<number>(6).fill(0);
    let rounds = 0;
    let links = 0;
    let filled = 0;
    const N = 120;
    for (let seed = 1; seed <= N; seed++) {
      const ps = [...ALL_IDS.slice(seed % 7, (seed % 7) + 6)];
      const order = Rng.from(seed).shuffle(ps);
      const r = simulate('m07', seed, order);
      const st = r.slot.state as M07State;
      expect(M07.done(st)).toBe(true);
      rounds += st.round;
      filled += st.owner.filter((o) => o >= 0).length;
      order.forEach((p, i) => { seatPts[i] += r.scores[p]!; if (r.ranking[0].includes(p)) seatWin[i]++; if (scoreOf(st.owner, st.seats[i]).link) links++; });
      rows.push(order.map((p) => `${p.slice(4, 8)}=${r.scores[p]}`).join(' '));
    }
    writeFileSync(`${S}/m07-sim.txt`, `rounds ${rounds / N} filled ${filled / N} links/game ${links / N}\nseat avg ${seatPts.map((x) => (x / N).toFixed(1)).join(' ')}\nseat wins ${seatWin.join(' ')}\n${rows.slice(0, 12).join('\n')}`);
    expect(Math.max(...seatPts) / Math.min(...seatPts)).toBeLessThan(1.5);
  });
});
