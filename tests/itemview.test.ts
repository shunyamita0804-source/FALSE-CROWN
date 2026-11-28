import { describe, expect, it } from 'vitest';
import { medalsOf, pieceLedger } from '../src/core/itemview';
import { applyRescue, forgoRescue, issueMedal, provisional } from '../src/core/rescue';
import { aliveIds, transfer } from '../src/core/state';
import { applyMainResult, endDay } from '../src/core/tournament';
import type { CharId } from '../src/data/characters';
import { CONFIG } from '../src/data/config';
import { freshState } from './helpers';

const heroFirst = (s: ReturnType<typeof freshState>): CharId[] => ['hero', ...aliveIds(s).filter((p) => p !== 'hero')];

describe('メインマッチの順位報酬と結果画面の数字', () => {
  it('生活棟は表どおり、監獄棟は 0。残高は報酬を受け取った直後の値', () => {
    const s = freshState(3);
    const ranking = aliveIds(s);
    const before = Object.fromEntries(ranking.map((p) => [p, s.actors[p].pieces]));
    const res = applyMainResult(s, ranking, {});
    ranking.forEach((p, i) => {
      const expected = res.living.includes(p) ? CONFIG.economy.m01Rewards[i] ?? 0 : 0;
      expect(res.rewards[p]).toBe(expected);
      expect(res.balances[p]).toBe(before[p] + expected);
    });
    for (const p of res.prison) expect(res.rewards[p]).toBe(0);
  });

  it('救いのメダルで棟が入れ替わっても、報酬と残高は変わらない', () => {
    const s = freshState(4);
    const res = applyMainResult(s, aliveIds(s), {});
    const r = issueMedal(s)!;
    const { prison, lowestLiving } = provisional(s);
    applyRescue(s, r.holder, prison[0]);
    for (const p of aliveIds(s)) expect(s.actors[p].pieces).toBe(res.balances[p]);
    expect(s.actors[lowestLiving!].house).toBe('prison');
    expect(res.rewards[lowestLiving!]).toBeGreaterThan(0);
    expect(res.rewards[prison[0]]).toBe(0);
  });
});

describe('手帳「アイテム」：ピースの出入り', () => {
  it('報酬・支払い・受け取りが新しい順に並び、残高が今の所持数と合う', () => {
    const s = freshState(5);
    applyMainResult(s, heroFirst(s), {});
    const npc = aliveIds(s).find((p) => p !== 'hero')!;
    transfer(s, 'hero', npc, 2, '情報の代金');
    transfer(s, npc, 'hero', 1, '返済');
    const led = pieceLedger(s);
    expect(led.balance).toBe(s.actors.hero.pieces);
    expect(led.initial).toBe(CONFIG.economy.initialPieces);
    expect(led.entries.map((e) => e.delta)).toEqual([1, -2, CONFIG.economy.m01Rewards[0]]);
    expect(led.entries[0].after).toBe(led.balance);
    expect(led.entries[1].other).toBe(npc);
    expect(led.entries[2].other).toBeNull();
    expect(led.entries[2].after).toBe(CONFIG.economy.initialPieces + CONFIG.economy.m01Rewards[0]);
    expect(led.totalIn).toBe(CONFIG.economy.m01Rewards[0] + 1);
    expect(led.totalOut).toBe(2);
  });

  it('他の人どうしの出入りは載らず、開いても状態を変えない', () => {
    const s = freshState(6);
    const [a, b] = aliveIds(s).filter((p) => p !== 'hero');
    transfer(s, a, b, 1, 'NPC どうし');
    const n = s.facts.length;
    expect(pieceLedger(s).entries).toEqual([]);
    expect(s.facts.length).toBe(n);
  });
});

describe('手帳「アイテム」：救いのメダル', () => {
  it('持っている間は所持中、使えば使用済み、使わなければ日をまたいで失効', () => {
    const s = freshState(7);
    expect(medalsOf(s)).toEqual([]);
    applyMainResult(s, heroFirst(s), {});
    issueMedal(s);
    expect(medalsOf(s)).toMatchObject([{ day: 1, status: 'held' }]);
    const target = provisional(s).prison[0];
    applyRescue(s, 'hero', target);
    expect(medalsOf(s)[0]).toMatchObject({ day: 1, status: 'used', target });
    endDay(s);
    // 2 日目も 1 位。今度は使わない
    applyMainResult(s, heroFirst(s), {});
    issueMedal(s);
    forgoRescue(s, 'hero');
    endDay(s);
    expect(medalsOf(s).map((m) => [m.day, m.status])).toEqual([[2, 'unused'], [1, 'used']]);
  });

  it('他の人のメダルは主人公の所持に入らない', () => {
    const s = freshState(8);
    const ranking = aliveIds(s).filter((p) => p !== 'hero');
    applyMainResult(s, [...ranking, 'hero'], {});
    issueMedal(s);
    expect(medalsOf(s)).toEqual([]);
    expect(medalsOf(s, ranking[0])).toHaveLength(1);
  });
});
