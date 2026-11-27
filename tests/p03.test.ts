import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { ALL_IDS } from '../src/data/characters';
import { DECK, P03, P03_PRACTICE, ROUND_MS, applyAct, fits, generateLayout, greedyPlayed, pointsOf, replay, solveLayout, startTable, type P03State } from '../src/matches/p03';
import { simulate } from './helpers';

const FOUR = ALL_IDS.slice(0, 4);

describe('P03 スピードカード', () => {
  it('並びは 1〜12 が 2 枚ずつ。出し切れる手順が必ずあり、何も考えずに出すだけでは出し切れない', () => {
    const g: number[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      const l = generateLayout(Rng.from(seed));
      expect(l.deck.length).toBe(DECK);
      for (let v = 1; v <= 12; v++) expect(l.deck.filter((c) => c === v).length).toBe(2);
      const sol = solveLayout(l);
      expect(sol).not.toBeNull();
      expect(replay(l, sol!)!.played).toBe(DECK);
      g.push(greedyPlayed(l));
      expect(greedyPlayed(l)).toBeLessThan(DECK);
    }
    writeFileSync('/tmp/p03-gen.txt', g.join(','));
    const sp = solveLayout(P03_PRACTICE);
    expect(sp && replay(P03_PRACTICE, sp)!.played).toBe(12);
  });

  it('差が 1 のカードだけ出せる（1 と 12 は隣り合わない）。置き換えは、どちらにも出せない時だけ', () => {
    expect(fits(1, 12)).toBe(false);
    expect(fits(5, 6)).toBe(true);
    expect(fits(5, 5)).toBe(false);
    const l = { deck: [5, 9, 1, 12, 6, 7, 8, 2], piles: [4, 10] as [number, number], reserve: [11, 3] };
    const t = startTable(l);
    expect(applyAct(l, t, { k: 'r', pile: 0 })).toBe(false);
    expect(applyAct(l, t, { k: 'p', v: 1, pile: 0 })).toBe(false);
    expect(applyAct(l, t, { k: 'p', v: 7, pile: 0 })).toBe(false);
    expect(applyAct(l, t, { k: 'p', v: 5, pile: 0 })).toBe(true);
    expect(t.hand).toEqual([6, 9, 1, 12]);
    expect(replay(l, [{ k: 'p', v: 5, pile: 1 }])).toBeNull();
    expect(pointsOf(10)).toBe(20);
    expect(pointsOf(24)).toBe(56);
  });

  it('不正な手順は拒否。得点は出した枚数 × 2、全部出すと +8。順位は得点、置き換えの少なさ、時間の順', () => {
    const s = P03.init(FOUR, Rng.from(3)) as P03State;
    const l = s.layouts[0];
    const sol = solveLayout(l)!;
    expect(P03.validate(s, FOUR[0], { t: 'run', acts: [{ k: 'p', v: 99, pile: 0 }], ms: 1000 })).toBe(false);
    expect(P03.validate(s, FOUR[0], { t: 'run', acts: sol, ms: ROUND_MS * 2 })).toBe(false);
    expect(P03.validate(s, FOUR[0], { t: 'ready' })).toBe(false);
    P03.submit(s, FOUR[0], { t: 'run', acts: sol, ms: 90_000 });
    P03.submit(s, FOUR[1], { t: 'run', acts: sol, ms: 80_000 });
    P03.submit(s, FOUR[2], { t: 'run', acts: sol.slice(0, 5), ms: 20_000 });
    P03.submit(s, FOUR[3], { t: 'run', acts: [], ms: 0 });
    expect(s.phase).toBe('break');
    expect(s.results[FOUR[0]][0]).toMatchObject({ played: 24, points: 56, cleared: true });
    expect(s.results[FOUR[3]][0]).toMatchObject({ played: 0, points: 0, ms: ROUND_MS });
    expect(P03.ranking(s).map((g) => g[0])).toEqual([FOUR[1], FOUR[0], FOUR[2], FOUR[3]]);
  });

  it('CPU だけで最後まで進む。見えているカードだけで読み、能力で差がつく', () => {
    const rows: string[] = [];
    let played = 0;
    let n = 0;
    let clears = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const r = simulate('p03', seed, FOUR);
      const st = r.slot.state as P03State;
      expect(P03.done(st)).toBe(true);
      for (const p of FOUR) for (const x of st.results[p]) { played += x.played; n++; if (x.cleared) clears++; }
      rows.push(FOUR.map((p) => `${p.slice(0, 6)}=${r.scores[p]}(${st.results[p].map((x) => x.played).join('/')})`).join(' '));
    }
    writeFileSync('/tmp/p03-sim.txt', `avg ${played / n} clears ${clears}/${n}\n${rows.join('\n')}`);
    expect(played / n).toBeGreaterThan(8);
  });
});
