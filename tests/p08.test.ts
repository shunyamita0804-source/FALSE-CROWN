import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { ALL_IDS } from '../src/data/characters';
import { P08, P08_PRACTICE, ROUNDS, judge, makeScale, pointsFor, solutions, type P08State, type Scale } from '../src/matches/p08';
import { simulate } from './helpers';

const TWO = ALL_IDS.slice(0, 2);
const S = '/tmp/claude-0/-home-claude/ced3d2db-bac9-5d25-8782-91ee7ff6cc58/scratchpad';

describe('P08 数字の天秤', () => {
  it('判定：固定の重りを含めた左右の合計が同じで、条件を全部満たす時だけ正解', () => {
    const sc: Scale = { tiles: [1, 2, 3, 4, 5, 6, 7, 8], fixL: 3, fixR: 0, minUse: 2, mustL: [0], mustR: [] };
    expect(judge(sc, [1, 0, 0, 2, 0, 0, 0, 0]).ok).toBe(true); // 3+1 = 4
    expect(judge(sc, [0, 0, 2, 0, 0, 0, 0, 0]).balanced).toBe(true); // 3 = 3 だが、1 枚しか使っていない
    expect(judge(sc, [0, 0, 2, 0, 0, 0, 0, 0]).ok).toBe(false);
    expect(judge(sc, [2, 1, 0, 0, 0, 2, 0, 0]).mustOk).toBe(false);
    expect(judge(sc, [1, 1, 1, 1, 1, 0, 0, 0]).panOk).toBe(false);
    expect(judge({ ...sc, fixL: 0 }, [0, 0, 0, 0, 0, 0, 0, 0]).balanced).toBe(false); // 何も載せないのは正解にならない
    expect(pointsFor(true, 0)).toBe(25);
    expect(pointsFor(true, 90_000)).toBe(20);
    expect(pointsFor(false, 10_000)).toBe(0);
    expect(solutions(P08_PRACTICE).length).toBeGreaterThan(3);
  });

  it('問題：全ラウンドで必ず正解があり、後のラウンドほど正解が少ない', () => {
    const counts: number[][] = Array.from({ length: ROUNDS }, () => []);
    for (let seed = 1; seed <= 30; seed++) {
      const rng = Rng.from(seed);
      for (let r = 0; r < ROUNDS; r++) {
        const sc = makeScale(rng, r);
        const n = solutions(sc).length;
        expect(n).toBeGreaterThan(0);
        expect(new Set(sc.tiles).size).toBe(8);
        expect(sc.fixL).not.toBe(sc.fixR);
        counts[r].push(n);
      }
    }
    const avg = counts.map((c) => c.reduce((a, b) => a + b, 0) / c.length);
    expect(avg[0]).toBeGreaterThan(avg[3]);
    expect(avg[3]).toBeGreaterThan(avg[6]);
    writeFileSync(`${S}/p08-gen.txt`, avg.map((x) => x.toFixed(1)).join(' '));
  });

  it('全員が答えると採点して次へ進む。別の答えでも正解', () => {
    const s = P08.init(TWO, Rng.from(3)) as P08State;
    const [a, b] = TWO;
    const sols = solutions(s.scales[0], 5);
    P08.submit(s, a, { t: 'answer', place: sols[0], ms: 9000 });
    expect(s.round).toBe(0);
    expect(P08.validate(s, a, { t: 'answer', place: sols[0], ms: 9000 })).toBe(false);
    P08.submit(s, b, { t: 'answer', place: sols[sols.length - 1], ms: 45_000 });
    expect(s.round).toBe(1);
    expect(s.results[a][0].points).toBe(20 + Math.round(5 * 81 / 90));
    expect(s.results[b][0].ok).toBe(true);
    expect(P08.view(s, a).lastExample).not.toBeNull();
    expect(P08.validate(s, a, { t: 'answer', place: [0, 1, 2, 3, 0, 0, 0, 0], ms: 1 })).toBe(false);
  });

  it('CPU だけで最後まで進む', () => {
    let okSum = 0;
    let n = 0;
    const perRound = new Array<number>(ROUNDS).fill(0);
    const totals: number[] = [];
    const N = 60;
    for (let seed = 1; seed <= N; seed++) {
      const ps = [ALL_IDS[seed % 12], ALL_IDS[(seed + 5) % 12]];
      const r = simulate('p08', seed, ps);
      const st = r.slot.state as P08State;
      expect(P08.done(st)).toBe(true);
      for (const p of ps) { st.results[p].forEach((x, i) => { if (x.ok) { okSum++; perRound[i]++; } n++; }); totals.push(r.scores[p]!); }
    }
    writeFileSync(`${S}/p08-sim.txt`, `ok rate ${(okSum / n).toFixed(2)} per round ${perRound.map((x) => (x / (N * 2)).toFixed(2)).join(' ')}\ntotals ${totals.slice(0, 30).join(' ')}`);
    expect(okSum / n).toBeGreaterThan(0.5);
    expect(okSum / n).toBeLessThan(0.93);
  });
});
