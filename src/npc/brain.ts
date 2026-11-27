/**
 * NPC の自律行動（自由行動フェーズ）。
 * シミュレーション時間で動き、意思決定は一定間隔（暫定 3 秒）。候補の効用を
 * 0.38*生存 + 0.22*将来優位 + 0.13*ピース + 0.12*関係 + 0.10*個人目標 + 0.05*探索 - 0.22*危険 - 0.10*時間
 * で評価し、人格ごとの重みを掛ける。プレイヤーも他の NPC と同じ「相手候補」の 1 人として扱う。
 */
import { NPC_BY_ID, PROFILES, type CharId, type NpcId } from '../data/characters';
import { CONFIG } from '../data/config';
import { Rng } from '../core/rng';
import { activeDeals, addInfo, adjustRel, aliveIds, aliveNpcs, allied, fact, learn, nameOf, rel, rngOf } from '../core/state';
import type { Actor, GameState, Info } from '../core/types';
import { CLUE_BY_EVENT } from '../story/clues';
import { canEnter, passFn } from '../world/access';
import { ROOMS } from '../world/maps';
import { roomRoute } from '../world/path';
import { actorsIn, distance, moveActor, setPathTo, setRouteTo, speedOf } from '../world/sim';
import { absorb, accuse, commit, evaluate, perceivedStrength, type Proposal } from './negotiation';

export interface BrainEvent {
  type: 'approach' | 'talk' | 'deal' | 'found' | 'rumor';
  npc: NpcId;
  other?: CharId;
  proposal?: Proposal;
  text?: string;
}

const THINK = 3000;
const TALK_TIME = 8000;
const SEARCH_TIME = 6000;

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
    if (room.area === 'secret' || room.id.startsWith('bedroom_')) continue;
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

function think(state: GameState, a: Actor, rng: Rng): void {
  const id = a.id as NpcId;
  const def = NPC_BY_ID[id];
  const w = prof(id).utilityWeights;
  const cands: { u: number; run: () => void }[] = [];
  const noise = CONFIG.difficulty[state.difficulty].noise * 4;

  // 会話・交渉
  for (const o of aliveIds(state)) {
    if (o === id) continue;
    const b = state.actors[o];
    if ((a.talkCd[o] ?? 0) > state.simTime) continue;
    if (b.pos.room.startsWith('bedroom_')) continue;
    const dist = reachable(state, a, b.pos.room);
    if (dist === null) continue;
    const u = talkUtility(state, id, o) - 0.1 * (dist * 8) * w.time;
    cands.push({ u, run: () => { a.goal = { kind: 'talk', target: o, until: state.simTime + 40_000 }; } });
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
    cands.push({ u: 3.5, run: () => { a.goal = { kind: 'wander', room, spot: rng.pick(ROOMS[room].spots), until: state.simTime + rng.int(12_000, 30_000) }; } });
  } else {
    const room = ROOMS[a.pos.room];
    cands.push({ u: 2, run: () => { a.goal = { kind: 'wander', room: room.id, spot: rng.pick(room.spots), until: state.simTime + rng.int(8_000, 20_000) }; } });
  }
  // 休息（夜は個室へ）
  if (state.phase === 'night' && canEnter(state, id, `bedroom_${id}`)) {
    cands.push({ u: 2 + (100 - def.personality.explore) / 25, run: () => { a.goal = { kind: 'rest', room: `bedroom_${id}`, until: state.simTime + 60_000 }; } });
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

function startGoal(state: GameState, a: Actor): void {
  const g = a.goal;
  if (!g) return;
  if (g.kind === 'talk' && g.target) {
    const b = state.actors[g.target];
    setRouteTo(state, a, b.pos.room);
  } else if (g.room) {
    setRouteTo(state, a, g.room, g.spot);
  }
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
function interact(state: GameState, a: Actor, b: Actor, rng: Rng, events: BrainEvent[]): void {
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
  fact(state, 'talk', [ida, idb], `${nameOf(state, ida)}と${nameOf(state, idb)}が${ROOMS[a.pos.room].name}で話した`);
  const witnesses = nearbyWitnesses(state, a, b);
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
  // 同時刻の処理順は公平なローテーション
  const ids = aliveNpcs(state);
  const rot = Math.floor(state.simTime / THINK) % Math.max(1, ids.length);
  const order = ids.map((_, i) => ids[(i + rot) % ids.length]);
  for (const id of order) {
    const a = state.actors[id];
    if (a.bubble && a.bubble.until <= state.simTime) a.bubble = undefined;
    if ((a.busyUntil ?? 0) > state.simTime) continue;
    moveActor(state, a, dt, speedOf(id));
    const g = a.goal;
    if (g && g.until < state.simTime) a.goal = undefined;
    if (a.goal?.kind === 'talk' && a.goal.target) {
      const b = state.actors[a.goal.target];
      if (!b.alive || !canEnter(state, id, b.pos.room) || b.pos.room.startsWith('bedroom_')) {
        a.goal = undefined;
      } else if (a.pos.room === b.pos.room) {
        const d = distance(a, b);
        if (d <= 2) {
          a.path = [];
          if (b.id === 'hero') {
            if (!heroBusy && !a.step) {
              const p = chooseProposal(state, id, 'hero', rng);
              a.talkCd.hero = state.simTime + CONFIG.npc.approachHeroCooldown;
              a.goal = undefined;
              if (p) {
                a.busyUntil = state.simTime + 1500;
                events.push({ type: 'approach', npc: id, other: 'hero', proposal: p });
              }
            }
          } else if ((b.busyUntil ?? 0) <= state.simTime && !a.step && !b.step) {
            interact(state, a, b, rng, events);
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
    } else if (a.goal?.kind === 'explore' && a.goal.spot) {
      if (a.pos.room === a.goal.room && !a.moving && !a.step) {
        if (Math.abs(a.pos.x - a.goal.spot.x) + Math.abs(a.pos.y - a.goal.spot.y) <= 2) searchSpot(state, a, events);
        else if (!setPathTo(state, a, a.goal.spot.x, a.goal.spot.y)) a.goal = undefined;
      }
    }
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
