import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { ALL_IDS } from '../src/data/characters';
import { FLAGS, flagSvg } from '../src/data/flags';
import { BOOST_MAX, BOOST_MS, M02, M02_PRACTICE, makeSet, MIXES, QUESTIONS, showMsOf, type M02State } from '../src/matches/m02';
import { answerOf, cpuAnswer, emptyAnswer, grade, wellFormed, type MemAnswer } from '../src/matches/memory';
import { simulate } from './helpers';

const ELEVEN = ALL_IDS.slice(0, 11);
const perfect = (s: M02State): MemAnswer => {
  const set = s.sets[s.round][s.chosen[s.round]];
  return { picks: set.questions.map((q) => answerOf(set.board, q)), ms: set.questions.map(() => 2000) };
};

describe('M02 フラッグ・フラッシュ', () => {
  it('国旗の一覧：ID と名前が重複せず、すべて描画できる', () => {
    expect(new Set(FLAGS.map((f) => f.id)).size).toBe(FLAGS.length);
    expect(new Set(FLAGS.map((f) => f.name)).size).toBe(FLAGS.length);
    expect(FLAGS.length).toBeGreaterThanOrEqual(40);
    for (const f of FLAGS) expect(flagSvg(f.id)).toContain('<svg');
  });

  it('出題セット：どの候補も旗 6〜12 枚、5 問、正解がちょうど 1 つ（100 シード）', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const s = M02.init(ELEVEN, Rng.from(seed)) as M02State;
      expect(s.order.length).toBe(11);
      expect([...s.order].sort()).toEqual([...ELEVEN].sort());
      s.sets.forEach((cands, r) => {
        expect(cands.length).toBe(3);
        expect(new Set(s.cands[r].map((c) => c.mix)).size).toBe(3);
        cands.forEach((set, i) => {
          const n = set.board.cells.filter((c) => c != null).length;
          expect(n).toBe(s.cands[r][i].n);
          expect(n).toBeGreaterThanOrEqual(6);
          expect(n).toBeLessThanOrEqual(12);
          expect(set.questions.length).toBe(QUESTIONS);
          expect(wellFormed(set)).toBe(true);
          expect(set.showMs).toBe(showMsOf(s.cands[r][i].mix, n));
        });
      });
    }
    expect(wellFormed(M02_PRACTICE)).toBe(true);
  });

  it('進行と得点：出題者だけが選ぶ。1 問 10 点、全問正解 +10。選んだ候補は終わるまで出題者だけに見える', () => {
    const s = M02.init(ELEVEN, Rng.from(7)) as M02State;
    const setter = s.order[0];
    const other = s.order[1];
    expect(M02.pending(s)).toEqual([setter]);
    expect(M02.validate(s, other, { t: 'pick', i: 0 })).toBe(false);
    expect(M02.validate(s, setter, { t: 'pick', i: 3 })).toBe(false);
    expect(M02.validate(s, setter, { t: 'pick', i: 1, tell: { [setter]: 1 } })).toBe(false);
    M02.submit(s, setter, { t: 'pick', i: 1, tell: { [other]: 2 } });
    expect(s.phase).toBe('prep');
    expect(M02.view(s, setter).chosen).toBe(1);
    expect(M02.view(s, other).chosen).toBe(null);
    expect(M02.view(s, other).tip).toBe(2);
    expect(M02.view(s, s.order[2]).tip).toBe(null);
    expect(M02.view(s, other).set).toBe(null);
    // 延長は同じラウンドに重ねられない
    M02.submit(s, other, { t: 'boost' });
    expect(M02.validate(s, other, { t: 'boost' })).toBe(false);
    for (const p of ELEVEN) M02.submit(s, p, { t: 'ready' });
    expect(s.phase).toBe('quiz');
    const base = s.sets[0][1].showMs;
    expect(M02.view(s, other).set!.showMs).toBe(base + BOOST_MS);
    expect(M02.view(s, setter).set!.showMs).toBe(base);
    const good = perfect(s);
    const four = { picks: [...good.picks], ms: [...good.ms] };
    four.picks[0] = -1;
    expect(M02.validate(s, setter, { t: 'answers', a: { picks: [0], ms: [0] } })).toBe(false);
    M02.submit(s, setter, { t: 'answers', a: good });
    M02.submit(s, other, { t: 'answers', a: four });
    for (const p of ELEVEN) if (p !== setter && p !== other) M02.submit(s, p, M02.defaultMove(s, p));
    expect(s.phase).toBe('break');
    expect(s.results[setter][0].points).toBe(60);
    expect(s.results[other][0].points).toBe(40);
    expect(s.results[s.order[2]][0].points).toBe(0);
    const v = M02.view(s, other);
    expect(v.last!.chosen).toBe(1);
    expect(v.last!.tip).toBe(2);
    // 次の出題者だけが、休憩中に候補を先に見られる
    expect(M02.view(s, s.order[1]).nextCands).not.toBe(null);
    expect(M02.view(s, s.order[2]).nextCands).toBe(null);
    for (const p of ELEVEN) M02.submit(s, p, { t: 'ready' });
    expect([s.phase, s.round]).toEqual(['pick', 1]);
    expect(M02.pending(s)).toEqual([s.order[1]]);
    expect(s.boostUsed[other]).toBe(1);
    expect(BOOST_MAX).toBe(2);
  });

  it('採点：未回答は不正解。正解時間は正解した問題だけ合計する', () => {
    const set = makeSet(Rng.from(3), 'even', 9);
    const a = emptyAnswer(set);
    expect(grade(set, a).correct).toBe(0);
    a.picks[2] = answerOf(set.board, set.questions[2]);
    a.ms[2] = 1234;
    const g = grade(set, a);
    expect(g.correct).toBe(1);
    expect(g.okMs).toBe(1234);
  });

  it('最後まで進む：全員が 1 回ずつ出題し、順位が全員ぶん決まる（2〜12 人）', () => {
    for (const n of [2, 5, 11, 12]) {
      const ps = ALL_IDS.slice(0, n);
      const r = simulate('m02', 5 + n, ps);
      const s = r.slot.state as M02State;
      expect(s.phase).toBe('done');
      for (const p of ps) expect(s.results[p].length).toBe(n);
      expect(r.ranking.flat().length).toBe(n);
    }
  });

  it('100 試合：1 位と最下位が特定の人に固定されない。候補の種類による正答率の差を記録する', () => {
    const first: Record<string, number> = {};
    const last: Record<string, number> = {};
    const byMix: Record<string, { ok: number; n: number }> = {};
    const setterGain = { setter: 0, others: 0, ns: 0, no: 0 };
    for (let seed = 1; seed <= 100; seed++) {
      const ps = ALL_IDS.filter((_, i) => i !== seed % 12);
      const r = simulate('m02', seed, ps);
      const s = r.slot.state as M02State;
      const f = r.ranking.flat();
      first[f[0]] = (first[f[0]] ?? 0) + 1;
      last[f[f.length - 1]] = (last[f[f.length - 1]] ?? 0) + 1;
      s.order.forEach((setter, round) => {
        const mix = s.cands[round][s.chosen[round]].mix;
        byMix[mix] ??= { ok: 0, n: 0 };
        for (const p of ps) {
          const c = s.results[p][round].correct;
          byMix[mix].ok += c;
          byMix[mix].n += QUESTIONS;
          if (p === setter) { setterGain.setter += c; setterGain.ns++; } else { setterGain.others += c; setterGain.no++; }
        }
      });
    }
    const rate = Object.fromEntries(Object.entries(byMix).map(([k, x]) => [k, +(x.ok / x.n).toFixed(3)]));
    writeFileSync('/tmp/m02-stats.json', JSON.stringify({ first, last, rate, setter: +(setterGain.setter / setterGain.ns).toFixed(2), others: +(setterGain.others / setterGain.no).toFixed(2) }, null, 1));
    expect(Object.keys(first).length).toBeGreaterThanOrEqual(8);
    expect(Object.keys(last).length).toBeGreaterThanOrEqual(8);
    expect(Math.max(...Object.values(first))).toBeLessThanOrEqual(30);
    expect(Math.max(...Object.values(last))).toBeLessThanOrEqual(30);
    const rates = Object.values(rate);
    expect(Math.max(...rates) - Math.min(...rates)).toBeLessThan(0.12);
    expect(MIXES.every((m) => byMix[m])).toBe(true);
  });

  it('CPU は盤面を覚えていなければ当てられない（正解を参照していない）', () => {
    let ok = 0;
    let n = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const rng = Rng.from(seed);
      const set = makeSet(rng, 'even', 12);
      ok += grade(set, cpuAnswer(set, { pSeen: 0, pLoc: 0 }, rng)).correct;
      n += QUESTIONS;
    }
    // 位置は 12 択、旗と有無は 4 択の当て推量
    expect(ok / n).toBeLessThan(0.25);
    expect(ok / n).toBeGreaterThan(0.1);
  });
});
