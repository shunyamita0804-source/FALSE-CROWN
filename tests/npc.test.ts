import { describe, expect, it } from 'vitest';
import { NPC_IDS, PROFILES, type NpcId } from '../src/data/characters';
import dialogue from '../src/data/dialogue.json';
import { tickNpcs } from '../src/npc/brain';
import { commit, evaluate, type Proposal } from '../src/npc/negotiation';
import { adjustRel, rel } from '../src/core/state';
import { canEnter } from '../src/world/access';
import { ROOMS } from '../src/world/maps';
import { placeIn } from '../src/world/sim';
import { freshState } from './helpers';

function totalPieces(s: ReturnType<typeof freshState>) {
  return Object.values(s.actors).reduce((a, x) => a + x.pieces, 0);
}

describe('NPC データ', () => {
  it('プロフィールと台詞が仕様どおり揃っている', () => {
    const entries = (dialogue as { entries: { id: string; npcId: string; event: string }[] }).entries;
    expect(entries.length).toBe(517);
    expect(new Set(entries.map((e) => e.id)).size).toBe(517);
    for (const id of NPC_IDS) {
      expect(PROFILES[id]).toBeTruthy();
      expect(new Set(entries.filter((e) => e.npcId === id).map((e) => e.event)).size).toBe(32);
      for (const v of Object.values(PROFILES[id].personality)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(100); }
    }
  });
});

describe('交渉', () => {
  it('関係は方向付き：贈与で受け手→贈り手だけが変わる', () => {
    const s = freshState(1);
    const before = { ...rel(s, 'hero', 'npc_04_mido') };
    const b2 = { ...rel(s, 'npc_04_mido', 'hero') };
    commit(s, { kind: 'gift', from: 'hero', to: 'npc_04_mido', payNow: 2, payOnSuccess: 0, untilDay: 1 });
    expect(rel(s, 'hero', 'npc_04_mido')).toEqual(before);
    expect(rel(s, 'npc_04_mido', 'hero').debt).toBe(b2.debt + 4);
    expect(s.actors.hero.pieces).toBe(1);
    expect(s.actors.npc_04_mido.pieces).toBe(5);
  });

  it('残高不足・負数・小数の取引は成立しない。総量は保存される', () => {
    const s = freshState(2);
    const total = totalPieces(s);
    expect(commit(s, { kind: 'gift', from: 'hero', to: 'npc_04_mido', payNow: 10, payOnSuccess: 0, untilDay: 1 })).toBeNull();
    expect(evaluate(s, { kind: 'alliance', from: 'hero', to: 'npc_04_mido', payNow: 1.5, payOnSuccess: 0, untilDay: 1 }).accept).toBe(false);
    expect(evaluate(s, { kind: 'alliance', from: 'hero', to: 'npc_04_mido', payNow: 99, payOnSuccess: 0, untilDay: 1 }).accept).toBe(false);
    commit(s, { kind: 'alliance', from: 'hero', to: 'npc_04_mido', payNow: 3, payOnSuccess: 0, untilDay: 1 });
    expect(totalPieces(s)).toBe(total);
    expect(s.actors.hero.pieces).toBe(0);
  });

  it('橘は、信頼している仲間への裏切り（引抜き）をいくら積まれても拒否する', () => {
    for (const amount of [1, 5, 10, 100]) {
      const s = freshState(3);
      s.actors.hero.pieces = 200;
      commit(s, { kind: 'alliance', from: 'npc_09_asahina', to: 'npc_07_tachibana', payNow: 0, payOnSuccess: 0, untilDay: 3 });
      adjustRel(s, 'npc_07_tachibana', 'npc_09_asahina', { trust: 40 });
      const v = evaluate(s, { kind: 'poach', from: 'hero', to: 'npc_07_tachibana', target: 'npc_09_asahina', payNow: amount, payOnSuccess: 0, untilDay: 1 });
      expect(v.accept).toBe(false);
      expect(v.reason).toBe('reject_principle');
    }
  });

  it('神崎は、自分の期待改善がない協力依頼を高額でも拒否する', () => {
    const s = freshState(4);
    s.actors.hero.pieces = 200;
    const p: Proposal = { kind: 'plan', from: 'hero', to: 'npc_02_kanzaki', performer: 'npc_02_kanzaki', plan: { match: 'm01', code: 'produce', label: '生産する' }, planCost: 2, payNow: 100, payOnSuccess: 0, untilDay: 1 };
    expect(evaluate(s, p).accept).toBe(false);
    expect(evaluate(s, { ...p, planCost: 0, payNow: 0 }).accept).toBe(true);
  });

  it('御堂は金額で動き、信頼・恩義・敵対で要求額が変わる', () => {
    const s = freshState(5);
    s.actors.hero.pieces = 20;
    const mk = (pay: number): Proposal => ({ kind: 'alliance', from: 'hero', to: 'npc_04_mido', payNow: pay, payOnSuccess: 0, untilDay: 1 });
    const low = evaluate(s, mk(0));
    expect(low.accept).toBe(false);
    expect(low.counter?.payNow).toBeGreaterThan(0);
    const ask = low.counter!.payNow!;
    expect(evaluate(s, mk(ask)).accept).toBe(true);
    // 信頼と恩義が高いと安くなる
    adjustRel(s, 'npc_04_mido', 'hero', { trust: 40, debt: 50 });
    const ask2 = evaluate(s, mk(0)).counter?.payNow ?? 0;
    expect(ask2).toBeLessThan(ask);
    // 敵対していると高くなる（または拒否）
    const s2 = freshState(5);
    s2.actors.hero.pieces = 20;
    adjustRel(s2, 'npc_04_mido', 'hero', { hostility: 50, wary: 30 });
    const v3 = evaluate(s2, { ...mk(0), to: 'npc_04_mido' });
    expect(v3.accept).toBe(false);
    expect(v3.counter?.payNow ?? 99).toBeGreaterThan(ask);
  });

  it('堂島は根拠のない告発を採用しない', () => {
    const s = freshState(6);
    adjustRel(s, 'npc_08_dojima', 'hero', { trust: 60 });
    const v = evaluate(s, { kind: 'accuse', from: 'hero', to: 'npc_08_dojima', target: 'npc_04_mido', payNow: 0, payOnSuccess: 0, untilDay: 1 });
    expect(v.accept).toBe(false);
  });
});

describe('自律行動', () => {
  it('NPC 同士の会話・合意が実際に起こり、立入制限と総ピース数が守られる', () => {
    const s = freshState(11);
    s.phase = 'morning';
    for (const id of NPC_IDS) placeIn(s, id, 'main_hall');
    placeIn(s, 'hero', 'bedroom_hero');
    const total = totalPieces(s);
    for (let t = 0; t < 5 * 60_000; t += 250) {
      s.simTime += 250;
      tickNpcs(s, 250, true);
      for (const id of NPC_IDS) {
        const room = s.actors[id].pos.room;
        expect(canEnter(s, id, room)).toBe(true);
        expect(ROOMS[room].area).not.toBe('secret');
      }
    }
    const talks = s.facts.filter((f) => f.type === 'talk').length;
    const deals = s.deals.filter((d) => d.from !== 'hero' && d.to !== 'hero');
    console.log('5分間の NPC 同士: 会話', talks, '合意', deals.length, '種類', [...new Set(deals.map((d) => d.kind))], '拒否', s.flags.npcRefusals ?? 0);
    expect(talks).toBeGreaterThan(5);
    expect(deals.length).toBeGreaterThan(0);
    expect(totalPieces(s)).toBe(total);
    for (const a of Object.values(s.actors)) expect(a.pieces).toBeGreaterThanOrEqual(0);
  });

  it('棟分け後、監獄棟の NPC は B1 から出ず、生活棟の NPC は B1 に入らない', () => {
    const s = freshState(12);
    s.phase = 'house';
    const prison: NpcId[] = ['npc_02_kanzaki', 'npc_03_kurose', 'npc_04_mido', 'npc_05_shiraishi'];
    for (const id of NPC_IDS) {
      s.actors[id].house = prison.includes(id) ? 'prison' : 'living';
      placeIn(s, id, prison.includes(id) ? 'prison_cells' : 'living_lounge');
    }
    s.actors.hero.house = 'living';
    for (let t = 0; t < 3 * 60_000; t += 250) {
      s.simTime += 250;
      tickNpcs(s, 250, true);
      for (const id of NPC_IDS) {
        const area = ROOMS[s.actors[id].pos.room].area;
        if (prison.includes(id)) expect(area).toBe('prison');
        else expect(area).not.toBe('prison');
      }
    }
  });
});
