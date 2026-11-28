import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { ALL_IDS } from '../src/data/characters';
import { cellAt, rot60 } from '../src/matches/hex';
import { G, P07, countOf, flipsFor, isCenter, isCorner, legalFor, orderAt, startBoard, type P07State } from '../src/matches/p07';
import { simulate } from './helpers';

const THREE = ALL_IDS.slice(0, 3);
// 試行の数字の書き出し先（環境に依らない一時フォルダ）
const S = (() => { const d = join(tmpdir(), 'false-crown-sim'); mkdirSync(d, { recursive: true }); return d; })();
const at = (q: number, r: number) => cellAt(G, q, r);

describe('P07 ブラック＆ホワイト', () => {
  it('盤面は 37 マス。最初の配置は 3 色 3 個ずつで、120 度回すと色が 1 つずつ入れ替わるだけ', () => {
    expect(G.cells.length).toBe(37);
    expect(G.cells.filter((_, c) => isCenter(c)).length).toBe(6);
    expect(G.cells.filter((_, c) => isCorner(c)).length).toBe(6);
    const b = startBoard(3);
    for (let s = 0; s < 3; s++) expect(countOf(b, s)).toBe(3);
    G.cells.forEach(([q, r], c) => {
      const [a, bb] = rot60(q, r, 2);
      const to = at(a, bb);
      expect(b[to]).toBe(b[c] < 0 ? b[c] : (b[c] + 1) % 3);
    });
    // 最初の手番で、全員に同じ数の返せる場所がある
    const n = [0, 1, 2].map((s) => legalFor(b, s));
    expect(n.every((x) => x.kind === 'flip')).toBe(true);
    expect(new Set(n.map((x) => x.cells.length)).size).toBe(1);
    const b2 = startBoard(2);
    expect(countOf(b2, 0)).toBe(3);
    expect(countOf(b2, 1)).toBe(3);
  });

  it('挟んだ駒は、色が混ざっていても全部返る。間に空きマスがあると返らない', () => {
    const b = new Array<number>(37).fill(-1);
    b[at(-1, 0)] = 0; b[at(0, 0)] = 1; b[at(1, 0)] = 2;
    expect(flipsFor(b, 0, at(2, 0)).sort()).toEqual([at(0, 0), at(1, 0)].sort());
    expect(flipsFor(b, 1, at(2, 0))).toEqual([at(1, 0)]);
    expect(flipsFor(b, 2, at(-2, 0))).toEqual([at(-1, 0), at(0, 0)]);
    b[at(0, 0)] = -1;
    expect(flipsFor(b, 0, at(2, 0))).toEqual([]);
    expect(flipsFor(b, 0, at(1, 0))).toEqual([]);
  });

  it('返せる場所がある時は、そこにしか置けない。無い時は自分の駒の隣に置ける。どちらも無ければパス', () => {
    const s = P07.init(THREE, Rng.from(1)) as P07State;
    const [a, b] = s.players;
    const lg = legalFor(s.board, 0);
    expect(lg.kind).toBe('flip');
    const free = G.adj[s.board.indexOf(0)].find((c) => s.board[c] < 0 && !lg.cells.includes(c));
    if (free !== undefined) expect(P07.validate(s, a, { t: 'put', cell: free })).toBe(false);
    expect(P07.validate(s, a, { t: 'pass' })).toBe(false);
    expect(P07.validate(s, b, { t: 'put', cell: lg.cells[0] })).toBe(false);
    const before = countOf(s.board, 0);
    const n = flipsFor(s.board, 0, lg.cells[0]).length;
    P07.submit(s, a, { t: 'put', cell: lg.cells[0] });
    expect(countOf(s.board, 0)).toBe(before + 1 + n);
    expect(P07.view(s, a).toMove).toBe(b);
    const e = new Array<number>(37).fill(-1);
    e[at(0, 0)] = 0;
    expect(legalFor(e, 0).kind).toBe('free');
    expect(legalFor(e, 0).cells.length).toBe(6);
    expect(legalFor(e, 1).kind).toBe('pass');
    expect(orderAt(s.players, 1)[0]).toBe(b);
  });

  it('CPU だけで最後まで進む。色による有利不利が大きくない', () => {
    const seatSum = [0, 0, 0];
    const seatWin = [0, 0, 0];
    const seatLast = [0, 0, 0];
    let rounds = 0;
    let filled = 0;
    const rows: string[] = [];
    const N = 150;
    for (let seed = 1; seed <= N; seed++) {
      const order = Rng.from(seed).shuffle([...ALL_IDS.slice(seed % 9, (seed % 9) + 3)]);
      const r = simulate('p07', seed, order);
      const st = r.slot.state as P07State;
      expect(P07.done(st)).toBe(true);
      rounds += st.round;
      filled += st.board.filter((o) => o >= 0).length;
      st.players.forEach((p, i) => { seatSum[i] += r.scores[p]!; if (r.ranking[0].includes(p)) seatWin[i]++; if (r.ranking[r.ranking.length - 1].includes(p)) seatLast[i]++; });
      rows.push(st.players.map((p) => `${p.slice(4, 8)}=${r.scores[p]}`).join(' '));
    }
    writeFileSync(`${S}/p07-sim.txt`, `rounds ${rounds / N} filled ${filled / N}\nseat avg ${seatSum.map((x) => (x / N).toFixed(1)).join(' ')}\nseat wins ${seatWin.join(' ')} last ${seatLast.join(' ')}\n${rows.slice(0, 14).join('\n')}`);
    expect(Math.max(...seatSum) / Math.min(...seatSum)).toBeLessThan(1.35);
  });
});
