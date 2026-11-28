import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/data/config';
import { newSlot } from '../src/core/runner';
import { Rng } from '../src/core/rng';
import { aliveIds, rel } from '../src/core/state';
import { askTip, finishStrategy, groupOf, newStrategy, planSlot, startStrategy, STRATEGY_ROOMS, strategyEnabled, talkRule, tipsOf } from '../src/core/strategy';
import { phaseDuration } from '../src/core/clock';
import { startMorning } from '../src/core/tournament';
import { chooseProposal, fastForward } from '../src/npc/brain';
import { commit, consumePledges, evaluate } from '../src/npc/negotiation';
import { findPath } from '../src/world/path';
import { collisionOf } from '../src/world/sim';
import type { NpcId } from '../src/data/characters';
import { freshState } from './helpers';

const K: NpcId = 'npc_02_kanzaki';
const T: NpcId = 'npc_07_tachibana';

describe('生活中の緩い約束（本人の決定 2026-11-28）', () => {
  it('生活中、NPC は同盟や不可侵ではなく緩い約束だけを持ちかける', () => {
    let pledges = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const s = freshState(seed);
      const rng = new Rng({ s: seed } as never);
      void rng;
      for (const a of aliveIds(s).filter((x): x is NpcId => x !== 'hero')) {
        for (const b of aliveIds(s)) {
          if (a === b) continue;
          const p = chooseProposal(s, a, b, Rng.derive(seed, `${a}${b}`), 'life');
          if (!p) continue;
          expect(['pledge', 'info_sell', 'loan']).toContain(p.kind);
          if (p.kind === 'pledge') { pledges++; expect(p.payNow).toBe(0); expect(p.payOnSuccess).toBe(0); }
        }
      }
    }
    expect(pledges).toBeGreaterThan(0);
  });

  it('自由時間を進めると、NPC 同士の緩い約束はできるが、支払い付きの同盟はできない', () => {
    const s = freshState(3);
    s.phase = 'morning';
    startMorning(s);
    s.phaseLeft = phaseDuration('morning');
    fastForward(s, 3 * 60 * 60 * 1000);
    expect(s.deals.some((d) => d.kind === 'pledge')).toBe(true);
    expect(s.deals.some((d) => d.kind === 'alliance' || d.kind === 'nonaggression')).toBe(false);
  });

  it('緩い約束は、同じ競技に出たら使い終える。断られても約束破り（裏切りの記録）にはならない', () => {
    const s = freshState(5);
    const d = commit(s, { kind: 'pledge', from: K, to: T, payNow: 0, payOnSuccess: 0, untilDay: 3 });
    expect(d).not.toBeNull();
    // 競技で協力を断られても、裏切りの記録は付かない
    const before = s.infos ? Object.values(s.infos).filter((i) => i.kind === 'betrayal').length : 0;
    consumePledges(s, aliveIds(s));
    expect(d!.status).toBe('expired');
    expect(Object.values(s.infos).filter((i) => i.kind === 'betrayal').length).toBe(before);
    expect(Number(s.flags[`betrayals_${K}`] ?? 0)).toBe(0);
  });

  it('緩い約束は、競技での協力の話の材料になる（同じ相手でも、約束があれば応じやすい）', () => {
    let withP = 0;
    let without = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const a = freshState(seed);
      const b = freshState(seed);
      commit(a, { kind: 'pledge', from: 'hero', to: 'npc_04_mido', payNow: 0, payOnSuccess: 0, untilDay: 3 });
      const p = { kind: 'alliance' as const, from: 'hero' as const, to: 'npc_04_mido' as const, payNow: 1, payOnSuccess: 0, untilDay: 1 };
      if (evaluate(a, p).accept) withP++;
      if (evaluate(b, p).accept) without++;
    }
    expect(withP).toBeGreaterThanOrEqual(without);
  });
});

describe('作戦時間（M01 の試作）', () => {
  it('M01 だけが作戦時間を使う。最大 2 分、4 枠', () => {
    expect(strategyEnabled('m01')).toBe(true);
    for (const id of ['m02', 'm03', 'm04', 'm05', 'm06', 'm07', 'm08', 'm09', 'm10', 'm11', 'p01', 'p05', 'p10']) expect(strategyEnabled(id)).toBe(false);
    const s = freshState(1);
    const st = newStrategy(s, 'm01');
    expect(st.slots).toBe(4);
    expect(st.slots * st.slotMs).toBeLessThanOrEqual(120_000);
    expect(talkRule('m01').window).toBe('between');
  });

  it('NPC 同士の相談が進み、同じ組の仲間ほど協力が成立しやすい。ピースの総数は変わらない', () => {
    let mateDeals = 0;
    let otherDeals = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const s = freshState(seed);
      const total = Object.values(s.actors).reduce((n, a) => n + a.pieces, 0);
      const slot = newSlot(s, 'm01', aliveIds(s), 'main');
      const st = newStrategy(s, 'm01');
      finishStrategy(s, slot, st, Rng.derive(seed, 'strat'));
      expect(st.done).toBe(true);
      expect(st.meetings.length).toBeGreaterThan(0);
      for (const d of s.deals.filter((x) => x.kind === 'alliance' && x.status === 'active')) {
        if (groupOf(slot, d.from).includes(d.to)) mateDeals++;
        else otherDeals++;
      }
      expect(Object.values(s.actors).reduce((n, a) => n + a.pieces, 0)).toBe(total);
      // 1 枠に 1 人が入る相談は 1 つだけ
      for (let k = 0; k < st.slots; k++) {
        const seen = new Set<string>();
        for (const m of st.meetings.filter((x) => x.slot === k)) for (const id of m.members) { expect(seen.has(id)).toBe(false); seen.add(id); }
      }
    }
    expect(mateDeals).toBeGreaterThan(otherDeals);
  });

  it('主人公は誘いを受けても、受けなくても大会は進む（主人公の不在で NPC の相談が止まらない）', () => {
    const s = freshState(7);
    const slot = newSlot(s, 'm01', aliveIds(s), 'main');
    const st = newStrategy(s, 'm01');
    startStrategy(s, slot, st, Rng.derive(7, 'a'));
    finishStrategy(s, slot, st, Rng.derive(7, 'b'));
    expect(st.meetings.every((m) => m.resolved)).toBe(true);
    expect(st.meetings.filter((m) => m.members.length >= 2 && !m.members.includes('hero')).length).toBeGreaterThan(0);
  });

  it('コツは実際の M01 の考え方。教わっても関係が上がるのは競技 1 回に 1 度だけ', () => {
    const s = freshState(9);
    const slot = newSlot(s, 'm01', aliveIds(s), 'main');
    const st = newStrategy(s, 'm01');
    expect(tipsOf('m01').length).toBeGreaterThanOrEqual(6);
    // 同じ組で信頼のある相手なら教えてくれる
    const mate = groupOf(slot, 'hero').find((x) => x !== 'hero') as NpcId;
    rel(s, mate, 'hero').trust = 70;
    const r0 = { ...rel(s, mate, 'hero') };
    const a1 = askTip(s, slot, st, mate, 'hero', Rng.derive(1, 'x'));
    expect(a1.kind).toBe('give');
    const r1 = { ...rel(s, mate, 'hero') };
    expect(r1.trust).toBeGreaterThan(r0.trust);
    for (let i = 0; i < 5; i++) expect(askTip(s, slot, st, mate, 'hero', Rng.derive(i, 'y')).kind).toBe('again');
    expect(rel(s, mate, 'hero')).toEqual(r1);
    planSlot(s, slot, st, Rng.derive(2, 'z'));
  });

  it('移動だけで相談時間を使い切らない：組の集合位置から自分の組の相談室まで 1 枠の 3 分の 1 以内。会場の端から端でも 1 枠は使い切らない', () => {
    const s = freshState(1);
    const grid = collisionOf(s, 'main_arena');
    const st = newStrategy(s, 'm01');
    const secs = (tiles: number, speed: number) => (tiles / speed) * 1000;
    let ownNpc = 0;
    let crossNpc = 0;
    let crossHero = 0;
    for (const r of STRATEGY_ROOMS) {
      for (const [x, y] of r.wait ?? []) {
        // 集合位置と入口は歩けるマス
        expect(grid[y][x]).toBe(false);
        for (const r2 of STRATEGY_ROOMS) {
          const path = findPath(grid, { x, y }, { x: r2.x, y: r2.y });
          expect(path).not.toBeNull();
          if (r2 === r) ownNpc = Math.max(ownNpc, secs(path!.length, CONFIG.npc.walkSpeed));
          else { crossNpc = Math.max(crossNpc, secs(path!.length, CONFIG.npc.walkSpeed)); crossHero = Math.max(crossHero, secs(path!.length, CONFIG.npc.heroWalkSpeed)); }
        }
      }
      expect(grid[r.y][r.x]).toBe(false);
    }
    // 結果は docs/venue_talk.md に記録する
    console.log(`[strategy] 1 枠 ${st.slotMs / 1000} 秒。自分の組の相談室まで NPC ${(ownNpc / 1000).toFixed(1)} 秒。別の相談室まで NPC ${(crossNpc / 1000).toFixed(1)} 秒、主人公 ${(crossHero / 1000).toFixed(1)} 秒`);
    expect(ownNpc).toBeLessThan(st.slotMs / 3);
    expect(crossHero).toBeLessThan(st.slotMs / 3);
    // 別の組の相談室へ呼ばれた NPC は、端から端で半枠ほど歩く。呼ぶ側は近い部屋を選ぶ（ui/strategy.ts の inviteToRoom）。1 枠は使い切らない
    expect(crossNpc).toBeLessThan(st.slotMs * 0.6);
  });
});
