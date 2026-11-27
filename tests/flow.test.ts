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
      // 救いのメダルで入れ替わることがあるため、順位ではなく監獄マッチの参加者で確かめる
      expect(prison.length).toBe(4);
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

  it('DAY2 は旧ルールの競技しかないため、本編では DAY2 の朝で止まる（v11 で置き換えるまで完成扱いにしない）', async () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = freshState(seed * 13);
      s.phase = 'morning';
      const ok = await autoAdvance(s, 3, 'morning');
      expect(ok).toBe(false);
      if (!s.actors.hero.alive) continue;
      expect(s.day).toBe(2);
      expect(s.phase).toBe('morning');
      expect(aliveIds(s).length).toBe(11);
    }
  }, 60_000);

  it('救いのメダルが使われても、脱落するのは監獄棟に配属された人の最下位 1 人だけ', async () => {
    let used = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const s = freshState(seed * 17);
      s.phase = 'morning';
      await autoAdvance(s, 2, 'morning', { free: seed % 10 === 0 });
      const rec = s.history[0];
      const main = rec?.mainRanking ?? s.today.mainRanking!;
      const prisonRank = rec?.prisonRanking ?? s.today.prisonRanking!;
      const rescue = rec?.rescue ?? s.today.rescue;
      const out = Object.values(s.actors).find((a) => !a.alive)!;
      expect(prisonRank.length).toBe(4);
      expect(prisonRank.at(-1)).toBe(out.id);
      expect(rescue).toBeDefined();
      expect(rescue!.holder).toBe(main[0]);
      expect(prisonRank).not.toContain(main[0]);
      if (rescue!.status === 'used') {
        used++;
        expect(prisonRank).toContain(rescue!.swapped);
        expect(prisonRank).not.toContain(rescue!.target);
      } else expect([...prisonRank].sort()).toEqual([...main.slice(8)].sort());
    }
    console.log('DAY1 自動進行 60 回のうち、救いのメダルが使われた回数', used);
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
