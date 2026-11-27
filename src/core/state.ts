import { ALL_IDS, NPC_BY_ID, type CharId, type NpcId } from '../data/characters';
import { CONFIG, type Difficulty } from '../data/config';
import { Rng } from './rng';
import type { Actor, Deal, Fact, GameState, Info, Known, Relation } from './types';

export const SAVE_VERSION = 1;

export function defaultRelation(): Relation {
  return { like: 0, trust: 40, wary: 30, debt: 0, hostility: 0, threat: 30 };
}

function makeActor(id: CharId): Actor {
  const room = `bedroom_${id}`;
  return {
    id,
    alive: true,
    pieces: CONFIG.economy.initialPieces,
    silver: 0,
    house: null,
    pos: { room, x: 10, y: 8, dir: 'down' },
    path: [],
    route: [],
    moving: false,
    rel: {},
    knows: {},
    items: {},
    nextThink: 0,
    talkCd: {},
    searched: [],
  };
}

export function newGame(opts: { gender: 'm' | 'f'; name: string; seed?: number; difficulty?: Difficulty }): GameState {
  const seed = opts.seed ?? (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
  const rng = Rng.derive(seed, 'init');
  const actors = Object.fromEntries(ALL_IDS.map((id) => [id, makeActor(id)])) as Record<CharId, Actor>;
  // 初期関係：全員同じ基準値。プレイヤー専用の補正はしない
  for (const a of ALL_IDS) {
    for (const b of ALL_IDS) {
      if (a === b) continue;
      const r = defaultRelation();
      // v03: 初対面の数値にシード付き ±5（恩義・敵対を除く）
      r.like += rng.int(-5, 5);
      r.trust += rng.int(-5, 5);
      r.wary += rng.int(-5, 5);
      r.threat += rng.int(-5, 5);
      actors[a].rel[b] = r;
    }
  }
  const state: GameState = {
    version: SAVE_VERSION,
    seed,
    rng: { s: Rng.derive(seed, 'main').state.s },
    difficulty: opts.difficulty ?? 'normal',
    hero: { gender: opts.gender, name: opts.name },
    day: 1,
    phase: 'prologue',
    phaseLeft: 0,
    simTime: 0,
    actors,
    deals: [],
    infos: {},
    facts: [],
    flags: { rules: 'v11' },
    seen: [],
    claimed: [],
    history: [],
    match: null,
    today: {},
    counter: 0,
    lineHist: {},
    relEvents: [],
    board: [],
    log: [],
  };
  return state;
}

export function rngOf(state: GameState): Rng {
  return new Rng(state.rng);
}

export function uid(state: GameState, prefix: string): string {
  state.counter += 1;
  return `${prefix}_${state.day}_${state.counter}`;
}

export function rel(state: GameState, a: CharId, b: CharId): Relation {
  const actor = state.actors[a];
  let r = actor.rel[b];
  if (!r) {
    r = defaultRelation();
    actor.rel[b] = r;
  }
  return r;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function adjustRel(state: GameState, a: CharId, b: CharId, d: Partial<Relation>): void {
  if (a === b) return;
  const r = rel(state, a, b);
  if (d.like) r.like = clamp(r.like + d.like, -100, 100);
  if (d.trust) r.trust = clamp(r.trust + d.trust, 0, 100);
  if (d.wary) r.wary = clamp(r.wary + d.wary, 0, 100);
  if (d.debt) r.debt = clamp(r.debt + d.debt, 0, 100);
  if (d.hostility) r.hostility = clamp(r.hostility + d.hostility, 0, 100);
  if (d.threat) r.threat = clamp(r.threat + d.threat, 0, 100);
}

export function aliveIds(state: GameState): CharId[] {
  return ALL_IDS.filter((id) => state.actors[id].alive);
}

export function aliveNpcs(state: GameState): NpcId[] {
  return aliveIds(state).filter((id): id is NpcId => id !== 'hero');
}

export function nameOf(state: GameState, id: CharId | string): string {
  if (id === 'hero') return state.hero.name;
  if (id in NPC_BY_ID) return NPC_BY_ID[id as NpcId].name;
  if (id === 'host' || id === 'host_observer') return 'オブザーバー';
  return String(id);
}

export function shortName(state: GameState, id: CharId | string): string {
  if (id === 'hero') return state.hero.name.split(/\s+/).pop() ?? state.hero.name;
  if (id in NPC_BY_ID) return NPC_BY_ID[id as NpcId].short;
  return nameOf(state, id);
}

export function log(state: GameState, text: string, kind?: string): void {
  state.log.push({ t: state.simTime, day: state.day, text, kind });
  if (state.log.length > 300) state.log.splice(0, state.log.length - 300);
}

export function fact(state: GameState, type: string, actors: CharId[], text: string, data?: Record<string, unknown>): Fact {
  const f: Fact = { t: state.simTime, day: state.day, phase: state.phase, type, actors, text, data };
  state.facts.push(f);
  return f;
}

// ---------------- 情報 ----------------

export function addInfo(state: GameState, info: Omit<Info, 'id' | 'day'> & { id?: string }): Info {
  const id = info.id ?? uid(state, 'info');
  const full: Info = { ...info, id, day: state.day };
  state.infos[id] = full;
  return full;
}

export function learn(state: GameState, who: CharId, infoId: string, from: Known['from'], conf: number): boolean {
  const a = state.actors[who];
  const cur = a.knows[infoId];
  if (cur && cur.conf >= conf) return false;
  a.knows[infoId] = { conf: Math.max(cur?.conf ?? 0, conf), from: cur?.from ?? from, day: cur?.day ?? state.day };
  if (who === 'hero' && !cur) {
    const info = state.infos[infoId];
    if (info) log(state, `手帳に記録：${info.text}`, 'info');
  }
  return !cur;
}

export function knows(state: GameState, who: CharId, infoId: string): boolean {
  return !!state.actors[who].knows[infoId];
}

/** 全員に公開情報として配る（脱落者を除く） */
export function publish(state: GameState, info: Omit<Info, 'id' | 'day' | 'source'> & { id?: string }): Info {
  const i = addInfo(state, { ...info, source: 'public' });
  for (const id of aliveIds(state)) learn(state, id, i.id, 'public', 1);
  return i;
}

// ---------------- ピース ----------------

/** 原子的なピース移動。残高不足なら何もせず false */
export function transfer(state: GameState, from: CharId | 'host', to: CharId | 'host', amount: number, reason: string): boolean {
  if (amount < 0) return transfer(state, to, from, -amount, reason);
  if (amount === 0) return true;
  if (from !== 'host') {
    const a = state.actors[from];
    if (a.pieces < amount) return false;
    a.pieces -= amount;
  }
  if (to !== 'host') state.actors[to].pieces += amount;
  fact(state, 'transfer', [from, to].filter((x) => x !== 'host') as CharId[], `${reason}`, { from, to, amount });
  return true;
}

export function activeDeals(state: GameState, a?: CharId, b?: CharId): Deal[] {
  return state.deals.filter(
    (d) => d.status === 'active' && (!a || d.from === a || d.to === a) && (!b || d.from === b || d.to === b),
  );
}

/** 2人の間に有効な同盟/不可侵があるか */
export function allied(state: GameState, a: CharId, b: CharId, kinds: Deal['kind'][] = ['alliance']): Deal | undefined {
  return state.deals.find(
    (d) => d.status === 'active' && kinds.includes(d.kind) && ((d.from === a && d.to === b) || (d.from === b && d.to === a)) && d.untilDay >= state.day,
  );
}

export function piecesOf(state: GameState, id: CharId): number {
  return state.actors[id].pieces;
}
