import { describe, expect, it } from 'vitest';
import { autoAdvance } from '../src/core/autoplay';
import { aliveIds } from '../src/core/state';
import jaUi from '../src/locales/ja/ui.json';
import enUi from '../src/locales/en/ui.json';
import { freshState } from './helpers';

describe('1日の進行（自動対戦）', () => {
  it('DAY1 を終えると必ず 1 人だけ脱落し、DAY2 の朝に進む', async () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = freshState(seed);
      s.phase = 'morning';
      await autoAdvance(s, 2, 'morning');
      const out = Object.values(s.actors).filter((a) => !a.alive);
      expect(out.length).toBe(1);
      expect(out[0].eliminatedDay).toBe(1);
      expect(out[0].pieces).toBe(0);
      // 脱落者は当日の監獄棟（メイン下位 4 人）の中から出る
      // 主人公が脱落した場合は終局するため、当日の記録（today）を見る
      const main = s.history[0]?.mainRanking ?? s.today.mainRanking!;
      const prison = s.history[0]?.prisonRanking ?? s.today.prisonRanking!;
      expect(main.slice(8)).toContain(out[0].id);
      expect(prison.at(-1)).toBe(out[0].id);
      if (s.actors.hero.alive) {
        expect(s.day).toBe(2);
        expect(aliveIds(s).length).toBe(11);
      }
    }
  });

  it('主人公への補正がない：CPU 操作の主人公も初日に脱落することがあり、脱落者は毎回同じではない', async () => {
    const outs = new Map<string, number>();
    const N = 120;
    for (let seed = 100; seed < 100 + N; seed++) {
      const s = freshState(seed);
      s.phase = 'morning';
      await autoAdvance(s, 2, 'morning');
      const out = Object.values(s.actors).find((a) => !a.alive)!;
      outs.set(out.id, (outs.get(out.id) ?? 0) + 1);
    }
    expect(outs.get('hero') ?? 0).toBeGreaterThan(0);
    // 脱落者が固定されていない（多数の人物が脱落し得る）
    expect(outs.size).toBeGreaterThanOrEqual(6);
    for (const n of outs.values()) expect(n).toBeLessThan(N * 0.5);
  });

  it('DAY2（M02 と P02）を終えると合計 2 人が脱落し、DAY3 の朝に進む。脱落者は固定されない', async () => {
    const outs = new Map<string, number>();
    let reached = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const s = freshState(seed * 13);
      s.phase = 'morning';
      await autoAdvance(s, 3, 'morning', { free: seed % 20 === 0 });
      if (!s.actors.hero.alive) continue;
      reached++;
      expect(s.day).toBe(3);
      expect(aliveIds(s).length).toBe(10);
      const d2 = Object.values(s.actors).find((a) => !a.alive && a.eliminatedDay === 2)!;
      expect(s.history[1].mainRanking!.slice(7)).toContain(d2.id);
      outs.set(d2.id, (outs.get(d2.id) ?? 0) + 1);
      for (const a of Object.values(s.actors)) expect(a.pieces).toBeGreaterThanOrEqual(0);
    }
    expect(reached).toBeGreaterThan(30);
    expect(outs.size).toBeGreaterThanOrEqual(5);
  }, 60_000);

  it('ピースは増減の合計が合う（報酬は主催者から、脱落者の分は回収）', async () => {
    const s = freshState(7);
    s.phase = 'morning';
    await autoAdvance(s, 2, 'morning', { free: true });
    const total = Object.values(s.actors).reduce((a, x) => a + x.pieces, 0);
    const granted = 5 + 3 + 3 + 2 + 2 + 2 + 1 + 1;
    expect(total).toBeLessThanOrEqual(36 + granted);
    expect(total).toBeGreaterThanOrEqual(36 + granted - 20);
    for (const a of Object.values(s.actors)) expect(a.pieces).toBeGreaterThanOrEqual(0);
  });
});

describe('文言', () => {
  it('英語の文言キーは日本語にも存在する', () => {
    for (const k of Object.keys(enUi)) expect(Object.keys(jaUi)).toContain(k);
  });
});
