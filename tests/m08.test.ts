import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { ALL_IDS } from '../src/data/characters';
import { ADJ, EDGES, M08, NODES, distTo, edgeBetween, goalNode, movesFor, nodeOf, orderAt, startNode, wallOk, type M08State } from '../src/matches/m08';
import { simulate } from './helpers';

const FIVE = ALL_IDS.slice(0, 5);
// 試行の数字の書き出し先（環境に依らない一時フォルダ）
const S = (() => { const d = join(tmpdir(), 'false-crown-sim'); mkdirSync(d, { recursive: true }); return d; })();

describe('M08 バリケード', () => {
  it('盤面：31 点、60 本の道。72 度回すと隣の席に重なり、全員のゴールまでの距離が同じ', () => {
    expect(NODES).toBe(31);
    expect(EDGES.length).toBe(60);
    expect(new Set(EDGES.map(([a, b]) => `${a}-${b}`)).size).toBe(60);
    expect(ADJ[0].length).toBe(10);
    expect(ADJ[nodeOf(3, 0)].length).toBe(3);
    expect(ADJ[nodeOf(2, 0)].length).toBe(4);
    const none = new Array<boolean>(60).fill(false);
    const d = [0, 1, 2, 3, 4].map((s) => distTo(none, startNode(s), goalNode(s)));
    expect(new Set(d).size).toBe(1);
    expect(d[0]).toBe(5);
    const all = [0, 1, 2, 3, 4].flatMap((s) => [startNode(s), goalNode(s)]);
    expect(new Set(all).size).toBe(10);
  });

  it('動けるのは、隣で、壁が無く、人がいない点だけ。壁は、誰かの道を完全にふさぐ時は置けない', () => {
    const s = M08.init(FIVE, Rng.from(1)) as M08State;
    const [a, b] = FIVE;
    const from = startNode(0);
    expect(movesFor(s, 0).sort()).toEqual([nodeOf(3, 1), nodeOf(3, 9), nodeOf(2, 0)].sort());
    expect(M08.validate(s, a, { t: 'move', to: 0 })).toBe(false);
    expect(M08.validate(s, b, { t: 'move', to: nodeOf(3, 3) })).toBe(false);
    expect(M08.validate(s, a, { t: 'pass' })).toBe(false);
    // 開始点から出る 3 本のうち 2 本はふさげるが、3 本目は置けない
    const e = [nodeOf(3, 1), nodeOf(3, 9), nodeOf(2, 0)].map((n) => edgeBetween(from, n));
    M08.submit(s, a, { t: 'wall', edge: e[0] });
    expect(s.wallsLeft[0]).toBe(2);
    expect(movesFor(s, 0)).not.toContain(nodeOf(3, 1));
    s.walls[e[1]] = true;
    expect(wallOk(s, e[2])).toBe(false);
    expect(wallOk(s, e[0])).toBe(false);
    expect(M08.view(s, a).toMove).toBe(b);
    // 人がいる点には入れないが、飛び越えた先には進める
    s.pos[2] = nodeOf(3, 3);
    expect(movesFor(s, 1)).not.toContain(nodeOf(3, 3));
    expect(movesFor(s, 1)).toContain(nodeOf(2, 3));
    expect(movesFor(s, 1)).toContain(nodeOf(3, 4));
    s.walls[edgeBetween(nodeOf(3, 3), nodeOf(3, 4))] = true;
    expect(movesFor(s, 1)).not.toContain(nodeOf(3, 4)); // 壁は飛び越えられない

  });

  it('ゴールに着くと盤面から外れ、次の巡からは手番が無い。早く着いた人が上位', () => {
    const s = M08.init(FIVE, Rng.from(1)) as M08State;
    s.pos[0] = nodeOf(3, 4);
    M08.submit(s, FIVE[0], { t: 'move', to: goalNode(0) });
    expect(s.arrived[0]).toBe(0);
    expect(s.pos[0]).toBe(-1);
    expect(orderAt(s, 1)).not.toContain(FIVE[0]);
    expect(M08.ranking(s)[0]).toEqual([FIVE[0]]);
    for (const p of FIVE.slice(1)) M08.submit(s, p, M08.defaultMove(s, p));
    expect(s.round).toBe(1);
    expect(M08.view(s, FIVE[0]).toMove).toBe(FIVE[1]);
  });

  it('CPU だけで最後まで進む。席による有利不利が大きくない', () => {
    const N = 150;
    const first = new Array<number>(5).fill(0);
    const lastTwo = new Array<number>(5).fill(0);
    let rounds = 0;
    let walls = 0;
    let arrived = 0;
    let capped = 0;
    const rows: string[] = [];
    for (let seed = 1; seed <= N; seed++) {
      const order = Rng.from(seed).shuffle([...ALL_IDS.slice(seed % 8, (seed % 8) + 5)]);
      const r = simulate('m08', seed, order);
      const st = r.slot.state as M08State;
      expect(M08.done(st)).toBe(true);
      rounds += st.round;
      if (st.round >= 25) capped++;
      walls += st.walls.filter(Boolean).length;
      arrived += st.arrived.filter((x) => x >= 0).length;
      const rank = r.ranking;
      order.forEach((p, i) => { if (rank[0].includes(p)) first[i]++; if (rank.slice(-2).flat().slice(-2).includes(p)) lastTwo[i]++; });
      rows.push(`${st.arrived.join(',')} | moves ${st.moves.join(',')} | walls ${st.wallsLeft.map((x) => 3 - x).join(',')} | groups ${rank.map((g) => g.length).join('')}`);
    }
    writeFileSync(`${S}/m08-sim.txt`, `rounds ${rounds / N} capped ${capped} walls ${walls / N} arrived ${arrived / N}\nfirst ${first.join(' ')}\nlastTwo ${lastTwo.join(' ')}\n${rows.slice(0, 16).join('\n')}`);
    expect(Math.max(...first) / Math.max(1, Math.min(...first))).toBeLessThan(2.2);
  });
});
