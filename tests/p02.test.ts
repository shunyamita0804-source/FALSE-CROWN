import { describe, expect, it } from 'vitest';
import { ALL_IDS } from '../src/data/characters';
import { Rng } from '../src/core/rng';
import { ALL_CODES, P02, candidates, judge, type P02State } from '../src/matches/p02';
import { simulate } from './helpers';

const FOUR = ALL_IDS.slice(0, 4);

describe('P02 四つの金庫', () => {
  it('候補は 720 通り。一致と数字のみの判定', () => {
    expect(ALL_CODES.length).toBe(720);
    expect(judge('012', '012')).toEqual({ hit: 3, blow: 0 });
    expect(judge('012', '021')).toEqual({ hit: 1, blow: 2 });
    expect(judge('012', '345')).toEqual({ hit: 0, blow: 0 });
    expect(judge('012', '201')).toEqual({ hit: 0, blow: 3 });
  });

  it('4 つの金庫は異なる番号。開錠 +5、記録更新は増えた分だけ +1、同じ入力は拒否', () => {
    const s = P02.init(FOUR, Rng.from(9));
    expect(new Set(s.codes).size).toBe(4);
    s.codes = ['012', '345', '678', '901'];
    const [a, b, c] = FOUR;
    expect(P02.validate(s, b, { t: 'guess', safe: 0, code: '019' })).toBe(false); // 手番ではない
    expect(P02.validate(s, a, { t: 'guess', safe: 0, code: '011' })).toBe(false); // 数字の重複
    P02.submit(s, a, { t: 'guess', safe: 0, code: '019' }); // 2 一致 → +2
    expect(s.score[a]).toBe(2);
    expect(P02.validate(s, b, { t: 'guess', safe: 0, code: '019' })).toBe(false);
    P02.submit(s, b, { t: 'guess', safe: 0, code: '312' }); // 2 一致、記録更新なし
    expect(s.score[b]).toBe(0);
    P02.submit(s, c, { t: 'guess', safe: 0, code: '012' });
    expect(s.score[c]).toBe(5);
    expect(s.opened[0]).toBe(c);
    expect(P02.validate(s, FOUR[3], { t: 'guess', safe: 0, code: '987' })).toBe(false);
    expect(P02.view(s, a).codes).toEqual(['012', null, null, null]);
  });

  it('候補の絞り込みは正解を必ず残す', () => {
    const s = P02.init(FOUR, Rng.from(11));
    const rng = Rng.from(5);
    for (let i = 0; i < 12; i++) {
      const p = P02.pending(s)[0];
      const m = { t: 'guess' as const, safe: 0, code: rng.pick(ALL_CODES) };
      if (P02.validate(s, p, m)) P02.submit(s, p, m);
      if (s.opened[0]) break;
      expect(candidates(s.history, 0)).toContain(s.codes[0]);
    }
  });

  it('CPU 同士：必ず終局し、入力は 1 人 12 回まで。最下位が固定されない', () => {
    const bottom = new Map<string, number>();
    let ties = 0;
    let opened = 0;
    const N = 200;
    for (let seed = 1; seed <= N; seed++) {
      const r = simulate('p02', seed * 3, FOUR);
      const s = r.slot.state as P02State;
      for (const p of FOUR) expect(s.left[p]).toBeGreaterThanOrEqual(0);
      expect(s.history.length).toBeLessThanOrEqual(48);
      opened += s.opened.filter(Boolean).length;
      const last = r.ranking[r.ranking.length - 1];
      if (last.length > 1) ties++;
      for (const p of last) bottom.set(p, (bottom.get(p) ?? 0) + 1 / last.length);
    }
    console.log('p02 bottom', [...bottom.entries()].map(([k, v]) => `${k}:${v.toFixed(0)}`).join(' '), 'tieLast', ties, 'opened/game', (opened / N).toFixed(2));
    expect(bottom.size).toBe(4);
    expect(Math.max(...bottom.values()) / N).toBeLessThan(0.5);
  });
});
