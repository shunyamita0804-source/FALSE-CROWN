/**
 * NPC の自律行動（自由行動フェーズ）。
 * シミュレーション時間で動き、意思決定は一定間隔（暫定 3 秒）。候補の効用を
 * 0.38*生存 + 0.22*将来優位 + 0.13*ピース + 0.12*関係 + 0.10*個人目標 + 0.05*探索 - 0.22*危険 - 0.10*時間
 * で評価し、人格ごとの重みを掛ける。プレイヤーも他の NPC と同じ「相手候補」の 1 人として扱う。
 */
import { homeOf, isCell, isPrivateRoom, ownerOfRoom } from '../world/rooms';
import { NPC_BY_ID, PROFILES, type CharId, type NpcId } from '../data/characters';
import { CONFIG } from '../data/config';
import { CLOCK, clockMinutes, lifeSlot } from '../core/clock';
import { Rng } from '../core/rng';
import { activeDeals, addInfo, adjustRel, aliveIds, aliveNpcs, allied, fact, learn, nameOf, rel, rngOf } from '../core/state';
import type { Actor, GameState, Info } from '../core/types';
import { CLUE_BY_EVENT } from '../story/clues';
import { canEnter, passFn } from '../world/access';
import { ROOMS } from '../world/maps';
import { roomRoute } from '../world/path';
import { actorsIn, distance, homeSpot, moveActor, seatUsable, setPathTo, setRouteTo, speedOf } from '../world/sim';
import { reserveSeat, seatOf, seatTile, sitDown, standUp, sweepSeats, freeSeats } from '../world/seats';
import { absorb, accuse, commit, evaluate, perceivedStrength, type Proposal } from './negotiation';
import { addInvite, endInvite, invited, INVITE_TIME, inviteVerdict, isBedroom, isPrivate, othersPresent, ownerOf, visitVerdict, witnessEntry } from './social';

export interface BrainEvent {
  type: 'approach' | 'talk' | 'deal' | 'found' | 'rumor' | 'invite' | 'sight' | 'followEnd' | 'knock';
  npc: NpcId;
  other?: CharId;
  proposal?: Proposal;
  text?: string;
}

const THINK = 3000;
const TALK_TIME = 12_000;
/** 用事が済んだ後、次の行動を決めるまでその場で過ごす時間 */
const PAUSE_MIN = 4000;
const PAUSE_MAX = 11_000;
/** 着いた場所で過ごす時間 */
const STAY_MIN = 30_000;
const STAY_MAX = 80_000;
const SEARCH_TIME = 6000;
const MEAL_TIME = 18_000;
const BATH_TIME = 20_000;
/** その場で過ごす時に、空いた椅子があれば座る割合 */
const SIT_CHANCE = 0.6;

function prof(id: NpcId) {
  return PROFILES[id];
}

/** その日の「同盟したい度合い」：競技前で、まだ味方が少ないほど高い */
function allianceNeed(state: GameState, id: NpcId): number {
  const n = activeDeals(state, id).filter((d) => d.kind === 'alliance' && d.untilDay >= state.day).length;
  const pre = state.phase === 'morning' || state.phase === 'strategy' ? 1 : state.phase === 'house' ? 0.5 : 0.3;
  const per = NPC_BY_ID[id].personality;
  const want = per.loyalty < 40 ? 3 : 2; // 忠誠の低い人物ほど同盟を多く持とうとする
  return Math.max(0, (want - n) / want) * pre;
}

/** a から見た「b と話す」効用（0..100 尺度の合成） */
function talkUtility(state: GameState, a: NpcId, b: CharId): number {
  const w = prof(a).utilityWeights;
  const r = rel(state, a, b);
  const need = allianceNeed(state, a);
  const strength = perceivedStrength(state, b);
  const survival = need * (30 + strength * 30) * (allied(state, a, b) ? 0.2 : 1);
  const future = need * 20 + (state.actors[b].pieces > state.actors[a].pieces ? 6 : 0);
  // 売れる情報を持っているか（相手が知らない情報の数）
  const sellable = Object.keys(state.actors[a].knows).filter((k) => !state.actors[b].knows[k] && (state.infos[k]?.value ?? 0) >= 1 && state.infos[k]?.source !== 'public').length;
  const piece = Math.min(20, sellable * 6) * (NPC_BY_ID[a].personality.greed / 100);
  const relation = 20 + r.like * 0.4 + (r.trust - 40) * 0.3 + r.debt * 0.2;
  const risk = r.hostility * 0.6 + Math.max(0, r.wary - 40) * 0.5;
  return 0.38 * survival * w.survival + 0.22 * future * w.futureAdvantage + 0.13 * piece * w.pieceValue + 0.12 * relation * w.relationship - 0.22 * risk * w.risk;
}

function reachable(state: GameState, a: Actor, room: string): number | null {
  if (a.pos.room === room) return 0;
  const route = roomRoute(a.pos.room, room, passFn(state, a.id));
  return route ? route.length : null;
}

/** 未調査の調査地点（立ち入れる部屋のみ） */
function unsearched(state: GameState, a: Actor): { room: string; id: string; x: number; y: number; event?: string }[] {
  const out: { room: string; id: string; x: number; y: number; event?: string }[] = [];
  for (const room of Object.values(ROOMS)) {
    if (room.area === 'secret' || isPrivateRoom(room.id)) continue;
    if (!canEnter(state, a.id, room.id)) continue;
    for (const ins of room.inspects) {
      if (a.searched.includes(ins.id)) continue;
      const clue = ins.event ? CLUE_BY_EVENT[ins.event] : undefined;
      if (!clue) continue;
      if (clue.fromDay && state.day < clue.fromDay) continue;
      if (clue.nightOnly && state.phase !== 'night') continue;
      out.push({ room: room.id, id: ins.id, x: ins.x, y: ins.y, event: ins.event });
    }
  }
  return out;
}

/** 個室の扉がある通路（生活棟の廊下、監獄棟の共同牢） */
const corridorOf = (privateRoomId: string): string => ROOMS[privateRoomId].doors[0].to;

/**
 * 就寝の支度の時刻を過ぎているか。21:00 からは入浴で個室へ戻る人が多く、21:20 には全員が戻り始める。
 * 監獄棟の部屋を割り当てられていて上の階にいる人は、道のりが長いので 21:00 に戻り始める。
 * lead は「消灯の何分前か」。id を省くと 40 分前で判定する。
 */
export function bedLead(state: GameState, id?: CharId): number {
  if (!id) return 40;
  return isCell(homeOf(state, id)) && ROOMS[state.actors[id].pos.room]?.area !== 'prison' ? 60 : 40;
}
export function bedtime(state: GameState, id?: CharId): boolean {
  return state.phase === 'night' && clockMinutes(state) >= CLOCK.curfew - bedLead(state, id);
}

function think(state: GameState, a: Actor, rng: Rng): void {
  const id = a.id as NpcId;
  const def = NPC_BY_ID[id];
  const w = prof(id).utilityWeights;
  const cands: { u: number; run: () => void }[] = [];
  const home = homeOf(state, id);
  // 就寝の支度：消灯の 40 分前からは、割り当てられた個室へ戻って過ごす
  if (bedtime(state, id) && canEnter(state, id, home)) {
    a.goal = { kind: 'rest', room: home, spot: homeSpot(state, id).spot, note: 'bed', until: state.simTime + 900_000 };
    startGoal(state, a);
    return;
  }
  // 他人の個室に用もなく残らない（招かれて話が済んだら出る。主人公に招かれている間は別）
  if (isPrivateRoom(a.pos.room) && a.pos.room !== home && !(ownerOfRoom(state, a.pos.room) === 'hero' && invited(state, 'hero', id))) {
    a.goal = { kind: 'goto', room: corridorOf(a.pos.room), until: state.simTime + 20_000 };
    startGoal(state, a);
    return;
  }
  const noise = CONFIG.difficulty[state.difficulty].noise * 4;

  // 会話・交渉
  for (const o of aliveIds(state)) {
    if (o === id) continue;
    const b = state.actors[o];
    if ((a.talkCd[o] ?? 0) > state.simTime) continue;
    if (isPrivateRoom(b.pos.room)) {
      // 個室にいる相手：本人の部屋に 1 人でいるなら、訪ねて行くことがある（入れてもらえるかは相手しだい）
      if (state.phase === 'curfew' || bedtime(state) || b.pos.room !== homeOf(state, o) || b.pos.room === a.pos.room || actorsIn(state, b.pos.room).length > 1) continue;
      const dc = reachable(state, a, corridorOf(b.pos.room));
      if (dc === null) continue;
      const uv = talkUtility(state, id, o) - 0.1 * (dc * 16) * w.time - 6;
      cands.push({ u: uv, run: () => { a.goal = { kind: 'talk', target: o, note: 'visit', until: state.simTime + 60_000 }; } });
      continue;
    }
    const dist = reachable(state, a, b.pos.room);
    if (dist === null) continue;
    // 遠くの相手をわざわざ追いかけない（近くにいる相手と話す）
    const u = talkUtility(state, id, o) - 0.1 * (dist * 16) * w.time - (b.pos.room === a.pos.room ? 0 : 3);
    cands.push({ u, run: () => { a.goal = { kind: 'talk', target: o, until: state.simTime + 60_000 }; } });
  }
  // 密談（v10）：人目のある場所で同盟を持ちかけたい相手を、自分の個室へ誘う。応じるかは相手しだい
  if (state.phase !== 'curfew' && !isBedroom(a.pos.room) && isPrivateRoom(homeOf(state, id)) && canEnter(state, id, homeOf(state, id)) && reachable(state, a, homeOf(state, id)) !== null && allianceNeed(state, id) > 0.25) {
    const secrecy = 0.15 + def.stats.acting * 0.03 + (100 - def.personality.morality) / 500;
    for (const o of aliveNpcs(state)) {
      if (o === id || allied(state, id, o)) continue;
      const b = state.actors[o];
      if (b.pos.room !== a.pos.room || (a.talkCd[o] ?? 0) > state.simTime || (b.busyUntil ?? 0) > state.simTime || b.goal?.kind === 'follow' || b.goal?.note?.startsWith('host:')) continue;
      if (!othersPresent(state, id, o) || !rng.chance(secrecy)) continue;
      const u = talkUtility(state, id, o) + 3;
      cands.push({ u, run: () => {
        a.talkCd[o] = state.simTime + CONFIG.npc.talkCooldown;
        const v = inviteVerdict(state, id, o, rng);
        fact(state, 'invite', [id, o], `${nameOf(state, id)}が${nameOf(state, o)}を個室での話に誘った（${v.accept ? '承諾' : '拒否'}）`);
        if (!v.accept || !addInvite(state, id, o)) {
          a.goal = { kind: 'wander', room: a.pos.room, spot: rng.pick(ROOMS[a.pos.room].spots), until: state.simTime + 4000 };
          return;
        }
        a.goal = { kind: 'goto', room: homeOf(state, id), note: `host:${o}`, until: state.simTime + INVITE_TIME };
        b.goal = { kind: 'follow', target: id, note: 'private', until: state.simTime + INVITE_TIME };
        b.path = [];
        b.route = [];
      } });
    }
  }
  // 探索
  const spots = unsearched(state, a);
  if (spots.length) {
    const s = spots.map((sp) => ({ sp, d: reachable(state, a, sp.room) })).filter((x) => x.d !== null).sort((x, y) => x.d! - y.d!)[0];
    if (s) {
      const u = 0.05 * 100 * w.exploration * (def.personality.explore / 100) * 4 + 0.10 * (def.personality.explore - 50) * 0.6 * w.personalGoal - 0.1 * s.d! * 8 * w.time;
      cands.push({ u, run: () => { a.goal = { kind: 'explore', room: s.sp.room, spot: { x: s.sp.x, y: s.sp.y }, note: s.sp.id, until: state.simTime + 60_000 }; } });
    }
  }
  // 好きな場所で過ごす
  const fav = def.favoriteRooms.filter((r) => canEnter(state, id, r) && reachable(state, a, r) !== null);
  if (fav.length) {
    const room = rng.pick(fav);
    cands.push({ u: 4.5, run: () => { a.goal = { kind: 'wander', room, spot: rng.pick(ROOMS[room].spots), until: state.simTime + TRAVEL_MAX }; } });
  }
  // いまいる部屋でそのまま過ごす（席や壁際など、部屋の待機地点へ行って留まる）。廊下では長居しない
  {
    const room = ROOMS[a.pos.room];
    const hall = room.id.includes('hallway') || room.id.includes('stairs');
    if (room.spots.length) cands.push({ u: hall ? 2 : 7, run: () => { a.goal = { kind: 'wander', room: room.id, spot: nearestSpot(a, room.spots, rng), until: state.simTime + TRAVEL_MAX }; } });
  }
  // 自分の個室で休む（昼間も、疲れやすい人や内向的な人ほど選ぶ）
  if (state.phase !== 'night' && state.phase !== 'curfew' && canEnter(state, id, homeOf(state, id)) && reachable(state, a, homeOf(state, id)) !== null) {
    cands.push({ u: 1.5 + (100 - def.personality.explore) / 40, run: () => { a.goal = { kind: 'rest', room: homeOf(state, id), until: state.simTime + rng.int(50_000, 90_000) }; } });
  }
  // 生活の予定（v10）：朝食と夕食は食堂へ、入浴の時間は個室へ。取るかどうかは人物と状況しだい
  const slot = state.phase === 'curfew' ? null : lifeSlot(clockMinutes(state));
  if ((slot === 'breakfast' || slot === 'dinner') && !state.flags[`ate:${state.day}:${slot}:${id}`] && canEnter(state, id, 'dining') && reachable(state, a, 'dining') !== null) {
    cands.push({ u: 30 + (def.personality.loyalty - 50) / 25 + (60 - def.personality.ambition) / 30, run: () => { a.goal = { kind: 'goto', room: 'dining', spot: rng.pick(ROOMS.dining.spots), note: 'meal', until: state.simTime + TRAVEL_MAX }; } });
  }
  if (slot === 'bath' && !state.flags[`bath:${state.day}:${id}`] && canEnter(state, id, homeOf(state, id)) && reachable(state, a, homeOf(state, id)) !== null) {
    cands.push({ u: 16 + (100 - def.personality.explore) / 30, run: () => { a.goal = { kind: 'rest', room: homeOf(state, id), note: 'bath', until: state.simTime + 50_000 }; } });
  }
  // 休息（夜は個室へ）
  if (state.phase === 'night' && canEnter(state, id, homeOf(state, id))) {
    cands.push({ u: 2 + (100 - def.personality.explore) / 25, run: () => { a.goal = { kind: 'rest', room: homeOf(state, id), until: state.simTime + 60_000 }; } });
  }
  let best = cands[0];
  let bv = -Infinity;
  for (const c of cands) {
    const v = c.u + rng.gauss(0, noise);
    if (v > bv) { bv = v; best = c; }
  }
  best.run();
  startGoal(state, a);
}

/** 移動にかけられる最長時間（着いたら、そこで過ごす時間に切り替える） */
const TRAVEL_MAX = 120_000;

/** 近い待機地点を選ぶ（いつも同じ場所にならないよう、近い 3 か所から選ぶ） */
function nearestSpot(a: Actor, spots: { x: number; y: number }[], rng: Rng): { x: number; y: number } {
  const near = spots.slice().sort((p, q) => Math.abs(p.x - a.pos.x) + Math.abs(p.y - a.pos.y) - (Math.abs(q.x - a.pos.x) + Math.abs(q.y - a.pos.y))).slice(0, 3);
  return rng.pick(near);
}

/** 主人公が自分の方へ向かってきている、またはすぐ隣にいるか */
/** 扉のすぐ近くにいるか。入口で立ち止まると後ろが詰まるので、ここでは主人公を待たない */
function nearDoor(a: Actor): boolean {
  const room = ROOMS[a.pos.room];
  if (!room) return false;
  return room.doors.some((d) => d.tiles.some((t) => Math.abs(t.x - a.pos.x) + Math.abs(t.y - a.pos.y) <= 3));
}

function heroComing(h: Actor, a: Actor): boolean {
  if (h.pos.room !== a.pos.room) return false;
  const dx = a.pos.x - h.pos.x;
  const dy = a.pos.y - h.pos.y;
  const d = Math.abs(dx) + Math.abs(dy);
  if (d <= 1) return true;
  if (d > 4) return false;
  const dir = h.intent ?? h.pos.dir;
  const vx = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
  const vy = dir === 'up' ? -1 : dir === 'down' ? 1 : 0;
  const along = dx * vx + dy * vy;
  const side = Math.abs(dx * vy) + Math.abs(dy * vx);
  return along >= 1 && side <= 1;
}

function startGoal(state: GameState, a: Actor): void {
  const g = a.goal;
  if (!g) return;
  if (g.kind === 'talk' && g.target) {
    const b = state.actors[g.target];
    setRouteTo(state, a, b.pos.room);
  } else if (g.room) {
    // 監獄棟の人が「自分の部屋で過ごす」時は、共同牢の入口ではなく自分の房まで行く
    if (g.kind === 'rest' && !g.spot && g.room === homeOf(state, a.id) && !isPrivateRoom(g.room)) g.spot = homeSpot(state, a.id).spot;
    setRouteTo(state, a, g.room, g.spot);
  }
}

/**
 * 着いた部屋で席を取り、その席の「立つ位置」へ向かう（先に予約してから歩く）。
 * 食事は必ず席を探し、その場で過ごす時はときどき座る。席が無ければ、これまで通り待機地点へ行く。
 */
function takeSeat(state: GameState, a: Actor, rng: Rng): void {
  const g = a.goal;
  if (!g || g.seat !== undefined || a.step || a.pos.room !== g.room) return;
  const meal = g.note === 'meal';
  if (!meal && !(g.kind === 'wander' && g.note !== 'at')) return;
  g.seat = '-';
  if (!freeSeats(state, a.pos.room, 'free').length) return;
  if (!meal && !rng.chance(SIT_CHANCE)) return;
  const seat = reserveSeat(state, a.id, a.pos.room, { near: g.spot ?? { x: a.pos.x, y: a.pos.y }, usable: seatUsable(state, a.id, a.pos.room) });
  if (!seat) return;
  const t = seatTile(seat);
  g.seat = seat.id;
  g.spot = t;
  a.route = [];
  if (a.pos.x === t.x && a.pos.y === t.y) a.path = [];
  else if (!setPathTo(state, a, t.x, t.y)) {
    // たどり着けない：席を放して、立ったまま過ごす
    standUp(state, a.id);
    g.seat = '-';
  }
}

/**
 * 取った席に着いていれば座る。途中で人にふさがれて着けなかった時は、何度か歩き直す。
 * それでも着けない時は席を放して、立ったまま過ごす。そこで過ごし始めてよければ true（歩き直している間は false）
 */
function settleSeat(state: GameState, a: Actor): boolean {
  const g = a.goal;
  if (!g?.seat || g.seat === '-') return true;
  if (sitDown(state, a.id)) return true;
  const mine = seatOf(state, a.id);
  if (mine && (g.tries ?? 0) < 4) {
    g.tries = (g.tries ?? 0) + 1;
    const t = seatTile(mine.seat);
    if (setPathTo(state, a, t.x, t.y) && a.path.length) return false;
  }
  standUp(state, a.id);
  g.seat = '-';
  return true;
}

/** a が b に持ちかける提案を決める（a の知識と関係だけから） */
export function chooseProposal(state: GameState, a: NpcId, b: CharId, rng: Rng): Proposal | null {
  const def = NPC_BY_ID[a];
  const per = def.personality;
  const r = rel(state, a, b);
  const need = allianceNeed(state, a);
  const base: Omit<Proposal, 'kind'> = { from: a, to: b, payNow: 0, payOnSuccess: 0, untilDay: state.day };
  const opts: { u: number; p: Proposal }[] = [];
  if (!allied(state, a, b) && r.hostility < 40) {
    const strength = perceivedStrength(state, b);
    let u = need * 50 + r.like * 0.5 + (r.trust - 40) * 0.6 + strength * 15 - r.wary * 0.3;
    if (def.rules.requireRational) u += (strength - 0.5) * 40 - 8;
    // 御堂：有力者を買収する（前金を積む）
    const pay = def.rules.profitFirst && state.actors[a].pieces >= 3 && strength >= 0.5 && per.greed >= 85 ? 1 : 0;
    opts.push({ u, p: { ...base, kind: 'alliance', payNow: pay, untilDay: state.day + (per.loyalty >= 70 ? 1 : 0) } });
    if (!allied(state, a, b, ['nonaggression'])) opts.push({ u: u * 0.6 + 6 + (r.threat - 30) * 0.2, p: { ...base, kind: 'nonaggression' } });
  }
  // 情報：相手が知らない情報を売る／共有する
  const mine = Object.keys(state.actors[a].knows)
    .map((k) => state.infos[k])
    .filter((i): i is Info => !!i && i.source !== 'public' && !state.actors[b].knows[i.id] && !i.about.includes(b));
  if (mine.length) {
    const info = mine.sort((x, y) => y.value - x.value)[0];
    const price = Math.max(0, Math.min(PROFILES[a].basePrices.SELL_INFO, info.value) - (r.trust >= 70 ? 1 : 0) - (r.debt >= 40 ? 1 : 0));
    const share = r.like > 20 || per.greed < 30;
    opts.push({ u: 14 + info.value * 5 + per.greed * 0.12, p: { ...base, kind: 'info_sell', payNow: share && price <= 1 ? 0 : -price, infoId: info.id } });
  }
  // 借金の申し込み（ピースが尽きた時だけ）
  if (state.actors[a].pieces === 0 && r.trust >= 55 && state.actors[b].pieces >= 3) opts.push({ u: 18, p: { ...base, kind: 'loan', payNow: -1, payOnSuccess: 1, untilDay: state.day + 2 } });
  if (!opts.length) return null;
  let best = opts[0];
  let bv = -Infinity;
  for (const o of opts) {
    const v = o.u + rng.gauss(0, 4);
    if (v > bv) { bv = v; best = o; }
  }
  return bv > 8 ? best.p : null;
}

function nearbyWitnesses(state: GameState, a: Actor, b: Actor): CharId[] {
  return actorsIn(state, a.pos.room)
    .filter((x) => x.id !== a.id && x.id !== b.id && distance(x, a) <= 7)
    .filter((x) => x.id === 'hero' || NPC_BY_ID[x.id as NpcId].stats.observation >= 7)
    .map((x) => x.id);
}

/** 雑談で噂を流す（低道徳・高演技の人物は虚偽を混ぜることがある） */
function gossip(state: GameState, a: NpcId, b: CharId, rng: Rng): void {
  const A = state.actors[a];
  const def = NPC_BY_ID[a];
  const r = rel(state, a, b);
  // 知っている裏切りや噂を共有（好感・信頼がある相手に）
  if (r.like + r.trust > 45) {
    const known = Object.keys(A.knows).map((k) => state.infos[k]).filter((i): i is Info => !!i && (i.kind === 'betrayal' || i.kind === 'deal' || i.kind === 'rumor') && !state.actors[b].knows[i.id] && !i.about.includes(b));
    if (known.length) {
      const info = known[0];
      const conf = Math.min(0.8, (20 + 0.6 * rel(state, b, a).trust - 0.3 * rel(state, b, a).wary) / 100) * Math.min(1, (A.knows[info.id]?.conf ?? 0.5) * 0.75 + 0.25);
      absorb(state, b, info.id, a, Math.max(0.1, conf));
      return;
    }
  }
  // 虚偽の噂：脅威と感じる相手を孤立させる（御堂・白石・如月・九条など）
  if (def.personality.morality <= 45 && def.stats.acting >= 8 && rng.chance(0.25)) {
    const rivals = aliveIds(state).filter((x) => x !== a && x !== b && !allied(state, a, x));
    const target = rivals.sort((x, y) => rel(state, a, y).threat - rel(state, a, x).threat)[0];
    if (target && rel(state, a, target).threat > 40) {
      const believed = b === 'hero' ? true : evaluate(state, { kind: 'accuse', from: a, to: b, target, payNow: 0, payOnSuccess: 0, untilDay: state.day }).accept;
      accuse(state, a, b, target, `${nameOf(state, target)}は、同盟相手を次の試合で切り捨てるつもりらしい。`, true, believed);
    }
  }
}

/** NPC 同士の会話を解決する */
function interact(state: GameState, a: Actor, b: Actor, rng: Rng, events: BrainEvent[], priv = false): void {
  const ida = a.id as NpcId;
  const idb = b.id as NpcId;
  a.busyUntil = b.busyUntil = state.simTime + TALK_TIME;
  a.talkCd[idb] = b.talkCd[ida] = state.simTime + CONFIG.npc.talkCooldown;
  a.path = []; a.route = []; b.path = []; b.route = [];
  a.bubble = { text: '…', until: state.simTime + TALK_TIME };
  b.bubble = { text: '…', until: state.simTime + TALK_TIME };
  // 初回の有意な会話（1日1人1回）
  const key = `met_${state.day}_${[ida, idb].sort().join('_')}`;
  if (!state.flags[key]) {
    state.flags[key] = true;
    adjustRel(state, ida, idb, { like: 2, trust: 1 });
    adjustRel(state, idb, ida, { like: 2, trust: 1 });
  }
  fact(state, priv ? 'private_talk' : 'talk', [ida, idb], `${nameOf(state, ida)}と${nameOf(state, idb)}が${priv ? '個室で密談した' : `${ROOMS[a.pos.room].name}で話した`}`);
  // 個室の密談は、同席していない人には見えも聞こえもしない
  const witnesses = priv ? actorsIn(state, a.pos.room).filter((x) => x.id !== a.id && x.id !== b.id).map((x) => x.id) : nearbyWitnesses(state, a, b);
  if (witnesses.includes('hero')) events.push({ type: 'talk', npc: ida, other: idb });
  const p = chooseProposal(state, ida, idb, rng);
  if (p) {
    let v = evaluate(state, p);
    let final = p;
    // 対案は最大 2 往復
    for (let i = 0; i < 2 && !v.accept && v.counter; i++) {
      const next: Proposal = { ...final, ...v.counter };
      // 提案者が対案（追加の支払い）を受け入れるか：自分の必要度と手持ちで判断
      const extra = (next.payNow ?? 0) - final.payNow;
      const affordable = state.actors[ida].pieces >= Math.max(0, next.payNow);
      const willing = extra <= 0 || (affordable && extra <= 1 + Math.round(allianceNeed(state, ida) * 2) + (NPC_BY_ID[ida].rules.profitFirst ? 1 : 0));
      if (!willing) break;
      final = next;
      v = evaluate(state, final);
    }
    if (v.accept) {
      const d = commit(state, final, witnesses);
      if (d) {
        a.bubble = { text: '🤝', until: state.simTime + TALK_TIME };
        b.bubble = { text: '🤝', until: state.simTime + TALK_TIME };
        if (witnesses.includes('hero')) events.push({ type: 'deal', npc: ida, other: idb });
      }
    } else {
      state.flags.npcRefusals = Number(state.flags.npcRefusals ?? 0) + 1;
    }
  }
  gossip(state, ida, idb, rng);
  if (rng.chance(0.5)) gossip(state, idb, ida, rng);
  a.goal = undefined;
}

function searchSpot(state: GameState, a: Actor, events: BrainEvent[]): void {
  const g = a.goal!;
  const insId = g.note!;
  a.searched.push(insId);
  const ins = ROOMS[a.pos.room]?.inspects.find((i) => i.id === insId);
  const clue = ins?.event ? CLUE_BY_EVENT[ins.event] : undefined;
  if (clue) {
    if (!state.infos[clue.id]) addInfo(state, { id: clue.id, kind: 'clue', text: clue.text, truth: true, about: [], source: 'world', value: clue.value, tags: clue.tags });
    learn(state, a.id, clue.id, 'self', 1);
    events.push({ type: 'found', npc: a.id as NpcId, text: clue.id });
  }
  a.busyUntil = state.simTime + SEARCH_TIME;
  a.bubble = { text: '🔍', until: state.simTime + SEARCH_TIME };
  a.goal = undefined;
}

/**
 * 自由行動中の NPC を dt ミリ秒進める。heroBusy は、プレイヤーが会話中などで話しかけられない状態。
 * 戻り値はプレイヤーに関係する出来事（話しかけてきた、目撃した等）。
 */
export function tickNpcs(state: GameState, dt: number, heroBusy: boolean): BrainEvent[] {
  const events: BrainEvent[] = [];
  const rng = rngOf(state);
  // 席の表の点検（部屋を出た人、脱落した人の席を空ける）
  sweepSeats(state);
  // 同時刻の処理順は公平なローテーション
  const ids = aliveNpcs(state);
  const rot = Math.floor(state.simTime / THINK) % Math.max(1, ids.length);
  const order = ids.map((_, i) => ids[(i + rot) % ids.length]);
  for (const id of order) {
    const a = state.actors[id];
    if (a.bubble && a.bubble.until <= state.simTime) a.bubble = undefined;
    if ((a.busyUntil ?? 0) > state.simTime) continue;
    const roomBefore = a.pos.room;
    const hadGoal = !!a.goal;
    // 主人公が話しかけようと近づいてきたら、立ち止まって待つ（待ち続けはしない。自分から主人公へ向かっている時と同行中は対象外）
    const hero = state.actors.hero;
    const toHero = (a.goal?.kind === 'talk' || a.goal?.kind === 'follow') && a.goal.target === 'hero';
    if (!heroBusy && !toHero && !nearDoor(a) && heroComing(hero, a)) {
      if ((a.waitCd ?? 0) <= state.simTime) {
        a.waitUntil = state.simTime + CONFIG.npc.waitForHero;
        a.waitCd = a.waitUntil + CONFIG.npc.waitForHeroCooldown;
      }
    } else if ((a.waitUntil ?? 0) > state.simTime && (toHero || distance(a, hero) > 5)) a.waitUntil = 0;
    const halt = (a.waitUntil ?? 0) > state.simTime;
    // 目当ての部屋に着いたら、空いた席を取ってそこへ向かう（食事、その場で過ごす時）
    takeSeat(state, a, rng);
    // 同行中は、相手に置いていかれないよう相手と同じ速さで歩く
    moveActor(state, a, dt, a.goal?.kind === 'follow' && a.goal.target ? Math.max(speedOf(id), speedOf(a.goal.target)) : speedOf(id), halt);
    if (halt && !a.step) {
      // 待っている間は用事の期限を延ばし、主人公の方を向く
      if (a.goal) a.goal.until += dt;
      const dx = hero.pos.x - a.pos.x;
      const dy = hero.pos.y - a.pos.y;
      if (hero.pos.room === a.pos.room && Math.abs(dx) + Math.abs(dy) <= 2) a.pos.dir = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
      continue;
    }
    if (a.pos.room !== roomBefore && isBedroom(a.pos.room) && a.pos.room !== homeOf(state, id)) {
      // 他人の個室へ入った：廊下にいた人が見ているかもしれない
      const host = ownerOf(state, a.pos.room);
      const seen = witnessEntry(state, host, id, roomBefore, rng);
      if (seen.includes('hero')) events.push({ type: 'sight', npc: id, other: host });
    }
    const g = a.goal;
    if (g && g.until < state.simTime) a.goal = undefined;
    // 就寝の支度：消灯の 40 分前に用事を切り上げ、20 分前にはどんな用事でも個室へ向かう
    if (bedtime(state, id) && a.goal?.note !== 'bed' && a.pos.room !== homeOf(state, id)) {
      const urgent = clockMinutes(state) >= CLOCK.curfew - bedLead(state, id) + 20;
      const bkey = `bed:${state.day}:${id}`;
      if (urgent || !state.flags[bkey]) {
        state.flags[bkey] = true;
        if (urgent || !a.goal || a.goal.kind === 'wander' || (a.goal.kind === 'rest' && a.goal.note !== 'bath') || a.goal.kind === 'explore' || a.goal.kind === 'idle') {
          if (a.goal?.kind === 'follow' && a.goal.target) endInvite(state, a.goal.target, id);
          a.goal = undefined;
          a.path = [];
          a.route = [];
          a.nextThink = state.simTime + (urgent ? 0 : rng.int(0, 6000));
        }
      }
    }
    // 食事や入浴の時間になったら、のんびり過ごしている人は予定を考え直す（行くかどうかは本人しだい）
    const slotNow = state.phase === 'curfew' ? null : lifeSlot(clockMinutes(state));
    if (slotNow && !state.flags[`slot:${state.day}:${slotNow}:${id}`]) {
      state.flags[`slot:${state.day}:${slotNow}:${id}`] = true;
      if (a.goal && (a.goal.kind === 'wander' || (a.goal.kind === 'rest' && a.goal.note !== 'bath'))) {
        a.goal = undefined;
        a.path = [];
        a.route = [];
      }
      a.nextThink = state.simTime + rng.int(0, 9000);
    }
    if (a.goal?.kind === 'talk' && a.goal.target) {
      const b = state.actors[a.goal.target];
      if (!b.alive) a.goal = undefined;
      else if (!canEnter(state, id, b.pos.room)) {
        // 個室にいる相手を訪ねる：扉の前まで行ってノックする。入れてもらえなければ引き返す
        if (a.goal.note !== 'visit' || b.pos.room !== homeOf(state, b.id) || state.phase === 'curfew' || bedtime(state)) a.goal = undefined;
        else {
          const corridor = corridorOf(b.pos.room);
          if (a.pos.room !== corridor) {
            if (!a.route.length && !a.step && !setRouteTo(state, a, corridor)) a.goal = undefined;
          } else {
            const door = ROOMS[corridor].doors.find((d) => d.to === b.pos.room)!;
            const at = door.tiles.some((tl) => tl.x === a.pos.x && tl.y === a.pos.y);
            if (!at) {
              if (!a.path.length && !a.step && !a.route.length && !setPathTo(state, a, door.tiles[0].x, door.tiles[0].y)) a.goal = undefined;
            } else if (!a.step) {
              a.path = [];
              a.pos.dir = door.dir;
              if (b.id === 'hero') {
                if (!heroBusy) {
                  a.talkCd.hero = state.simTime + CONFIG.npc.approachHeroCooldown;
                  a.busyUntil = state.simTime + 8000;
                  a.goal = undefined;
                  events.push({ type: 'knock', npc: id, other: 'hero' });
                }
              } else {
                const v = visitVerdict(state, id, b.id as NpcId, rng);
                const ok = v.accept && addInvite(state, b.id, id);
                a.talkCd[b.id] = state.simTime + CONFIG.npc.talkCooldown;
                a.busyUntil = state.simTime + 1200;
                fact(state, 'invite', [id, b.id], `${nameOf(state, id)}が${nameOf(state, b.id)}の個室を訪ねた（${ok ? '入室' : '断られた'}）`);
                if (state.actors.hero.pos.room === corridor) events.push({ type: 'knock', npc: id, other: b.id });
                if (!ok) a.goal = undefined;
              }
            }
          }
        }
      } else if (a.pos.room === b.pos.room) {
        const d = distance(a, b);
        if (d <= 2) {
          a.path = [];
          if (b.id === 'hero') {
            if (!heroBusy && !a.step) {
              const p = chooseProposal(state, id, 'hero', rng);
              a.talkCd.hero = state.simTime + CONFIG.npc.approachHeroCooldown;
              a.goal = undefined;
              const secrecy = 0.15 + NPC_BY_ID[id].stats.acting * 0.03 + (100 - NPC_BY_ID[id].personality.morality) / 500;
              if (p && p.kind === 'alliance' && state.phase !== 'curfew' && !isBedroom(a.pos.room) && othersPresent(state, id, 'hero') && isPrivateRoom(homeOf(state, id)) && canEnter(state, id, homeOf(state, id)) && reachable(state, a, homeOf(state, id)) !== null && rng.chance(secrecy)) {
                // 人目があるので、同盟の話は自分の個室でしたい（主人公も NPC 同士と同じ扱い）
                a.busyUntil = state.simTime + 1500;
                events.push({ type: 'invite', npc: id, other: 'hero' });
              } else if (p) {
                a.busyUntil = state.simTime + 1500;
                events.push({ type: 'approach', npc: id, other: 'hero', proposal: p });
              }
            }
          } else if ((b.busyUntil ?? 0) <= state.simTime && !a.step && !b.step) {
            const priv = isPrivate(state, id, b.id);
            interact(state, a, b, rng, events, priv);
            // 訪ねた先の個室で話が済んだら、部屋を出る
            if (isPrivateRoom(a.pos.room) && a.pos.room !== homeOf(state, id)) {
              endInvite(state, b.id, id);
              a.goal = { kind: 'goto', room: corridorOf(a.pos.room), until: state.simTime + 20_000 };
            }
          }
        } else if (!a.path.length && !a.step) {
          setPathTo(state, a, b.pos.x, b.pos.y);
          if (a.path.length) a.path.pop(); // 隣で止まる
        }
      } else if (!a.route.length && !a.step) {
        if (!setRouteTo(state, a, b.pos.room)) a.goal = undefined;
      } else if (a.route.length && a.route[a.route.length - 1] !== b.pos.room) {
        setRouteTo(state, a, b.pos.room);
      }
    } else if (a.goal?.kind === 'follow' && a.goal.target) {
      // 同行（v10）：相手の後ろを歩く。扉や階段、立入制限は通常の移動と同じ
      const b = state.actors[a.goal.target];
      const host = a.goal.target;
      if (!b.alive) a.goal = undefined;
      else if (a.pos.room !== b.pos.room) {
        if (!a.step && (!a.route.length || a.route[a.route.length - 1] !== b.pos.room)) {
          a.path = [];
          if (!setRouteTo(state, a, b.pos.room)) {
            // たどり着けない（立入制限など）：同行をやめる
            endInvite(state, host, id);
            a.goal = undefined;
            if (host === 'hero') events.push({ type: 'followEnd', npc: id });
          }
        }
      } else {
        a.route = [];
        const d = distance(a, b);
        if (d > 2 && !a.path.length && !a.step) {
          if (setPathTo(state, a, b.pos.x, b.pos.y) && a.path.length) a.path.pop();
        } else if (d <= 1) a.path = [];
      }
    } else if (a.goal?.note?.startsWith('host:') && a.pos.room === homeOf(state, id) && !a.step) {
      // 自分の個室で、招いた相手を待つ。揃ったら密談する
      const guest = a.goal.note.slice(5) as CharId;
      const b = state.actors[guest];
      if (!b.alive) a.goal = undefined;
      else if (b.pos.room === a.pos.room && guest !== 'hero' && !b.step && (b.busyUntil ?? 0) <= state.simTime) {
        b.path = [];
        interact(state, a, b, rng, events, true);
        endInvite(state, id, guest);
        b.goal = { kind: 'goto', room: corridorOf(a.pos.room), until: state.simTime + 20_000 };
        a.goal = undefined;
      } else if (b.pos.room === a.pos.room && guest === 'hero' && !heroBusy && distance(a, b) <= 3 && !state.flags[`hosted:${state.day}:${id}:${Math.floor(a.goal.until / 1000)}`]) {
        // 主人公を招いた場合：部屋に来たら話を切り出す（1 度だけ）
        state.flags[`hosted:${state.day}:${id}:${Math.floor(a.goal.until / 1000)}`] = true;
        const p = chooseProposal(state, id, 'hero', rng);
        a.busyUntil = state.simTime + 1500;
        events.push({ type: 'approach', npc: id, other: 'hero', proposal: p ?? undefined });
      }
    } else if (a.goal?.note === 'meal' && a.pos.room === 'dining' && !a.step && !a.path.length && !a.route.length && settleSeat(state, a)) {
      // 取った席に座って食べる（席が無ければ立ったまま）。食べ終わると立って、席を空ける
      // 食事：同じ時間に食卓を囲んだ相手と少し打ち解ける
      // 歩いているうちに時間帯を少し過ぎても、その食事として数える
      const slot = clockMinutes(state) < CLOCK.main ? 'breakfast' : 'dinner';
      state.flags[`ate:${state.day}:${slot}:${id}`] = true;
      a.busyUntil = state.simTime + MEAL_TIME;
      a.bubble = { text: '🍽', until: state.simTime + MEAL_TIME };
      for (const o of actorsIn(state, 'dining')) {
        if (o.id === id || o.id === 'hero' || !state.flags[`ate:${state.day}:${slot}:${o.id}`]) continue;
        const key = `dined:${state.day}:${slot}:${[id, o.id].sort().join('+')}`;
        if (state.flags[key]) continue;
        state.flags[key] = true;
        adjustRel(state, id, o.id, { like: 1 });
        adjustRel(state, o.id, id, { like: 1 });
      }
      a.goal = undefined;
    } else if (a.goal?.note === 'bath' && a.pos.room === homeOf(state, id) && !a.step && !a.path.length && !a.route.length) {
      // 入浴は個室の中（画面には出さない）
      state.flags[`bath:${state.day}:${id}`] = true;
      a.busyUntil = state.simTime + BATH_TIME;
      a.goal = undefined;
    } else if (a.goal?.kind === 'explore' && a.goal.spot) {
      if (a.pos.room === a.goal.room && !a.moving && !a.step) {
        if (Math.abs(a.pos.x - a.goal.spot.x) + Math.abs(a.pos.y - a.goal.spot.y) <= 2) searchSpot(state, a, events);
        else if (!setPathTo(state, a, a.goal.spot.x, a.goal.spot.y)) a.goal = undefined;
      }
    }
    else if ((a.goal?.kind === 'wander' || a.goal?.kind === 'rest') && a.goal.note !== 'at' && a.goal.note !== 'bath' && a.pos.room === a.goal.room && !a.step && !a.path.length && !a.route.length && settleSeat(state, a)) {
      // 着いた：しばらくそこで過ごす（待機、着席、休息）
      // 就寝の支度で個室へ戻った時、まだなら入浴も済ませる
      if (a.goal.note === 'bed' && !state.flags[`bath:${state.day}:${id}`]) {
        state.flags[`bath:${state.day}:${id}`] = true;
        a.busyUntil = state.simTime + BATH_TIME;
      }
      a.goal.note = 'at';
      a.goal.until = state.simTime + rng.int(STAY_MIN, STAY_MAX);
    }
    // 席に座っているのは、その場で過ごしている間だけ（用事ができたら立つ。食事中は上の busyUntil で止まっている）
    if (a.seat && a.goal?.note !== 'at' && (a.busyUntil ?? 0) <= state.simTime) standUp(state, id);
    // 用事もなく予約だけ残っている席は放す
    else if (!a.seat && (!a.goal?.seat || a.goal.seat === '-') && seatOf(state, id)) standUp(state, id);
    // 用事が済んだら、すぐ次へ動かずに少しその場で過ごす
    if (hadGoal && !a.goal && a.nextThink < state.simTime) a.nextThink = state.simTime + rng.int(PAUSE_MIN, PAUSE_MAX);
    if (!a.goal && state.simTime >= a.nextThink && !a.step) {
      a.nextThink = state.simTime + THINK + rng.int(0, 1200);
      think(state, a, rng);
    }
  }
  return events;
}

/** 日末：未接触者への警戒・敵対を最大 2 だけ初期方向へ緩和（重大な裏切りの記録は残る） */
export function dailyDecay(state: GameState): void {
  for (const a of aliveIds(state)) {
    for (const b of aliveIds(state)) {
      if (a === b) continue;
      const r = rel(state, a, b);
      if (r.wary > 30) r.wary = Math.max(30, r.wary - 2);
      if (r.hostility > 0) r.hostility = Math.max(0, r.hostility - 2);
    }
  }
}

/** プレイヤーが操作していない時間を早送りする（フェーズを飛ばす時） */
export function fastForward(state: GameState, ms: number): void {
  const step = 250;
  for (let t = 0; t < ms; t += step) {
    state.simTime += step;
    tickNpcs(state, step, true);
  }
}
