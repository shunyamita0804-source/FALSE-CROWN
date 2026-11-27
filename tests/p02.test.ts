import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { ALL_IDS } from '../src/data/characters';
import { answerOf, wellFormed } from '../src/matches/memory';
import { P02, P02_PRACTICE, QUESTIONS, ROUND_SPECS, ROUNDS, SYMBOLS, type P02State } from '../src/matches/p02';
import { simulate } from './helpers';

const FOUR = ALL_IDS.slice(0, 4);

describe('P02 瞬間記憶', () => {
  it('問題：8 ラウンド、4×4 から 5×5、図柄 8〜18 個、6 問。候補 4 つに正解がちょうど 1 つ（100 シード）', () => {
    expect(SYMBOLS.length).toBe(20);
    for (let seed = 1; seed <= 100; seed++) {
      const s = P02.init(FOUR, Rng.from(seed)) as P02State;
      expect(s.sets.length).toBe(ROUNDS);
      s.sets.forEach((set, r) => {
        const sp = ROUND_SPECS[r];
        expect(set.board.w).toBe(sp.size);
        expect(set.board.cells.filter((c) => c != null).length).toBe(sp.n);
        expect(set.showMs).toBeGreaterThanOrEqual(10_000);
        expect(set.showMs).toBeLessThanOrEqual(15_000);
        expect(set.questions.length).toBe(QUESTIONS);
        expect(wellFormed(set)).toBe(true);
        expect(new Set(set.questions.map((q) => (q.kind === 'item' ? q.cell : -1))).size).toBe(QUESTIONS);
        for (const q of set.questions) expect(q.kind === 'item' && q.options.length).toBe(4);
      });
    }
    expect(ROUND_SPECS[0].n).toBe(8);
    expect(ROUND_SPECS[ROUNDS - 1].n).toBe(18);
    expect(wellFormed(P02_PRACTICE)).toBe(true);
  });

  it('得点：正解 2 点、全問正解 +2。延長は 1 回だけ。2 ラウンドごとに休憩', () => {
    const s = P02.init(FOUR, Rng.from(2)) as P02State;
    M: {
      P02.submit(s, FOUR[0], { t: 'boost' });
      expect(P02.validate(s, FOUR[0], { t: 'boost' })).toBe(false);
      for (const p of FOUR) P02.submit(s, p, { t: 'ready' });
      expect(s.phase).toBe('quiz');
      expect(P02.view(s, FOUR[0]).set!.showMs).toBe(ROUND_SPECS[0].showMs + 2000);
      expect(P02.view(s, FOUR[1]).set!.showMs).toBe(ROUND_SPECS[0].showMs);
      const set = s.sets[0];
      const good = { picks: set.questions.map((q) => answerOf(set.board, q)), ms: set.questions.map(() => 1500) };
      const half = { picks: good.picks.map((x, i) => (i < 3 ? x : -1)), ms: [...good.ms] };
      P02.submit(s, FOUR[0], { t: 'answers', a: good });
      P02.submit(s, FOUR[1], { t: 'answers', a: half });
      P02.submit(s, FOUR[2], P02.defaultMove(s, FOUR[2]));
      P02.submit(s, FOUR[3], P02.defaultMove(s, FOUR[3]));
      expect(s.results[FOUR[0]][0].points).toBe(14);
      expect(s.results[FOUR[1]][0].points).toBe(6);
      expect(s.results[FOUR[2]][0].points).toBe(0);
      expect([s.phase, s.round]).toEqual(['prep', 1]);
      expect(P02.validate(s, FOUR[0], { t: 'boost' })).toBe(false);
      for (const p of FOUR) P02.submit(s, p, { t: 'ready' });
      for (const p of FOUR) P02.submit(s, p, P02.defaultMove(s, p));
      expect(s.phase).toBe('break');
      for (const p of FOUR) P02.submit(s, p, { t: 'ready' });
      expect([s.phase, s.round]).toEqual(['prep', 2]);
      break M;
    }
  });

  it('最後まで進む（2〜4 人）。100 試合で最下位が特定の人に固定されない', () => {
    for (const n of [2, 3, 4]) {
      const r = simulate('p02', 3 + n, ALL_IDS.slice(0, n));
      expect((r.slot.state as P02State).phase).toBe('done');
      expect(r.ranking.flat().length).toBe(n);
    }
    const last: Record<string, number> = {};
    const app: Record<string, number> = {};
    let ok = 0;
    let q = 0;
    const byRound = ROUND_SPECS.map(() => 0);
    for (let seed = 1; seed <= 300; seed++) {
      const ps = [ALL_IDS[seed % 12], ALL_IDS[(seed + 3) % 12], ALL_IDS[(seed + 5) % 12], ALL_IDS[(seed + 8) % 12]];
      const r = simulate('p02', seed, ps);
      const f = r.ranking.flat();
      last[f[3]] = (last[f[3]] ?? 0) + 1;
      const s = r.slot.state as P02State;
      for (const p of ps) {
        app[p] = (app[p] ?? 0) + 1;
        s.results[p].forEach((x, i) => { ok += x.correct; q += QUESTIONS; byRound[i] += x.correct; });
      }
    }
    const rate = Object.fromEntries(Object.entries(last).map(([k, v]) => [k, +(v / app[k]).toFixed(2)]));
    writeFileSync('/tmp/p02-stats.json', JSON.stringify({ rate, ok: +(ok / q).toFixed(3), byRound: byRound.map((x) => +(x / (300 * 4 * QUESTIONS)).toFixed(2)) }, null, 1));
    expect(Object.keys(last).length).toBeGreaterThanOrEqual(10);
    expect(Math.max(...Object.values(rate))).toBeLessThan(0.6);
  });
});
