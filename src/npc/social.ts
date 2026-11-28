/**
 * 同行、個室への招待、目撃（仕様 v10）。
 * 主人公も NPC も同じ規則で扱う。個室へ入れるのは本人と、本人が招いた相手だけ。
 * 個室で第三者がいない状態を「私的な場所」とし、そこでの取引は他の参加者に知られない。
 * 目撃者が知るのは「誰と誰が個室に入った」という事実だけで、話の中身は分からない。
 */
import { homeOf, isPrivateRoom, ownerOfRoom } from '../world/rooms';
import { clockMinutes, lifeSlot, nextSchedule } from '../core/clock';
import type { Rng } from '../core/rng';
import { activeDeals, addInfo, adjustRel, allied, learn, nameOf, rel, shortName } from '../core/state';
import type { Actor, GameState, Info } from '../core/types';
import { NPC_BY_ID, type CharId, type NpcId } from '../data/characters';
import { ROOMS } from '../world/maps';
import { actorsIn } from '../world/sim';

export interface Invite {
  host: CharId;
  guest: CharId;
  /** この時刻（simTime）まで有効 */
  until: number;
}

/** 個室の会議の定員（部屋の主を含む） */
export const MEETING_CAP = 4;
export const INVITE_TIME = 110_000;

export const isBedroom = (room: string) => isPrivateRoom(room);
/** 個室の持ち主（空室の時は呼ばない） */
export const ownerOf = (state: GameState, room: string) => ownerOfRoom(state, room) as CharId;

export function invitesOf(state: GameState): Invite[] {
  const st = state as GameState & { invites?: Invite[] };
  if (!st.invites) st.invites = [];
  // 期限切れ、脱落者の招待は消す
  if (st.invites.some((i) => i.until <= state.simTime || !state.actors[i.host]?.alive || !state.actors[i.guest]?.alive)) {
    st.invites = st.invites.filter((i) => i.until > state.simTime && state.actors[i.host]?.alive && state.actors[i.guest]?.alive);
  }
  return st.invites;
}

export function invited(state: GameState, host: CharId, guest: CharId): boolean {
  return invitesOf(state).some((i) => i.host === host && i.guest === guest);
}

/** 招待を出す。定員を超える場合は出せない */
export function addInvite(state: GameState, host: CharId, guest: CharId, ms = INVITE_TIME): boolean {
  if (host === guest || state.phase === 'curfew') return false;
  // 招く先は自分の個室。監獄棟の房（格子の向こうは丸見え）へは招けない
  if (!isPrivateRoom(homeOf(state, host))) return false;
  const list = invitesOf(state);
  const cur = list.find((i) => i.host === host && i.guest === guest);
  if (cur) {
    cur.until = Math.max(cur.until, state.simTime + ms);
    return true;
  }
  if (list.filter((i) => i.host === host).length + 1 >= MEETING_CAP) return false;
  list.push({ host, guest, until: state.simTime + ms });
  return true;
}

export function endInvite(state: GameState, host: CharId, guest: CharId): void {
  const st = state as GameState & { invites?: Invite[] };
  st.invites = invitesOf(state).filter((i) => !(i.host === host && i.guest === guest));
}

/** 締切や消灯で、同行と招待をすべて解く */
export function clearSocial(state: GameState): void {
  (state as GameState & { invites?: Invite[] }).invites = [];
  for (const a of Object.values(state.actors)) if (a.goal?.kind === 'follow' || a.goal?.note?.startsWith('host:')) a.goal = undefined;
}

/** a と b が、第三者のいない個室にいるか */
export function isPrivate(state: GameState, a: CharId, b: CharId): boolean {
  const ra = state.actors[a].pos.room;
  if (ra !== state.actors[b].pos.room || !isBedroom(ra)) return false;
  return actorsIn(state, ra).every((x) => x.id === a || x.id === b);
}

/** その部屋に、a と b 以外の人がいるか（公の場かどうか） */
export function othersPresent(state: GameState, a: CharId, b: CharId): boolean {
  return actorsIn(state, state.actors[a].pos.room).some((x) => x.id !== a && x.id !== b);
}

export function followersOf(state: GameState, leader: CharId): Actor[] {
  return Object.values(state.actors).filter((x) => x.alive && x.goal?.kind === 'follow' && x.goal.target === leader);
}

/**
 * owner（NPC）が、自分の個室を訪ねてきた visitor を部屋へ入れるか。主人公も NPC も同じ基準。
 * 先客がいる時、締切が近い時、相手を警戒している時は断る。
 */
export function visitVerdict(state: GameState, visitor: CharId, owner: NpcId, rng: Rng): InviteVerdict {
  if (state.phase === 'curfew') return { accept: false, reason: 'deadline' };
  const next = nextSchedule(state);
  if (next?.item.hard && next.inMin <= 12) return { accept: false, reason: 'deadline' };
  if (invitesOf(state).filter((i) => i.host === owner).length + 1 >= MEETING_CAP) return { accept: false, reason: 'full' };
  const o = state.actors[owner];
  if (o.goal?.note?.startsWith('host:') || actorsIn(state, o.pos.room).some((x) => x.id !== owner && x.id !== visitor)) return { accept: false, reason: 'busy' };
  const r = rel(state, owner, visitor);
  if (r.hostility >= 45 || r.wary >= 75) return { accept: false, reason: 'distrust' };
  const def = NPC_BY_ID[owner];
  let score = (r.trust - 38) * 0.55 + r.like * 0.35 - (r.wary - 30) * 0.35 - r.hostility * 0.5;
  score += allied(state, owner, visitor) ? 14 : 0;
  score += (def.personality.loyalty - 50) * 0.06;
  if (lifeSlot(clockMinutes(state)) === 'bath' && !state.flags[`bath:${state.day}:${owner}`]) score -= 8;
  score += rng.gauss(0, 5);
  if (score >= 0) return { accept: true, reason: 'ok' };
  return { accept: false, reason: score > -8 ? 'busy' : 'distrust' };
}

export interface InviteVerdict {
  accept: boolean;
  reason: 'ok' | 'busy' | 'distrust' | 'deadline' | 'full';
}

/**
 * guest（NPC）が host の誘いに応じるか。予定、信頼、危険、期待利益で決める。主人公専用の補正はない。
 */
export function inviteVerdict(state: GameState, host: CharId, guest: NpcId, rng: Rng): InviteVerdict {
  if (state.phase === 'curfew') return { accept: false, reason: 'deadline' };
  if (invitesOf(state).filter((i) => i.host === host).length + 1 >= MEETING_CAP) return { accept: false, reason: 'full' };
  const next = nextSchedule(state);
  if (next?.item.hard && next.inMin <= 12) return { accept: false, reason: 'deadline' };
  const def = NPC_BY_ID[guest];
  const r = rel(state, guest, host);
  if (r.hostility >= 45 || r.wary >= 75) return { accept: false, reason: 'distrust' };
  const g = state.actors[guest];
  if (g.goal?.kind === 'follow' || g.goal?.note?.startsWith('host:')) return { accept: false, reason: 'busy' };
  // 期待利益：味方が足りない、すでに同盟している、相手が有力
  const allies = activeDeals(state, guest).filter((d) => d.kind === 'alliance').length;
  let score = (r.trust - 35) * 0.55 + r.like * 0.35 - (r.wary - 30) * 0.35 - r.hostility * 0.5;
  score += allied(state, guest, host) ? 14 : allies === 0 ? 8 : 0;
  score += (def.personality.ambition - 50) * 0.12 + (def.personality.risk - 50) * 0.1;
  // 予定：食事や入浴の時間で、まだ済ませていなければ腰が重い
  const slot = lifeSlot(clockMinutes(state));
  if ((slot === 'breakfast' || slot === 'dinner') && !state.flags[`ate:${state.day}:${slot}:${guest}`]) score -= 6;
  if (slot === 'bath') score -= 5;
  if (next?.item.hard && next.inMin <= 25) score -= 8;
  score += rng.gauss(0, 5);
  if (score >= 4) return { accept: true, reason: 'ok' };
  return { accept: false, reason: r.trust < 35 || r.wary > 55 ? 'distrust' : 'busy' };
}

/**
 * guest が host の個室へ入るのを、廊下にいた人が目撃する。
 * 分かるのは入室の事実だけ。そこから「手を組んでいるのでは」と推測するかは、見た人の性格と関係しだい。
 * 戻り値は目撃者。
 */
export function witnessEntry(state: GameState, host: CharId, guest: CharId, fromRoom: string, rng: Rng): CharId[] {
  const key = `sight:${state.day}:${host}:${guest}:${Math.floor(state.simTime / 60_000)}`;
  if (state.flags[key]) return [];
  state.flags[key] = true;
  const g = state.actors[guest];
  const seen: CharId[] = [];
  for (const o of actorsIn(state, fromRoom)) {
    if (o.id === host || o.id === guest || !o.alive) continue;
    // 距離：扉の近く（入った人の直前の位置は分からないので、部屋の主の扉から 9 マス以内）
    const door = ROOMS[fromRoom]?.doors.find((d) => d.to === homeOf(state, host));
    const tile = door?.tiles[0];
    const dx = tile ? Math.abs(o.pos.x - tile.x) : 0;
    const dy = tile ? Math.abs(o.pos.y - tile.y) : 0;
    if (dx + dy > 9) continue;
    if (o.id !== 'hero') {
      // 観察力が低い人は見落とすことがある
      const obs = NPC_BY_ID[o.id as NpcId].stats.observation;
      if (!rng.chance(Math.min(1, 0.35 + obs * 0.08))) continue;
    }
    seen.push(o.id);
  }
  if (!seen.length) return [];
  const info = addInfo(state, {
    kind: 'rumor',
    text: `${nameOf(state, guest)}が、${nameOf(state, host)}の個室に入っていった。`,
    truth: true,
    about: [host, guest],
    source: 'world',
    value: 1,
    tags: ['sighting'],
    data: { host, guest },
  });
  for (const o of seen) {
    learn(state, o, info.id, 'self', 1);
    if (o === 'hero') continue;
    // 推測は性格と関係による。必ず敵対するわけではない
    const per = NPC_BY_ID[o as NpcId].personality;
    const suspicious = (100 - per.morality) * 0.4 + per.ambition * 0.3 + (o !== host && o !== guest ? 10 : 0);
    for (const x of [host, guest]) {
      if (allied(state, o, x)) {
        // 味方が別の誰かと会っている：少しだけ気にする
        adjustRel(state, o, x, { wary: suspicious > 45 ? 2 : 0 });
      } else {
        adjustRel(state, o, x, { wary: suspicious > 40 ? 3 : 1, threat: suspicious > 50 ? 2 : 0 });
      }
    }
  }
  void g;
  return seen;
}

/** 目撃や伝聞から、その人が「手を組んでいるらしい」と思っている相手の組（確認済みの事実とは別） */
export function suspectedPairs(state: GameState, viewer: CharId): { a: CharId; b: CharId; info: Info }[] {
  const out: { a: CharId; b: CharId; info: Info }[] = [];
  for (const k of Object.keys(state.actors[viewer].knows)) {
    const i = state.infos[k];
    if (i && i.tags.includes('sighting') && i.about.length === 2) out.push({ a: i.about[0], b: i.about[1], info: i });
  }
  return out;
}

export interface AboutAnswer {
  kind: 'refuse' | 'none' | 'tell' | 'price';
  infos: Info[];
  price: number;
  /** 作り話を混ぜた（内部のみ） */
  fabricated?: boolean;
}

/**
 * 「他者の動向」を尋ねられた NPC の返事。本人が実際に知っていることだけを話す。
 * 知らなければ知らないと答える。信用していない相手には値段を付けるか断る。演技が得意で道徳心の低い人物は作り話をすることがある。
 */
export function aboutTarget(state: GameState, npc: NpcId, asker: CharId, target: CharId, rng: Rng): AboutAnswer {
  const def = NPC_BY_ID[npc];
  const r = rel(state, npc, asker);
  if (r.hostility >= 45 || r.trust < 20) return { kind: 'refuse', infos: [], price: 0 };
  const A = state.actors[npc];
  const known = Object.keys(A.knows)
    .map((k) => state.infos[k])
    .filter((i): i is Info => !!i && i.about.includes(target) && !i.about.includes(asker) && i.source !== 'public' && i.kind !== 'profile' && i.kind !== 'result');
  // 自分と対象の同盟は、頼まれても明かさない
  const mine = known.filter((i) => !i.about.includes(npc));
  const friendly = !!allied(state, npc, asker) || r.trust >= 60;
  if (!mine.length) {
    if (!friendly && def.stats.acting >= 8 && def.personality.morality <= 45 && !allied(state, npc, target) && rng.chance(0.35)) {
      const fake = addInfo(state, { kind: 'rumor', text: `${nameOf(state, target)}は、手を組んだ相手を次の競技で見捨てるつもりらしい。`, truth: false, about: [target], source: npc, value: 1, tags: ['danger', 'accuse'] });
      learn(state, npc, fake.id, 'self', 1);
      return { kind: 'tell', infos: [fake], price: 0, fabricated: true };
    }
    return { kind: 'none', infos: [], price: 0 };
  }
  const list = mine.sort((x, y) => y.day - x.day || y.value - x.value).slice(0, 2);
  if (friendly) return { kind: 'tell', infos: list, price: 0 };
  return { kind: 'price', infos: list, price: def.personality.greed >= 70 ? 2 : 1 };
}

/** 主人公から見た「相手の好意」の推定。観測した会話と行動だけで動く（内部の本当の値ではない） */
export function observeAttitude(state: GameState, npc: CharId, delta: number, onceKey?: string): void {
  if (npc === 'hero') return;
  if (onceKey) {
    const k = `estOnce:${state.day}:${npc}:${onceKey}`;
    if (state.flags[k]) return;
    state.flags[k] = true;
  }
  const k = `est_${npc}`;
  state.flags[k] = Math.max(-100, Math.min(100, Number(state.flags[k] ?? 0) + delta));
  state.flags[`estSeen_${npc}`] = true;
}

/** 推定好感度の段階（0 = 不明、1〜5） */
export function attitudeStep(state: GameState, npc: CharId): 0 | 1 | 2 | 3 | 4 | 5 {
  if (!state.flags[`estSeen_${npc}`]) return 0;
  const v = Number(state.flags[`est_${npc}`] ?? 0);
  return v <= -15 ? 1 : v < -4 ? 2 : v <= 6 ? 3 : v <= 20 ? 4 : 5;
}

export const sightText = (state: GameState, host: CharId, guest: CharId) => `${shortName(state, guest)}が${shortName(state, host)}の個室に入っていくのを見た。`;
