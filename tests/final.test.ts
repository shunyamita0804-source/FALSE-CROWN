import { describe, expect, it } from 'vitest';
import { autoAdvance } from '../src/core/autoplay';
import { rel } from '../src/core/state';
import { championEnding, ENDING_RULE, isFinalDay } from '../src/core/tournament';
import { NPC_IDS } from '../src/data/characters';
import { freshState } from './helpers';

describe('決勝の日と優勝の結末', () => {
  it('決勝は DAY 11 だけ', () => {
    for (let d = 1; d <= 11; d++) expect(isFinalDay(d)).toBe(d === 11);
  });

  it('結末の決まり：破った約束 4 つ以上は孤独な王、果たした約束 4 つ以上と信頼 3 人以上は信頼の証、それ以外は王者', () => {
    const s = freshState(5);
    for (const id of NPC_IDS) rel(s, id, 'hero').trust = 40;
    expect(championEnding(s)).toBe('E_WIN');
    const deal = (i: number) => ({ id: `t${i}`, day: 1, from: 'hero' as const, to: NPC_IDS[i], kind: 'plan' as const, payNow: 0, payOnSuccess: 0, untilDay: 3, status: 'fulfilled' as const, witnesses: [], createdAt: 0 });
    for (let i = 0; i < ENDING_RULE.bondDeals; i++) s.deals.push(deal(i));
    expect(championEnding(s)).toBe('E_WIN'); // 信頼が足りない
    for (let i = 0; i < ENDING_RULE.bondPeople - 1; i++) rel(s, NPC_IDS[i], 'hero').trust = 70;
    expect(championEnding(s)).toBe('E_WIN');
    rel(s, NPC_IDS[5], 'hero').trust = 90;
    expect(championEnding(s)).toBe('E_BOND');
    // 両方に当てはまるときは孤独な王を優先
    s.flags.betrayals_hero = ENDING_RULE.loneBetrayals - 1;
    expect(championEnding(s)).toBe('E_BOND');
    s.flags.betrayals_hero = ENDING_RULE.loneBetrayals;
    expect(championEnding(s)).toBe('E_LONE');
  });

  it('自動対戦で決勝まで進むと、2 人のうち 1 人が優勝する。主人公が優勝する割合に偏りがない', async () => {
    let reached = 0, heroWin = 0, total = 0;
    const champs: Record<string, number> = {};
    for (let seed = 1; seed <= 40; seed++) {
      const s = freshState(seed * 31);
      s.phase = 'morning';
      await autoAdvance(s, 11, 'reward');
      total++;
      if (s.day !== 11 || s.phase !== 'reward') { expect(s.actors.hero.alive).toBe(false); continue; }
      reached++;
      const r = s.today.mainRanking!;
      expect(r.length).toBe(2);
      expect(r).toContain('hero');
      champs[r[0]] = (champs[r[0]] ?? 0) + 1;
      if (r[0] === 'hero') heroWin++;
    }
    console.log(`final: total=${total} heroReached=${reached} heroChampion=${heroWin}`);
    // 12 人中 2 人が決勝に残る。主人公が毎回残る、毎回勝つ、ということがない
    expect(reached).toBeLessThan(total * 0.5);
  }, 120_000);
});
