import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { ALL_IDS } from '../src/data/characters';
import { M01, M01_DEMO, M01_PRACTICE, STAGES, STAGE_MS, scoreOf, type M01State } from '../src/matches/m01';
import { canPlace, coverage, freeCount, generate, isComplete, orientations, solve, STAGE_SPECS } from '../src/matches/poly';
import { simulate } from './helpers';

describe('ポリオミノの問題', () => {
  it('生成した盤面は必ず解ける。大きさ、穴、ピースの数が指定どおり。別解も受け付ける', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const rng = Rng.from(seed);
      for (const spec of STAGE_SPECS) {
        const { puzzle, solution } = generate(rng, spec);
        expect(puzzle.w).toBe(spec.w);
        expect(puzzle.holes.filter(Boolean).length).toBe(spec.holes);
        expect(puzzle.pieces.length).toBe(spec.pieces);
        expect(puzzle.pieces.every((p) => p.length >= 2 && p.length <= 6)).toBe(true);
        expect(puzzle.pieces.reduce((n, p) => n + p.length, 0)).toBe(freeCount(puzzle));
        expect(isComplete(puzzle, solution)).toBe(true);
        // 見えている情報だけの探索でも解ける（解と違う置き方でも完成と判定される）
        const r = solve(puzzle, 1e6, Rng.from(seed + 99));
        expect(r.solved).toBe(true);
        expect(isComplete(puzzle, r.placed)).toBe(true);
      }
    }
  });

  it('重なり、枠外、穴の上、同じピースの二重使用は不正', () => {
    const { puzzle, solution } = generate(Rng.from(3), STAGE_SPECS[2]);
    expect(coverage(puzzle, [solution[0], solution[0]])).toBe(-1);
    expect(coverage(puzzle, [{ ...solution[0], x: -3 }])).toBe(-1);
    expect(coverage(puzzle, [{ ...solution[0], x: 99 }])).toBe(-1);
    const hole = puzzle.holes.indexOf(true);
    const one = { piece: 0, rot: 0, x: (hole % puzzle.w) - puzzle.pieces[0][0][0], y: Math.floor(hole / puzzle.w) - puzzle.pieces[0][0][1] };
    expect(canPlace(puzzle, [], one)).toBe(false);
    expect(coverage(puzzle, solution.slice(0, 2))).toBe(puzzle.pieces[solution[0].piece].length + puzzle.pieces[solution[1].piece].length);
    expect(orientations([[0, 0], [1, 0], [0, 1], [1, 1]]).length).toBe(1);
    expect(orientations([[0, 0], [1, 0], [2, 0]]).length).toBe(2);
  });

  it('説明と練習の盤面も解ける', () => {
    expect(solve(M01_DEMO, 1e5).solved).toBe(true);
    expect(solve(M01_PRACTICE, 1e5).solved).toBe(true);
  });
});

describe('M01 ピース・アセンブル', () => {
  it('得点：完成 100＋速さ最大 20、未完成は埋めた割合 × 40。組の全員完成で +10', () => {
    const s = M01.init(ALL_IDS, Rng.from(5)) as M01State;
    const pz = s.puzzles[0];
    const sol = s.solutions[0];
    expect(scoreOf(pz, sol, 0)).toMatchObject({ complete: true, base: 100, speed: 20 });
    expect(scoreOf(pz, sol, STAGE_MS / 2)).toMatchObject({ base: 100, speed: 10 });
    expect(scoreOf(pz, sol, STAGE_MS)).toMatchObject({ base: 100, speed: 0 });
    const part = scoreOf(pz, sol.slice(0, 1), STAGE_MS);
    expect(part.complete).toBe(false);
    expect(part.base).toBe(Math.floor((pz.pieces[sol[0].piece].length / freeCount(pz)) * 40));
    expect(s.groups.map((g) => g.length)).toEqual([4, 4, 4]);
    // 1 組だけ全員完成、他は 1 人が未完成
    const g0 = s.groups[0];
    for (const p of ALL_IDS) {
      const fail = !g0.includes(p) && (p === s.groups[1][0] || p === s.groups[2][0]);
      M01.submit(s, p, { t: 'solve', placed: fail ? [] : sol, ms: 60_000 });
    }
    expect(s.phase).toBe('break');
    for (const p of g0) expect(s.results[p][0]).toMatchObject({ base: 100, speed: 10, team: 10 });
    expect(s.results[s.groups[1][1]][0].team).toBe(0);
    expect(s.results[s.groups[1][0]][0]).toMatchObject({ base: 0, speed: 0, team: 0 });
  });

  it('不正な配置や範囲外の時間は拒否。ヒントは 1 回だけで、買った本人にだけ見える。解は view に出ない', () => {
    const s = M01.init(ALL_IDS, Rng.from(8)) as M01State;
    const [a, b] = ALL_IDS;
    const sol = s.solutions[0];
    expect(M01.validate(s, a, { t: 'solve', placed: [sol[0], sol[0]], ms: 1000 })).toBe(false);
    expect(M01.validate(s, a, { t: 'solve', placed: sol, ms: -1 })).toBe(false);
    expect(M01.validate(s, a, { t: 'solve', placed: sol, ms: STAGE_MS * 3 })).toBe(false);
    expect(M01.validate(s, a, { t: 'ready' })).toBe(false);
    expect(JSON.stringify(M01.view(s, a))).not.toContain('solutions');
    expect(M01.view(s, a).hint).toBeNull();
    M01.submit(s, a, { t: 'hint' });
    expect(M01.validate(s, a, { t: 'hint' })).toBe(false);
    const hint = M01.view(s, a).hint!;
    expect(sol).toContainEqual(hint);
    expect(M01.view(s, b).hint).toBeNull();
    // CPU に渡す view には、ほかの人の進み具合を入れない
    M01.submit(s, b, { t: 'solve', placed: sol, ms: 5000 });
    for (const p of ALL_IDS.filter((x) => x !== 'hero')) expect(M01.view(s, p).mates).toEqual([]);
    expect(M01.validate(s, b, { t: 'solve', placed: sol, ms: 5000 })).toBe(false);
  });

  it('6 ステージで終わり、3 ステージ後に組替え。全員の順位が出る。時間切れは無提出と同じ', () => {
    const r = simulate('m01', 11);
    const s = r.slot.state as M01State;
    expect(s.phase).toBe('done');
    for (const p of ALL_IDS) expect(s.results[p].length).toBe(STAGES);
    expect(r.ranking.flat().length).toBe(12);
    const d = M01.init(ALL_IDS, Rng.from(2)) as M01State;
    const before = d.groups.map((g) => [...g]);
    for (let st = 0; st < 3; st++) {
      for (const p of ALL_IDS) M01.submit(d, p, M01.defaultMove(d, p));
      for (const p of ALL_IDS) M01.submit(d, p, { t: 'ready' });
    }
    expect(d.stage).toBe(3);
    expect(d.groups.map((g) => g.length)).toEqual([4, 4, 4]);
    // 組替えで、元の組の 4 人がそのまま残る組はない
    for (const g of d.groups) for (const o of before) expect(g.filter((p) => o.includes(p)).length).toBeLessThanOrEqual(2);
    expect(Object.values(M01.scores(d)).every((v) => v === 0)).toBe(true);
  });

  it('100 試合：脱落圏（下位 4 人）と 1 位が特定の人に固定されない。少人数でも成立する', () => {
    const top: Record<string, number> = {};
    const bottom: Record<string, number> = {};
    for (let seed = 1; seed <= 100; seed++) {
      const flat = simulate('m01', seed).ranking.flat();
      top[flat[0]] = (top[flat[0]] ?? 0) + 1;
      for (const p of flat.slice(-4)) bottom[p] = (bottom[p] ?? 0) + 1;
    }
    expect(Math.max(...Object.values(top))).toBeLessThanOrEqual(40);
    expect(Object.keys(top).length).toBeGreaterThanOrEqual(5);
    expect(Math.max(...Object.values(bottom))).toBeLessThanOrEqual(85);
    for (const n of [2, 3, 5, 9]) expect(simulate('m01', 7, ALL_IDS.slice(0, n)).ranking.flat().length).toBe(n);
  }, 120_000);
});
