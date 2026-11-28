/**
 * 性格による集団行動（本人の承認 2026-11-28）。支配欲・自立志向・主導性・追従性の 4 項目を、
 * 「誰を誘うか」「誰について行くか」「どこで会議するか」「役割を引き受けるか」に効かせる。
 *
 * - 主人公も NPC も同じ規則。主人公だけの加点・減点はない。
 * - 頼れそうかは「公開された実績（同じ種類の競技での順位）」と、その人が持つ関係（信頼・警戒）だけで決める。
 *   相手の能力の本当の値や、相手の内部の信頼値は見ない。初めは全員「実績なし」（平均）から始まる。
 * - 自分の能力は本人が知っている（自分に向いた役割かの判断に使う）。
 * - リーダーは固定しない。競技の種類（主に効く能力）と実績、利害で毎回変わる。
 * - 指示された側は、断る・別の役割を出す・抜けるを選べる。結果を固定するイベントはない。
 */
import { NPC_BY_ID, type CharId, type NpcId, type Personality } from '../data/characters';
import { MATCH_ABILITIES, mainAbility } from '../data/abilities';
import { rel } from '../core/state';
import type { GameState } from '../core/types';
import { skill } from '../matches/types';
import type { Rng } from '../core/rng';

const NEUTRAL: Pick<Personality, 'dominance' | 'independence' | 'initiative' | 'followership'> = { dominance: 50, independence: 50, initiative: 50, followership: 50 };

/** 集団行動の 4 項目（0〜1）。主人公はプレイヤー本人が決めるので、NPC の判断に使う時だけ中立の値 */
export function groupTraits(id: CharId): { dominance: number; independence: number; initiative: number; followership: number } {
  const p = id === 'hero' ? NEUTRAL : NPC_BY_ID[id as NpcId]?.personality ?? NEUTRAL;
  return { dominance: p.dominance / 100, independence: p.independence / 100, initiative: p.initiative / 100, followership: p.followership / 100 };
}

/** その競技で主に効く能力（logic など）。競技 ID がない時は戦略 */
export const kindOf = (matchId: string) => mainAbility(matchId);

/**
 * 公開された実績：同じ種類（主に効く能力が同じ）の競技での順位の平均（0〜1）と、件数。
 * メインも監獄も、結果は全員に公開されている（大会の掲示）。
 */
export function recordIn(state: GameState, who: CharId, matchId: string): { v: number; n: number } {
  const kind = kindOf(matchId);
  let sum = 0;
  let n = 0;
  for (const h of state.history) {
    for (const [id, ranking] of [[h.main, h.mainRanking], [h.prisonGame, h.prisonRanking]] as [string | null, CharId[]][]) {
      if (!id || !ranking.length || MATCH_ABILITIES[id]?.main !== kind) continue;
      const i = ranking.indexOf(who);
      if (i < 0) continue;
      sum += ranking.length > 1 ? 1 - i / (ranking.length - 1) : 0.5;
      n++;
    }
  }
  return { v: n ? sum / n : 0.5, n };
}

/** 公開された実績（メインと監獄の全競技） */
export function recordAll(state: GameState, who: CharId): number {
  let sum = 0;
  let n = 0;
  for (const h of state.history) {
    for (const ranking of [h.mainRanking, h.prisonRanking]) {
      const i = ranking.indexOf(who);
      if (i >= 0 && ranking.length > 1) { sum += 1 - i / (ranking.length - 1); n++; }
    }
  }
  return n ? sum / n : 0.5;
}

/**
 * viewer から見て、target がこの競技で頼れそうか（0〜1）。公開の実績と、viewer 自身の信頼・警戒だけから。
 * 実績が少ないうちは平均に寄る。
 */
export function reliance(state: GameState, viewer: CharId, target: CharId, matchId: string): number {
  // 競技が決まっていない時（生活中）は、全競技の実績だけで見る
  const rec = matchId ? recordIn(state, target, matchId) : { v: 0.5, n: 0 };
  const w = rec.n / (rec.n + 0.75);
  const perf = rec.v * w + recordAll(state, target) * (1 - w);
  const r = rel(state, viewer, target);
  return Math.max(0, Math.min(1, perf * 0.7 + ((r.trust - 40) / 100) * 0.5 - Math.max(0, r.wary - 40) / 200 + 0.15));
}

/** 自分がこの競技に向いているか（本人は自分の能力を知っている）＋自分の実績 */
export function selfFit(state: GameState, id: CharId, matchId: string): number {
  if (id === 'hero') return recordIn(state, id, matchId).v;
  const s = NPC_BY_ID[id as NpcId].stats;
  const kind = kindOf(matchId);
  const rec = recordIn(state, id, matchId);
  return skill(s[kind]) * 0.7 + rec.v * 0.3;
}

/**
 * この競技で「自分が中心になって人を集めたい」度合い（0〜1）。
 * 支配欲の高い人は、自分が向いていない競技でも仕切りたがる（向き不向きをあまり考えない）。
 * 支配欲が低く主導性の高い人（調整役）は、向いている時や人が集まっていない時に動く。
 */
export function leadDesire(state: GameState, id: NpcId, matchId: string): number {
  const g = groupTraits(id);
  const fit = selfFit(state, id, matchId);
  const fitWeight = 1 - g.dominance * 0.8;
  return Math.max(0, Math.min(1, g.dominance * 0.45 + g.initiative * 0.45 - g.independence * 0.3 + (fit - 0.5) * fitWeight * 0.8 + 0.1));
}

/**
 * follower が leader の集まりに乗るか（加点。consultScore と同じ尺度）。
 * 追従性 ×（頼れそうか）と、自立志向（集団に頼らない）で決める。相手が主人公でも NPC でも同じ式。
 */
export function followBonus(state: GameState, follower: NpcId, leader: CharId, matchId: string): number {
  const g = groupTraits(follower);
  const rely = reliance(state, follower, leader, matchId);
  // 自立志向の高い人も、得になる相手（頼れる人）なら必要な分だけ協力する
  return g.followership * (rely - 0.35) * 18 - g.independence * 5 + (g.independence > 0.65 ? Math.max(0, rely - 0.6) * 10 : 0);
}

/** その人が、作戦時間の 1 枠で誰かと話そうとする確率 */
export function talkChance(id: NpcId, slotIndex: number): number {
  const g = groupTraits(id);
  return Math.max(0.15, Math.min(0.92, 0.35 + g.initiative * 0.45 + g.dominance * 0.15 - g.independence * 0.25 - slotIndex * 0.05));
}

/**
 * 会議の場所の好み。支配欲の高い人は自分の側（組の相談室か自分の個室）に呼ぶ。
 * 調整役（主導性が高く支配欲は中くらい）は中立の相談室。自立志向の高い人は立ち話で短く済ませる。
 */
export function meetingPlace(id: NpcId): 'own' | 'neutral' | 'standing' {
  const g = groupTraits(id);
  if (g.independence >= 0.7 && g.dominance < 0.6) return 'standing';
  if (g.dominance >= 0.7) return 'own';
  return 'neutral';
}

/** 同時に持ちたい協力関係の数（生活中の緩い約束・同盟）。集団を作りたい人ほど多く、自立した人ほど少ない */
export function wantedPartners(id: NpcId): number {
  const g = groupTraits(id);
  return g.independence >= 0.7 ? 1 : g.dominance >= 0.7 || g.followership >= 0.7 ? 3 : 2;
}

// ---------- 役割分担 ----------

export type RoleId = 'lead' | 'share' | 'scout' | 'support';

export interface RoleAnswer {
  answer: 'accept' | 'counter' | 'refuse' | 'leave';
  /** 対案の役割 */
  counter?: RoleId;
}

/**
 * リーダーが役割を割り振る。誰が向いているかは、リーダーが見た公開の実績を、リーダー自身の能力の精度で見積もる
 * （その競技が苦手なリーダーほど見積もりの誤差が大きく、割り振りを誤りやすい）。支配欲の高いリーダーは自分の見立てを優先する。
 */
export function assignRoles(state: GameState, leader: NpcId, members: CharId[], matchId: string, rng: Rng): Partial<Record<CharId, RoleId>> {
  const kind = kindOf(matchId);
  const own = skill(NPC_BY_ID[leader].stats[kind]);
  const err = 0.08 + (1 - own) * 0.3;
  const est = members.filter((m) => m !== leader).map((m) => ({ m, v: reliance(state, leader, m, matchId) + rng.gauss(0, err) })).sort((a, b) => b.v - a.v);
  const out: Partial<Record<CharId, RoleId>> = { [leader]: 'lead' };
  est.forEach((x, i) => { out[x.m] = i === 0 ? 'share' : i === 1 ? 'scout' : 'support'; });
  return out;
}

/**
 * 割り振られた役割に、本人がどう答えるか。本人は自分の向き不向き（自分の能力）を知っている。
 * 向かない役割なら断るか別の役割を出す。リーダーを信頼できない、抜けた方が得なら抜ける。
 * 主人公への割り振りは画面で本人が選ぶので、ここは NPC だけ。
 */
export function answerRole(state: GameState, member: NpcId, leader: CharId, role: RoleId, matchId: string, rng: Rng): RoleAnswer {
  const g = groupTraits(member);
  const fit = selfFit(state, member, matchId);
  const r = rel(state, member, leader);
  const rely = reliance(state, member, leader, matchId);
  const want = role === 'share' ? fit - 0.55 : role === 'scout' ? 0.1 : 0.05;
  const v = want * 2 + g.followership * (rely - 0.3) * 2.2 - g.independence * 0.6 - g.dominance * 0.4 + (r.trust - 45) / 60 + rng.gauss(0, 0.35);
  if (v >= 0) return { answer: 'accept' };
  if (rely < 0.3 && (g.independence > 0.6 || r.wary > 60)) return { answer: 'leave' };
  if (role === 'share' && fit < 0.5) return { answer: 'counter', counter: 'support' };
  if (role !== 'share' && fit > 0.65) return { answer: 'counter', counter: 'share' };
  return v > -0.5 ? { answer: 'counter', counter: role === 'support' ? 'scout' : 'support' } : { answer: 'refuse' };
}

/** リーダーが対案を受け入れるか。支配欲の高い人ほど受け入れにくい */
export function takeCounter(leader: NpcId, rng: Rng): boolean {
  return rng.chance(0.85 - groupTraits(leader).dominance * 0.6);
}
