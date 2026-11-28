import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { ALL_IDS } from '../src/data/characters';
import { ADJ, FLAGS, GEM_NODES, HOME, M10, actsOf, applyAct, endBonus, exposed, startBoard, type M10State } from '../src/matches/m10';
import { simulate } from './helpers';

// 試行の数字の書き出し先（環境に依らない一時フォルダ）
const S = (() => { const d = join(tmpdir(), 'false-crown-sim'); mkdirSync(d, { recursive: true }); return d; })();
const THREE = ALL_IDS.slice(0, 3);

describe('M10 トライアングル', () => {
  it('盤面：15 点。頂点の隣は 2 点、内側の 3 点は 6 点とつながる。3 席は回しても同じ形', () => {
    expect(ADJ.length).toBe(15);
    for (const f of FLAGS) expect(ADJ[f].length).toBe(2);
    for (const g of GEM_NODES) expect(ADJ[g].length).toBe(6);
    for (let a = 0; a < 15; a++) for (const b of ADJ[a]) expect(ADJ[b]).toContain(a);
    // どの席の兵も、自分に近い宝石の点と隣り合う。宝石の 3 点は互いに隣り合う
    HOME.forEach((h, s) => { for (const n of h) expect(ADJ[n]).toContain(GEM_NODES[s]); });
    expect(ADJ[GEM_NODES[0]]).toEqual(expect.arrayContaining([GEM_NODES[1], GEM_NODES[2]]));
    const b = startBoard([0, 1, 2]);
    expect(b.soldiers.length).toBe(6);
    expect(new Set([...b.soldiers.map((s) => s.pos), ...b.ground.map((g) => g.node), ...FLAGS]).size).toBe(12);
  });

  it('宝石を持つ、納める、置き直す。旗の点と味方の点には入れない', () => {
    let b = startBoard([0, 1, 2]);
    expect(actsOf(b, 0).some((a) => a.t === 'move' && a.to === 0)).toBe(false);
    expect(actsOf(b, 0).some((a) => a.t === 'move' && a.from === 1 && a.to === 2)).toBe(false);
    let r = applyAct(b, 0, { t: 'move', from: 1, to: 4 });
    expect(r.fx.pick).toBe(true);
    b = r.board;
    expect(b.soldiers.find((s) => s.pos === 4)!.gem).toBe(0);
    expect(actsOf(b, 0).some((a) => a.t === 'deliver')).toBe(false);
    b = applyAct(b, 0, { t: 'move', from: 4, to: 1 }).board;
    r = applyAct(b, 0, { t: 'deliver', from: 1 });
    expect(r.fx.points).toBe(4);
    // 元の点が空いているので、すぐ置き直される
    expect(r.board.ground.some((g) => g.node === 4 && g.id === 0)).toBe(true);
    expect(r.board.delivered[0]).toBe(1);
    // 3 回納めたら置き直さない
    const last = applyAct({ ...b, delivered: [2, 0, 0] }, 0, { t: 'deliver', from: 1 });
    expect(last.board.ground.some((g) => g.id === 0)).toBe(false);
    expect(last.board.waiting.length).toBe(0);
  });

  it('取る：1 点。持っていた宝石は落ち、取った兵が持っていなければ拾う。終了時の加点', () => {
    const b = { soldiers: [{ seat: 0, pos: 4, gem: 0 }, { seat: 1, pos: 7, gem: -1 }, { seat: 1, pos: 6, gem: 1 }], ground: [], waiting: [], delivered: [0, 0, 0] };
    const r = applyAct(b, 1, { t: 'move', from: 7, to: 4 });
    expect(r.fx).toMatchObject({ points: 1, cap: 0, capGem: true, pick: true });
    expect(r.board.soldiers.length).toBe(2);
    expect(r.board.soldiers.find((s) => s.pos === 4)).toMatchObject({ seat: 1, gem: 0 });
    // 席 1：宝石 2 個を持ち、1 個は旗の隣（6）にいる
    // 宝石 2 個 × 1 点 ＋ 旗の隣の兵 1 個 × 2 点（2026-11-28 本人の指示で 2 点）
    expect(endBonus(r.board, 1)).toBe(4);
    expect(endBonus(r.board, 0)).toBe(0);
  });

  it('手番：先手は巡ごとに交代し、兵のいない人は飛ばす', () => {
    const s = M10.init(THREE, Rng.from(1)) as M10State;
    expect(M10.pending(s)).toEqual([THREE[0]]);
    for (const p of THREE) M10.submit(s, p, M10.defaultMove(s, p));
    expect(s.round).toBe(1);
    expect(M10.pending(s)).toEqual([THREE[1]]);
    s.board.soldiers = s.board.soldiers.filter((q) => q.seat !== 2);
    M10.submit(s, THREE[1], M10.defaultMove(s, THREE[1]));
    expect(M10.pending(s)).toEqual([THREE[0]]);
    M10.submit(s, THREE[0], M10.defaultMove(s, THREE[0]));
    expect(s.round).toBe(2);
  });

  it('CPU だけで最後まで進む。席による偏りが大きくない', () => {
    const N = 240;
    const first = [0, 0, 0];
    const sum = [0, 0, 0];
    let caps = 0, dels = 0, left = 0;
    const lines: string[] = [];
    for (let seed = 1; seed <= N; seed++) {
      const ps = [0, 1, 2].map((k) => ALL_IDS[(seed * 5 + k * 3) % 12]);
      const r = simulate('m10', seed, ps);
      const st = r.slot.state as M10State;
      expect(M10.done(st)).toBe(true);
      ps.forEach((p, i) => { sum[i] += r.scores[p]!; });
      first[ps.indexOf(r.ranking[0][0])] += 1 / r.ranking[0].length;
      caps += st.caps.reduce((a, b) => a + b, 0);
      dels += st.delivers.reduce((a, b) => a + b, 0);
      left += st.board.soldiers.length;
      if (seed <= 12) lines.push(`${ps.map((p) => r.scores[p]).join(' ')} | del ${st.delivers.join('')} cap ${st.caps.join('')} left ${st.board.soldiers.length} r${st.round}`);
    }
    writeFileSync(`${S}/m10-sim.txt`, `caps ${(caps / N).toFixed(2)} delivers ${(dels / N).toFixed(2)} soldiers left ${(left / N).toFixed(2)}\nseat avg ${sum.map((x) => (x / N).toFixed(1)).join(' ')}\nfirst ${first.map((x) => x.toFixed(1)).join(' ')}\n${lines.join('\n')}`);
    expect(Math.min(...first)).toBeGreaterThan(N * 0.22);
    expect(caps / N).toBeGreaterThan(0.8);
    expect(dels / N).toBeGreaterThan(3);
  }, 60_000);
});

describe('M10 次に取られうる兵の表示', () => {
  it('隣に敵の兵がいる自分の兵だけを示す。まだ取れない巡なら示さない', () => {
    const b = { soldiers: [{ seat: 0, pos: 4, gem: -1 }, { seat: 0, pos: 1, gem: -1 }, { seat: 1, pos: 7, gem: -1 }], ground: [], waiting: [], delivered: [0, 0, 0] };
    expect(ADJ[4]).toContain(7);
    expect(ADJ[1]).not.toContain(7);
    expect(exposed(b, 0, true)).toEqual([4]);
    expect(exposed(b, 1, true)).toEqual([7]);
    expect(exposed(b, 0, false)).toEqual([]);
  });
});
