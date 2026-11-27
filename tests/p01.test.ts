import { describe, expect, it } from 'vitest';
import type { CharId } from '../src/data/characters';
import { buildCtx } from '../src/core/runner';
import { rngOf } from '../src/core/state';
import { P01, type P01Move, type P01State } from '../src/matches/p01';
import { Rng } from '../src/core/rng';
import { freshState, simulate } from './helpers';

const FOUR: CharId[] = ['hero', 'npc_02_kanzaki', 'npc_05_shiraishi', 'npc_10_kujo'];

describe('P01 偽りの数字', () => {
  it('24手で終局し、得点表どおりに加減点される', () => {
    const s = P01.init(FOUR, Rng.from(1));
    // hero: 5 を「5」と宣言 → 2人信用、1人疑い
    P01.submit(s, 'hero', { t: 'play', card: 5, claim: 5 });
    P01.submit(s, FOUR[1], { t: 'judge', trust: true });
    P01.submit(s, FOUR[2], { t: 'judge', trust: true });
    P01.submit(s, FOUR[3], { t: 'judge', trust: false });
    expect(s.score.hero).toBe(12);
    expect(s.score[FOUR[1]]).toBe(10);
    expect(s.score[FOUR[3]]).toBe(8);
    // 次: 嘘（3 を「7」）→ 1人信用、2人看破
    P01.submit(s, FOUR[1], { t: 'play', card: 3, claim: 7 });
    P01.submit(s, 'hero', { t: 'judge', trust: true });
    P01.submit(s, FOUR[2], { t: 'judge', trust: false });
    P01.submit(s, FOUR[3], { t: 'judge', trust: false });
    expect(s.score[FOUR[1]]).toBe(10 + 2 - 2 - 2);
    expect(s.score.hero).toBe(10);
    expect(s.score[FOUR[2]]).toBe(12);
  });

  it('手番外・手札にないカード・範囲外の宣言を拒否する', () => {
    const s = P01.init(FOUR, Rng.from(1));
    expect(P01.validate(s, FOUR[1], { t: 'play', card: 1, claim: 1 })).toBe(false);
    expect(P01.validate(s, 'hero', { t: 'play', card: 10, claim: 1 })).toBe(false);
    expect(P01.validate(s, 'hero', { t: 'play', card: 1, claim: 0 })).toBe(false);
    P01.submit(s, 'hero', { t: 'play', card: 1, claim: 1 });
    expect(P01.validate(s, 'hero', { t: 'judge', trust: true })).toBe(false);
    for (const p of FOUR.slice(1)) P01.submit(s, p, { t: 'judge', trust: true });
    for (const p of FOUR.slice(1)) { P01.submit(s, p, P01.defaultMove(s, p)); for (const q of FOUR) if (q !== p) P01.submit(s, q, { t: 'judge', trust: true }); }
    // 同じ数字の再宣言は不可
    expect(P01.validate(s, 'hero', { t: 'play', card: 2, claim: 1 })).toBe(false);
    expect(P01.validate(s, 'hero', { t: 'play', card: 2, claim: 2 })).toBe(true);
  });

  it('view は伏せたカードと他人の手札を含まない', () => {
    const s = P01.init(FOUR, Rng.from(1));
    P01.submit(s, 'hero', { t: 'play', card: 4, claim: 9 });
    const v = P01.view(s, FOUR[1]) as unknown as Record<string, unknown>;
    expect(JSON.stringify(v)).not.toContain('"card":4');
    expect(v.hands).toBeUndefined();
    expect(v.current).toBeUndefined();
  });

  it('CPU 同士で終局し、正直固定が必勝にならない', () => {
    const N = 200;
    let ties = 0;
    let lieRate = 0;
    for (let seed = 1; seed <= N; seed++) {
      const r = simulate('p01', seed, FOUR);
      const st = r.slot.state as P01State;
      expect(st.history.length).toBe(24);
      const last = r.ranking[r.ranking.length - 1];
      if (last.length > 1) ties++;
      lieRate += st.history.filter((h) => h.card !== h.claim).length / 24;
    }
    // 正直固定の hero vs 通常 AI
    let rankSum = 0;
    let lastCount = 0;
    for (let seed = 1; seed <= N; seed++) {
      const state = freshState(seed);
      const s = P01.init(FOUR, Rng.from(seed));
      while (!P01.done(s)) {
        for (const p of P01.pending(s)) {
          let m: P01Move;
          if (p === 'hero' && s.stage === 'play') m = P01.defaultMove(s, p);
          else m = P01.ai(P01.view(s, p), buildCtx(state, p, 'p01', rngOf(state)));
          P01.submit(s, p, m);
        }
      }
      const order = P01.ranking(s).flat();
      rankSum += order.indexOf('hero') + 1;
      if (order[3] === 'hero') lastCount++;
    }
    console.log('P01 嘘の割合', (lieRate / N).toFixed(3), '最下位同点率', (ties / N).toFixed(3), '正直固定の平均順位', (rankSum / N).toFixed(2), '最下位率', (lastCount / N).toFixed(2));
    expect(rankSum / N).toBeGreaterThan(1.3);
  });
});
