/**
 * M04・M06・M07 の人数の小調整（本人の承認 2026-11-28）。上限を外すだけでなく、配り方、盤、手番、時間を人数ごとに確かめる。
 * 成り立たない人数は、抽選の候補（src/data/lineup.json）に入れない。結果は docs/lineup.md に記録する。
 */
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { engineOf, newSlot, stepNpcs } from '../src/core/runner';
import { Rng } from '../src/core/rng';
import { ALL_IDS, type CharId } from '../src/data/characters';
import { tableSizes, type M04State } from '../src/matches/m04';
import { HAND, FIELD, type M06State } from '../src/matches/m06';
import { G as HEX, START_TILES, areaOf, type M07State } from '../src/matches/m07';
import { MAIN_POOL } from '../src/core/lineup';
import { freshState } from './helpers';

interface Sim { n: number; wins: number[]; pts: number[]; ms: number; turns: number; extra: number }

/** CPU だけで最後まで進め、席ごとの 1 位の数と平均点、制限時間の合計（最長の時間）、手番の数を数える */
function sim(id: string, n: number, N: number, extra: (st: unknown) => number = () => 0): Sim {
  const eng = engineOf(id);
  const out: Sim = { n, wins: new Array(n).fill(0), pts: new Array(n).fill(0), ms: 0, turns: 0, extra: 0 };
  for (let seed = 1; seed <= N; seed++) {
    const state = freshState(seed);
    const ps = Rng.from(seed * 7 + n).shuffle([...ALL_IDS]).slice(0, n) as CharId[];
    const slot = newSlot(state, id, ps, 'free');
    // 手を出すたびに、その時の区切り（ラベルと手番の人）を記録し、新しい区切りの制限時間を足す
    let last = '';
    const orig = eng.submit;
    eng.submit = (st, p, m) => {
      const stg = eng.stage(st);
      const key = `${stg.label}|${eng.pending(st).join(',')}`;
      if (key !== last) { out.ms += stg.time ?? 0; out.turns++; last = key; }
      return orig.call(eng, st, p, m);
    };
    try {
      for (let g = 0; g < 100000 && !eng.done(slot.state); g++) if (!stepNpcs(state, slot, { includeHero: true })) break;
    } finally { eng.submit = orig; }
    expect(eng.done(slot.state)).toBe(true);
    const sc = eng.scores(slot.state);
    const rk = eng.ranking(slot.state);
    // 席は、エンジンが内部で決めた順（players の並び）で数える
    const seatsOf = (slot.state as { players: CharId[] }).players;
    seatsOf.forEach((p, i) => { out.pts[i] += sc[p] ?? 0; if (rk[0].includes(p)) out.wins[i] += 1 / rk[0].length; });
    out.extra += extra(slot.state);
  }
  out.ms /= N; out.turns /= N; out.extra /= N;
  out.pts = out.pts.map((x) => x / N);
  return out;
}

const line = (id: string, r: Sim, N: number, note = '') =>
  `${id} ${r.n} 人：制限時間の合計 ${(r.ms / 60000).toFixed(1)} 分（同時に進む手番も足すので多め。人数どうしの比較用）、区切り ${r.turns.toFixed(0)}、席ごとの 1 位 ${r.wins.map((w) => `${Math.round((w / N) * 100)}%`).join(' ')}、平均点 ${r.pts.map((x) => x.toFixed(1)).join(' ')}${note}`;

const report: string[] = [];
const flush = (x: string) => { report.push(x); writeFileSync(`${tmpdir()}/expand-sim.txt`, report.join('\n')); };
const N = 150;

describe('人数の小調整（M04・M06・M07）', () => {
  it('M04：3 人卓に分ける。3 の倍数（3・6・9・12）だけが全卓 3 人。それ以外は 2 人卓ができるので候補にしない', () => {
    for (const n of [3, 6, 9, 12]) expect(tableSizes(n).every((x) => x === 3)).toBe(true);
    for (const n of [4, 5, 7, 8, 10, 11]) expect(tableSizes(n).some((x) => x < 3)).toBe(true);
    let base = 0;
    for (const n of [9, 6]) {
      const r = sim('m04', n, N, (st) => (st as M04State).tables.length);
      if (n === 9) base = r.ms;
      flush(line('M04', r, N, `、卓 ${r.extra}`));
      // 卓の中の席（1〜3 番）で見た偏り：卓ごとに席 0,1,2 が並ぶ
      const bySeat = [0, 1, 2].map((k) => r.pts.filter((_, i) => i % 3 === k).reduce((a, b) => a + b, 0));
      expect(Math.max(...bySeat) / Math.min(...bySeat)).toBeLessThan(1.35);
      // 卓は同時に進むので、6 人（2 卓）でも 9 人（3 卓）より長くならない
      expect(r.ms).toBeLessThanOrEqual(base * 1.05);
    }
    expect(MAIN_POOL.pool.find((e) => e.id === 'm04')!.players.every((n) => n % 3 === 0)).toBe(true);
  }, 120_000);

  it('M06：手札 5 枚と場 5 枚は人数で変えない。5〜7 人は山札が残り、席の偏りも小さい。4 人は先に交換する席が偏る（6 ラウンドを 4 人で回すと、2 回先手の席ができる）ので候補にしない', () => {
    let base = 0;
    for (const n of [7, 6, 5, 4]) {
      expect(52 - HAND * n - FIELD).toBeGreaterThanOrEqual(12);
      const r = sim('m06', n, N, (st) => (st as M06State).deck.length);
      if (n === 7) base = r.ms;
      flush(line('M06', r, N, `、終わりの山札 ${r.extra.toFixed(1)} 枚`));
      expect(Math.max(...r.pts) / Math.min(...r.pts)).toBeLessThan(1.35);
      // 交換は 1 人ずつなので、人数が少ないほど短い
      expect(r.ms).toBeLessThanOrEqual(base);
      const share = r.wins.map((w) => w / N);
      if (n === 4) expect(Math.max(...share)).toBeGreaterThan(0.3);
      else expect(Math.max(...share)).toBeLessThan(1.6 / n);
    }
    expect(MAIN_POOL.pool.find((e) => e.id === 'm06')!.players).not.toContain(4);
  }, 120_000);

  it('M07：3 人は開始点を 1 つおき（対称）。盤は 61 マスで、3 人でも全員のタイルは入りきらない（取り合いが残る）。4・5 人は対称にならないので候補にしない', () => {
    const area = START_TILES.reduce((n, x) => n + areaOf(x), 0);
    expect(3 * area + 3).toBeGreaterThan(HEX.cells.length);
    let base = 0;
    for (const n of [6, 3]) {
      const r = sim('m07', n, N, (st) => (st as M07State).owner.filter((o) => o >= 0).length);
      if (n === 6) base = r.ms;
      flush(line('M07', r, N, `、埋まったマス ${r.extra.toFixed(0)} / ${HEX.cells.length}`));
      expect(Math.max(...r.pts) / Math.min(...r.pts)).toBeLessThan(1.5);
      expect(r.ms).toBeLessThanOrEqual(base);
    }
    expect(MAIN_POOL.pool.find((e) => e.id === 'm07')!.players.every((n) => n === 3 || n === 6)).toBe(true);
  }, 120_000);
});
