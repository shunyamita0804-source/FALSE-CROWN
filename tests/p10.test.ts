import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { ALL_IDS } from '../src/data/characters';
import { CENTERS, P10, applyStep, centerCount, seatAt, startPieces, stepsOf, type P10State } from '../src/matches/p10';
import { simulate } from './helpers';

// 試行の数字の書き出し先（環境に依らない一時フォルダ）
const S = (() => { const d = join(tmpdir(), 'false-crown-sim'); mkdirSync(d, { recursive: true }); return d; })();
const at = (x: number, y: number) => y * 5 + x;

describe('P10 最後の一手', () => {
  it('最初の配置：左右の端に 4 個ずつ、左右対称。中央は十字の 5 マス', () => {
    const ps = startPieces();
    expect(ps.length).toBe(8);
    for (const p of ps) expect(ps.some((q) => q.seat !== p.seat && q.pos === at(4 - (p.pos % 5), Math.floor(p.pos / 5)))).toBe(true);
    expect(CENTERS.sort((a, b) => a - b)).toEqual([at(2, 1), at(1, 2), at(2, 2), at(3, 2), at(2, 3)].sort((a, b) => a - b));
    expect(stepsOf(ps, 0).length).toBe(6);
  });

  it('飛び越し：隣の敵の先が空いていれば取れる。先がふさがっている時、盤面の外の時は取れない', () => {
    const ps = [{ seat: 0, pos: at(1, 2) }, { seat: 1, pos: at(2, 2) }, { seat: 1, pos: at(1, 1) }, { seat: 1, pos: at(1, 0) }, { seat: 1, pos: at(0, 2) }];
    const st = stepsOf(ps, 0);
    expect(st).toContainEqual({ from: at(1, 2), to: at(3, 2), cap: at(2, 2) });
    expect(st.some((s) => s.cap === at(1, 1))).toBe(false);
    expect(st.some((s) => s.cap === at(0, 2))).toBe(false);
    expect(st).toContainEqual({ from: at(1, 2), to: at(1, 3) });
    const after = applyStep(ps, 0, st.find((s) => s.cap !== undefined)!);
    expect(after.length).toBe(4);
    expect(centerCount(after, 0)).toBe(1);
  });

  it('巡の終わりに中央の点が入る。2 ゲーム目は先手が入れ替わる。時間切れはパス', () => {
    const s = P10.init(ALL_IDS.slice(0, 2), Rng.from(1)) as P10State;
    const [a, b] = s.players;
    expect(P10.pending(s)).toEqual([a]);
    s.pieces = [{ seat: 0, pos: at(1, 1) }, { seat: 1, pos: at(3, 2) }, { seat: 1, pos: at(4, 4) }];
    P10.submit(s, a, { t: 'move', from: at(1, 1), to: at(1, 2) });
    expect(s.points).toEqual([0, 0]);
    expect(P10.defaultMove(s, b)).toEqual({ t: 'pass' });
    P10.submit(s, b, { t: 'pass' });
    expect(s.points).toEqual([1, 1]);
    expect(s.round).toBe(1);
    // 飛び越して取る：3 点
    P10.submit(s, a, { t: 'move', from: at(1, 2), to: at(2, 2) });
    P10.submit(s, b, { t: 'move', from: at(3, 2), to: at(1, 2) });
    expect(s.points).toEqual([1, 5]);
    expect(s.remain).toEqual([0, 2]);
    expect(s.phase).toBe('break');
    expect(s.game).toBe(1);
    expect(seatAt(1, 0)).toBe(1);
    P10.submit(s, a, { t: 'ready' });
    P10.submit(s, b, { t: 'ready' });
    expect(P10.pending(s)).toEqual([b]);
    expect(s.pieces.length).toBe(8);
  });

  it('CPU だけで最後まで進む。席による偏りが大きくない', () => {
    const N = 40;
    const win = [0, 0];
    const sum = [0, 0];
    let caps = 0;
    const firstAdv = [0, 0];
    const lines: string[] = [];
    for (let seed = 1; seed <= N; seed++) {
      const ps = [ALL_IDS[seed % 12], ALL_IDS[(seed + 5) % 12]];
      const r = simulate('p10', seed, ps);
      const st = r.slot.state as P10State;
      expect(P10.done(st)).toBe(true);
      st.points.forEach((x, i) => { sum[i] += x; });
      win[ps.indexOf(r.ranking[0][0])] += 1 / r.ranking[0].length;
      caps += st.caps[0] + st.caps[1];
      firstAdv[0] += st.gamePts[0][0] + st.gamePts[1][1];
      firstAdv[1] += st.gamePts[0][1] + st.gamePts[1][0];
      if (seed <= 12) lines.push(`${st.points.join(' ')} | g1 ${st.gamePts[0].join('-')} g2 ${st.gamePts[1].join('-')} caps ${st.caps.join('')} remain ${st.remain.join('')}`);
    }
    writeFileSync(`${S}/p10-sim.txt`, `caps ${(caps / N).toFixed(2)} seat avg ${sum.map((x) => (x / N).toFixed(1)).join(' ')} wins ${win.join(' ')}\nfirst mover total ${firstAdv[0]} second ${firstAdv[1]}\n${lines.join('\n')}`);
    expect(Math.min(...win)).toBeGreaterThan(N * 0.25);
  }, 60_000);
});
