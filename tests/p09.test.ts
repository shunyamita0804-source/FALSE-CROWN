import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { ALL_IDS } from '../src/data/characters';
import { P09, P09_PRACTICE, ROUNDS, expected, hintFor, makeMirror, mirrorCell, mirrorTile, scoreOf, sideOf, type Axis, type P09State, type Tile } from '../src/matches/p09';
import { simulate } from './helpers';

const S = '/tmp/claude-0/-home-claude/ced3d2db-bac9-5d25-8782-91ee7ff6cc58/scratchpad';

describe('P09 鏡の決闘', () => {
  it('折り返し：2 回映すと元に戻る。表示側は作る側に、軸の上は軸の上に映る。矢印の向きも映る', () => {
    for (const n of [5, 6, 7]) for (const axis of ['v', 'h', 'd', 'a'] as Axis[]) {
      let src = 0;
      let dst = 0;
      for (let c = 0; c < n * n; c++) {
        const m = mirrorCell(n, axis, c);
        expect(mirrorCell(n, axis, m)).toBe(c);
        const s = sideOf(n, axis, c);
        expect(sideOf(n, axis, m)).toBe(s === 'src' ? 'dst' : s === 'dst' ? 'src' : 'axis');
        if (s === 'src') src++;
        if (s === 'dst') dst++;
      }
      expect(src).toBe(dst);
      for (const t of ['b', 'u', 'r', 'd', 'l'] as Tile[]) expect(mirrorTile(axis, mirrorTile(axis, t))).toBe(t);
    }
    expect(mirrorTile('v', 'r')).toBe('l');
    expect(mirrorTile('v', 'u')).toBe('u');
    expect(mirrorTile('h', 'u')).toBe('d');
    expect(mirrorTile('d', 'u')).toBe('l');
    expect(mirrorTile('a', 'u')).toBe('r');
    // 5×5、縦の軸：左上の角は右上の角に映る
    expect(mirrorCell(5, 'v', 0)).toBe(4);
    expect(mirrorCell(7, 'd', 7)).toBe(1);
  });

  it('採点：完全に一致で 20 ＋ 時間、そうでなければ合っている割合 × 8 から余分を引く', () => {
    const m = P09_PRACTICE;
    const exp = expected(m);
    expect(Object.keys(exp).length).toBe(4);
    expect(exp[4]).toBe('b');
    expect(exp[8]).toBe('l');
    expect(scoreOf(m, exp, 0).points).toBe(25);
    expect(scoreOf(m, exp, 45_000).points).toBe(23);
    const half: Record<number, Tile> = { 4: 'b', 8: 'r' };
    expect(scoreOf(m, half, 1000)).toMatchObject({ perfect: false, correct: 1, extra: 0, points: 2 });
    expect(scoreOf(m, { ...exp, 9: 'b' }, 1000)).toMatchObject({ perfect: false, correct: 4, extra: 1, points: 7 });
    expect(scoreOf(m, { 9: 'b', 14: 'b' }, 1000).points).toBe(0);
    expect(hintFor(m, half)).toEqual({ cell: 8, tile: 'l' });
    expect(hintFor(m, exp)).toBeNull();
    expect(hintFor(m, { ...exp, 9: 'b' })).toEqual({ cell: 9, tile: null });
  });

  it('問題：形は表示側だけにあり、後半の 2 ラウンドだけ斜めの軸。矢印のあるラウンドには矢印が 2 個以上', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const rng = Rng.from(seed);
      for (let r = 0; r < ROUNDS; r++) {
        const m = makeMirror(rng, r);
        for (const c of Object.keys(m.src)) expect(sideOf(m.n, m.axis, Number(c))).toBe('src');
        expect(m.axis === 'd' || m.axis === 'a').toBe(r >= 4);
        const arrows = Object.values(m.src).filter((t) => t !== 'b').length;
        if (r === 0) expect(arrows).toBe(0); else expect(arrows).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('全員が答えると採点して次へ進む。作る側以外のマスに置いた答えは受け付けない', () => {
    const s = P09.init(ALL_IDS.slice(0, 2), Rng.from(2)) as P09State;
    const [a, b] = s.players;
    const exp = expected(s.mirrors[0]);
    expect(P09.validate(s, a, { t: 'answer', grid: { [Number(Object.keys(s.mirrors[0].src)[0])]: 'b' }, ms: 100 })).toBe(false);
    P09.submit(s, a, { t: 'answer', grid: exp, ms: 18_000 });
    P09.submit(s, b, { t: 'answer', grid: {}, ms: 90_000 });
    expect(s.round).toBe(1);
    expect(s.results[a][0].points).toBe(24);
    expect(s.results[b][0].points).toBe(0);
    expect(P09.ranking(s)[0]).toEqual([a]);
  });

  it('CPU だけで最後まで進む', () => {
    const N = 60;
    let perfect = 0;
    let n = 0;
    const per = new Array<number>(ROUNDS).fill(0);
    const totals: number[] = [];
    for (let seed = 1; seed <= N; seed++) {
      const ps = [ALL_IDS[seed % 12], ALL_IDS[(seed + 5) % 12]];
      const r = simulate('p09', seed, ps);
      const st = r.slot.state as P09State;
      expect(P09.done(st)).toBe(true);
      for (const p of ps) { st.results[p].forEach((x, i) => { if (x.perfect) { perfect++; per[i]++; } n++; }); totals.push(r.scores[p]!); }
    }
    writeFileSync(`${S}/p09-sim.txt`, `perfect ${(perfect / n).toFixed(2)} per round ${per.map((x) => (x / (N * 2)).toFixed(2)).join(' ')}\ntotals ${totals.slice(0, 30).join(' ')}`);
    expect(perfect / n).toBeGreaterThan(0.5);
    expect(perfect / n).toBeLessThan(0.92);
  });
});
