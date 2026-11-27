import { describe, expect, it } from 'vitest';
import { ALL_IDS, type CharId } from '../src/data/characters';
import { Rng } from '../src/core/rng';
import { ITEMS, M02, START_FUNDS, itemScore, moneyScore, totalScore, type M02State } from '../src/matches/m02';
import { simulate } from './helpers';

const ELEVEN = ALL_IDS.slice(0, 11);
const bag = (o: Partial<Record<(typeof ITEMS)[number], number>>) => ({ crown: 0, gem: 0, key: 0, book: 0, coin: 0, ...o });
const bidAll = (s: M02State, f: (p: CharId) => number) => { for (const p of M02.pending(s)) M02.submit(s, p, { t: 'bid', amount: f(p) }); };

describe('M02 黄金の競売', () => {
  it('得点：素点、セット、残金', () => {
    expect(itemScore(bag({ crown: 1, gem: 1 }))).toBe(18);
    expect(itemScore(bag({ key: 2, book: 1 }))).toBe(3 + 3 + 4 + 6);
    expect(itemScore(bag({ coin: 4 }))).toBe(8 + 8);
    expect(moneyScore(100)).toBe(5);
    expect(moneyScore(59)).toBe(2);
    expect(moneyScore(400)).toBe(5);
    expect(totalScore(bag({}), 100)).toBe(5);
  });

  it('20品を5種4つずつ出品し、最高額の1人が支払って落札する', () => {
    const s = M02.init(ELEVEN, Rng.from(3));
    expect(s.lots.length).toBe(20);
    for (const k of ITEMS) expect(s.lots.filter((x) => x === k).length).toBe(4);
    const first = s.lots[0];
    bidAll(s, (p) => (p === ELEVEN[2] ? 30 : p === ELEVEN[3] ? 29 : 0));
    expect(s.history[0].winner).toBe(ELEVEN[2]);
    expect(s.funds[ELEVEN[2]]).toBe(70);
    expect(s.funds[ELEVEN[3]]).toBe(100);
    expect(s.items[ELEVEN[2]][first]).toBe(1);
  });

  it('全員0なら流札。同額首位は1回だけ再入札し、同額のままなら流札', () => {
    const s = M02.init(ELEVEN, Rng.from(4));
    bidAll(s, () => 0);
    expect(s.history[0].winner).toBe(null);
    bidAll(s, (p) => (p === ELEVEN[0] || p === ELEVEN[1] ? 20 : 5));
    expect(s.stage).toBe('rebid');
    expect(M02.pending(s).sort()).toEqual([ELEVEN[0], ELEVEN[1]].sort());
    expect(M02.validate(s, ELEVEN[0], { t: 'bid', amount: 19 })).toBe(false);
    expect(M02.validate(s, ELEVEN[5], { t: 'bid', amount: 50 })).toBe(false);
    bidAll(s, () => 25);
    expect(s.history[1].winner).toBe(null);
    expect(s.funds[ELEVEN[0]]).toBe(100);
    // 再入札で 1 人が降りれば残った人が落札
    bidAll(s, (p) => (p === ELEVEN[0] || p === ELEVEN[1] ? 20 : 5));
    bidAll(s, (p) => (p === ELEVEN[0] ? 20 : 0));
    expect(s.history[2].winner).toBe(ELEVEN[0]);
    expect(s.funds[ELEVEN[0]]).toBe(80);
  });

  it('資金を超える入札はできない', () => {
    const s = M02.init(ELEVEN, Rng.from(5));
    expect(M02.validate(s, ELEVEN[0], { t: 'bid', amount: 101 })).toBe(false);
    expect(M02.validate(s, ELEVEN[0], { t: 'bid', amount: -1 })).toBe(false);
    expect(M02.validate(s, ELEVEN[0], { t: 'bid', amount: 1.5 })).toBe(false);
  });

  it('5品ごとに交換の時間。同意があれば資金と品物が同時に移り、持っていない物は渡せない', () => {
    const s = M02.init(ELEVEN, Rng.from(6));
    const [a, b] = ELEVEN;
    for (let i = 0; i < 5; i++) bidAll(s, (p) => (p === a ? 10 : 0));
    expect(s.stage).toBe('trade');
    const have = ITEMS.find((k) => s.items[a][k] > 0)!;
    const none = ITEMS.find((k) => s.items[b][k] === 0)!;
    expect(M02.validate(s, a, { t: 'offer', to: b, give: { money: 0, items: { [have]: 1 } }, take: { money: 0, items: { [none]: 1 } } })).toBe(false);
    expect(M02.validate(s, a, { t: 'offer', to: b, give: { money: 0, items: { [have]: 9 } }, take: { money: 10, items: {} } })).toBe(false);
    expect(M02.validate(s, a, { t: 'offer', to: b, give: { money: 0, items: {} }, take: { money: 101, items: {} } })).toBe(false);
    expect(M02.validate(s, a, { t: 'offer', to: a, give: { money: 1, items: {} }, take: { money: 0, items: {} } })).toBe(false);
    const fa = s.funds[a];
    M02.submit(s, a, { t: 'offer', to: b, give: { money: 0, items: { [have]: 1 } }, take: { money: 15, items: {} } });
    expect(M02.pending(s)).toEqual([b]);
    M02.submit(s, b, { t: 'answer', accept: true });
    expect(s.funds[a]).toBe(fa + 15);
    expect(s.funds[b]).toBe(85);
    expect(s.items[b][have]).toBe(1);
    // 断られた提案では何も動かない
    M02.submit(s, a, { t: 'offer', to: b, give: { money: 5, items: {} }, take: { money: 0, items: { [have]: 1 } } });
    M02.submit(s, b, { t: 'answer', accept: false });
    expect(s.items[b][have]).toBe(1);
    // 提案は 2 回まで
    expect(M02.validate(s, a, { t: 'offer', to: b, give: { money: 5, items: {} }, take: { money: 0, items: {} } })).toBe(false);
    for (const p of ELEVEN) M02.submit(s, p, { t: 'ready' });
    expect(s.stage).toBe('bid');
  });

  it('CPU 同士の対戦：資金と品物の総量が保たれ、資金は負にならず、必ず終局する', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const r = simulate('m02', seed, ELEVEN);
      const s = r.slot.state as M02State;
      const sold = s.history.filter((h) => h.winner).length;
      const paid = s.history.reduce((x, h) => x + h.price, 0);
      expect(s.history.length).toBe(20);
      expect(ELEVEN.reduce((x, p) => x + s.funds[p], 0)).toBe(START_FUNDS * 11 - paid);
      expect(ELEVEN.reduce((x, p) => x + ITEMS.reduce((y, k) => y + s.items[p][k], 0), 0)).toBe(sold);
      for (const p of ELEVEN) {
        expect(s.funds[p]).toBeGreaterThanOrEqual(0);
        for (const k of ITEMS) expect(s.items[p][k]).toBeGreaterThanOrEqual(0);
      }
      expect(r.ranking.flat().length).toBe(11);
    }
  });

  it('勝者と最下位が固定されない', () => {
    const top = new Map<string, number>();
    const bottom = new Map<string, number>();
    let unsold = 0;
    let trades = 0;
    const N = 150;
    for (let seed = 1; seed <= N; seed++) {
      const r = simulate('m02', seed * 7, ELEVEN);
      const order = r.ranking.flat();
      top.set(order[0], (top.get(order[0]) ?? 0) + 1);
      bottom.set(order[10], (bottom.get(order[10]) ?? 0) + 1);
      const s = r.slot.state as M02State;
      unsold += s.history.filter((h) => !h.winner).length;
      trades += s.trades.filter((x) => x.accepted).length;
    }
    console.log('m02 top', [...top.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' '));
    console.log('m02 bottom', [...bottom.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' '));
    console.log('m02 unsold/game', (unsold / N).toFixed(2), 'trades/game', (trades / N).toFixed(2));
    expect(top.size).toBeGreaterThanOrEqual(6);
    expect(bottom.size).toBeGreaterThanOrEqual(6);
    expect(Math.max(...top.values()) / N).toBeLessThan(0.4);
    expect(Math.max(...bottom.values()) / N).toBeLessThan(0.4);
    expect(unsold / N).toBeLessThan(3);
  });
});
