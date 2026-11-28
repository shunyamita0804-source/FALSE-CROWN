import { describe, expect, it } from 'vitest';
import { newSlot } from '../src/core/runner';
import { Rng } from '../src/core/rng';
import { activeDeals, aliveIds, rel } from '../src/core/state';
import { leaveMeeting, newStrategy, talkRule } from '../src/core/strategy';
import { promiseRescue, promised } from '../src/core/rescue';
import { commit } from '../src/npc/negotiation';
import { addInvite, clearSocial, dismissGuest, endInvite, invited, personalState } from '../src/npc/social';
import { homeOf } from '../src/world/rooms';
import type { NpcId } from '../src/data/characters';
import { freshState } from './helpers';

const K: NpcId = 'npc_02_kanzaki';
const T: NpcId = 'npc_07_tachibana';

function withPromises(seed: number) {
  const s = freshState(seed);
  commit(s, { kind: 'pledge', from: 'hero', to: K, payNow: 0, payOnSuccess: 0, untilDay: 3 });
  commit(s, { kind: 'alliance', from: 'hero', to: T, payNow: 0, payOnSuccess: 0, untilDay: 1 });
  promiseRescue(s, K, 'hero');
  const snap = () => JSON.stringify([activeDeals(s, 'hero', K).map((d) => [d.kind, d.status]), activeDeals(s, 'hero', T).map((d) => [d.kind, d.status]), promised(s, K, 'hero')]);
  return { s, snap };
}

describe('個人的な話：条件未達と聞き終えたを分ける', () => {
  it('日数や関係が足りない時は notYet、聞いた後は done', () => {
    const s = freshState(1);
    s.day = 1;
    expect(personalState(s, K).kind).toBe('notYet');
    s.day = 2;
    rel(s, K, 'hero').trust = 10;
    expect(personalState(s, K).kind).toBe('notYet');
    rel(s, K, 'hero').trust = 60;
    const r = personalState(s, K);
    expect(r.kind).toBe('ready');
    if (r.kind === 'ready') s.seen.push(r.ev.id);
    expect(personalState(s, K).kind).toBe('done');
  });
});

describe('退出や会話の終わりで、成立した約束は消えない', () => {
  it('密談の解散（dismissGuest）、招待の終了、消灯の解除', () => {
    const { s, snap } = withPromises(2);
    const before = snap();
    expect(addInvite(s, 'hero', K)).toBe(true);
    s.actors[K].goal = { kind: 'follow', target: 'hero', note: 'private', until: s.simTime + 60_000 };
    s.actors[K].pos = { ...s.actors[K].pos, room: homeOf(s, 'hero') };
    dismissGuest(s, K);
    expect(invited(s, 'hero', K)).toBe(false);
    expect(s.actors[K].goal?.kind).toBe('goto');
    endInvite(s, 'hero', T);
    clearSocial(s);
    expect(snap()).toBe(before);
  });

  it('相談室を出る：残りが 2 人以上なら続き、1 人なら解散して予約も解く。約束はそのまま', () => {
    const { s, snap } = withPromises(3);
    const before = snap();
    const slot = newSlot(s, 'm01', aliveIds(s), 'main');
    void slot;
    const st = newStrategy(s, 'm01');
    st.started = true;
    const a = { slot: 0, room: 'A', host: 'hero' as const, members: ['hero', K, T] as ('hero' | NpcId)[], resolved: false, withHero: true };
    st.meetings.push(a);
    st.engaged = { hero: 0, [K]: 0, [T]: 0 };
    expect(leaveMeeting(st, a, 'hero')).toBe('left');
    expect(a.members).toEqual([K, T]);
    expect(a.host).toBe(K);
    expect(a.withHero).toBe(false);
    expect(st.engaged.hero).toBeUndefined();
    expect(a.left).toContain('hero');
    const b = { slot: 0, room: 'B', host: 'hero' as const, members: ['hero', 'npc_04_mido'] as ('hero' | NpcId)[], resolved: false, withHero: true };
    st.meetings.push(b);
    st.engaged.hero = 0;
    st.engaged.npc_04_mido = 0;
    expect(leaveMeeting(st, b, 'hero')).toBe('dissolved');
    expect(b.resolved).toBe(true);
    expect(st.engaged.npc_04_mido).toBeUndefined();
    // 2 度目は何もしない
    expect(leaveMeeting(st, b, 'hero')).toBe('none');
    expect(snap()).toBe(before);
  });
});

describe('競技ごとの相談の区分', () => {
  it('全競技に区分があり、相談不可の競技が決まっている', () => {
    const ids = ['m01', 'm02', 'm03', 'm04', 'm05', 'm06', 'm07', 'm08', 'm09', 'm10', 'm11', 'p01', 'p02', 'p03', 'p04', 'p05', 'p06', 'p07', 'p08', 'p09', 'p10'];
    for (const id of ids) expect(['none', 'between', 'during', 'pre_only']).toContain(talkRule(id).window);
    expect(talkRule('m11').window).toBe('none');
    expect(talkRule('p01').window).toBe('none');
    expect(talkRule('m04').window).toBe('during');
    void Rng;
  });
});
