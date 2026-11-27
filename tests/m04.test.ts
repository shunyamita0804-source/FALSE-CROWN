import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { ALL_IDS } from '../src/data/characters';
import { EDGES, M04, ROUNDS, START_FUNDS, applyAct, baseCost, generateSetup, missionPoints, practiceTable, routeFor, scoreOf, seatToMove, shortest, tableSizes, type M04State } from '../src/matches/m04';
import { simulate } from './helpers';

const NINE = ALL_IDS.slice(0, 9);

describe('M04 鉄道王国・改', () => {
  it('地図は 9 都市 16 区間。任務の組は、どの席も同じ得点の並びで、都市の組が重ならない', () => {
    expect(EDGES.length).toBe(16);
    expect(new Set(EDGES.map(([a, b]) => `${a}-${b}`)).size).toBe(16);
    for (let a = 0; a < 9; a++) for (let b = 0; b < 9; b++) if (a !== b) expect(shortest(a, b, () => 1)).not.toBeNull();
    for (let seed = 1; seed <= 40; seed++) {
      const st = generateSetup(Rng.from(seed), 3);
      expect(st.costs.every((c) => c >= 1 && c <= 4)).toBe(true);
      const pts = st.sets.map((set) => set.map((m) => m.points).join(','));
      expect(new Set(pts).size).toBe(1);
      const keys = st.sets.flat().map((m) => [m.from, m.to].sort().join('-'));
      expect(new Set(keys).size).toBe(9);
      for (const m of st.sets.flat()) {
        expect(m.points).toBe(missionPoints(st.costs, m.from, m.to));
        expect(m.points).toBeGreaterThanOrEqual(6);
        expect(m.points).toBeLessThanOrEqual(12);
        expect(shortest(m.from, m.to, () => 1)!.total).toBeGreaterThanOrEqual(2);
      }
    }
    expect(tableSizes(9)).toEqual([3, 3, 3]);
    expect(tableSizes(10)).toEqual([3, 3, 2, 2]);
    expect(tableSizes(12)).toEqual([3, 3, 3, 3]);
    expect(tableSizes(2)).toEqual([2]);
  });

  it('線路、資金、輸送：他人の線路は通行料 1 を持ち主へ。線路が切れていれば輸送できない。先手は毎巡替わる', () => {
    const s = M04.init(NINE, Rng.from(2)) as M04State;
    for (const p of NINE) M04.submit(s, p, { t: 'ready' });
    expect(s.phase).toBe('play');
    const t = s.tables[0];
    expect(seatToMove(t)).toBe(0);
    const [a, b, c] = t.players;
    const m = t.missions[1][0];
    const path = shortest(m.from, m.to, (e) => t.costs[e])!.edges;
    expect(M04.validate(s, b, { t: 'fund' })).toBe(false);
    expect(M04.validate(s, a, { t: 'transport', mission: 0 })).toBe(false);
    // 席 0 が、席 1 の任務の経路の 1 本目を敷く
    t.funds[0] = 99; t.funds[1] = 99;
    M04.submit(s, a, { t: 'build', edge: path[0] });
    expect(t.owner[path[0]]).toBe(0);
    expect(M04.validate(s, b, { t: 'build', edge: path[0] })).toBe(false);
    expect(M04.validate(s, b, { t: 'transport', mission: 0 })).toBe(false);
    for (const e of path.slice(1)) { t.owner[e] = 1; t.built[1]++; }
    const before = [t.funds[0], t.funds[1]];
    expect(routeFor(t, 1, m.from, m.to)!.toll).toBe(1);
    M04.submit(s, b, { t: 'transport', mission: 0 });
    expect(t.missions[1][0].done).toBe(true);
    expect(t.funds[0]).toBe(before[0] + 1);
    expect(t.funds[1]).toBe(before[1] - 1);
    M04.submit(s, c, { t: 'fund' });
    expect(t.funds[2]).toBe(START_FUNDS + 3);
    // 2 巡目の先手は席 1
    expect(seatToMove(t)).toBe(1);
    expect(scoreOf(t, 2)).toBe(Math.floor((START_FUNDS + 3) / 3));
    // 未達成の任務は本人にしか見えない
    const vb = M04.view(s, b);
    expect(vb.missions.length).toBe(3);
    expect(JSON.stringify(M04.view(s, a).table)).not.toContain(JSON.stringify(t.missions[1][1]).slice(0, 18) + ',"done":false');
    expect(M04.view(s, a).table.doneMissions[1].length).toBe(1);
  });

  it('任務の交換：1 回だけ。候補は同じ得点で、同じ卓の任務と重ならない', () => {
    const s = M04.init(NINE, Rng.from(7)) as M04State;
    const p = s.tables[0].players[0];
    const old = { ...s.tables[0].missions[0][2] };
    M04.submit(s, p, { t: 'aid', mission: 2 });
    expect(M04.validate(s, p, { t: 'ready' })).toBe(false);
    expect(M04.validate(s, p, { t: 'aid', mission: 1 })).toBe(false);
    const v = M04.view(s, p);
    expect(v.aid!.cands.length).toBe(2);
    for (const c of v.aid!.cands) expect(c.points).toBe(old.points);
    M04.submit(s, p, { t: 'pick', c: 1 });
    expect(s.tables[0].missions[0][2]).toMatchObject({ from: v.aid!.cands[1].from, to: v.aid!.cands[1].to, points: old.points });
    expect(M04.validate(s, p, { t: 'aid', mission: 0 })).toBe(false);
    expect(M04.validate(s, p, { t: 'ready' })).toBe(true);
  });

  it('練習の卓：線路を 2 本敷いて輸送できる', () => {
    const t = practiceTable();
    const r = shortest(0, 4, (e) => t.costs[e])!;
    expect(baseCost(t.costs, 0, 4)).toBeLessThanOrEqual(6);
    for (const e of r.edges) expect(applyAct(t, 0, { t: 'build', edge: e })).toBe(true);
    expect(applyAct(t, 0, { t: 'transport', mission: 0 })).toBe(true);
    expect(t.missions[0][0].done).toBe(true);
  });

  it('CPU だけで最後まで進む。3 巡ごとに交渉が入り、全卓が 9 巡で終わる', () => {
    const rows: string[] = [];
    const wins: Record<string, number> = {};
    let done = 0;
    let n = 0;
    const seatScore = [0, 0, 0];
    for (let seed = 1; seed <= 30; seed++) {
      const r = simulate('m04', seed, NINE);
      const st = r.slot.state as M04State;
      expect(M04.done(st)).toBe(true);
      for (const t of st.tables) {
        expect(t.turn).toBe(ROUNDS * 3);
        expect(t.passed).toBe(2);
        t.players.forEach((_, i) => { done += t.missions[i].filter((m) => m.done).length; n += 3; seatScore[i] += scoreOf(t, i); });
        expect(t.funds.every((f) => f >= 0)).toBe(true);
      }
      wins[r.ranking[0][0]] = (wins[r.ranking[0][0]] ?? 0) + 1;
      rows.push(NINE.map((p) => `${p.slice(0, 6)}=${r.scores[p]}`).join(' '));
    }
    writeFileSync('/tmp/m04-sim.txt', `missions ${done / n} seat ${seatScore.map((x) => (x / 90).toFixed(1))}\n${JSON.stringify(wins)}\n${rows.join('\n')}`);
    expect(done / n).toBeGreaterThan(0.3);
  });
});
