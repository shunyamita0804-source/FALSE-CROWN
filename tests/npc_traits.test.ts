import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { buildCtx, newSlot } from '../src/core/runner';
import { finishStrategy, newStrategy } from '../src/core/strategy';
import { aliveIds } from '../src/core/state';
import { Rng } from '../src/core/rng';
import { rel } from '../src/core/state';
import { abilityStep, CORE_ABILITIES, coreTotal, MATCH_ABILITIES, NORMAL_LUCK, NORMAL_TOTAL, SHOWN_ABILITIES } from '../src/data/abilities';
import { NPC_BY_ID, NPCS, PROFILES, type CharId, type NpcId } from '../src/data/characters';
import { MATCHES } from '../src/matches/registry';
import { answerRole, followBonus, leadDesire, meetingPlace, reliance, takeCounter } from '../src/npc/group';
import { evaluate } from '../src/npc/negotiation';
import { inviteVerdict } from '../src/npc/social';
import { abilityRows } from '../src/core/relationview';
import { freshState } from './helpers';

const K: NpcId = 'npc_02_kanzaki';
const KU: NpcId = 'npc_03_kurose';
const MI: NpcId = 'npc_04_mido';
const KI: NpcId = 'npc_06_kiryu';
const DO: NpcId = 'npc_08_dojima';
const AS: NpcId = 'npc_09_asahina';

describe('能力の基準（本人の決定 2026-11-28）', () => {
  it('通常の NPC は 5 能力の合計 35、運 5。能力と性格の出所は npc_profiles.json だけ', () => {
    for (const n of NPCS) {
      expect(n.tier).toBe('normal');
      expect(coreTotal(n.stats)).toBe(NORMAL_TOTAL);
      expect(n.stats.luck).toBe(NORMAL_LUCK);
      for (const k of [...CORE_ABILITIES, 'acting', 'luck'] as const) expect(n.stats[k]).toBe(PROFILES[n.id].ability[k]);
      // 全員に得意（8 以上）があり、全部が得意な人はいない
      const core = CORE_ABILITIES.map((k) => n.stats[k]);
      expect(Math.max(...core)).toBeGreaterThanOrEqual(8);
      expect(core.filter((v) => v >= 8).length).toBeLessThanOrEqual(3);
    }
  });

  it('集団行動の 4 項目がある。調整役・支配と主導・自立と忠実の方向', () => {
    const p = (id: NpcId) => NPC_BY_ID[id].personality;
    for (const n of NPCS) for (const k of ['dominance', 'independence', 'initiative', 'followership'] as const) expect(n.personality[k]).toBeGreaterThanOrEqual(0);
    expect(p(KU).initiative).toBeGreaterThanOrEqual(80);
    expect(p(KU).dominance).toBeLessThan(60);
    expect(p(MI).dominance).toBeGreaterThanOrEqual(90);
    expect(p(MI).initiative).toBeGreaterThanOrEqual(85);
    expect(p(DO).independence).toBeGreaterThanOrEqual(80);
    expect(p(DO).loyalty).toBeGreaterThanOrEqual(80);
    expect(meetingPlace(MI)).toBe('own');
    expect(meetingPlace(KU)).toBe('neutral');
    expect(meetingPlace(DO)).toBe('standing');
  });

  it('全競技に主に効く能力がある。CPU はその能力を実際に読んでいる', () => {
    const files: Record<string, string> = { h02: 'duel', h06: 'p10', h01: 'h01', h03: 'h03', h05: 'h05', h08: 'h08', m11: 'm11' };
    for (const id of Object.keys(MATCHES)) {
      const m = MATCH_ABILITIES[id];
      expect(m, id).toBeTruthy();
      if (['h01', 'h03', 'h05', 'h08', 'm11'].includes(id)) continue; // 共通のぶれ、または種目ごとに別の競技の CPU を使う
      const src = readFileSync(`src/matches/${files[id] ?? id}.ts`, 'utf8');
      expect(src.includes(`ctx.stats.${m.main}`), `${id} は ${m.main} を読む`).toBe(true);
      if (m.sub) expect(src.includes(`ctx.stats.${m.sub}`), `${id} は ${m.sub} を読む`).toBe(true);
    }
  });

  it('判断のぶれは、その競技の主な能力から決まる（戦略だけが全競技に効かない）', () => {
    const s = freshState(1);
    const base = buildCtx(s, AS, 'm02', Rng.from(1)).noise; // エミリー：記憶 10
    const board = buildCtx(s, AS, 'm09', Rng.from(1)).noise; // 戦略 5
    expect(base).toBeLessThan(board);
    const k = buildCtx(s, KI, 'm09', Rng.from(1)).noise; // マイク：戦略 10
    expect(k).toBeLessThan(board);
  });
});

describe('交渉力は提案する側だけに効く', () => {
  it('受ける側の判断は、提案者の交渉力で変わらない', () => {
    const s = freshState(2);
    const def = NPC_BY_ID[MI];
    const keep = def.stats.negotiation;
    const p = { kind: 'alliance' as const, from: MI, to: K, payNow: 1, payOnSuccess: 0, untilDay: s.day };
    const a = evaluate(s, p);
    def.stats.negotiation = 1;
    const b = evaluate(s, p);
    def.stats.negotiation = keep;
    expect(b).toEqual(a);
  });
});

describe('集団行動（主人公も NPC も同じ規則）', () => {
  it('誘いに乗るかは、誘った人が主人公でも NPC でも、関係と実績が同じなら同じ', () => {
    const s = freshState(3);
    s.phase = 'morning';
    Object.assign(rel(s, AS, 'hero'), { trust: 60, like: 20 });
    Object.assign(rel(s, AS, KI), { trust: 60, like: 20 });
    expect(followBonus(s, AS, 'hero', 'm01')).toBeCloseTo(followBonus(s, AS, KI, 'm01'));
    for (let seed = 1; seed <= 30; seed++) {
      expect(inviteVerdict(s, 'hero', AS, Rng.from(seed)).accept).toBe(inviteVerdict(s, KI, AS, Rng.from(seed)).accept);
    }
  });

  it('頼れる相手は競技の種類と公開の実績で変わる（リーダーは固定されない）', () => {
    const s = freshState(4);
    const players: CharId[] = ['hero', K, KI, AS];
    // DAY1 のメイン（M01＝論理）で K が 1 位、監獄（P05＝戦略）で KI が 1 位だった
    s.history.push({ day: 1, main: 'm01', mainRanking: [K, AS, 'hero', KI], mainScores: {}, prisonGame: 'p05', prisonRanking: [KI, 'hero', K, AS], prisonScores: {}, eliminated: [], rewards: {} } as never);
    void players;
    expect(reliance(s, AS, K, 'p01')).toBeGreaterThan(reliance(s, AS, KI, 'p01')); // 論理の競技
    expect(reliance(s, AS, KI, 'p07')).toBeGreaterThan(reliance(s, AS, K, 'p07')); // 戦略の競技
    // 自分から仕切りたい度合いも競技で変わる（マイクは戦略の競技で強く出る）
    expect(leadDesire(s, KI, 'm09')).toBeGreaterThan(leadDesire(s, KI, 'p02'));
  });

  it('役割は断る・別の役割を出す・抜けるを選べる。支配欲の高いリーダーは対案を受けにくい', () => {
    const s = freshState(5);
    Object.assign(rel(s, DO, MI), { trust: 25, wary: 70 });
    const answers = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) answers.add(answerRole(s, DO, MI, 'share', 'm01', Rng.from(seed)).answer);
    expect(answers.has('accept')).toBe(false);
    expect([...answers].some((a) => a === 'leave' || a === 'refuse' || a === 'counter')).toBe(true);
    let mido = 0;
    let kurose = 0;
    for (let seed = 1; seed <= 400; seed++) {
      if (takeCounter(MI, Rng.from(seed))) mido++;
      if (takeCounter(KU, Rng.from(seed))) kurose++;
    }
    expect(mido).toBeLessThan(kurose);
  });
});

describe('作戦時間の集団行動（M01）', () => {
  it('集まりの中心は回ごとに変わり、役割の分担・断り・抜けが実際に起こる', () => {
    const hosts = new Set<string>();
    const kinds = new Set<string>();
    let roles = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const s = freshState(seed);
      s.phase = 'strategy';
      const slot = newSlot(s, 'm01', aliveIds(s), 'main');
      const st = newStrategy(s, 'm01');
      finishStrategy(s, slot, st, Rng.derive(seed, 'g'));
      for (const m of st.meetings) if (m.room && m.members.length >= 2) hosts.add(m.host);
      for (const f of s.facts) {
        if (f.type === 'roles') roles++;
        if (f.type === 'leave' || f.type === 'broker') kinds.add(f.type);
      }
      for (const k of Object.keys(s.flags)) if (k.startsWith('stratRole:')) kinds.add(String(s.flags[k]));
    }
    expect(hosts.size).toBeGreaterThanOrEqual(5); // 特定の人だけが仕切るのではない
    expect(roles).toBeGreaterThan(0);
    expect(kinds.has('share') || kinds.has('scout')).toBe(true);
  });
});

describe('手帳の能力表示', () => {
  it('会うまでは未確認。6 項目を 5 段階で出し、内部の値や演技・信頼は出さない', () => {
    const s = freshState(6);
    expect(abilityRows(s, K)).toBeNull();
    s.flags[`heroMet_${K}`] = true;
    const rows = abilityRows(s, K)!;
    expect(rows.map((r) => r.key)).toEqual(SHOWN_ABILITIES);
    expect(rows.map((r) => r.key)).not.toContain('acting');
    for (const r of rows) expect(r.step).toBeGreaterThanOrEqual(1);
    expect(rows.find((r) => r.key === 'logic')!.step).toBe(5);
    expect(rows.find((r) => r.key === 'luck')!.step).toBe(3); // 運 5 は「普通」
  });
});
