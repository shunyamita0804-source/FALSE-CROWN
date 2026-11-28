import { describe, expect, it } from 'vitest';
import { drawLineup, drawPool, fillable, mainOf, prisonOf, MAIN_POOL, PRISON_POOL, type Pool } from '../src/core/lineup';
import { Rng } from '../src/core/rng';
import { ALL_IDS } from '../src/data/characters';
import { CONFIG, scheduleFor } from '../src/data/config';
import { MATCHES, isImplemented } from '../src/matches/registry';
import { freshState, simulate } from './helpers';

const pre = CONFIG.schedule.filter((d) => d.prison > 0);

describe('大会の競技の割り当て（lineup）', () => {
  it('候補の競技はすべて実装済みで、人数がエンジンの対応範囲に収まる', () => {
    for (const e of [...MAIN_POOL.pool, ...PRISON_POOL.pool]) {
      expect(isImplemented(e.id), e.id).toBe(true);
      for (const n of e.players) {
        expect(n, e.id).toBeGreaterThanOrEqual(MATCHES[e.id].minPlayers);
        expect(n, e.id).toBeLessThanOrEqual(MATCHES[e.id].maxPlayers);
      }
    }
  });

  it('2,000 回の抽選で、どの日も人数に合う競技が入り、同じ系統は 1 回だけ。メインと監獄版も重ならない', () => {
    const fam = new Map([...MAIN_POOL.pool, ...PRISON_POOL.pool].map((e) => [e.id, e.family]));
    const seen = new Map<string, number>();
    for (let seed = 1; seed <= 2000; seed++) {
      const l = drawLineup(seed);
      expect(l.main.length).toBe(CONFIG.schedule.length);
      CONFIG.schedule.forEach((d, i) => {
        if (d.prison === 0) { expect(l.prison[i]).toBeNull(); return; }
        const p = l.prison[i]!;
        expect(PRISON_POOL.pool.find((e) => e.id === p)!.players).toContain(d.prison);
        seen.set(p, (seen.get(p) ?? 0) + 1);
      });
      const fams = [...l.main, ...l.prison].filter((x): x is string => !!x && fam.has(x)).map((x) => fam.get(x));
      expect(new Set(fams).size).toBe(fams.length);
    }
    // メインが今の並び（M02・M03・M05 がメインにいる）間は、その監獄版は出ない
    expect(seen.get('q02') ?? 0).toBe(0);
    expect(seen.get('q03') ?? 0).toBe(0);
    expect(seen.get('q05') ?? 0).toBe(0);
    // 監獄の競技は偏りすぎない（10 本のうち、どれも 1 割以上の大会に出る）
    for (const id of ['p01', 'p02', 'p03', 'p04', 'p05', 'p06', 'p07', 'p08', 'p09', 'p10']) expect(seen.get(id) ?? 0, id).toBeGreaterThan(200);
  });

  it('メインが今の並びのうちは、メインは日程表のまま', () => {
    expect(MAIN_POOL.mode).toBe('fixed');
    const l = drawLineup(7);
    CONFIG.schedule.forEach((d, i) => expect(l.main[i]).toBe(d.main));
  });

  it('メインも抽選にした時（新しいメインがそろった後）も、2,000 回すべて埋まる。M02・M03・M05 が外れると監獄版が出る', () => {
    const main: Pool = { mode: 'draw', pool: [
      { id: 'm01', players: [8, 9, 10, 11, 12], family: 'piece' },
      { id: 'n_role', players: [6, 7, 8, 9, 10, 11, 12], family: 'role' },
      { id: 'n_raid', players: [4, 5, 6, 7, 8, 9, 10, 11, 12], family: 'raid' },
      { id: 'n_chase', players: [4, 5, 6, 7, 8, 9, 10], family: 'chase' },
      { id: 'n_market', players: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12], family: 'market' },
      { id: 'n_gem', players: [3, 4, 5, 6, 7, 8], family: 'gem' },
      { id: 'm04', players: [9], family: 'rail' },
      { id: 'm06', players: [7], family: 'card' },
      { id: 'm07', players: [6], family: 'hex' },
      { id: 'm08', players: [5], family: 'barricade' },
      { id: 'm09', players: [4], family: 'kings' },
      { id: 'm10', players: [3], family: 'triangle' },
    ] };
    let q = 0;
    for (let seed = 1; seed <= 2000; seed++) {
      const l = drawLineup(seed, main, PRISON_POOL);
      expect(l.main[l.main.length - 1]).toBe('m11');
      if (l.prison.some((p) => p && p.startsWith('q'))) q++;
    }
    expect(q).toBeGreaterThan(1000);
  });

  it('埋まらない候補は最初に分かる（途中で詰まらない）', () => {
    expect(fillable([3, 3], [{ id: 'a', players: [3], family: 'a' }], new Set())).toBe(false);
    expect(() => drawPool([3, 3], [{ id: 'a', players: [3], family: 'a' }], Rng.from(1))).toThrow();
    expect(drawPool([3, 4], [{ id: 'a', players: [3, 4], family: 'a' }, { id: 'b', players: [4], family: 'b' }], Rng.from(1))).toEqual(['a', 'b']);
  });

  it('新しい大会には割り当てが残り、古いセーブ（割り当てなし）は日程表のまま', () => {
    const s = freshState(5);
    expect(s.lineup).toBeTruthy();
    expect(prisonOf(s, 1)).toBe(s.lineup!.prison[0]);
    expect(prisonOf(s, 11)).toBeNull();
    delete s.lineup;
    for (const d of CONFIG.schedule) {
      expect(mainOf(s, d.day)).toBe(scheduleFor(d.day).main);
      expect(prisonOf(s, d.day)).toBe(scheduleFor(d.day).prisonGame);
    }
  });
});

describe('監獄版 Q02・Q03・Q05', () => {
  const runs = (id: string, n: number, seeds = 20) => {
    const firsts: Record<string, number> = {};
    let rounds = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      const r = simulate(id, seed, ALL_IDS.slice(0, n));
      expect(r.ranking.flat().length).toBe(n);
      firsts[r.ranking[0][0]] = (firsts[r.ranking[0][0]] ?? 0) + 1;
      rounds = (r.slot.state as { rounds?: unknown; order?: unknown[] }).order?.length ?? (typeof (r.slot.state as { rounds?: unknown }).rounds === 'number' ? (r.slot.state as { rounds: number }).rounds : 8);
    }
    return { firsts, rounds };
  };
  it('Q02：人数の 2 倍のラウンドで、全員が 2 回ずつ出題する', () => {
    for (const n of [2, 3, 4]) {
      const r = simulate('q02', n, ALL_IDS.slice(0, n));
      const order = (r.slot.state as { order: string[] }).order;
      expect(order.length).toBe(n * 2);
      for (const p of ALL_IDS.slice(0, n)) expect(order.filter((x) => x === p).length).toBe(2);
      expect(r.ranking.flat().length).toBe(n);
    }
  });
  it('Q03：3〜4 人は 3 ラウンドで全員と 1 回ずつ組み、3 人の時は全員が 1 回ずつ相手なし', () => {
    for (const n of [3, 4]) {
      const r = simulate('q03', 11, ALL_IDS.slice(0, n));
      const st = r.slot.state as { pairs: [string, string | null][][]; rounds: number };
      expect(st.rounds).toBe(3);
      const solo: Record<string, number> = {};
      const met = new Set<string>();
      for (const round of st.pairs) for (const [a, b] of round) {
        if (!b) solo[a] = (solo[a] ?? 0) + 1;
        else met.add([a, b].sort().join('-'));
      }
      if (n === 3) for (const p of ALL_IDS.slice(0, 3)) expect(solo[p]).toBe(1);
      else expect(met.size).toBe(6);
    }
  });
  it('Q05：2 人と 4 人は、組の全員が同じ回数ずつ出題担当を務める', () => {
    for (const n of [2, 4]) {
      const r = simulate('q05', 3, ALL_IDS.slice(0, n));
      const res = (r.slot.state as { results: Record<string, { setter: boolean }[]> }).results;
      const counts = ALL_IDS.slice(0, n).map((p) => res[p].filter((x) => x.setter).length);
      expect(new Set(counts).size).toBe(1);
    }
  });
  it('CPU だけで最後まで進み、全員の順位が決まる', () => {
    for (const [id, n] of [['q02', 4], ['q03', 3], ['q05', 2]] as const) runs(id, n, 6);
  });
});
