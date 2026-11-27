/**
 * 競技の実行。プレイヤーの有無に関わらず同じルールエンジンを使う。
 * NPC には engine.view(本人) だけを渡し、全体状態は渡さない。
 */
import { NPC_BY_ID, type CharId, type NpcId } from '../data/characters';
import { CONFIG } from '../data/config';
import { MATCHES } from '../matches/registry';
import { TIEBREAK } from '../matches/tiebreak';
import { skill, type AiCtx, type MatchEngine } from '../matches/types';
import { Rng } from './rng';
import { activeDeals, nameOf, rel, rngOf, transfer } from './state';
import type { GameState, MatchSlot } from './types';

export function engineOf(id: string): MatchEngine {
  if (id === 'tiebreak') return TIEBREAK;
  const e = MATCHES[id];
  if (!e) throw new Error(`未実装の競技: ${id}`);
  return e;
}

export function buildCtx(state: GameState, id: CharId, matchId: string, rng: Rng): AiCtx {
  const def = NPC_BY_ID[id as NpcId];
  const diff = CONFIG.difficulty[state.difficulty];
  const stats = def?.stats ?? HERO_STANDIN;
  const personality = def?.personality ?? { greed: 50, loyalty: 50, ambition: 50, morality: 50, risk: 50, explore: 50 };
  const deals = activeDeals(state, id);
  const partner = (d: { from: CharId; to: CharId }) => (d.from === id ? d.to : d.from);
  return {
    self: id,
    stats,
    personality,
    rng,
    noise: diff.noise * (1.25 - skill(stats.strategy) * 0.5),
    depth: Math.max(0, Math.round(diff.depth + skill(stats.strategy) * 2 - 1)),
    memoryLoss: diff.memoryLoss * (1.5 - skill(stats.memory)),
    relation: (o) => rel(state, id, o),
    allies: deals.filter((d) => d.kind === 'alliance').map(partner),
    nonAggression: deals.filter((d) => d.kind === 'nonaggression').map(partner),
    myPlans: deals.flatMap((d) => {
      if (d.kind !== 'plan') return [];
      const out: AiCtx['myPlans'] = [];
      const reward = d.payOnSuccess;
      if (d.plan && d.plan.match === matchId && d.performer === id) out.push({ to: partner(d), plan: d.plan, reward });
      if (d.planBack && d.planBack.match === matchId && d.performer !== id) out.push({ to: partner(d), plan: d.planBack, reward: 0 });
      return out;
    }),
    theirPlans: deals.flatMap((d) => {
      if (d.kind !== 'plan') return [];
      const out: AiCtx['theirPlans'] = [];
      if (d.plan && d.plan.match === matchId && d.performer !== id) out.push({ from: partner(d), plan: d.plan });
      if (d.planBack && d.planBack.match === matchId && d.performer === id) out.push({ from: partner(d), plan: d.planBack });
      return out;
    }),
    name: (o) => nameOf(state, o),
    pieces: state.actors[id]?.pieces ?? 0,
    spend: (n, reason) => transfer(state, id, 'host', n, reason),
  };
}

/** プレイヤーの代わりに CPU が動かすとき（自動対戦、開発用の検証）の能力値。NPC 11 人の平均に合わせる（旧値は全て 6 で、平均より低く、自動対戦では主人公だけ早く脱落していた） */
const HERO_STANDIN = { logic: 8, strategy: 8, memory: 8, negotiation: 7, acting: 6, observation: 8 };

/** 手番待ちの NPC 全員に手を出させる。プレイヤーの手番は触らない。戻り値は進行があったか */
export function stepNpcs(state: GameState, slot: MatchSlot, opts: { includeHero?: boolean; holdNegotiation?: boolean } = {}): boolean {
  const engine = engineOf(slot.id);
  let progressed = false;
  for (let guard = 0; guard < 2000; guard++) {
    if (engine.done(slot.state)) break;
    const pend = engine.pending(slot.state).filter((p) => opts.includeHero || p !== 'hero');
    if (!pend.length) break;
    if (opts.holdNegotiation && engine.stage(slot.state).negotiation) break;
    const p = pend[0];
    const rng = rngOf(state);
    const ctx = buildCtx(state, p, slot.id, rng);
    if (slot.id === 'tiebreak') (ctx as AiCtx & { _tb?: unknown })._tb = slot.state;
    let move = engine.ai(engine.view(slot.state, p), ctx);
    if (!engine.validate(slot.state, p, move)) move = engine.defaultMove(slot.state, p);
    engine.submit(slot.state, p, move);
    progressed = true;
  }
  return progressed;
}

/** CPU だけで最後まで進める（プレイヤー不参加の監獄マッチなど） */
export function runToEnd(state: GameState, slot: MatchSlot): void {
  const engine = engineOf(slot.id);
  for (let guard = 0; guard < 100000 && !engine.done(slot.state); guard++) {
    if (!stepNpcs(state, slot, { includeHero: true })) break;
  }
  if (!engine.done(slot.state)) throw new Error(`${slot.id}: 終局しませんでした`);
}

export function newSlot(state: GameState, id: string, players: CharId[], kind: MatchSlot['kind'], opts?: Record<string, unknown>): MatchSlot {
  const engine = engineOf(id);
  const rng = Rng.derive(state.seed, `${id}:${state.day}:${state.counter++}`);
  return { id, day: state.day, kind, players: [...players], state: engine.init(players, rng, opts), stageLeft: 0 };
}

/** 完全同点が 3 セット続いた場合だけに使う、開始時公開のシード付き抽選順位（最後の手段） */
export function lotteryOrder(state: GameState, players: CharId[]): CharId[] {
  const rng = Rng.derive(state.seed, `lottery:${state.day}`);
  const all = rng.shuffle([...Object.keys(state.actors)] as CharId[]);
  return [...players].sort((x, y) => all.indexOf(x) - all.indexOf(y));
}

export const MAX_TIEBREAK_SETS = 3;

/**
 * 同点グループを共通決定戦で解消する。
 * プレイヤーを含むグループは playTiebreak（UI）に委ね、NPC だけのグループは自動で実行する。
 * 再同点は新しい問題で最大 3 セット。それでも完全同点の場合のみ抽選順位を使い、使用を記録する。
 */
export async function resolveTies(
  state: GameState,
  groups: CharId[][],
  playTiebreak: (slot: MatchSlot) => Promise<void>,
  onEvent?: (e: { players: CharId[]; result: CharId[]; lottery: boolean; sets: number }) => void,
): Promise<CharId[]> {
  const out: CharId[] = [];
  for (const g of groups) {
    if (g.length === 1) {
      out.push(g[0]);
      continue;
    }
    let pending: { grp: CharId[]; sets: number }[] = [{ grp: g, sets: 0 }];
    while (pending.length) {
      const { grp, sets } = pending.shift()!;
      if (grp.length === 1) {
        out.push(grp[0]);
        continue;
      }
      if (sets >= MAX_TIEBREAK_SETS) {
        const order = lotteryOrder(state, grp);
        state.flags.lotteryUsed = Number(state.flags.lotteryUsed ?? 0) + 1;
        onEvent?.({ players: grp, result: order, lottery: true, sets });
        out.push(...order);
        continue;
      }
      const slot = newSlot(state, 'tiebreak', grp, 'tiebreak');
      if (grp.includes('hero')) await playTiebreak(slot);
      else runToEnd(state, slot);
      const sub = TIEBREAK.ranking(slot.state as never);
      state.flags.tiebreaks = Number(state.flags.tiebreaks ?? 0) + 1;
      if (sub.length > 1 || sub[0].length === 1) onEvent?.({ players: grp, result: sub.flat(), lottery: false, sets: sets + 1 });
      pending = [...sub.map((x) => ({ grp: x, sets: sets + 1 })), ...pending];
    }
  }
  return out;
}
