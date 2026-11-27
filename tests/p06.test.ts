import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { ALL_IDS } from '../src/data/characters';
import { P06, P06_PRACTICE, P06_PRACTICE_SOL, SIZES, STAGES, STAGE_MS, hintFor, makeMaze, scoreStage, solveFrom, trace, type P06State } from '../src/matches/p06';
import { simulate } from './helpers';

const THREE = ALL_IDS.slice(0, 3);
const S = '/tmp/claude-0/-home-claude/ced3d2db-bac9-5d25-8782-91ee7ff6cc58/scratchpad';

describe('P06 一筆の迷宮', () => {
  it('線の検査：壁、再訪、チェック点の順番、終点に入る条件', () => {
    const m = P06_PRACTICE;
    expect(trace(m, P06_PRACTICE_SOL)).toEqual({ valid: 9, checks: 2, done: true });
    expect(trace(m, [0, 1, 5]).valid).toBe(2); // 壁
    expect(trace(m, [0, 4, 0]).valid).toBe(2); // 再訪
    expect(trace(m, [0, 4, 5, 9]).valid).toBe(3); // チェック点 2 を先には通れない
    expect(trace(m, [0, 1, 2, 6, 10, 11, 15]).valid).toBe(6); // チェック点を残して終点には入れない
    expect(trace(m, [1, 2]).valid).toBe(0);
    expect(trace(m, [0, 1, 2, 6]).checks).toBe(1);
  });

  it('得点：完成 30 ＋ 残り時間で最大 10。未完成は、順に通ったチェック点 1 つ 2 点', () => {
    const m = P06_PRACTICE;
    expect(scoreStage(m, P06_PRACTICE_SOL, 0)).toEqual({ done: true, checks: 2, points: 40 });
    expect(scoreStage(m, P06_PRACTICE_SOL, STAGE_MS / 2)).toEqual({ done: true, checks: 2, points: 35 });
    expect(scoreStage(m, [0, 1, 2, 6], 1000)).toEqual({ done: false, checks: 1, points: 2 });
    expect(scoreStage(m, [], 1000).points).toBe(0);
  });

  it('問題は必ず解ける。補助は、完成できる線なら次の 1 マス、できない線なら戻す位置を示す', () => {
    const lens: number[] = [];
    for (let seed = 1; seed <= 25; seed++) {
      const rng = Rng.from(seed);
      for (const size of SIZES) {
        const m = makeMaze(rng, size);
        const r = solveFrom(m, [m.start]);
        expect(r.path).not.toBeNull();
        expect(trace(m, r.path!).done).toBe(true);
        expect(m.checks.length).toBe(size <= 5 ? 3 : size === 6 ? 4 : 5);
        lens.push(r.path!.length / (size * size));
        const h = hintFor(m, r.path!.slice(0, 3));
        expect(h.next).toBeDefined();
      }
    }
    const m = P06_PRACTICE;
    expect(hintFor(m, [0]).next).toBeDefined();
    // 0→4→8→12 は行き止まり（12 と 13 の間は壁）なので、戻す位置が出る
    const bad = hintFor(m, [0, 4, 8, 12]);
    expect(bad.cutTo).toBeDefined();
    expect(bad.cutTo!).toBeLessThan(4);
    writeFileSync(`${S}/p06-gen.txt`, `解の長さ ÷ マス数の平均 ${lens.reduce((a, b) => a + b, 0) / lens.length}`);
  });

  it('全員が出すと次のステージへ進む。3 ステージの後に休憩。補助は 1 回', () => {
    const s = P06.init(THREE, Rng.from(2)) as P06State;
    const [a, b, c] = THREE;
    P06.submit(s, a, { t: 'aid' });
    expect(P06.validate(s, a, { t: 'aid' })).toBe(false);
    for (let i = 0; i < 3; i++) {
      const sol = solveFrom(s.mazes[i], [s.mazes[i].start]).path!;
      P06.submit(s, a, { t: 'solve', path: sol, ms: 45_000 });
      P06.submit(s, b, { t: 'solve', path: sol.slice(0, 4), ms: STAGE_MS });
      P06.submit(s, c, { t: 'solve', path: [], ms: STAGE_MS });
    }
    expect(s.phase).toBe('break');
    expect(s.results[a][0]).toMatchObject({ done: true, points: 35 });
    expect(s.results[b][0].done).toBe(false);
    expect(s.results[c][0].points).toBe(0);
    for (const p of THREE) P06.submit(s, p, { t: 'ready' });
    expect(s.phase).toBe('solve');
    expect(P06.view(s, a).stageNo).toBe(3);
    expect(P06.ranking(s)[0]).toEqual([a]);
  });

  it('CPU だけで最後まで進む。完成率は能力で変わる', () => {
    const rows: string[] = [];
    let done = 0;
    let n = 0;
    const by: number[] = new Array(STAGES).fill(0);
    for (let seed = 1; seed <= 30; seed++) {
      const ps = [ALL_IDS[seed % 12], ALL_IDS[(seed + 4) % 12], ALL_IDS[(seed + 8) % 12]];
      const r = simulate('p06', seed, ps);
      const st = r.slot.state as P06State;
      expect(P06.done(st)).toBe(true);
      for (const p of ps) st.results[p].forEach((x, i) => { n++; if (x.done) { done++; by[i]++; } });
      rows.push(ps.map((p) => `${p.slice(4, 8)}=${r.scores[p]}`).join(' '));
    }
    writeFileSync(`${S}/p06-sim.txt`, `done ${done / n} by stage ${by.map((x) => (x / 90).toFixed(2)).join(' ')}\n${rows.slice(0, 12).join('\n')}`);
    expect(done / n).toBeGreaterThan(0.4);
    expect(done / n).toBeLessThan(0.97);
  });
});
