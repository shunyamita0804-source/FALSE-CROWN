import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { ALL_IDS } from '../src/data/characters';
import { HAND, M06, ROUNDS, finalBonus, matchesIn, meets, rankOf, suitOf, type M06State } from '../src/matches/m06';
import { simulate } from './helpers';

const SEVEN = ALL_IDS.slice(0, 7);
const S = '/tmp/claude-0/-home-claude/ced3d2db-bac9-5d25-8782-91ee7ff6cc58/scratchpad';
const card = (rank: number, suit: number) => suit * 13 + rank - 1;

describe('M06 クロス・カード', () => {
  it('目標の判定：同じ数字、同じ紋、連続する数字', () => {
    expect(meets('pair', card(7, 0), card(7, 2))).toBe(true);
    expect(meets('pair', card(7, 0), card(8, 0))).toBe(false);
    expect(meets('suit', card(2, 1), card(11, 1))).toBe(true);
    expect(meets('suit', card(2, 1), card(2, 3))).toBe(false);
    expect(meets('run', card(12, 0), card(13, 3))).toBe(true);
    expect(meets('run', card(13, 0), card(1, 0))).toBe(false);
    expect(matchesIn('run', [card(3, 0), card(4, 1), card(5, 2)]).length).toBe(2);
  });

  it('最後の手札：同じ数字 3 枚 +8、同じ紋 4 枚 +6、両方なら高い方だけ', () => {
    expect(finalBonus([card(5, 0), card(5, 1), card(5, 2)])).toEqual({ points: 8, kind: 'triple' });
    expect(finalBonus([card(1, 0), card(3, 0), card(5, 0), card(9, 0), card(2, 1)])).toEqual({ points: 6, kind: 'flush' });
    expect(finalBonus([card(5, 0), card(5, 1), card(5, 2), card(7, 0), card(9, 0)]).points).toBe(8);
    expect(finalBonus([card(5, 0), card(6, 1)]).points).toBe(0);
  });

  it('交換は手番の人だけ。場に空きは出ず、出したカードは公開。手札は他の人に見えない', () => {
    const s = M06.init(SEVEN, Rng.from(4)) as M06State;
    const [a, b] = SEVEN;
    const all = [...s.deck, ...s.field, ...SEVEN.flatMap((p) => s.hands[p])];
    expect(new Set(all).size).toBe(52);
    expect(M06.validate(s, b, { t: 'pass' })).toBe(false);
    const h = s.hands[a][0];
    const f = s.field[2];
    M06.submit(s, a, { t: 'swap', hand: h, field: f });
    expect(s.field.length).toBe(5);
    expect(s.field[2]).toBe(h);
    expect(s.hands[a]).toContain(f);
    expect(M06.view(s, b).log[0]).toMatchObject({ who: a, took: f, gave: h });
    expect(M06.view(s, b).hand).toEqual(s.hands[b]);
    expect(JSON.stringify(M06.view(s, b))).not.toContain(JSON.stringify(s.hands[a]));
    expect(M06.view(s, b).finalHands).toBeNull();
  });

  it('提出：目標に合う 2 枚で 6 点。提出したカードは捨て札になり、5 枚まで補充される', () => {
    const s = M06.init(SEVEN, Rng.from(8)) as M06State;
    for (const p of SEVEN) M06.submit(s, p, { t: 'pass' });
    expect(s.phase).toBe('submit');
    const target = s.targets[0];
    const expectPts: Record<string, number> = {};
    for (const p of SEVEN) {
      const pairs = matchesIn(target, s.hands[p]);
      expect(M06.validate(s, p, { t: 'submit', cards: [s.hands[p][0], s.hands[p][0]] })).toBe(false);
      expect(M06.validate(s, p, { t: 'submit', cards: s.hands[p].slice(0, 3) })).toBe(false);
      expectPts[p] = pairs.length ? 6 : 0;
      M06.submit(s, p, { t: 'submit', cards: pairs.length ? pairs[0] : [s.hands[p][0]] });
    }
    expect(s.phase).toBe('break');
    const tops = SEVEN.filter((p) => s.history[0][p].top);
    expect(tops.length).toBeGreaterThan(0);
    const sum = (p: string) => s.history[0][p].cards.reduce((n, c) => n + rankOf(c), 0);
    for (const p of SEVEN) if (s.history[0][p].ok) expect(sum(p)).toBeLessThanOrEqual(sum(tops[0]));
    for (const p of SEVEN) {
      expect(s.scores[p]).toBe(expectPts[p] + (s.history[0][p].top ? 3 : 0));
      expect(s.hands[p].length).toBe(HAND);
    }
    const all = [...s.deck, ...s.discard, ...s.field, ...SEVEN.flatMap((p) => s.hands[p])];
    expect(new Set(all).size).toBe(52);
    expect(M06.view(s, SEVEN[0]).order[0]).toBe(SEVEN[1]);
  });

  it('CPU だけで最後まで進む。山札が尽きても、同じカードが 2 枚になることはない', () => {
    const rows: string[] = [];
    const wins: Record<string, number> = {};
    let ach = 0;
    let bonus = 0;
    let n = 0;
    let swaps = 0;
    let turns = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const ps = [...ALL_IDS.slice(seed % 6, (seed % 6) + 7)];
      const r = simulate('m06', seed, ps);
      const st = r.slot.state as M06State;
      expect(M06.done(st)).toBe(true);
      expect(st.history.length).toBe(ROUNDS);
      const all = [...st.deck, ...st.discard, ...st.field, ...ps.flatMap((p) => st.hands[p])];
      expect(all.length).toBe(52);
      expect(new Set(all).size).toBe(52);
      for (const c of all) { expect(rankOf(c)).toBeGreaterThan(0); expect(suitOf(c)).toBeLessThan(4); }
      for (const p of ps) { ach += st.achieved[p]; n++; if (st.bonus[p].points) bonus++; }
      swaps += st.log.filter((l) => l.kind === 'swap').length;
      turns += st.log.length;
      wins[r.ranking[0][0]] = (wins[r.ranking[0][0]] ?? 0) + 1;
      rows.push(ps.map((p) => `${p.slice(4, 8)}=${r.scores[p]}`).join(' '));
    }
    writeFileSync(`${S}/m06-sim.txt`, `achieved/player ${ach / n} of 6, bonus rate ${bonus / n}, swap rate ${swaps / turns}\n${JSON.stringify(wins)}\n${rows.slice(0, 14).join('\n')}`);
    expect(ach / n).toBeGreaterThan(2);
  });
});
