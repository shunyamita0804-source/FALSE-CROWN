import { describe, expect, it } from 'vitest';
import { phaseDuration } from '../src/core/clock';
import { Rng } from '../src/core/rng';
import { addInfo, adjustRel, aliveIds, learn } from '../src/core/state';
import { startMorning } from '../src/core/tournament';
import { fastForward, tickNpcs } from '../src/npc/brain';
import { aboutTarget, addInvite, attitudeStep, clearSocial, invited, inviteVerdict, isPrivate, MEETING_CAP, observeAttitude, witnessEntry } from '../src/npc/social';
import { canEnter } from '../src/world/access';
import { placeIn } from '../src/world/sim';
import { freshState } from './helpers';

const K = 'npc_02_kanzaki';
const M = 'npc_04_mido';
const S = 'npc_05_shiraishi';

function morning(seed: number) {
  const s = freshState(seed);
  s.phase = 'morning';
  startMorning(s);
  s.phaseLeft = phaseDuration('morning');
  return s;
}

describe('個室と招待（v10）', () => {
  it('他人の個室には招かれた人だけが入れる。期限切れ、消灯、定員の扱い', () => {
    const s = morning(1);
    expect(canEnter(s, 'hero', `bedroom_${K}`)).toBe(false);
    expect(canEnter(s, M, `bedroom_${K}`)).toBe(false);
    expect(addInvite(s, K, 'hero')).toBe(true);
    expect(canEnter(s, 'hero', `bedroom_${K}`)).toBe(true);
    expect(canEnter(s, M, `bedroom_${K}`)).toBe(false); // 招かれていない人は入れない
    expect(canEnter(s, K, 'bedroom_hero')).toBe(false); // 逆向きの許可にはならない
    // 定員（主を含めて 4 人）
    expect(addInvite(s, K, M)).toBe(true);
    expect(addInvite(s, K, S)).toBe(true);
    expect(addInvite(s, K, 'npc_06_kiryu')).toBe(false);
    expect(MEETING_CAP).toBe(4);
    // 期限切れ
    s.simTime += 200_000;
    expect(invited(s, K, 'hero')).toBe(false);
    expect(canEnter(s, 'hero', `bedroom_${K}`)).toBe(false);
    // 消灯後は招待を出せず、自分の個室以外に入れない
    s.phase = 'curfew';
    expect(addInvite(s, K, 'hero')).toBe(false);
    expect(canEnter(s, 'hero', `bedroom_${K}`)).toBe(false);
  });

  it('誘いに応じるかは信頼と警戒で変わる。敵対していれば断る。締切が近ければ断る', () => {
    let yes = 0;
    let no = 0;
    for (let i = 0; i < 40; i++) {
      const s = morning(100 + i);
      adjustRel(s, K, 'hero', { trust: 40, like: 30 });
      if (inviteVerdict(s, 'hero', K, Rng.from(i)).accept) yes++;
      const s2 = morning(100 + i);
      adjustRel(s2, K, 'hero', { hostility: 60 });
      if (inviteVerdict(s2, 'hero', K, Rng.from(i)).accept) no++;
    }
    expect(yes).toBeGreaterThan(30);
    expect(no).toBe(0);
    const s = morning(7);
    adjustRel(s, K, 'hero', { trust: 40, like: 30 });
    s.phaseLeft = 8_000; // 11:52
    expect(inviteVerdict(s, 'hero', K, Rng.from(1))).toMatchObject({ accept: false, reason: 'deadline' });
    // NPC 同士も同じ関数で判断する（主人公専用の扱いはない）
    const s3 = morning(9);
    adjustRel(s3, K, M, { hostility: 60 });
    expect(inviteVerdict(s3, M, K, Rng.from(1)).accept).toBe(false);
  });

  it('同行：招かれた NPC は後ろを歩いて個室まで来る。2 人きりなら私的な場所になる', () => {
    const s = morning(3);
    for (const id of aliveIds(s)) if (id !== 'hero' && id !== K) { placeIn(s, id, 'dining'); s.actors[id].busyUntil = 1e15; }
    placeIn(s, 'hero', 'living_hallway', { x: 14, y: 5 });
    placeIn(s, K, 'living_hallway', { x: 18, y: 5 });
    expect(addInvite(s, 'hero', K)).toBe(true);
    s.actors[K].goal = { kind: 'follow', target: 'hero', note: 'private', until: s.simTime + 110_000 };
    for (let i = 0; i < 40; i++) { s.simTime += 100; tickNpcs(s, 100, true); }
    const d0 = Math.abs(s.actors[K].pos.x - 14) + Math.abs(s.actors[K].pos.y - 5);
    expect(d0).toBeLessThanOrEqual(2); // 重ならず、隣まで来る
    expect(d0).toBeGreaterThanOrEqual(1);
    placeIn(s, 'hero', 'bedroom_hero');
    for (let i = 0; i < 200 && s.actors[K].pos.room !== 'bedroom_hero'; i++) { s.simTime += 100; tickNpcs(s, 100, true); }
    expect(s.actors[K].pos.room).toBe('bedroom_hero');
    expect(isPrivate(s, 'hero', K)).toBe(true);
    // 第三者が同席すれば私的な場所ではない
    addInvite(s, 'hero', M);
    placeIn(s, M, 'bedroom_hero');
    expect(isPrivate(s, 'hero', K)).toBe(false);
    // 締切で同行と招待が解ける
    clearSocial(s);
    expect(s.actors[K].goal).toBeUndefined();
    expect(invited(s, 'hero', K)).toBe(false);
  });

  it('同行：入れない場所へは付いて来られず、同行が終わる', () => {
    const s = morning(4);
    for (const id of aliveIds(s)) if (id !== 'hero' && id !== K) { placeIn(s, id, 'dining'); s.actors[id].busyUntil = 1e15; }
    placeIn(s, 'hero', 'bedroom_hero'); // 招待なし
    placeIn(s, K, 'living_hallway', { x: 18, y: 5 });
    s.actors[K].goal = { kind: 'follow', target: 'hero', note: 'private', until: s.simTime + 110_000 };
    const ev = [];
    for (let i = 0; i < 20; i++) { s.simTime += 100; ev.push(...tickNpcs(s, 100, true)); }
    expect(s.actors[K].pos.room).toBe('living_hallway');
    expect(s.actors[K].goal?.kind).not.toBe('follow');
    expect(ev.some((e) => e.type === 'followEnd')).toBe(true);
  });
});

describe('目撃と密談（v10）', () => {
  it('入室の目撃で分かるのは事実だけ。廊下にいない人、遠い人は知らない。同じ入室を二重に記録しない', () => {
    const s = morning(5);
    for (const id of aliveIds(s)) placeIn(s, id, 'dining');
    const door = (await0(s, K));
    placeIn(s, 'hero', 'living_hallway', door);
    placeIn(s, S, 'living_hallway', { x: door.x + 1, y: door.y });
    const seen = witnessEntry(s, K, M, 'living_hallway', Rng.from(2));
    expect(seen).toContain('hero');
    const info = Object.values(s.infos).find((i) => i.tags.includes('sighting'))!;
    expect(info.about).toEqual([K, M]);
    expect(info.text).not.toMatch(/同盟|約束|取引/); // 中身や推測は書かない
    expect(s.actors.hero.knows[info.id]).toBeTruthy();
    expect(s.actors.npc_06_kiryu.knows[info.id]).toBeUndefined(); // 食堂にいた人は知らない
    expect(witnessEntry(s, K, M, 'living_hallway', Rng.from(2))).toEqual([]);
    expect(Object.values(s.infos).filter((i) => i.tags.includes('sighting')).length).toBe(1);
  });

  it('NPC 同士が個室で密談する。個室で結んだ約束は、部屋の外にいる人には知られない', () => {
    let priv = 0;
    let deals = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const s = morning(seed * 17);
      for (const id of aliveIds(s)) if (id !== K && id !== M) { placeIn(s, id, 'living_hallway'); s.actors[id].busyUntil = 1e15; }
      placeIn(s, K, `bedroom_${K}`);
      addInvite(s, K, M);
      placeIn(s, M, `bedroom_${K}`);
      s.actors[K].goal = { kind: 'goto', room: `bedroom_${K}`, note: `host:${M}`, until: s.simTime + 60_000 };
      s.actors[M].goal = { kind: 'follow', target: K, note: 'private', until: s.simTime + 60_000 };
      const before = s.deals.length;
      for (let i = 0; i < 30 && !s.facts.some((f) => f.type === 'private_talk'); i++) { s.simTime += 100; tickNpcs(s, 100, true); }
      const talk = s.facts.find((f) => f.type === 'private_talk');
      if (!talk) continue;
      priv++;
      expect(talk.actors.sort()).toEqual([K, M].sort());
      for (const d of s.deals.slice(before)) {
        deals++;
        // 廊下には 10 人いるが、誰も目撃者にならない
        expect(d.witnesses).toEqual([]);
      }
      // 廊下の人は、この密談についての情報を何も得ていない
      for (const id of aliveIds(s)) {
        if (id === K || id === M) continue;
        for (const k of Object.keys(s.actors[id].knows)) {
          const info = s.infos[k];
          expect(info.day === s.day && info.kind === 'deal' && info.about.includes(K) && info.about.includes(M)).toBe(false);
        }
      }
      // 終わったら招待は解け、客は部屋を出る
      expect(invited(s, K, M)).toBe(false);
      expect(s.actors[M].goal?.room).toBe('living_hallway');
    }
    expect(priv).toBeGreaterThan(20);
    expect(deals).toBeGreaterThan(0);
  });

  it('朝の自由行動で、NPC 同士の誘いと密談、目撃が実際に起きる', () => {
    let priv = 0;
    let invites = 0;
    let refused = 0;
    let sights = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const s = morning(seed * 19);
      for (let i = 0; i < 300; i++) { fastForward(s, 1000); s.phaseLeft -= 1000; }
      priv += s.facts.filter((f) => f.type === 'private_talk').length;
      invites += s.facts.filter((f) => f.type === 'invite').length;
      refused += s.facts.filter((f) => f.type === 'invite' && f.text.includes('拒否')).length;
      sights += Object.values(s.infos).filter((i) => i.tags.includes('sighting')).length;
    }
    expect(priv).toBeGreaterThan(6);
    expect(refused).toBeGreaterThan(0); // 断られることもある
    expect(refused).toBeLessThan(invites);
    expect(sights).toBeGreaterThan(0);
  });

  it('他者の動向：知らなければ知らないと答え、知っていることだけを話す。自分と対象の話は明かさない', () => {
    const s = morning(6);
    adjustRel(s, K, 'hero', { trust: 40 });
    expect(aboutTarget(s, K, 'hero', M, Rng.from(1)).kind).toBe('none');
    const i1 = addInfo(s, { kind: 'rumor', text: '御堂と白石が個室に入った', truth: true, about: [M, S], source: 'world', value: 1, tags: ['sighting'] });
    learn(s, K, i1.id, 'self', 1);
    const own = addInfo(s, { kind: 'deal', text: '神崎と御堂の同盟', truth: true, about: [K, M], source: 'world', value: 2, tags: [] });
    learn(s, K, own.id, 'self', 1);
    const ans = aboutTarget(s, K, 'hero', M, Rng.from(1));
    expect(ans.kind).toBe('tell');
    expect(ans.infos.map((i) => i.id)).toEqual([i1.id]);
    // 信用が低ければ値段を付け、敵対していれば断る
    const s2 = morning(6);
    const i2 = addInfo(s2, { kind: 'rumor', text: 'x', truth: true, about: [M, S], source: 'world', value: 1, tags: ['sighting'] });
    learn(s2, K, i2.id, 'self', 1);
    expect(aboutTarget(s2, K, 'hero', M, Rng.from(1)).kind).toBe('price');
    adjustRel(s2, K, 'hero', { hostility: 60 });
    expect(aboutTarget(s2, K, 'hero', M, Rng.from(1)).kind).toBe('refuse');
  });

  it('関係一覧の推定は観測でだけ動く。未接触は不明', () => {
    const s = morning(8);
    expect(attitudeStep(s, K)).toBe(0);
    adjustRel(s, K, 'hero', { like: 80, trust: 50 }); // 内部の本当の値が動いても、観測がなければ不明のまま
    expect(attitudeStep(s, K)).toBe(0);
    observeAttitude(s, K, 8);
    expect(attitudeStep(s, K)).toBe(4);
    observeAttitude(s, K, 2, 'smalltalk');
    observeAttitude(s, K, 2, 'smalltalk'); // 同じ日の 2 回目は数えない
    expect(s.flags[`est_${K}`]).toBe(10);
    observeAttitude(s, K, -40);
    expect(attitudeStep(s, K)).toBe(1);
  });
});

/** 生活棟の廊下で、指定した人物の個室の扉の前 */
function await0(s: ReturnType<typeof freshState>, owner: string): { x: number; y: number } {
  void s;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return DOOR(owner);
}
import { ROOMS } from '../src/world/maps';
function DOOR(owner: string): { x: number; y: number } {
  return ROOMS.living_hallway.doors.find((d) => d.to === `bedroom_${owner}`)!.tiles[0];
}
