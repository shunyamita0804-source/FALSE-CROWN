import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { ALL_IDS } from '../src/data/characters';
import { M05, M05_PRACTICE, ROUNDS, SOLVE_MS, evalToks, exprText, makeRound, scoreAnswer, solutions, type M05State, type Tok } from '../src/matches/m05';
import { simulate } from './helpers';

const EIGHT = ALL_IDS.slice(0, 8);
// 試行の数字の書き出し先（環境に依らない一時フォルダ）
const S = (() => { const d = join(tmpdir(), 'false-crown-sim'); mkdirSync(d, { recursive: true }); return d; })();

describe('M05 ナンバー・リレー', () => {
  it('式の計算：優先順位、括弧、分数、0 での割り算、書きかけ、カードの使い回し', () => {
    const c = [3, 4, 8, 9, 10, 12];
    expect(evalToks([0, '+', 1, '*', 2], c)).toEqual({ n: 35, d: 1 });
    expect(evalToks(['(', 0, '+', 1, ')', '*', 2], c)).toEqual({ n: 56, d: 1 });
    expect(evalToks([2, '/', 0], c)).toEqual({ n: 8, d: 3 });
    expect(evalToks([2, '/', 0, '*', 3], c)).toEqual({ n: 24, d: 1 });
    expect(evalToks([2, '/', '(', 1, '-', 1, ')'], c)).toBeNull();
    expect(evalToks([2, '/', '(', 5, '-', 5, ')'], [1, 1, 1, 1, 1, 1])).toBeNull();
    expect(evalToks([0, '+'], c)).toBeNull();
    expect(evalToks(['(', 0, '+', 1], c)).toBeNull();
    expect(evalToks([0, '+', 0], c)).toBeNull();
    expect(evalToks([0, 1], c)).toBeNull();
    expect(evalToks([], c)).toBeNull();
  });

  it('得点：正解 40、カード 1 枚 2 点（最大 12）、残り時間で最大 8', () => {
    const { cards, target } = M05_PRACTICE;
    const three: Tok[] = ['(', 2, '-', 0, ')', '*', 3];
    expect(scoreAnswer(cards, target, three, 0)).toEqual({ correct: true, used: 3, points: 54 });
    expect(scoreAnswer(cards, target, three, SOLVE_MS)).toEqual({ correct: true, used: 3, points: 46 });
    expect(scoreAnswer(cards, target, [0, '+', 1], 1000).points).toBe(0);
    const six: Tok[] = [0, '+', 2, '*', '(', 3, '-', 1, ')', '+', 5, '-', 4];
    expect(scoreAnswer(cards, target, six, SOLVE_MS / 2)).toEqual({ correct: true, used: 6, points: 56 });
  });

  it('問題：候補 3 つはどれも 2 枚では作れず 3 枚で作れる。探索が返す式は必ず目標と一致する', () => {
    let six = 0;
    let n = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const r = makeRound(Rng.from(seed));
      expect(r.cards.length).toBe(6);
      expect(r.cards.includes(r.extra)).toBe(false);
      for (const c of r.cands) {
        const sols = solutions(r.cards, c);
        expect(sols[1]).toBeUndefined();
        expect(sols[2]).toBeUndefined();
        expect(sols[3]).toBeDefined();
        for (const k of Object.keys(sols).map(Number)) {
          expect(scoreAnswer(r.cards, c, sols[k], 0)).toMatchObject({ correct: true, used: k });
        }
        n++;
        if (sols[6]) six++;
      }
    }
    writeFileSync(`${S}/m05-gen.txt`, `6 枚の解がある候補 ${six}/${n}`);
  });

  it('出題担当だけが先にカードを見る。教えた時だけ組の人にも見える。組の全員が正解で +10', () => {
    const s = M05.init(EIGHT, Rng.from(3)) as M05State;
    const [ta, tb] = s.halves[0];
    const setter = ta[0];
    expect(M05.view(s, setter).isSetter).toBe(true);
    expect(M05.view(s, setter).cards).toEqual(s.rounds[0].cards);
    expect(M05.view(s, ta[1]).cards).toBeNull();
    expect(M05.view(s, ta[1]).target).toBeNull();
    expect(M05.validate(s, ta[1], { t: 'set', pick: 1, tell: true })).toBe(false);
    expect(M05.pending(s).sort()).toEqual([setter, tb[0]].sort());
    M05.submit(s, setter, { t: 'set', pick: 2, tell: true });
    expect(M05.view(s, ta[1]).cards).toBeNull();
    M05.submit(s, tb[0], { t: 'set', pick: 0, tell: false });
    expect(s.phase).toBe('prep');
    expect(M05.view(s, ta[1]).cards).toEqual(s.rounds[0].cards);
    expect(M05.view(s, ta[1]).target).toBe(s.rounds[0].cands[2]);
    expect(M05.view(s, tb[1]).cards).toBeNull();
    M05.submit(s, ta[2], { t: 'extra' });
    expect(M05.validate(s, ta[2], { t: 'extra' })).toBe(false);
    for (const p of EIGHT) M05.submit(s, p, { t: 'ready' });
    expect(s.phase).toBe('solve');
    expect(M05.view(s, ta[2]).cards!.length).toBe(7);
    const solA = solutions(s.rounds[0].cards, s.rounds[0].cands[2])[3];
    const solB = solutions(s.rounds[0].cards, s.rounds[0].cands[0])[3];
    for (const p of ta) M05.submit(s, p, { t: 'answer', toks: solA, ms: 30_000 });
    tb.forEach((p, i) => M05.submit(s, p, { t: 'answer', toks: i === 0 ? [] : solB, ms: 30_000 }));
    expect(s.round).toBe(1);
    expect(s.results[ta[0]][0]).toMatchObject({ correct: true, bonus: 10, points: 40 + 6 + 5 });
    expect(s.results[tb[1]][0]).toMatchObject({ correct: true, bonus: 0 });
    expect(s.results[tb[0]][0]).toMatchObject({ correct: false, points: 0 });
    expect(M05.view(s, ta[1]).isSetter).toBe(true);
    expect(exprText(M05.view(s, ta[0]).lastExample!.sols[0], s.rounds[0].cards).length).toBeGreaterThan(4);
  });

  it('全員が 2 回ずつ出題担当になる。組替え後の組は、前半の両方の組から 2 人ずつ', () => {
    const s = M05.init(EIGHT, Rng.from(9)) as M05State;
    const count: Record<string, number> = {};
    for (let r = 0; r < ROUNDS; r++) {
      const teams = s.halves[r < 4 ? 0 : 1];
      for (const tm of teams) { const p = tm[(r % 4) % tm.length]; count[p] = (count[p] ?? 0) + 1; }
    }
    expect(Object.values(count)).toEqual(new Array(8).fill(2));
    for (const tm of s.halves[1]) expect(tm.filter((p) => s.halves[0][0].includes(p)).length).toBe(2);
  });

  it('CPU だけで最後まで進む。論理の能力で差がつく', () => {
    const rows: string[] = [];
    let correct = 0;
    let used = 0;
    let n = 0;
    let told = 0;
    const wins: Record<string, number> = {};
    for (let seed = 1; seed <= 12; seed++) {
      const ps = [...ALL_IDS.slice(seed % 5, (seed % 5) + 8)];
      const r = simulate('m05', seed, ps);
      const st = r.slot.state as M05State;
      expect(M05.done(st)).toBe(true);
      for (const p of ps) {
        expect(st.results[p].length).toBe(ROUNDS);
        for (const x of st.results[p]) { n++; if (x.correct) { correct++; used += x.used; } if (x.bonus) told++; }
      }
      wins[r.ranking[0][0]] = (wins[r.ranking[0][0]] ?? 0) + 1;
      rows.push(ps.map((p) => `${p.slice(0, 6)}=${r.scores[p]}`).join(' '));
    }
    writeFileSync(`${S}/m05-sim.txt`, `correct ${correct / n} cards ${used / correct} teamBonus ${told / n}\n${JSON.stringify(wins)}\n${rows.join('\n')}`);
    expect(correct / n).toBeGreaterThan(0.5);
    expect(correct / n).toBeLessThan(0.95);
  });
});
