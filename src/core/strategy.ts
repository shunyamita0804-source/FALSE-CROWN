/**
 * 競技の作戦時間（ルール説明の後、開始前の相談）。本人の決定（2026-11-28）による試作。まず M01 だけで使う。
 *
 * - 時間は「枠」で数える。1 枠の長さは決まっていて（M01 は 30 秒 × 4 枠、最大 2 分）、会話を開いても止まらず、延びない。
 * - 枠の始めに、NPC は全員一斉に「誰と相談するか」を決める。主人公も同じ候補の 1 人として扱い、優先しない。
 * - NPC 同士の相談は、その枠の終わり（または主人公が準備完了を押した時）に、主人公と同じ判断関数（evaluate）で解決する。
 * - 相談室に入ったことは、ホールにいる人に見える。中で何を話したかは分からない（v10 の目撃と同じ）。
 * - 主人公専用の補正はない。相談室は親しい人だけの場所ではなく、初対面でも同じ組なら応じやすい（利害が一致するため）。
 */
import talkJson from '../data/match_talk.json';
import { NPC_BY_ID, type CharId, type NpcId } from '../data/characters';
import { canReframe, commit, evaluate, type Proposal } from '../npc/negotiation';
import type { Rng } from './rng';
import { activeDeals, addInfo, adjustRel, allied, fact, learn, log, nameOf, pledged, rel, shortName } from './state';
import type { GameState, MatchSlot } from './types';
import { medalIssued, promiseRescue, promised } from './rescue';
import { answerRole, assignRoles, followBonus, leadDesire, meetingPlace, takeCounter, talkChance, type RoleId } from '../npc/group';
import { t } from '../i18n/i18n';

export type TalkWindow = 'pre_only' | 'between' | 'during' | 'none';

export interface TalkRule {
  window: TalkWindow;
  pre: { slots: number; slotMs?: number };
  /** 休憩の会話メニューを競技用の新しい形にする */
  breakTalk?: boolean;
  /** 組（M01 の 4 人組など）ごとに相談室を割り当てる */
  groupRooms?: boolean;
  topics?: string[];
  /** 専用室（出題室、任務室） */
  procedure?: string;
}

export interface StrategyRoom {
  id: string;
  name: string;
  /** 主人公が入口を調べる時に立つマス */
  x: number;
  y: number;
  /** 相談に来た人が立つマス（入口の前） */
  spot: [number, number][];
  /** 組分けの発表の後、その部屋の組が集まる位置（相談室の近く） */
  wait?: [number, number][];
  dir: 'left' | 'right';
}

interface TalkData {
  strategy: { maxMs: number };
  rooms: StrategyRoom[];
  matches: Record<string, TalkRule>;
  tips: Record<string, string[]>;
}

export const TALK = talkJson as unknown as TalkData;
export const STRATEGY_ROOMS = TALK.rooms;

export const talkRule = (matchId: string): TalkRule => TALK.matches[matchId] ?? { window: 'between', pre: { slots: 0 } };
/** この競技で作戦時間を使うか（試作の間は M01 だけ） */
export const strategyEnabled = (matchId: string): boolean => (talkRule(matchId).pre.slots ?? 0) > 0;
export const tipsOf = (matchId: string): string[] => TALK.tips[matchId] ?? [];

export interface StrategyMeeting {
  slot: number;
  /** 相談室の id。null は立ち話 */
  room: string | null;
  host: CharId;
  members: CharId[];
  resolved: boolean;
  /** 主人公が加わった */
  withHero?: boolean;
}

export interface StrategyState {
  match: string;
  day: number;
  /** 案内を読み終えて計時を始めたか（説明・操作案内の間は始めない） */
  started: boolean;
  slot: number;
  slots: number;
  slotMs: number;
  /** 今の枠の残り（ミリ秒） */
  slotLeft: number;
  done: boolean;
  meetings: StrategyMeeting[];
  /** その枠で、もう相談の相手が決まっている人（人 → 枠） */
  engaged: Partial<Record<CharId, number>>;
  /** NPC から主人公への誘い */
  invites: { from: NpcId; room: string | null; slot: number }[];
  /** 検証用：主人公が歩いていた時間、会話を開いていた時間、立ち止まっていた時間（ミリ秒） */
  metrics: { walkMs: number; talkMs: number; idleMs: number; perSlot: { walkMs: number; talkMs: number }[] };
}

export function newStrategy(state: GameState, matchId: string): StrategyState {
  const rule = talkRule(matchId);
  const slots = Math.max(0, rule.pre.slots);
  const slotMs = Math.min(rule.pre.slotMs ?? 30_000, Math.floor(TALK.strategy.maxMs / Math.max(1, slots)));
  return {
    match: matchId,
    day: state.day,
    started: false,
    slot: 0,
    slots,
    slotMs,
    slotLeft: slotMs,
    done: slots === 0,
    meetings: [],
    engaged: {},
    invites: [],
    metrics: { walkMs: 0, talkMs: 0, idleMs: 0, perSlot: Array.from({ length: slots }, () => ({ walkMs: 0, talkMs: 0 })) },
  };
}

/** 競技の組（M01 の 4 人組など）。組の無い競技は空 */
export function groupsOf(slot: MatchSlot | null): CharId[][] {
  const st = slot?.state as { groups?: CharId[][]; teams?: CharId[][] } | undefined;
  return st?.groups ?? st?.teams ?? [];
}

export function groupOf(slot: MatchSlot | null, id: CharId): CharId[] {
  return groupsOf(slot).find((g) => g.includes(id)) ?? [];
}

/** 組に割り当てた相談室（組の順に A、B、C） */
export function roomOfGroup(slot: MatchSlot | null, id: CharId): StrategyRoom | null {
  if (!slot || !talkRule(slot.id).groupRooms) return null;
  const i = groupsOf(slot).findIndex((g) => g.includes(id));
  return i >= 0 ? STRATEGY_ROOMS[i] ?? null : null;
}

export const roomById = (id: string | null | undefined) => STRATEGY_ROOMS.find((r) => r.id === id) ?? null;

/**
 * a から見た「b と相談したい度合い」。同じ組（組の加点がある）、緩い約束、同盟、関係、律儀さで決める。
 * 主人公への補正はない。
 */
export function consultScore(state: GameState, slot: MatchSlot | null, a: CharId, b: CharId): number {
  const r = rel(state, a, b);
  const per = a === 'hero' ? null : NPC_BY_ID[a as NpcId].personality;
  const mate = groupOf(slot, a).includes(b) ? 12 : 0;
  const match = slot?.id ?? '';
  // 集団行動（追従性・自立志向）：頼れそうな相手と話したい度合い。主人公にも NPC にも同じ式
  const follow = a === 'hero' ? 0 : followBonus(state, a as NpcId, b, match) * 0.5;
  // この競技で、相手の集まりから抜けた（抜けられた）ことがある
  const left = state.flags[leftKey(state.day, match, a, b)] || state.flags[leftKey(state.day, match, b, a)] ? -15 : 0;
  return -6 + mate + follow + left + (pledged(state, a, b) ? 8 : 0) + (allied(state, a, b) ? 10 : 0) + r.like * 0.3 + r.trust * 0.2 - r.wary * 0.15 - r.hostility * 0.5 + (per ? (per.loyalty - 50) / 10 : 0);
}

/** guest（NPC）が host の「相談しよう」に応じるか */
export function consultVerdict(state: GameState, slot: MatchSlot | null, st: StrategyState, guest: NpcId, host: CharId, rng: Rng): boolean {
  if (st.engaged[guest] === st.slot) return false;
  const r = rel(state, guest, host);
  if (r.hostility >= 50 || r.wary >= 80) return false;
  // 誘いに乗るか：相手と話したい度合い＋追従性（頼れそうな相手の集まりに乗る）。相手が主人公でも同じ
  const follow = followBonus(state, guest, host, slot?.id ?? st.match) * 0.5;
  return consultScore(state, slot, guest, host) + follow + rng.gauss(0, 4) >= 4;
}

/**
 * 組分けの発表の後、組ごとに相談室の近くへ集まる（M01 の試作）。
 * 席のまま始めると、会場の反対側の相談室まで NPC の足で 14 秒ほどかかり、1 枠（30 秒）の半分を歩くだけで使ってしまうため。
 */
export function arrangeGroups(state: GameState, slot: MatchSlot, place: (id: CharId, x: number, y: number) => void): void {
  if (!talkRule(slot.id).groupRooms) return;
  groupsOf(slot).forEach((g, i) => {
    const room = STRATEGY_ROOMS[i];
    if (!room?.wait) return;
    g.forEach((id, k) => {
      if (!state.actors[id]?.alive) return;
      const [x, y] = room.wait![k % room.wait!.length];
      place(id, x, y);
    });
  });
}

const pairKey = (a: CharId, b: CharId) => [a, b].sort().join('_');

/** その競技の間に 1 回だけ、相談で関係が少し深まる（同じ話の繰り返しで上げ続けられない） */
export function bondOnce(state: GameState, st: StrategyState, a: CharId, b: CharId, what: string): boolean {
  const k = `strat:${st.day}:${st.match}:${what}:${pairKey(a, b)}`;
  if (state.flags[k]) return false;
  state.flags[k] = true;
  adjustRel(state, a, b, { like: 1, trust: 1 });
  adjustRel(state, b, a, { like: 1, trust: 1 });
  return true;
}

/**
 * 枠の始めに、NPC が相談の相手を一斉に決める。
 * 組がある競技では、組の仲間を組の相談室に集めようとする。誘いに乗るかは、誘われた側が同じ基準で決める。
 * 主人公が相手に選ばれた時は、主人公への誘いとして残す（行くかどうかは主人公しだい）。
 */
export function planSlot(state: GameState, slot: MatchSlot, st: StrategyState, rng: Rng): void {
  // 自分から人を集めたい人（支配欲・主導性が高い、その競技に向いている）から先に動く。順番は毎枠少し揺れる
  const npcs = rng
    .shuffle(slot.players.filter((p): p is NpcId => p !== 'hero' && state.actors[p]?.alive))
    .map((p) => ({ p, v: leadDesire(state, p, slot.id) + rng.gauss(0, 0.12) }))
    .sort((x, y) => y.v - x.v)
    .map((x) => x.p);
  const usedRooms = new Set(st.meetings.filter((m) => m.slot === st.slot && m.room).map((m) => m.room!));
  for (const a of npcs) {
    if (st.engaged[a] === st.slot) continue;
    // 毎枠、誰かと話すとは限らない（一人で考える人もいる）。主導性の高い人ほど自分から声をかけ、自立志向の高い人は控える。後の枠ほど少し減る
    if (!rng.chance(talkChance(a, st.slot))) continue;
    const cands = slot.players.filter((b) => b !== a && st.engaged[b] !== st.slot && state.actors[b]?.alive);
    if (!cands.length) continue;
    const scored = cands.map((b) => ({ b, v: consultScore(state, slot, a, b) + rng.gauss(0, 4) })).sort((x, y) => y.v - x.v);
    const best = scored[0];
    if (best.v < 2) continue;
    const room = roomOfGroup(slot, a);
    const mates = groupOf(slot, a);
    const members: CharId[] = [a];
    let inviteHero = false;
    // 自立志向の高い人は、組の部屋に人を集めず、必要な相手とだけ立ち話で済ませる
    if (room && mates.includes(best.b) && !usedRooms.has(room.id) && meetingPlace(a) !== 'standing') {
      // 組の相談室に、組の仲間を集める
      for (const m of rng.shuffle(mates.filter((x) => x !== a))) {
        if (st.engaged[m] === st.slot) continue;
        if (m === 'hero') { inviteHero = true; continue; }
        if (consultVerdict(state, slot, st, m as NpcId, a, rng)) members.push(m);
      }
      if (members.length < 2 && !inviteHero) continue;
      usedRooms.add(room.id);
      for (const m of members) st.engaged[m] = st.slot;
      st.meetings.push({ slot: st.slot, room: room.id, host: a, members, resolved: false });
      if (inviteHero) st.invites.push({ from: a, room: room.id, slot: st.slot });
      continue;
    }
    // 組の外の人とは、ホールで立ち話
    if (best.b === 'hero') {
      st.engaged[a] = st.slot;
      st.meetings.push({ slot: st.slot, room: null, host: a, members: [a], resolved: false });
      st.invites.push({ from: a, room: null, slot: st.slot });
      continue;
    }
    if (!consultVerdict(state, slot, st, best.b as NpcId, a, rng)) continue;
    members.push(best.b);
    for (const m of members) st.engaged[m] = st.slot;
    st.meetings.push({ slot: st.slot, room: null, host: a, members, resolved: false });
  }
}

/** 相談の中身を解決する（NPC 同士の組だけ。主人公との話は画面で行う） */
export function resolveMeeting(state: GameState, slot: MatchSlot, st: StrategyState, mt: StrategyMeeting, rng: Rng): void {
  if (mt.resolved) return;
  mt.resolved = true;
  const npcs = mt.members.filter((m): m is NpcId => m !== 'hero' && state.actors[m]?.alive);
  // 入るところはホールから見える（中身は分からない）。立ち話は、近くにいれば「何か約束していた」まで伝わる（commit の目撃）
  if (mt.room && mt.members.length >= 2) {
    const room = roomById(mt.room);
    const names = mt.members.map((m) => shortName(state, m)).join('、');
    const info = addInfo(state, { kind: 'rumor', text: `${names}が${room?.name ?? '相談室'}に入っていった。`, truth: true, about: [...mt.members], source: 'world', value: 1, tags: ['sighting', 'consult'] });
    for (const o of slot.players) {
      if (mt.members.includes(o) || !state.actors[o]?.alive) continue;
      // 「ほかの組の動きを見る役」を引き受けた人は、見落とさない
      const scout = state.flags[roleKey(st, o)] === 'scout';
      if (o === 'hero' || scout || rng.chance(Math.min(1, 0.4 + NPC_BY_ID[o as NpcId].stats.observation * 0.07))) learn(state, o, info.id, 'self', 1);
    }
    fact(state, 'consult', [...mt.members], `${names}が作戦時間に${room?.name ?? '相談室'}で相談した`);
  }
  // 3 人以上の集まりでは、言い出した人が役割を割り振ることがある（引き受けるかは各自が決める）
  if (!mt.withHero && mt.host !== 'hero' && npcs.length >= 3) splitRoles(state, slot, st, mt, rng);
  for (let i = 0; i < npcs.length; i++) {
    for (let j = i + 1; j < npcs.length; j++) {
      const a = npcs[i];
      const b = npcs[j];
      bondOnce(state, st, a, b, 'talk');
      if (allied(state, a, b)) continue;
      // 言い出すのは、相手と組みたい気持ちが強い方
      const [from, to] = consultScore(state, slot, a, b) >= consultScore(state, slot, b, a) ? [a, b] : [b, a];
      let p: Proposal = { kind: 'alliance', from, to, payNow: 0, payOnSuccess: 0, untilDay: state.day };
      let v = evaluate(state, p);
      if (!v.accept && v.counter && (v.counter.payNow ?? 0) <= 1 && state.actors[from].pieces >= (v.counter.payNow ?? 0) + 2) {
        p = { ...p, ...v.counter };
        v = evaluate(state, p);
      }
      // 断られたら、同席している中でいちばん交渉のうまい人（本人か仲介役）が、受けやすい形（不可侵）を出し直す。受けるかは相手しだい
      if (!v.accept && !allied(state, from, to, ['nonaggression'])) {
        const broker = npcs.filter((x) => canReframe(x)).sort((x, y) => NPC_BY_ID[y].stats.negotiation - NPC_BY_ID[x].stats.negotiation)[0];
        if (broker) {
          p = { kind: 'nonaggression', from, to, payNow: 0, payOnSuccess: 0, untilDay: state.day };
          v = evaluate(state, p);
          if (v.accept && broker !== from && broker !== to) fact(state, 'broker', [broker, from, to], `${nameOf(state, broker)}が${nameOf(state, from)}と${nameOf(state, to)}の間を取り持った`);
        }
      }
      if (v.accept) commit(state, p, []);
    }
  }
  // 救いのメダルの約束（同盟した相手、よく知る相手に）。履行は強制しない
  if (medalIssued(state.day)) {
    for (const a of npcs) for (const b of mt.members) {
      if (a === b || promised(state, a, b)) continue;
      const r = rel(state, a, b);
      if ((allied(state, a, b) && r.trust >= 45) || (r.like >= 45 && r.trust >= 50)) promiseRescue(state, a, b);
    }
  }
}

/** 枠を終える：まだ解決していない相談を解決し、次の枠へ進める。最後の枠なら終わり */
export function endSlot(state: GameState, slot: MatchSlot, st: StrategyState, rng: Rng): void {
  for (const mt of st.meetings) if (mt.slot === st.slot) resolveMeeting(state, slot, st, mt, rng);
  st.invites = st.invites.filter((i) => i.slot > st.slot);
  if (st.slot + 1 >= st.slots) {
    st.done = true;
    st.slotLeft = 0;
    return;
  }
  st.slot += 1;
  st.slotLeft = st.slotMs;
  planSlot(state, slot, st, rng);
}

/**
 * 準備完了（または時間切れ）：残りの枠を、NPC 同士だけで最後まで進めてから終える。
 * 主人公が早く切り上げても、NPC の行動は省かない（v11「全員完了で早送り、CPU の行動を解決してから進む」）。
 */
export function finishStrategy(state: GameState, slot: MatchSlot, st: StrategyState, rng: Rng): void {
  if (!st.started) { st.started = true; planSlot(state, slot, st, rng); }
  for (let guard = 0; guard < 20 && !st.done; guard++) endSlot(state, slot, st, rng);
  st.done = true;
  log(state, `作戦時間が終わった（${nameOf(state, 'hero')}の相談：${st.meetings.filter((m) => m.withHero).length} 回）`);
}

/** 計時を始める（説明と操作案内を閉じた後） */
export function startStrategy(state: GameState, slot: MatchSlot, st: StrategyState, rng: Rng): void {
  if (st.started) return;
  st.started = true;
  st.slotLeft = st.slotMs;
  planSlot(state, slot, st, rng);
}

/** 時間を進める。枠が切り替わったら true */
export function tickStrategy(state: GameState, slot: MatchSlot, st: StrategyState, dt: number, rng: Rng): boolean {
  if (!st.started || st.done) return false;
  st.slotLeft -= dt;
  if (st.slotLeft > 0) return false;
  endSlot(state, slot, st, rng);
  return true;
}

/** 合計の残り時間（ミリ秒） */
export const strategyLeft = (st: StrategyState) => (st.done ? 0 : Math.max(0, st.slotLeft) + (st.slots - st.slot - 1) * st.slotMs);

// ---------------- 主人公との会話で使う判断（NPC 同士と同じ基準） ----------------

export type TipAnswer = { kind: 'give'; text: string } | { kind: 'again'; text: string } | { kind: 'refuse' };

/** その人が知っているコツ（人ごとに 3 つ。誰が何を知っているかは固定） */
export function tipsKnown(matchId: string, npc: NpcId): string[] {
  const all = tipsOf(matchId);
  if (!all.length) return [];
  let h = 0;
  for (const c of npc) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return [0, 3, 5].map((k) => all[(h + k) % all.length]);
}

/**
 * コツを聞かれた NPC の返事。教えるかは関係、同じ組か、性格で決める。
 * 点数・CPU の能力・解く速さには効かせない（本人の決定 2026-11-28）。関係が深まるのは競技 1 回につき 1 度だけ。
 */
export function askTip(state: GameState, slot: MatchSlot | null, st: StrategyState, npc: NpcId, asker: CharId, rng: Rng): TipAnswer {
  const k = `stratTip:${st.day}:${st.match}:${npc}:${asker}`;
  const told = state.flags[k];
  const known = tipsKnown(st.match, npc);
  if (typeof told === 'string') return { kind: 'again', text: told };
  const r = rel(state, npc, asker);
  const per = NPC_BY_ID[npc].personality;
  const mate = groupOf(slot, npc).includes(asker);
  const v = (r.trust - 35) / 15 + r.like / 20 - r.hostility / 10 + (mate ? 2 : 0) + (pledged(state, npc, asker) || allied(state, npc, asker) ? 1.5 : 0) + (per.morality - 50) / 40 - (per.ambition - 50) / 60 + rng.gauss(0, 0.8);
  if (v < 0 || !known.length) return { kind: 'refuse' };
  const text = known[Math.floor(rng.next() * known.length)];
  state.flags[k] = text;
  bondOnce(state, st, npc, asker, 'tip');
  return { kind: 'give', text };
}

/** 主人公が NPC にコツを教える（関係が深まるのは競技 1 回につき 1 度だけ） */
export function giveTip(state: GameState, st: StrategyState, from: CharId, to: NpcId): boolean {
  return bondOnce(state, st, from, to, 'tipBack');
}

/** 「ヒントは買う？」への返事。本人も決めていないことは断言しない。信用していない相手にはぼかす */
export function answerHint(state: GameState, npc: NpcId, asker: CharId, rng: Rng): 'yes' | 'no' | 'vague' {
  const r = rel(state, npc, asker);
  const def = NPC_BY_ID[npc];
  if (r.trust < 35 || r.hostility >= 30) return 'vague';
  const leaning = state.actors[npc].pieces >= 4 && def.personality.risk >= 50 ? 'yes' : 'no';
  // 演技がうまく道徳の低い人物は、信頼の薄い相手に逆を言うことがある（真偽は画面に出さない）
  if (r.trust < 55 && def.stats.acting >= 8 && def.personality.morality < 50 && rng.chance(0.4)) return leaning === 'yes' ? 'no' : 'yes';
  return leaning;
}

/** 協力を解消する（相手に伝わる。黙って破るのとは別の扱いで、裏切りの記録は付けない） */
export function cancelCooperation(state: GameState, a: CharId, b: CharId): boolean {
  const d = allied(state, a, b);
  if (!d) return false;
  d.status = 'cancelled';
  d.note = `${nameOf(state, a)}が申し出て解消`;
  adjustRel(state, b, a, { trust: -2, wary: 2 });
  fact(state, 'cancel', [a, b], `${nameOf(state, a)}が${nameOf(state, b)}との協力を解消した`);
  return true;
}

/** 主人公と相手との、いまの約束（協力、緩い約束、救済の約束） */
export function promisesWith(state: GameState, a: CharId, b: CharId): string[] {
  const out = activeDeals(state, a, b).map((d) => d.kind);
  return [...new Set(out)];
}

// ---------------- 役割分担（集団行動、本人の承認 2026-11-28） ----------------

const leftKey = (day: number, match: string, member: CharId, host: CharId) => `stratLeft:${day}:${match}:${member}:${host}`;
/** その競技で引き受けた役割 */
export const roleKey = (st: StrategyState, id: CharId) => `stratRole:${st.day}:${st.match}:${id}`;

export interface RoleLine {
  id: CharId;
  text: string;
}

/**
 * 集まりの言い出した人（NPC）が役割を割り振り、各自が答える。主人公への割り振りは heroRole に返し、画面で本人が選ぶ。
 * 割り振りは言い出した人の見立て（公開の実績を、自分の能力の精度で見積もる）。断る・別の役割を出す・抜けるは各自の判断。
 * 役割は、この競技のルールで許された相談の範囲だけ（コツを伝える、ほかの組の動きを見る、聞き役）。点数や解く速さは変えない。
 */
export function splitRoles(state: GameState, slot: MatchSlot, st: StrategyState, mt: StrategyMeeting, rng: Rng): { lines: RoleLine[]; heroRole?: RoleId } {
  const host = mt.host as NpcId;
  const lines: RoleLine[] = [];
  if (host === ('hero' as NpcId) || leadDesire(state, host, slot.id) < 0.4) return { lines };
  const k = `stratSplit:${st.day}:${st.match}:${host}:${st.slot}`;
  if (state.flags[k]) return { lines };
  state.flags[k] = true;
  const roles = assignRoles(state, host, mt.members, slot.id, rng);
  state.flags[roleKey(st, host)] = 'lead';
  lines.push({ id: host, text: t('role.propose') });
  let heroRole: RoleId | undefined;
  for (const m of [...mt.members]) {
    if (m === host) continue;
    const role = roles[m]!;
    if (m === 'hero') { heroRole = role; continue; }
    const a = answerRole(state, m as NpcId, host, role, slot.id, rng);
    if (a.answer === 'accept') {
      state.flags[roleKey(st, m)] = role;
      lines.push({ id: m, text: t('role.accept', { role: t(`role.${role}`) }) });
    } else if (a.answer === 'counter' && a.counter) {
      const ok = takeCounter(host, rng);
      if (ok) state.flags[roleKey(st, m)] = a.counter;
      lines.push({ id: m, text: t('role.counter', { role: t(`role.${a.counter}`) }) });
      lines.push({ id: host, text: t(ok ? 'role.counterOk' : 'role.counterNo') });
    } else if (a.answer === 'leave') {
      leaveMeeting(state, st, mt, m);
      lines.push({ id: m, text: t('role.leave') });
    } else lines.push({ id: m, text: t('role.refuse') });
  }
  const done = lines.filter((l) => l.id !== host).length;
  fact(state, 'roles', [...mt.members], `${nameOf(state, host)}が役割の分担を持ちかけた（${done} 人が返事）`);
  const until = state.simTime + 5000;
  for (const l of lines) if (l.id !== 'hero' && state.actors[l.id]) state.actors[l.id].bubble = { text: l.text, until };
  return { lines, heroRole };
}

/** 集まりから抜ける。この競技の間、同じ人の集まりには戻りにくい（約束破りとは別の扱い） */
export function leaveMeeting(state: GameState, st: StrategyState, mt: StrategyMeeting, who: CharId): void {
  mt.members = mt.members.filter((x) => x !== who);
  if (st.engaged[who] === mt.slot) delete st.engaged[who];
  state.flags[leftKey(st.day, st.match, who, mt.host)] = true;
  fact(state, 'leave', [who, mt.host], `${nameOf(state, who)}が${nameOf(state, mt.host)}の集まりから抜けた`);
}

/** 主人公が、言い出した人から割り振られた役割に答える（NPC と同じ選択肢） */
export function heroAnswerRole(state: GameState, st: StrategyState, mt: StrategyMeeting, role: RoleId, answer: 'accept' | 'counter' | 'refuse' | 'leave', counter: RoleId | undefined, rng: Rng): string {
  const host = mt.host as NpcId;
  if (answer === 'accept') { state.flags[roleKey(st, 'hero')] = role; return t('role.counterOk'); }
  if (answer === 'counter' && counter) {
    const ok = takeCounter(host, rng);
    if (ok) state.flags[roleKey(st, 'hero')] = counter;
    return t(ok ? 'role.counterOk' : 'role.counterNo');
  }
  if (answer === 'leave') { leaveMeeting(state, st, mt, 'hero'); return t('role.leaveOk'); }
  return t('role.refuseOk');
}

/**
 * 主人公が言い出した集まりで、役割を持ちかける。主人公が選んだ割り振りに、NPC が NPC と同じ基準で答える。
 */
export function heroSplitRoles(state: GameState, slot: MatchSlot, st: StrategyState, mt: StrategyMeeting, assign: Partial<Record<CharId, RoleId>>, rng: Rng): RoleLine[] {
  const lines: RoleLine[] = [];
  state.flags[roleKey(st, 'hero')] = 'lead';
  for (const [m, role] of Object.entries(assign) as [NpcId, RoleId][]) {
    if (!mt.members.includes(m)) continue;
    const a = answerRole(state, m, 'hero', role, slot.id, rng);
    if (a.answer === 'accept') { state.flags[roleKey(st, m)] = role; lines.push({ id: m, text: t('role.accept', { role: t(`role.${role}`) }) }); }
    else if (a.answer === 'counter' && a.counter) { state.flags[roleKey(st, m)] = a.counter; lines.push({ id: m, text: t('role.counter', { role: t(`role.${a.counter}`) }) }); }
    else if (a.answer === 'leave') { leaveMeeting(state, st, mt, m); lines.push({ id: m, text: t('role.leave') }); }
    else lines.push({ id: m, text: t('role.refuse') });
  }
  fact(state, 'roles', [...mt.members], `${nameOf(state, 'hero')}が役割の分担を持ちかけた`);
  return lines;
}
