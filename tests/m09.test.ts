import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { ALL_IDS } from '../src/data/characters';
import { CENTER, M09, attackedBy, legalMoves, movesOf, startPieces, type M09State } from '../src/matches/m09';
import { simulate } from './helpers';

const FOUR = ALL_IDS.slice(0, 4);
const S = '/tmp/claude-0/-home-claude/ced3d2db-bac9-5d25-8782-91ee7ff6cc58/scratchpad';
const at = (x: number, y: number) => y * 7 + x;

describe('M09 四王の戦場・改', () => {
  it('最初の配置：四隅に王 1 と兵 3。90 度回すと隣の席に重なる', () => {
    const ps = startPieces([0, 1, 2, 3]);
    expect(ps.length).toBe(16);
    expect(ps.filter((p) => p.king).map((p) => p.pos).sort((a, b) => a - b)).toEqual([at(0, 0), at(6, 0), at(0, 6), at(6, 6)].sort((a, b) => a - b));
    const rot = (c: number) => { const x = c % 7; const y = Math.floor(c / 7); return at(6 - y, x); };
    for (const p of ps) expect(ps.some((q) => q.seat === (p.seat + 1) % 4 && q.king === p.king && q.pos === rot(p.pos))).toBe(true);
    expect(new Set(ps.map((p) => p.pos)).size).toBe(16);
  });

  it('王は 8 方向、兵は縦横に 1 マス。味方のマスには動けず、敵のマスへ動くと取る', () => {
    const s = M09.init(FOUR, Rng.from(1)) as M09State;
    const king = s.pieces.find((p) => p.seat === 0 && p.king)!;
    expect(movesOf(s.pieces, king)).toEqual([]); // 味方に囲まれている
    const sol = s.pieces.find((p) => p.seat === 0 && p.pos === at(1, 1))!;
    expect(movesOf(s.pieces, sol).sort((a, b) => a - b)).toEqual([at(2, 1), at(1, 2)].sort((a, b) => a - b));
    expect(M09.validate(s, FOUR[0], { t: 'move', from: at(1, 1), to: at(2, 2) })).toBe(false);
    expect(M09.validate(s, FOUR[1], { t: 'move', from: at(5, 1), to: at(4, 1) })).toBe(false);
    expect(M09.validate(s, FOUR[0], { t: 'pass' })).toBe(false);
    // 取る
    s.pieces.find((p) => p.seat === 1 && p.pos === at(5, 1))!.pos = at(2, 1);
    expect(attackedBy(s.pieces, at(2, 1), 1).length).toBe(1);
    M09.submit(s, FOUR[0], { t: 'move', from: at(1, 1), to: at(2, 1) });
    expect(s.points[0]).toBe(1);
    expect(s.captures[0]).toBe(1);
    expect(s.pieces.filter((p) => p.seat === 1).length).toBe(3);
    expect(M09.view(s, FOUR[0]).toMove).toBe(FOUR[1]);
  });

  it('巡の終わりに中央にいる駒の持ち主に 2 点。王を取ると 5 点、終了時に王が残っていれば 5 点', () => {
    const s = M09.init(FOUR, Rng.from(1)) as M09State;
    s.pieces.find((p) => p.seat === 0 && p.pos === at(1, 1))!.pos = at(3, 2);
    M09.submit(s, FOUR[0], { t: 'move', from: at(3, 2), to: CENTER });
    for (const p of FOUR.slice(1)) { const seat = s.seats[s.players.indexOf(p)]; const m = legalMoves(s.pieces, seat).find((x) => x.to !== CENTER)!; M09.submit(s, p, { t: 'move', ...m }); }
    expect(s.round).toBe(1);
    expect(s.points[0]).toBe(2);
    expect(s.order[0]).toBe(FOUR[1]);
    // 王を取る
    s.pieces.find((p) => p.seat === 0 && p.king)!.pos = at(5, 2);
    s.pieces.find((p) => p.seat === 1 && p.pos === at(5, 1)) ?? s.pieces.filter((p) => p.seat === 1 && !p.king)[0];
    const taker = s.pieces.filter((p) => p.seat === 1 && !p.king)[0];
    taker.pos = at(5, 3);
    M09.submit(s, FOUR[1], { t: 'move', from: at(5, 3), to: at(5, 2) });
    expect(s.points[1]).toBe(5);
    s.phase = 'done';
    const sc = M09.scores(s);
    expect(sc[FOUR[1]]).toBe(10);
    expect(sc[FOUR[0]]).toBe(2);
  });

  it('CPU だけで最後まで進む。席による有利不利が大きくない', () => {
    const N = 120;
    const first = [0, 0, 0, 0];
    const sum = [0, 0, 0, 0];
    let rounds = 0;
    let kings = 0;
    let caps = 0;
    let center = 0;
    const rows: string[] = [];
    for (let seed = 1; seed <= N; seed++) {
      const order = Rng.from(seed).shuffle([...ALL_IDS.slice(seed % 9, (seed % 9) + 4)]);
      const r = simulate('m09', seed, order);
      const st = r.slot.state as M09State;
      expect(M09.done(st)).toBe(true);
      rounds += st.round;
      kings += st.pieces.filter((p) => p.king).length;
      caps += st.captures.reduce((a, b) => a + b, 0);
      center += st.log.filter((l) => l.kind === 'center').length;
      order.forEach((p, i) => { sum[i] += r.scores[p]!; if (r.ranking[0].includes(p)) first[i]++; });
      rows.push(order.map((p) => r.scores[p]).join(' ') + ` | pieces ${[0, 1, 2, 3].map((x) => st.pieces.filter((p) => p.seat === x).length).join('')} r${st.round}`);
    }
    writeFileSync(`${S}/m09-sim.txt`, `rounds ${rounds / N} kings alive ${kings / N} captures ${caps / N} center awards ${center / N}\nseat avg ${sum.map((x) => (x / N).toFixed(1)).join(' ')}\nfirst ${first.join(' ')}\n${rows.slice(0, 16).join('\n')}`);
    expect(Math.max(...sum) / Math.min(...sum)).toBeLessThan(1.4);
  });
});
