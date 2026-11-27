import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { ALL_IDS } from '../src/data/characters';
import { allSolutions, legalPath, P01, P01_PRACTICE, pointsOf, Q_MS, QUESTIONS, ROUNDS, sumOf, type P01State } from '../src/matches/p01';
import { simulate } from './helpers';

const FOUR = ALL_IDS.slice(0, 4);

describe('P01 数字の鎖', () => {
  it('経路の規則：縦横の隣接、重複なし、長さ 3〜6', () => {
    expect(legalPath([0, 1, 2])).toBe(true);
    expect(legalPath([0, 1])).toBe(false);
    expect(legalPath([0, 5, 10])).toBe(false); // 斜め
    expect(legalPath([0, 1, 0])).toBe(false);
    expect(legalPath([3, 4, 5])).toBe(false); // 行をまたぐ
    expect(legalPath([0, 1, 2, 3, 7, 11, 15])).toBe(false); // 7 個
    expect(legalPath([0, 1, 2, 3, 7, 11])).toBe(true);
  });

  it('すべての問題に正解がある（100 シード）。同じラウンドの 2 問は目標値が違う', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const s = P01.init(FOUR, Rng.from(seed)) as P01State;
      expect(s.boards.length).toBe(ROUNDS);
      s.boards.forEach((b, r) => {
        expect(b.length).toBe(16);
        expect(b.every((n) => n >= 1 && n <= 9)).toBe(true);
        expect(new Set(s.targets[r]).size).toBe(QUESTIONS);
        for (const t of s.targets[r]) expect(allSolutions(b, t, 1).length).toBe(1);
      });
    }
    expect(allSolutions(P01_PRACTICE, 14, 1).length).toBe(1);
  });

  it('得点：正解 10＋長さ＋残り時間の加点。合計が違えば 0 点。全員同じ問題', () => {
    expect(pointsOf(3, Q_MS)).toBe(13);
    expect(pointsOf(6, 0)).toBe(19);
    expect(pointsOf(4, Q_MS / 2)).toBe(15);
    const s = P01.init(FOUR, Rng.from(4)) as P01State;
    const sols = allSolutions(s.boards[0], s.targets[0][0]);
    const good = sols[0];
    const bad = [0, 1, 2, 3].find(() => true) !== undefined ? [0, 1, 2, 3].slice(0, 3) : [0, 1, 2];
    const badOk = sumOf(s.boards[0], bad) === s.targets[0][0];
    expect(P01.view(s, FOUR[0]).board).toEqual(P01.view(s, FOUR[1]).board);
    expect(P01.view(s, FOUR[0]).target).toBe(P01.view(s, FOUR[3]).target);
    expect(P01.validate(s, FOUR[0], { t: 'chain', path: [0, 5, 10], ms: 100 })).toBe(false);
    P01.submit(s, FOUR[0], { t: 'chain', path: good, ms: 5000 });
    expect(P01.validate(s, FOUR[0], { t: 'pass' })).toBe(false);
    P01.submit(s, FOUR[1], { t: 'chain', path: bad, ms: 5000 });
    P01.submit(s, FOUR[2], { t: 'pass' });
    P01.submit(s, FOUR[3], P01.defaultMove(s, FOUR[3]));
    expect(s.q).toBe(1);
    expect(s.answers[FOUR[0]][0].points).toBe(pointsOf(good.length, 5000));
    if (!badOk) expect(s.answers[FOUR[1]][0].points).toBe(0);
    expect(s.answers[FOUR[2]][0].points).toBe(0);
  });

  it('6 ラウンド 12 問で終わる。2 ラウンドごとに休憩。最下位が 1 人に決まるか、同点として返る', () => {
    const r = simulate('p01', 21, FOUR);
    const s = r.slot.state as P01State;
    expect(s.phase).toBe('done');
    for (const p of FOUR) expect(s.answers[p].length).toBe(ROUNDS * QUESTIONS);
    expect(r.ranking.flat().length).toBe(4);
    const d = P01.init(FOUR, Rng.from(1)) as P01State;
    for (let i = 0; i < 4; i++) for (const p of FOUR) P01.submit(d, p, { t: 'pass' });
    expect(d.phase).toBe('break');
    for (const p of FOUR) P01.submit(d, p, { t: 'ready' });
    expect([d.phase, d.round, d.q]).toEqual(['solve', 2, 0]);
    for (const n of [2, 3]) expect(simulate('p01', 3, ALL_IDS.slice(0, n)).ranking.flat().length).toBe(n);
  });

  it('100 試合：最下位が特定の人に固定されない', () => {
    const last: Record<string, number> = {};
    let n = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const ps = [ALL_IDS[seed % 12], ALL_IDS[(seed + 3) % 12], ALL_IDS[(seed + 5) % 12], ALL_IDS[(seed + 8) % 12]];
      const f = simulate('p01', seed, ps).ranking.flat();
      last[f[3]] = (last[f[3]] ?? 0) + 1;
      n++;
    }
    expect(Object.keys(last).length).toBeGreaterThanOrEqual(7);
    expect(Math.max(...Object.values(last))).toBeLessThanOrEqual(n * 0.4);
  });
});
