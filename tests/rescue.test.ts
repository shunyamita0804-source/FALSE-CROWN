import { describe, expect, it } from 'vitest';
import { applyRescue, autoRescue, declineRescue, forgoRescue, issueMedal, npcAcceptsRescue, npcChooseRescue, promiseRescue, provisional, rescueCandidates, rescueError, resolveNpcRescue } from '../src/core/rescue';
import { aliveIds, rel } from '../src/core/state';
import { applyMainResult, eliminate } from '../src/core/tournament';
import type { GameState } from '../src/core/types';
import { ALL_IDS, NPC_IDS, type CharId } from '../src/data/characters';
import { scheduleFor } from '../src/data/config';
import { Rng } from '../src/core/rng';
import { freshState } from './helpers';

/** day 日目の順位発表直後の状態を作る。ranking を渡さなければ ID 順 */
function ranked(day: number, order?: CharId[], seed = 1): GameState {
  const s = freshState(seed);
  for (let d = 1; d < day; d++) {
    const alive = aliveIds(s);
    eliminate(s, alive.filter((p) => p !== 'hero').at(-1)!);
    s.day = d + 1;
  }
  const alive = aliveIds(s);
  const ranking = order ? [...order.filter((p) => alive.includes(p)), ...alive.filter((p) => !order.includes(p))] : alive;
  applyMainResult(s, ranking, {});
  return s;
}
const bond = (s: GameState, a: CharId, b: CharId, like = 90) => { const r = rel(s, a, b); r.like = like; r.trust = 80; };
const houses = (s: GameState) => ({ living: aliveIds(s).filter((p) => s.actors[p].house === 'living').length, prison: aliveIds(s).filter((p) => s.actors[p].house === 'prison').length });

describe('救いのメダル（v11）', () => {
  it('DAY1〜9 は 1 位に 1 枚だけ発行され、DAY10・11 は発行されない', () => {
    for (let day = 1; day <= 9; day++) {
      const s = ranked(day);
      const r = issueMedal(s)!;
      expect(r.holder).toBe(s.today.mainRanking![0]);
      expect(issueMedal(s)).toBe(r);
    }
    const s10 = ranked(10);
    expect(issueMedal(s10)).toBeNull();
    expect(s10.today.rescue).toBeUndefined();
  });

  it('使うと指名した人と生活棟の最下位が入れ替わり、人数と順位報酬は変わらない', () => {
    for (let day = 1; day <= 9; day++) {
      const s = ranked(day);
      const before = houses(s);
      const pieces = Object.fromEntries(aliveIds(s).map((p) => [p, s.actors[p].pieces]));
      const r = issueMedal(s)!;
      const { prison, lowestLiving } = provisional(s);
      const target = prison[0];
      const swapped = applyRescue(s, r.holder, target);
      expect(swapped).toBe(lowestLiving);
      expect(s.actors[target].house).toBe('living');
      expect(s.actors[swapped].house).toBe('prison');
      expect(s.actors[r.holder].house).toBe('living');
      expect(houses(s)).toEqual(before);
      expect(houses(s).prison).toBe(scheduleFor(day).prison);
      for (const p of aliveIds(s)) expect(s.actors[p].pieces).toBe(pieces[p]);
      expect(r.status).toBe('used');
    }
  });

  it('自分、生活棟の人、脱落者には使えない。2 度は使えない', () => {
    const s = ranked(1);
    const r = issueMedal(s)!;
    const { living, prison } = provisional(s);
    expect(rescueError(s, r.holder, r.holder)).not.toBeNull();
    expect(rescueError(s, r.holder, living[3])).not.toBeNull();
    expect(rescueError(s, living[1], prison[0])).not.toBeNull();
    applyRescue(s, r.holder, prison[0]);
    expect(rescueError(s, r.holder, prison[1])).not.toBeNull();
    expect(() => applyRescue(s, r.holder, prison[1])).toThrow();
    expect(houses(s).prison).toBe(4);
  });

  it('使わなければ配属は順位のまま', () => {
    const s = ranked(3);
    const r = issueMedal(s)!;
    const snap = aliveIds(s).map((p) => s.actors[p].house);
    forgoRescue(s, r.holder);
    expect(r.status).toBe('forgone');
    expect(aliveIds(s).map((p) => s.actors[p].house)).toEqual(snap);
    expect(rescueCandidates(s)).toEqual([]);
  });

  it('指名された本人は辞退でき、辞退した人はもう指名できない', () => {
    const s = ranked(1);
    const r = issueMedal(s)!;
    const { prison } = provisional(s);
    declineRescue(s, prison[0]);
    expect(rescueCandidates(s)).not.toContain(prison[0]);
    expect(rescueError(s, r.holder, prison[0])).not.toBeNull();
    applyRescue(s, r.holder, prison[1]);
    expect(s.actors[prison[1]].house).toBe('living');
  });

  it('NPC の 1 位は関係で決める：親しい人を救い、関係が薄ければ使わない', () => {
    const order: CharId[] = [...NPC_IDS, 'hero'];
    const s = ranked(1, order);
    issueMedal(s);
    const holder = NPC_IDS[0];
    expect(npcChooseRescue(s, holder)).toBeNull();
    bond(s, holder, NPC_IDS[9]);
    expect(npcChooseRescue(s, holder)).toBe(NPC_IDS[9]);
    autoRescue(s);
    expect(s.today.rescue!.target).toBe(NPC_IDS[9]);
    expect(s.today.rescue!.swapped).toBe(NPC_IDS[7]);
  });

  it('主人公は入れ替えられる側になると拒否できず、救われる側なら辞退できる', async () => {
    // 主人公が生活棟の最下位
    const o1: CharId[] = [...NPC_IDS.slice(0, 7), 'hero', ...NPC_IDS.slice(7)];
    const s1 = ranked(1, o1);
    issueMedal(s1);
    bond(s1, NPC_IDS[0], NPC_IDS[10]);
    let asked = 0;
    await resolveNpcRescue(s1, async () => { asked++; return false; });
    expect(asked).toBe(0);
    expect(s1.actors.hero.house).toBe('prison');
    // 主人公が監獄棟の予定で、1 位が主人公を救おうとする
    const s2 = ranked(1, [...NPC_IDS, 'hero']);
    issueMedal(s2);
    bond(s2, NPC_IDS[0], 'hero');
    await resolveNpcRescue(s2, async () => false);
    expect(s2.actors.hero.house).toBe('prison');
    expect(s2.today.rescue!.declined).toContain('hero');
    expect(s2.today.rescue!.status).toBe('forgone');
    const s3 = ranked(1, [...NPC_IDS, 'hero']);
    issueMedal(s3);
    bond(s3, NPC_IDS[0], 'hero');
    await resolveNpcRescue(s3, async () => true);
    expect(s3.actors.hero.house).toBe('living');
    expect(rel(s3, 'hero', NPC_IDS[0]).debt).toBeGreaterThan(0);
  });

  it('救われた人は恩義を、入れ替えられた人は敵意を持つ', () => {
    const s = ranked(2);
    const r = issueMedal(s)!;
    const { prison } = provisional(s);
    const swapped = applyRescue(s, r.holder, prison[0]);
    expect(rel(s, prison[0], r.holder).debt).toBeGreaterThanOrEqual(30);
    expect(rel(s, swapped, r.holder).hostility).toBeGreaterThanOrEqual(25);
    expect(s.facts.some((f) => f.type === 'rescue')).toBe(true);
    expect(s.board.some((b) => b.text.includes('救いのメダル'))).toBe(true);
  });

  it('救済の約束を破ると、約束した相手の信頼を失い、裏切りとして記録される', () => {
    const s = ranked(1);
    const holder = s.today.mainRanking![0];
    const { prison } = provisional(s);
    promiseRescue(s, holder, prison[0]);
    const trust0 = rel(s, prison[0], holder).trust;
    issueMedal(s);
    applyRescue(s, holder, prison[1]);
    expect(rel(s, prison[0], holder).trust).toBeLessThan(trust0);
    expect(Object.values(s.infos).some((i) => i.kind === 'betrayal' && i.about.includes(holder))).toBe(true);
    // 約束を守った場合は記録されない
    const s2 = ranked(1);
    promiseRescue(s2, holder, prison[0]);
    issueMedal(s2);
    applyRescue(s2, holder, prison[0]);
    expect(Object.values(s2.infos).some((i) => i.kind === 'betrayal')).toBe(false);
  });

  it('保存して読み込んでも、使用済みのメダルは使えない', () => {
    const s = ranked(1);
    const r = issueMedal(s)!;
    applyRescue(s, r.holder, provisional(s).prison[0]);
    const loaded = JSON.parse(JSON.stringify(s)) as GameState;
    expect(issueMedal(loaded)!.status).toBe('used');
    expect(rescueError(loaded, r.holder, provisional(loaded).prison[1])).not.toBeNull();
    expect(houses(loaded).prison).toBe(4);
  });

  it('強く嫌っている相手からの救済は断る', () => {
    const s = ranked(1);
    const r = issueMedal(s)!;
    const target = provisional(s).prison[0] as (typeof NPC_IDS)[number];
    expect(npcAcceptsRescue(s, target, r.holder)).toBe(true);
    rel(s, target, r.holder).hostility = 80;
    expect(npcAcceptsRescue(s, target, r.holder)).toBe(false);
  });

  it('主人公への補正がない：関係を無作為に与えた時、主人公が救われる割合は他の参加者と同じ水準', () => {
    const saved: Record<string, number> = {};
    const eligible: Record<string, number> = {};
    for (let seed = 1; seed <= 600; seed++) {
      const rng = Rng.from(seed * 7919);
      const order = rng.shuffle([...ALL_IDS]);
      const s = ranked(1, order, seed);
      for (const a of ALL_IDS) for (const b of ALL_IDS) if (a !== b) { const r = rel(s, a, b); r.like = rng.int(-60, 90); r.trust = rng.int(0, 90); r.hostility = rng.int(0, 40); }
      for (const p of provisional(s).prison) eligible[p] = (eligible[p] ?? 0) + 1;
      const r = autoRescue(s);
      if (r?.status === 'used') saved[r.target!] = (saved[r.target!] ?? 0) + 1;
    }
    const rate = (id: string) => (saved[id] ?? 0) / Math.max(1, eligible[id] ?? 0);
    const npcRates = NPC_IDS.map(rate);
    const avg = npcRates.reduce((a, b) => a + b, 0) / npcRates.length;
    expect(avg).toBeGreaterThan(0.02);
    console.log('救済率 主人公', rate('hero').toFixed(3), 'NPC 平均', avg.toFixed(3), 'NPC 範囲', Math.min(...npcRates).toFixed(3), Math.max(...npcRates).toFixed(3));
    expect(rate('hero')).toBeGreaterThan(Math.min(...npcRates) - 0.08);
    expect(rate('hero')).toBeLessThan(Math.max(...npcRates) + 0.08);
  });
});
