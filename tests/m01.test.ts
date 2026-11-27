import { describe, expect, it } from 'vitest';
import { ALL_IDS } from '../src/data/characters';
import { M01, type M01Move, type M01State } from '../src/matches/m01';
import { Rng } from '../src/core/rng';
import { simulate } from './helpers';

function playAll(s: M01State, pick: (p: string, s: M01State) => M01Move) {
  while (!M01.done(s)) {
    for (const p of M01.pending(s)) {
      if (s.stage === 'negotiate') M01.submit(s, p, { t: 'ready' });
      else {
        const m = pick(p, s);
        M01.submit(s, p, M01.validate(s, p, m) ? m : M01.defaultMove(s, p));
      }
    }
  }
}

describe('M01 三国の盟約', () => {
  it('12人を3国4人ずつに分け、5ラウンドで終局する', () => {
    const s = M01.init(ALL_IDS, Rng.from(1));
    for (let n = 0; n < 3; n++) expect(ALL_IDS.filter((p) => s.nation[p] === n).length).toBe(4);
    playAll(s, () => ({ t: 'produce' }));
    expect(s.round).toBe(5);
    expect(M01.done(s)).toBe(true);
    // 生産のみ：個人10点 + 領土3×2
    for (const p of ALL_IDS) expect(M01.scores(s)[p]).toBe(16);
  });

  it('単独最大の攻撃が防御を上回れば占領、同値は維持', () => {
    const s = M01.init(ALL_IDS, Rng.from(2));
    const red = ALL_IDS.filter((p) => s.nation[p] === 0);
    const blue = ALL_IDS.filter((p) => s.nation[p] === 1);
    for (const p of ALL_IDS) M01.submit(s, p, { t: 'ready' });
    // 紅2人が蒼都(3)へ侵攻(攻撃4)、蒼1人が防衛(3) → 占領。紅1人と金…は中立9へ: 紅2 vs 蒼2 → 同値で維持
    for (const p of ALL_IDS) {
      let m: M01Move = { t: 'produce' };
      if (p === red[0] || p === red[1]) m = { t: 'invade', terr: 3 };
      if (p === blue[0]) m = { t: 'defend', terr: 3 };
      if (p === red[2]) m = { t: 'invade', terr: 9 };
      if (p === blue[1]) m = { t: 'invade', terr: 9 };
      M01.submit(s, p, m);
    }
    expect(s.owner[3]).toBe(0);
    expect(s.owner[9]).toBe(null);
    expect(s.personal[red[0]]).toBe(3);
    expect(s.personal[blue[0]]).toBe(0);
  });

  it('資源不足の手はパスになり、資源は負にならない', () => {
    const s = M01.init(ALL_IDS, Rng.from(3));
    playAll(s, () => ({ t: 'hoard' }));
    expect(Math.min(...s.resources)).toBeGreaterThanOrEqual(0);
    // 6 資源 → 1R目は3人だけ蓄財でき、以降は誰もできない
    const total = ALL_IDS.reduce((a, p) => a + s.personal[p], 0);
    expect(total).toBe(3 * 3 * 3);
    for (const p of ALL_IDS) expect(s.hoards[p]).toBeLessThanOrEqual(2);
  });

  it('不正な手を拒否する', () => {
    const s = M01.init(ALL_IDS, Rng.from(4));
    const p = ALL_IDS[0];
    expect(M01.validate(s, p, { t: 'produce' })).toBe(false); // 交渉中
    for (const q of ALL_IDS) M01.submit(s, q, { t: 'ready' });
    const own = s.owner.findIndex((o) => o === s.nation[p]);
    expect(M01.validate(s, p, { t: 'invade', terr: own })).toBe(false);
    expect(M01.validate(s, p, { t: 'spy', target: p })).toBe(false);
    expect(M01.validate(s, p, { t: 'spy', target: ALL_IDS[3] })).toBe(false); // R1 は諜報不可
    expect(() => M01.submit(s, p, { t: 'invade', terr: own })).toThrow();
  });

  it('NPC の view に他人の行動・個人点が含まれない', () => {
    const s = M01.init(ALL_IDS, Rng.from(5));
    const v = M01.view(s, ALL_IDS[1]) as unknown as Record<string, unknown>;
    expect(v.moves).toBeUndefined();
    expect(v.personal).toBeUndefined();
    expect(v.executed).toBeUndefined();
  });

  it('CPU 12人の自動対戦が複数シードで終局し、蓄財連打が支配戦略にならない', () => {
    const N = 60;
    let ties = 0;
    const actionCount: Record<string, number> = {};
    for (let seed = 1; seed <= N; seed++) {
      const r = simulate('m01', seed);
      const st = r.slot.state as M01State;
      if (r.ranking.some((g) => g.length > 1)) ties++;
      for (const p of ALL_IDS) for (const m of st.executed[p]) actionCount[m.t] = (actionCount[m.t] ?? 0) + 1;
    }
    const total = Object.values(actionCount).reduce((a, b) => a + b, 0);
    console.log('M01 行動選択率', Object.fromEntries(Object.entries(actionCount).map(([k, v]) => [k, (v / total).toFixed(3)])), '同点発生率', (ties / N).toFixed(2));
    expect(actionCount.hoard / total).toBeLessThan(0.6);
    // 蓄財固定の1人 vs 通常AI：平均順位が上位に張り付かないこと
    let rankSum = 0;
    for (let seed = 1; seed <= N; seed++) {
      const s = M01.init(ALL_IDS, Rng.from(seed * 7));
      const state = simulateWithFixed(s, seed, 'hero', { t: 'hoard' });
      const order = M01.ranking(state).flat();
      rankSum += order.indexOf('hero') + 1;
    }
    console.log('M01 蓄財固定の平均順位', (rankSum / N).toFixed(2));
    // 蓄財固定は強いが必勝ではない（docs/balance-report.md に計測値と調整案を記録）
    expect(rankSum / N).toBeGreaterThan(1.5);
  });
});

import { buildCtx } from '../src/core/runner';
import { freshState } from './helpers';
import { rngOf } from '../src/core/state';

function simulateWithFixed(s: M01State, seed: number, fixed: string, move: M01Move): M01State {
  const state = freshState(seed);
  while (!M01.done(s)) {
    for (const p of M01.pending(s)) {
      if (s.stage === 'negotiate') { M01.submit(s, p, { t: 'ready' }); continue; }
      let m: M01Move = p === fixed ? move : M01.ai(M01.view(s, p), buildCtx(state, p, 'm01', rngOf(state)));
      if (!M01.validate(s, p, m)) m = M01.defaultMove(s, p);
      M01.submit(s, p, m);
    }
  }
  return s;
}
