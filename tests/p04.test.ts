import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { ALL_IDS } from '../src/data/characters';
import { ANSWER_MS, P04, P04_PRACTICE, ROUNDS, ROUND_SPECS, changedCells, makeSet, scoreAnswer, type P04State } from '../src/matches/p04';
import { simulate } from './helpers';

const THREE = ALL_IDS.slice(0, 3);

describe('P04 消えた図形', () => {
  it('変わったマスの数は指定どおり。変化は見た目で区別でき、2 種類以上を含む', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rng = Rng.from(seed);
      for (const spec of ROUND_SPECS) {
        const set = makeSet(rng, spec);
        expect(set.a.filter((x) => x !== null).length).toBe(spec.n);
        expect(changedCells(set).length).toBe(spec.k);
        expect(set.k).toBe(spec.k);
      }
    }
    expect(changedCells(P04_PRACTICE)).toEqual([1, 14, 16]);
  });

  it('得点：当たり 3 点、間違い −1 点（最低 0 点）、すべて当てて間違いなしで +3', () => {
    const set = P04_PRACTICE;
    expect(scoreAnswer(set, [1, 14, 16])).toMatchObject({ hits: 3, misses: 0, points: 12, perfect: true });
    expect(scoreAnswer(set, [1, 14, 0])).toMatchObject({ hits: 2, misses: 1, points: 5, perfect: false });
    expect(scoreAnswer(set, [0, 2, 3])).toMatchObject({ hits: 0, misses: 3, points: 0 });
    expect(scoreAnswer(set, [])).toMatchObject({ points: 0 });
    expect(scoreAnswer(set, [1])).toMatchObject({ points: 3, perfect: false });
  });

  it('選べるのは変化の数まで。表示延長は 1 回だけ。解いている間だけ問題が渡り、終わると公開される', () => {
    const s = P04.init(THREE, Rng.from(5)) as P04State;
    const [a, b, c] = THREE;
    expect(P04.view(s, a).set).toBeNull();
    P04.submit(s, a, { t: 'boost' });
    expect(P04.validate(s, a, { t: 'boost' })).toBe(false);
    for (const p of THREE) P04.submit(s, p, { t: 'ready' });
    expect(s.phase).toBe('quiz');
    expect(P04.view(s, a).showMs).toBe(11_000);
    expect(P04.view(s, b).showMs).toBe(8_000);
    const ch = changedCells(s.sets[0]);
    expect(P04.validate(s, a, { t: 'answer', cells: [0, 1, 2, 3], ms: 1000 })).toBe(false);
    expect(P04.validate(s, a, { t: 'answer', cells: [1, 1], ms: 1000 })).toBe(false);
    expect(P04.validate(s, a, { t: 'answer', cells: ch, ms: ANSWER_MS * 3 })).toBe(false);
    P04.submit(s, a, { t: 'answer', cells: ch, ms: 9000 });
    P04.submit(s, b, { t: 'answer', cells: ch.slice(0, 1), ms: 5000 });
    P04.submit(s, c, { t: 'answer', cells: [], ms: 0 });
    expect(s.round).toBe(1);
    expect(s.results[a][0]).toMatchObject({ hits: 3, points: 12, perfect: true });
    expect(P04.view(s, b).last!.round).toBe(0);
    expect(P04.view(s, a).boostUsed).toBe(true);
    expect(P04.view(s, a).showMs).toBe(8_000);
    expect(P04.ranking(s).map((g) => g[0])).toEqual([a, b, c]);
  });

  it('CPU だけで最後まで進む。記憶の能力で差がつく', () => {
    const rows: string[] = [];
    let pts = 0;
    let max = 0;
    let perfect = 0;
    let n = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const ps = [ALL_IDS[seed % 12], ALL_IDS[(seed + 4) % 12], ALL_IDS[(seed + 8) % 12]];
      const r = simulate('p04', seed, ps);
      const st = r.slot.state as P04State;
      expect(P04.done(st)).toBe(true);
      for (const p of ps) {
        expect(st.results[p].length).toBe(ROUNDS);
        st.results[p].forEach((x, i) => { pts += x.points; max += ROUND_SPECS[i].k * 3 + 3; n++; if (x.perfect) perfect++; });
      }
      rows.push(ps.map((p) => `${p.slice(0, 6)}=${r.scores[p]}`).join(' '));
    }
    writeFileSync('/tmp/p04-sim.txt', `rate ${pts / max} perfect ${perfect / n}\n${rows.join('\n')}`);
    expect(pts / max).toBeGreaterThan(0.3);
    expect(pts / max).toBeLessThan(0.9);
  });
});
