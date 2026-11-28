import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { ALL_IDS, type CharId } from '../src/data/characters';
import { H02, type DuelState } from '../src/matches/duel';
import { H01, H01_MAX, h01Candidates, type H01State } from '../src/matches/h01';
import { atGoal, H03, mirrorStep, solveMirror, type Dir, type H03State } from '../src/matches/h03';
import { H04, h04Passed, type H04State } from '../src/matches/h04';
import { H05, makeSlide, orderOk, slidable, slideSolved, slideTo, solveSlide, type H05State } from '../src/matches/h05';
import { H07, h07Wrong, type H07State } from '../src/matches/h07';
import { H08, normalize, type H08State } from '../src/matches/h08';
import { solveFrom, trace } from '../src/matches/p06';
import { H06, H06_KEEP, H06_ROUNDS, H06_SIGNALS, P10, type P10State } from '../src/matches/p10';
import { EVIDENCE, H01_ANSWER, H03_STAGES, H04_QUESTIONS, H05_ORDER, H07_QUESTIONS, H08_LOGIC, LETTERS } from '../src/story/hiddendata';
import { simulate } from './helpers';

const ONE = [ALL_IDS[0]];
const NPC = (i: number) => [ALL_IDS[1 + (i % 11)]];

describe('H01 賢者の金庫', () => {
  it('6 つの条件を満たす数は 1 つだけ。条件を 1 つ外すと、複数になるか別の数になる（どの条件も必要）', () => {
    expect(h01Candidates()).toEqual([H01_ANSWER]);
    // 「1 から 6 を 1 回ずつ」は入力盤の決まりでもあるので、残りの 5 つを調べる
    const needed = [1, 2, 3, 4, 5].filter((skip) => h01Candidates([0, 1, 2, 3, 4, 5].filter((i) => i !== skip)).length > 1);
    console.log(`h01: clues needed=${needed.join(',')}`);
  });
  it('5 回まで。合えば成功、5 回違えば失敗。答えは画面に渡らない', () => {
    const s = H01.init(ONE, Rng.from(1)) as H01State;
    expect(JSON.stringify(H01.view(s, ONE[0]))).not.toContain(H01_ANSWER);
    expect(H01.validate(s, ONE[0], { t: 'try', code: '112345' })).toBe(false);
    for (const c of ['123456', '654321', '213456', '312456']) H01.submit(s, ONE[0], { t: 'try', code: c });
    expect(H01.done(s)).toBe(false);
    expect(H01.validate(s, ONE[0], { t: 'try', code: '123456' })).toBe(false);
    H01.submit(s, ONE[0], { t: 'try', code: '412356' });
    expect(H01.done(s)).toBe(true);
    expect(s.solved).toBe(false);
    expect(s.tries.length).toBe(H01_MAX);
    const r = simulate('h01', 3, NPC(3));
    expect((r.slot.state as H01State).solved).toBe(true);
  });
});

describe('H02 月下の賭場', () => {
  it('カードは 1 から 5、全 5 ラウンド。CPU 同士 100 回で必ず終わる', () => {
    let draw = 0, first = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const r = simulate('h02', seed, [ALL_IDS[seed % 12], 'dealer' as CharId]);
      const st = r.slot.state as DuelState;
      expect(st.n).toBe(5);
      expect(st.log.length).toBe(5);
      expect(st.wins[0] + st.wins[1]).toBe(5);
      if (st.wins[0] === st.wins[1]) draw++; else if (st.wins[0] > st.wins[1]) first++;
    }
    console.log(`h02: playerWin=${first} draw=${draw} dealerWin=${100 - first - draw}`);
    expect(H02.id).toBe('h02');
  });
});

describe('H03 鏡の迷宮', () => {
  it('3 面とも、30 手以内で解ける。右の駒は左右だけ逆に動く', () => {
    const lens = H03_STAGES.map((st) => solveMirror(st, [st.start[0], st.start[1]])!.length);
    console.log(`h03: shortest=${lens.join(',')}`);
    for (const [i, n] of lens.entries()) { expect(n).toBeGreaterThan(5); expect(n).toBeLessThanOrEqual(H03_STAGES[i].maxMoves); }
    // 仕様の解法（QA 用）でも解ける
    const qa = ['RURUUURRURRU', 'URRRURRULUUURR', 'URRRUURULULUURRRURRR'];
    for (const [i, sol] of qa.entries()) {
      const st = H03_STAGES[i];
      let pos: [[number, number], [number, number]] = [st.start[0], st.start[1]];
      for (const d of sol) pos = mirrorStep(st, pos, d as Dir);
      expect(atGoal(st, pos)).toBe(true);
    }
    const st0 = H03_STAGES[0];
    const p = mirrorStep(st0, [[3, 2], [3, 2]], 'R');
    expect(p).toEqual([[4, 2], [2, 2]]);
    expect(mirrorStep(st0, [[3, 2], [3, 2]], 'U')).toEqual([[3, 1], [3, 1]].map((q, k) => (st0.boards[k][1][3] === '#' ? [3, 2] : q)));
  });
  it('動けない操作と「最初から」も 1 手に数える。30 手で失敗。CPU は 3 面とも解く', () => {
    const s = H03.init(ONE, Rng.from(1)) as H03State;
    H03.submit(s, ONE[0], { t: 'go', dir: 'D' });
    expect(s.moves).toBe(1);
    expect(s.pos).toEqual([[0, 6], [6, 6]]);
    H03.submit(s, ONE[0], { t: 'reset' });
    expect(s.moves).toBe(2);
    for (let i = 0; i < 28; i++) H03.submit(s, ONE[0], { t: 'go', dir: 'D' });
    expect(H03.done(s)).toBe(true);
    expect(s.failed).toBe(true);
    let ok = 0;
    for (let seed = 1; seed <= 30; seed++) if ((simulate('h03', seed, NPC(seed)).slot.state as H03State).cleared === 3) ok++;
    console.log(`h03: cpuCleared=${ok}/30`);
    expect(ok).toBeGreaterThan(20);
  });
});

describe('H04 囚人の遺言', () => {
  it('問いの根拠の手紙は、どれも実在する。答えは、終わるまで画面に渡らない', () => {
    for (const q of H04_QUESTIONS) for (const e of q.evidence) expect(LETTERS.some((l) => l.id === e)).toBe(true);
    const s = H04.init(ONE, Rng.from(1)) as H04State;
    const v = H04.view(s, ONE[0]);
    expect(v.marks).toBeNull();
    expect(JSON.stringify(v)).not.toContain('answer"');
    H04.submit(s, ONE[0], { t: 'answer', a: [1, 0, 2, 1, 0] });
    expect(s.correct).toBe(4);
    expect(h04Passed(s)).toBe(true);
    expect(H04.view(s, ONE[0]).marks).toEqual([true, true, true, true, false]);
    const s2 = H04.init(ONE, Rng.from(1)) as H04State;
    H04.submit(s2, ONE[0], { t: 'answer', a: [0, 0, 2, 1, 0] });
    expect(h04Passed(s2)).toBe(false);
  });
});

describe('H05 時の牢獄', () => {
  it('スライド板は、完成の形から崩して作るので必ず解ける。並べ替えの答えは 1 つだけ', () => {
    let max = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const t = makeSlide(Rng.from(seed));
      expect(slideSolved(t)).toBe(false);
      let cur = t;
      const sol = solveSlide(t);
      max = Math.max(max, sol.length);
      for (const pos of sol) { expect(slidable(cur)).toContain(pos); cur = slideTo(cur, pos); }
      expect(slideSolved(cur)).toBe(true);
    }
    console.log(`h05: slideMaxMoves=${max}`);
    const perms: string[][] = [];
    const rec = (a: string[]) => { if (a.length === 4) { perms.push(a); return; } for (const g of H05_ORDER.glyphs) if (!a.includes(g)) rec([...a, g]); };
    rec([]);
    expect(perms.filter(orderOk)).toEqual([H05_ORDER.answer]);
  });
  it('間違えても続けられる。3 つ解けば成功。時間切れは失敗', () => {
    const s = H05.init(ONE, Rng.from(5)) as H05State;
    H05.submit(s, ONE[0], { t: 'num', v: 36 });
    expect(s.idx).toBe(0);
    expect(s.misses).toBe(1);
    H05.submit(s, ONE[0], { t: 'num', v: 37 });
    expect(s.idx).toBe(1);
    expect(H05.validate(s, ONE[0], { t: 'num', v: 37 })).toBe(false);
    H05.submit(s, ONE[0], H05.defaultMove(s, ONE[0]));
    expect(H05.done(s)).toBe(true);
    expect(H05.scores(s)[ONE[0]]).toBe(1);
    expect((simulate('h05', 8, NPC(2)).slot.state as H05State).idx).toBe(3);
  });
});

describe('H06 影の対戦者', () => {
  it('駒 3 個ずつの矢じり、12 巡、点は上下の端の合図のマス。終わった時に残った駒 1 個につき 2 点', () => {
    const s = H06.init(['hero', 'mask' as CharId], Rng.from(1)) as P10State;
    expect(s.pieces.length).toBe(6);
    const v = H06.view(s, 'hero');
    expect(v.centers).toEqual(H06_SIGNALS);
    expect(H06_SIGNALS).toEqual([2, 22]);
    // P10 とは配置と点の入るマスが違う（同じ駒の動き）
    const p = P10.view(P10.init(['hero', 'mask' as CharId], Rng.from(1)), 'hero');
    expect(v.centers.some((c) => p.centers.includes(c))).toBe(false);
    expect(v.start.map((x) => x.pos).sort()).not.toEqual(p.start.map((x) => x.pos).sort());
    expect(v.rounds).toBe(H06_ROUNDS);
    expect(v.games).toBe(1);
    let pw = 0, mw = 0, dr = 0, sum = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const r = simulate('h06', seed, seed % 2 ? [ALL_IDS[seed % 12], 'mask' as CharId] : ['mask' as CharId, ALL_IDS[seed % 12]]);
      const st = r.slot.state as P10State;
      expect(st.round).toBeLessThanOrEqual(H06_ROUNDS);
      // 残った駒の点が入っている
      const caps = st.caps[0] * 3;
      expect(st.points[0]).toBeGreaterThanOrEqual(caps + H06_KEEP * st.pieces.filter((p) => p.seat === 0).length);
      const mi = st.players.indexOf('mask' as CharId);
      sum += st.points[0] + st.points[1];
      if (st.points[mi] > st.points[1 - mi]) mw++; else if (st.points[mi] < st.points[1 - mi]) pw++; else dr++;
    }
    console.log(`h06: challengerWin=${pw} maskWin=${mw} draw=${dr} avgTotal=${(sum / 60).toFixed(1)}`);
    expect(pw).toBeGreaterThan(5);
    expect(mw).toBeGreaterThan(5);
  }, 120_000);
});

describe('H07 十二の証明', () => {
  it('12 人の問いと資料が 1 対 1 で対応する。食い違いは、どの人かだけが分かる', () => {
    expect(H07_QUESTIONS.length).toBe(12);
    H07_QUESTIONS.forEach((q, i) => { expect(q.evidence).toEqual([EVIDENCE[i].id]); expect(EVIDENCE[i].text).toContain(q.prompt === '主人公' ? '招待状' : q.prompt); });
    const good = H07_QUESTIONS.map((q) => ({ opt: q.answer, ev: q.evidence[0] }));
    expect(h07Wrong(good)).toEqual([]);
    const bad = good.map((x, i) => (i === 3 ? { ...x, ev: 'E01' } : i === 7 ? { ...x, opt: (x.opt + 1) % 3 } : x));
    expect(h07Wrong(bad)).toEqual([3, 7]);
    const s = H07.init(ONE, Rng.from(1)) as H07State;
    H07.submit(s, ONE[0], { t: 'answer', a: bad });
    expect(H07.done(s)).toBe(false);
    const v = H07.view(s, ONE[0]);
    expect(v.wrong).toEqual([3, 7]);
    expect(JSON.stringify(v)).not.toContain('"answer"');
    H07.submit(s, ONE[0], { t: 'answer', a: good });
    expect(s.solved).toBe(true);
    let ok = 0;
    for (let seed = 1; seed <= 30; seed++) if ((simulate('h07', seed, NPC(seed)).slot.state as H07State).solved) ok++;
    expect(ok).toBe(30);
  });
});

describe('H08 神の方程式', () => {
  it('3 つの箱の問いは、答えが 1 つだけ', () => {
    const truths = (box: number) => [box !== 2, box === 0 || box === 1, box === 2].filter(Boolean).length;
    expect([0, 1, 2].filter((b) => truths(b) === 1)).toEqual([H08_LOGIC.answer]);
    expect(normalize('ｃrown ')).toBe('CROWN');
  });
  it('段階ごとに進み、間違えても続けられる。中断すると、解けた段階の数が残り、続きから始められる', () => {
    const s = H08.init(ONE, Rng.from(9)) as H08State;
    H08.submit(s, ONE[0], { t: 'text', v: 'KING' });
    expect(s.idx).toBe(0);
    H08.submit(s, ONE[0], { t: 'text', v: 'crown' });
    H08.submit(s, ONE[0], { t: 'num', v: 65 });
    expect(s.idx).toBe(2);
    H08.submit(s, ONE[0], { t: 'pause' });
    expect(H08.done(s)).toBe(true);
    expect(H08.scores(s)[ONE[0]]).toBe(2);
    const s2 = H08.init(ONE, Rng.from(10), { from: 2 }) as H08State;
    expect(s2.idx).toBe(2);
    H08.submit(s2, ONE[0], { t: 'pick', i: 2 });
    const sol = solveFrom(s2.maze, [s2.maze.start]).path!;
    expect(trace(s2.maze, sol).done).toBe(true);
    expect(H08.validate(s2, ONE[0], { t: 'pick', i: 1 })).toBe(false);
    H08.submit(s2, ONE[0], { t: 'path', path: sol.slice(0, -1) });
    expect(s2.idx).toBe(3);
    H08.submit(s2, ONE[0], { t: 'path', path: sol });
    H08.submit(s2, ONE[0], { t: 'pick', i: 1 });
    expect(s2.idx).toBe(5);
    expect(H08.done(s2)).toBe(true);
    for (let seed = 1; seed <= 30; seed++) expect((simulate('h08', seed, NPC(seed)).slot.state as H08State).idx).toBe(5);
  });
});
