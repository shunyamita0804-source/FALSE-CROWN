import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { ALL_IDS } from '../src/data/characters';
import { generateLink, linkComplete, linked, solveLink } from '../src/matches/link';
import { M03, M03_DEMO, M03_PRACTICE, PUZZLES, ROUND_SPECS, ROUND_MS, schedule, type M03State } from '../src/matches/m03';
import { simulate } from './helpers';

const TEN = ALL_IDS.slice(0, 10);

describe('経路つなぎの問題', () => {
  it('生成した盤面は必ず解ける。端点は重ならず、隣り合わない。見えている情報だけの探索でも解ける', () => {
    let solved = 0;
    let all = 0;
    let nodes = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const rng = Rng.from(seed);
      for (const specs of ROUND_SPECS) for (const [size, colors] of specs) {
        const { puzzle, solution } = generateLink(rng, size, colors);
        expect(puzzle.size).toBe(size);
        expect(puzzle.ends.length).toBe(colors);
        expect(new Set(puzzle.ends.flat()).size).toBe(colors * 2);
        expect(linkComplete(puzzle, solution)).toBe(true);
        const r = solveLink(puzzle, 6000);
        all++;
        nodes += r.nodes;
        if (r.solved) {
          solved++;
          expect(linkComplete(puzzle, r.sol)).toBe(true);
        }
      }
    }
    writeFileSync('/tmp/m03-gen.txt', `${solved}/${all} avg nodes ${nodes / all}`);
    expect(solved / all).toBeGreaterThan(0.9);
  });

  it('交差、共有、他の記号の端点を通る経路、飛び飛びの経路は不正。途中までの経路は未完成', () => {
    const p = M03_DEMO;
    const r = solveLink(p, 1e5);
    expect(r.solved).toBe(true);
    expect(linked(p, r.sol)).toBe(p.ends.length);
    expect(linked(p, [r.sol[0].slice(0, 2)])).toBe(0);
    expect(linked(p, [r.sol[0], r.sol[0]])).toBe(-1);
    expect(linked(p, [[p.ends[0][0], p.ends[0][1]]])).toBe(-1);
    expect(linked(p, [null, [p.ends[1][0]]])).toBe(0);
    expect(linked(p, [[5]])).toBe(-1);
    expect(solveLink(M03_PRACTICE, 1e5).solved).toBe(true);
  });
});

describe('M03 ツイン・リンク', () => {
  it('組み合わせ：毎ラウンド全員が組み、同じ相手とは 2 度組まない', () => {
    const sc = schedule(TEN, 5);
    const seen = new Set<string>();
    for (const round of sc) {
      expect(round.length).toBe(5);
      expect(new Set(round.flat()).size).toBe(10);
      for (const [a, b] of round) {
        const k = [a, b].sort().join('-');
        expect(seen.has(k)).toBe(false);
        seen.add(k);
      }
    }
  });

  it('得点：1 問 20 点、2 人とも 3 問以上で +15。手掛かりは教えた時だけ相手に見える。解は view に出ない', () => {
    const s = M03.init(TEN, Rng.from(4)) as M03State;
    const [a, b] = s.pairs[0][0] as [typeof TEN[number], typeof TEN[number]];
    expect(JSON.stringify(M03.view(s, a))).not.toContain('solutions');
    expect(M03.view(s, a).holding).not.toBeNull();
    for (const p of TEN) M03.submit(s, p, { t: 'ready', share: p === a });
    expect(s.phase).toBe('solve');
    expect(M03.view(s, b).clue).not.toBeNull();
    expect(M03.view(s, a).clue).toBeNull();
    expect(M03.validate(s, a, { t: 'solve', sols: [[[0, 7]], [], [], []], ms: [1, -1, -1, -1] })).toBe(false);
    M03.submit(s, a, { t: 'aid', puzzle: 3 });
    expect(M03.view(s, a).aid?.cells.length).toBe(3);
    expect(M03.validate(s, a, { t: 'aid', puzzle: 2 })).toBe(false);
    const full = (p: string, n: number) => ({ t: 'solve' as const, sols: s.solutions[p][0].map((x, i) => (i < n ? x : [])), ms: Array.from({ length: PUZZLES }, (_, i) => (i < n ? 30_000 * (i + 1) : -1)) });
    for (const p of TEN) M03.submit(s, p, full(p, p === a ? 4 : p === b ? 3 : 2));
    expect(s.round).toBe(1);
    expect(s.results[a][0]).toMatchObject({ done: 4, points: 80, bonus: 15, gave: true, got: false });
    expect(s.results[b][0]).toMatchObject({ done: 3, points: 60, bonus: 15, got: true });
    const other = TEN.find((p) => p !== a && p !== b)!;
    expect(s.results[other][0]).toMatchObject({ done: 2, points: 40, bonus: 0 });
    expect(M03.view(s, a).aid).toBeNull();
    expect(M03.view(s, a).aidUsed).toBe(true);
    expect(ROUND_MS).toBe(150_000);
  });

  it('CPU だけで最後まで進む。完成数は能力で差がつき、主人公も同じ基準で動く', () => {
    const rows: string[] = [];
    let done = 0;
    let n = 0;
    const wins: Record<string, number> = {};
    for (let seed = 1; seed <= 12; seed++) {
      const r = simulate('m03', seed, TEN);
      const st = r.slot.state as M03State;
      expect(M03.done(st)).toBe(true);
      for (const p of TEN) {
        expect(st.results[p].length).toBe(5);
        for (const x of st.results[p]) { done += x.done; n += PUZZLES; }
      }
      const top = r.ranking[0][0];
      wins[top] = (wins[top] ?? 0) + 1;
      rows.push(`${seed}: ${TEN.map((p) => `${p.slice(0, 6)}=${r.scores[p]}`).join(' ')}`);
    }
    writeFileSync('/tmp/m03-sim.txt', `rate ${done / n}\n${JSON.stringify(wins)}\n${rows.join('\n')}`);
    expect(done / n).toBeGreaterThan(0.55);
    expect(done / n).toBeLessThan(0.9);
  });
});
