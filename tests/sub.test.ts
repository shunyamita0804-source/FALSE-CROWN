import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { ALL_IDS } from '../src/data/characters';
import { ALL_CODES, candidates, judge, S01, type S01State } from '../src/matches/s01';
import { lineAt, S02, S02_N, type S02State } from '../src/matches/s02';
import { flipsOf, legalOf, S03, type S03State } from '../src/matches/s03';
import { S04, type S04State } from '../src/matches/s04';
import { chances, holds, S05, type S05State } from '../src/matches/s05';
import { applySwaps, S06, solve, solved, type S06State } from '../src/matches/s06';
import { simulate } from './helpers';

const TWO = ALL_IDS.slice(0, 2);
const pairOf = (seed: number) => { const a = ALL_IDS[seed % 12]; const b = ALL_IDS[(seed * 5 + 1 + (seed % 11)) % 12]; return a === b ? [a, ALL_IDS[(seed + 1) % 12]] : [a, b]; };

describe('S01 数字当て', () => {
  it('ヒットとブローの数え方', () => {
    expect(judge('123', '123')).toEqual({ hit: 3, blow: 0 });
    expect(judge('123', '321')).toEqual({ hit: 1, blow: 2 });
    expect(judge('123', '456')).toEqual({ hit: 0, blow: 0 });
    expect(judge('123', '231')).toEqual({ hit: 0, blow: 3 });
    expect(ALL_CODES.length).toBe(720);
    expect(candidates([{ code: '123', hit: 3, blow: 0 }])).toEqual(['123']);
  });
  it('同じ数字を使う数は決められない。当てた回数の少ない方が勝ち', () => {
    const s = S01.init(TWO, Rng.from(1)) as S01State;
    expect(S01.validate(s, TWO[0], { t: 'secret', code: '112' })).toBe(false);
    S01.submit(s, TWO[0], { t: 'secret', code: '123' });
    S01.submit(s, TWO[1], { t: 'secret', code: '456' });
    // 相手の秘密の数は見えない
    expect(JSON.stringify(S01.view(s, TWO[0]))).not.toContain('456');
    S01.submit(s, TWO[0], { t: 'guess', code: '456' });
    S01.submit(s, TWO[1], { t: 'guess', code: '789' });
    expect(S01.done(s)).toBe(true);
    expect(S01.ranking(s)).toEqual([[TWO[0]], [TWO[1]]]);
  });
  it('CPU 同士 100 試合：必ず終わり、たいてい 8 回以内に当たる', () => {
    let solvedN = 0, sum = 0, draw = 0, first = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const r = simulate('s01', seed, pairOf(seed) as never);
      const st = r.slot.state as S01State;
      if (st.solved.some((x) => x !== null)) { solvedN++; sum += Math.min(...st.solved.filter((x): x is number => x !== null)); }
      if (r.ranking.length === 1) draw++; else if (r.ranking[0][0] === st.players[0]) first++;
    }
    console.log(`s01: solved=${solvedN}/100 avgGuesses=${(sum / solvedN).toFixed(2)} draw=${draw} firstSeatWin=${first}`);
    expect(solvedN).toBeGreaterThan(90);
  });
});

describe('S02 五目並べ', () => {
  it('5 つ並ぶと勝ち。4 つでは勝ちにならない', () => {
    const s = S02.init(TWO, Rng.from(1)) as S02State;
    for (let k = 0; k < 4; k++) { S02.submit(s, TWO[0], { t: 'put', cell: k }); S02.submit(s, TWO[1], { t: 'put', cell: 9 * 5 + k }); }
    expect(S02.done(s)).toBe(false);
    expect(S02.validate(s, TWO[0], { t: 'put', cell: 0 })).toBe(false);
    S02.submit(s, TWO[0], { t: 'put', cell: 4 });
    expect(S02.done(s)).toBe(true);
    expect(s.winner).toBe(0);
    expect(s.line.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
    // 斜め
    const b = Array(S02_N * S02_N).fill(-1);
    for (let k = 0; k < 5; k++) b[k * 10] = 1;
    expect(lineAt(b, 20, 1).length).toBe(5);
    expect(lineAt(b, 20, 0).length).toBe(0);
  });
  it('CPU 同士 100 試合：必ず終わる。先手と後手の勝ち数を記録', () => {
    let first = 0, second = 0, draw = 0, moves = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const r = simulate('s02', seed, pairOf(seed) as never);
      const st = r.slot.state as S02State;
      moves += st.count;
      if (st.winner === 0) first++; else if (st.winner === 1) second++; else draw++;
    }
    console.log(`s02: first=${first} second=${second} draw=${draw} avgMoves=${(moves / 100).toFixed(1)}`);
    expect(first + second + draw).toBe(100);
  });
});

describe('S03 ミニリバーシ', () => {
  it('挟める所にだけ置け、挟んだ石が返る。置ける時はパスできない', () => {
    const s = S03.init(TWO, Rng.from(1)) as S03State;
    const legal = legalOf(s.board, 0);
    expect(legal.length).toBe(4);
    expect(S03.validate(s, TWO[0], { t: 'pass' })).toBe(false);
    expect(S03.validate(s, TWO[0], { t: 'put', cell: 0 })).toBe(false);
    const c = legal[0];
    const fl = flipsOf(s.board, c, 0);
    S03.submit(s, TWO[0], { t: 'put', cell: c });
    expect(s.board[c]).toBe(0);
    for (const f of fl) expect(s.board[f]).toBe(0);
    expect(s.board.filter((x) => x === 0).length).toBe(4);
  });
  it('CPU 同士 100 試合：必ず終わる', () => {
    let first = 0, second = 0, draw = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const r = simulate('s03', seed, pairOf(seed) as never);
      if (r.ranking.length === 1) draw++; else if (r.ranking[0][0] === (r.slot.state as S03State).players[0]) first++; else second++;
    }
    console.log(`s03: first=${first} second=${second} draw=${draw}`);
    expect(first + second + draw).toBe(100);
  }, 60_000);
});

describe('S04 記憶カード', () => {
  it('同じ絵なら取って続ける。違えば交代。伏せたカードの絵は見えない', () => {
    const s = S04.init(TWO, Rng.from(4)) as S04State;
    const v0 = S04.view(s, TWO[0]);
    expect(JSON.stringify(v0)).not.toContain('faces');
    expect(v0.open).toEqual([]);
    const a = 0;
    const mate = s.faces.findIndex((f, i) => i !== a && f === s.faces[a]);
    const other = s.faces.findIndex((f) => f !== s.faces[a]);
    S04.submit(s, TWO[0], { t: 'flip', cell: a });
    expect(S04.validate(s, TWO[0], { t: 'flip', cell: a })).toBe(false);
    S04.submit(s, TWO[0], { t: 'flip', cell: other });
    expect(s.phase).toBe('show');
    S04.submit(s, TWO[0], { t: 'ok' }); S04.submit(s, TWO[1], { t: 'ok' });
    expect(s.turn).toBe(1);
    S04.submit(s, TWO[1], { t: 'flip', cell: a });
    S04.submit(s, TWO[1], { t: 'flip', cell: mate });
    S04.submit(s, TWO[0], { t: 'ok' }); S04.submit(s, TWO[1], { t: 'ok' });
    expect(s.pairs).toEqual([0, 1]);
    expect(s.turn).toBe(1);
    expect(S04.validate(s, TWO[1], { t: 'flip', cell: a })).toBe(false);
  });
  it('CPU 同士 100 試合：必ず終わる。記憶の高い人が勝ちやすい', () => {
    let first = 0, second = 0, draw = 0, turns = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const r = simulate('s04', seed, pairOf(seed) as never);
      const st = r.slot.state as S04State;
      turns += st.turns;
      expect(st.pairs[0] + st.pairs[1]).toBe(6);
      if (r.ranking.length === 1) draw++; else if (r.ranking[0][0] === st.players[0]) first++; else second++;
    }
    console.log(`s04: first=${first} second=${second} draw=${draw} avgTurns=${(turns / 100).toFixed(1)}`);
  });
});

describe('S05 ダイスパズル', () => {
  it('条件の判定', () => {
    expect(holds(0, [4, 4, 4, 4, 4])).toBe(true);
    expect(holds(0, [4, 4, 4, 4, 3])).toBe(false);
    expect(holds(1, [2, 5, 2, 6, 2])).toBe(true);
    expect(holds(1, [2, 5, 2, 6, 1])).toBe(false);
    expect(holds(2, [2, 3, 4, 5, 5])).toBe(true);
    expect(holds(2, [1, 2, 3, 5, 6])).toBe(false);
    const ch = chances([6, 6, 6, 1, 1]);
    expect(ch.length).toBe(32);
    expect(ch[0].p).toEqual([1, 1, 0]);
  });
  it('振り直しの出目は、出るまで見えない。条件を満たせば 3 点', () => {
    const s = S05.init(TWO, Rng.from(2)) as S05State;
    const v = S05.view(s, TWO[0]);
    expect(Object.keys(v)).not.toContain('re');
    const base = s.base[0];
    const cond = [0, 1, 2].find((c) => holds(c, base));
    S05.submit(s, TWO[0], { t: 'roll', re: [], cond: cond ?? 0 });
    S05.submit(s, TWO[1], { t: 'roll', re: [0, 1, 2, 3, 4], cond: 0 });
    expect(s.points[0]).toBe(cond === undefined ? 0 : 3);
    expect(s.log[0].picks[1].dice).toEqual(s.re[0][1]);
    expect(s.used[0][cond ?? 0]).toBe(true);
    S05.submit(s, TWO[0], { t: 'ok' }); S05.submit(s, TWO[1], { t: 'ok' });
    // 同じ条件は 2 回選べない
    expect(S05.validate(s, TWO[1], { t: 'roll', re: [], cond: 0 })).toBe(false);
    expect(S05.validate(s, TWO[1], { t: 'roll', re: [], cond: 1 })).toBe(true);
  });
  it('CPU 同士 100 試合：点の分布を記録', () => {
    const dist: Record<number, number> = {}; let draw = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const r = simulate('s05', seed, pairOf(seed) as never);
      for (const p of (r.slot.state as S05State).points) dist[p] = (dist[p] ?? 0) + 1;
      if (r.ranking.length === 1) draw++;
    }
    console.log(`s05: points=${JSON.stringify(dist)} draw=${draw}`);
  });
});

describe('S06 ミニジグソー', () => {
  it('どの並びも、決まりどおりの入れ替えで完成できる', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const s = S06.init(TWO, Rng.from(seed)) as S06State;
      expect(solved(s.perm)).toBe(false);
      const sw = solve(s.n, s.mode, s.perm);
      const r = applySwaps(s.n, s.mode, s.perm, sw);
      expect(r && solved(r)).toBe(true);
      expect(sw.length).toBeLessThan(80);
    }
  });
  it('隣どうしだけの問題で、離れた 2 枚は入れ替えられない。未完成の提出は受け付けない', () => {
    const s = S06.init(TWO, Rng.from(3), { n: 3, mode: 'adj' }) as S06State;
    expect(applySwaps(3, 'adj', s.perm, [[0, 8]])).toBeNull();
    expect(S06.validate(s, TWO[0], { t: 'solve', swaps: [], ms: 1000 })).toBe(false);
    const sw = solve(s.n, s.mode, s.perm);
    expect(S06.validate(s, TWO[0], { t: 'solve', swaps: sw, ms: 5000 })).toBe(true);
    S06.submit(s, TWO[0], { t: 'solve', swaps: sw, ms: 5000 });
    S06.submit(s, TWO[1], { t: 'giveup' });
    expect(S06.ranking(s)).toEqual([[TWO[0]], [TWO[1]]]);
  });
  it('CPU 同士 100 試合：完成の割合と時間を記録。1 人でも遊べる', () => {
    let done = 0, sum = 0, n = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const r = simulate('s06', seed, pairOf(seed) as never);
      for (const x of (r.slot.state as S06State).results) { n++; if (typeof x === 'number') { done++; sum += x; } }
    }
    console.log(`s06: solved=${done}/${n} avgSec=${(sum / done / 1000).toFixed(1)}`);
    const solo = simulate('s06', 5, [ALL_IDS[3]] as never);
    expect(S06.done(solo.slot.state)).toBe(true);
  });
});
