/**
 * 救いのメダル（v11）。
 * M01〜M09 の 1 位に当日限りで 1 枚。監獄棟へ行く予定の 1 人を指名し、生活棟に残る予定の最下位 1 人と入れ替える。
 * 順位報酬は変わらない。自分には使えない。譲渡も持ち越しもできない。指名された本人は辞退でき、入れ替えられる側は拒否できない。
 * 主人公も NPC も同じ関数で判定する（主人公だけが救われやすい、救われにくい、という分岐は置かない）。
 */
import { PROFILES, type CharId, type NpcId } from '../data/characters';
import { scheduleFor } from '../data/config';
import { recordBetrayal } from '../npc/negotiation';
import { adjustRel, aliveIds, allied, fact, log, nameOf, publish, rel, shortName } from './state';
import type { GameState } from './types';

/** メダルが発行される最後の日（DAY 10 は生活棟が 1 人、DAY 11 は決勝のため発行しない） */
export const MEDAL_LAST_DAY = 9;

export interface RescueState {
  holder: CharId;
  status: 'pending' | 'used' | 'forgone';
  target?: CharId;
  swapped?: CharId;
  /** 指名されたが辞退した人 */
  declined: CharId[];
}

export interface RescuePromise {
  /** 1 位になったら救うと約束した人 */
  from: CharId;
  to: CharId;
}

export const medalIssued = (day: number) => day >= 1 && day <= MEDAL_LAST_DAY;

/** 仮配属（メインマッチの順位だけで決まる、メダル使用前の棟分け） */
export function provisional(state: GameState): { living: CharId[]; prison: CharId[]; lowestLiving: CharId | null } {
  const ranking = state.today.mainRanking ?? [];
  const nPrison = scheduleFor(state.day).prison;
  const living = ranking.slice(0, ranking.length - nPrison);
  const prison = ranking.slice(ranking.length - nPrison);
  return { living, prison, lowestLiving: living.length >= 2 ? living[living.length - 1] : null };
}

/** メダルを発行する。順位確定の直後に 1 度だけ呼ぶ（二重発行しない） */
export function issueMedal(state: GameState): RescueState | null {
  if (state.today.rescue) return state.today.rescue;
  const ranking = state.today.mainRanking ?? [];
  if (!medalIssued(state.day) || !ranking.length) return null;
  const { lowestLiving } = provisional(state);
  if (!lowestLiving || lowestLiving === ranking[0]) return null;
  state.today.rescue = { holder: ranking[0], status: 'pending', declined: [] };
  fact(state, 'medal_issued', [ranking[0]], `${nameOf(state, ranking[0])}が救いのメダルを得た`, {});
  return state.today.rescue;
}

/** 指名できる相手（監獄棟へ行く予定で、まだ辞退していない人） */
export function rescueCandidates(state: GameState): CharId[] {
  const r = state.today.rescue;
  if (!r || r.status !== 'pending') return [];
  return provisional(state).prison.filter((id) => state.actors[id].alive && id !== r.holder && !r.declined.includes(id));
}

/** 使えない理由。使えるなら null */
export function rescueError(state: GameState, holder: CharId, target: CharId): string | null {
  const r = state.today.rescue;
  if (!medalIssued(state.day)) return 'この日はメダルが発行されない';
  if (!r || r.holder !== holder) return 'メダルを持っていない';
  if (r.status !== 'pending') return 'メダルは使用済み';
  if (holder === target) return '自分には使えない';
  if (!state.actors[target]?.alive) return '対象がいない';
  if (!rescueCandidates(state).includes(target)) return '監獄棟へ行く予定の人だけを指名できる';
  if (!provisional(state).lowestLiving) return '入れ替える相手がいない';
  return null;
}

const promisesOf = (state: GameState): RescuePromise[] => state.today.rescuePromises ?? [];

export function promised(state: GameState, from: CharId, to: CharId): boolean {
  return promisesOf(state).some((p) => p.from === from && p.to === to);
}

/** 救済の約束を記録する（履行は強制されない） */
export function promiseRescue(state: GameState, from: CharId, to: CharId): void {
  if (from === to || promised(state, from, to)) return;
  state.today.rescuePromises = [...promisesOf(state), { from, to }];
  fact(state, 'rescue_promise', [from, to], `${nameOf(state, from)}が${nameOf(state, to)}に救済を約束`, {});
}

const personality = (id: CharId) => (id === 'hero' ? null : PROFILES[id]?.personality ?? null);

/** holder から見た相手の大切さ（関係の内部値だけで決まる） */
function bond(state: GameState, holder: CharId, other: CharId): number {
  const r = rel(state, holder, other);
  return r.like * 0.5 + r.trust * 0.25 + r.debt * 0.5 - r.hostility * 0.6 - r.wary * 0.15 + (allied(state, holder, other, ['alliance']) ? 25 : 0);
}

/** holder が target を救い、swapped を監獄棟へ送ることの望ましさ */
export function rescueScore(state: GameState, holder: CharId, target: CharId, swapped: CharId): number {
  const p = personality(holder);
  const loyalty = p?.loyalty ?? 50;
  const morality = p?.morality ?? 50;
  const ambition = p?.ambition ?? 50;
  const threat = (rel(state, holder, swapped).threat - rel(state, holder, target).threat) * 0.2 * (0.5 + ambition / 100);
  const promise = promised(state, holder, target) ? 15 + loyalty * 0.35 : 0;
  // 関係の薄い相手を突き落とすことへのためらい（道徳心が高いほど大きい）
  const reluctance = 6 + morality * 0.12;
  return bond(state, holder, target) - bond(state, holder, swapped) * 0.8 + threat + promise - reluctance;
}

/** NPC の 1 位が誰を救うかを決める。使わないなら null */
export function npcChooseRescue(state: GameState, holder: NpcId): CharId | null {
  const { lowestLiving } = provisional(state);
  if (!lowestLiving) return null;
  let best: CharId | null = null;
  let bestScore = 10;
  for (const c of rescueCandidates(state)) {
    const sc = rescueScore(state, holder, c, lowestLiving);
    if (sc > bestScore) { best = c; bestScore = sc; }
  }
  return best;
}

/** 指名された NPC が救済を受けるか。強く嫌っている相手からの救済、親しい人を身代わりにする救済は断ることがある */
export function npcAcceptsRescue(state: GameState, target: NpcId, holder: CharId): boolean {
  const { lowestLiving } = provisional(state);
  const r = rel(state, target, holder);
  if (r.hostility >= 65) return false;
  const p = personality(target);
  if (lowestLiving && lowestLiving !== target) {
    const s = rel(state, target, lowestLiving);
    if (s.like >= 55 && (p?.loyalty ?? 50) >= 65 && (p?.morality ?? 50) >= 60) return false;
  }
  return true;
}

/** 指名された人が辞退した */
export function declineRescue(state: GameState, target: CharId): void {
  const r = state.today.rescue;
  if (!r || r.status !== 'pending' || r.declined.includes(target)) return;
  r.declined.push(target);
  fact(state, 'rescue_declined', [target, r.holder], `${nameOf(state, target)}が救済を辞退`, {});
  adjustRel(state, r.holder, target, { like: -4 });
}

function settlePromises(state: GameState, holder: CharId, kept: CharId | null): void {
  for (const p of promisesOf(state)) {
    if (p.from !== holder) continue;
    if (p.to === kept) {
      adjustRel(state, p.to, holder, { trust: 12 });
      continue;
    }
    // 約束した相手が監獄棟へ行く予定だったのに救わなかった：約束違反
    if (!provisional(state).prison.includes(p.to)) continue;
    if (state.today.rescue?.declined.includes(p.to)) continue;
    adjustRel(state, p.to, holder, { trust: -25, like: -15, hostility: 15, wary: 15 });
    recordBetrayal(state, holder, p.to, [p.to], `${shortName(state, holder)}は${shortName(state, p.to)}に救済を約束したが、救わなかった。`, 1, 'betrayal');
  }
}

/** メダルを使う。棟を入れ替え、出来事と関係の変化を記録する。入れ替えられた人を返す */
export function applyRescue(state: GameState, holder: CharId, target: CharId): CharId {
  const err = rescueError(state, holder, target);
  if (err) throw new Error(`救いのメダル：${err}`);
  const r = state.today.rescue!;
  const swapped = provisional(state).lowestLiving!;
  state.actors[target].house = 'living';
  state.actors[swapped].house = 'prison';
  r.status = 'used';
  r.target = target;
  r.swapped = swapped;
  adjustRel(state, target, holder, { debt: 35, like: 20, trust: 15 });
  adjustRel(state, holder, target, { like: 6 });
  adjustRel(state, swapped, holder, { hostility: 30, like: -25, wary: 20, trust: -15 });
  adjustRel(state, swapped, target, { like: -8, wary: 6 });
  for (const id of aliveIds(state)) {
    if (id === holder || id === target || id === swapped) continue;
    // 見ていた人は、2 人が組んでいると受け取る
    adjustRel(state, id, holder, { wary: 5 });
    adjustRel(state, id, target, { wary: 3 });
  }
  const text = `DAY${state.day}：${nameOf(state, holder)}が救いのメダルで${nameOf(state, target)}を救った。代わりに${nameOf(state, swapped)}が監獄棟へ。`;
  fact(state, 'rescue', [holder, target, swapped], text, { holder, target, swapped });
  publish(state, { kind: 'result', text, truth: true, about: [holder, target, swapped], value: 0, tags: ['result', 'rescue'] });
  state.board.push({ day: state.day, text });
  log(state, text, 'rescue');
  settlePromises(state, holder, target);
  return swapped;
}

/** メダルを使わない */
export function forgoRescue(state: GameState, holder: CharId): void {
  const r = state.today.rescue;
  if (!r || r.holder !== holder || r.status !== 'pending') return;
  r.status = 'forgone';
  fact(state, 'rescue_forgone', [holder], `${nameOf(state, holder)}は救いのメダルを使わなかった`, {});
  settlePromises(state, holder, null);
}

/** NPC が 1 位の時の処理。主人公が指名された場合は askHero で本人の意思を確かめる */
export async function resolveNpcRescue(state: GameState, askHero: (holder: CharId, swapped: CharId) => Promise<boolean>): Promise<RescueState | null> {
  const r = state.today.rescue;
  if (!r || r.status !== 'pending' || r.holder === 'hero') return r ?? null;
  const holder = r.holder as NpcId;
  for (let guard = 0; guard < 6; guard++) {
    const target = npcChooseRescue(state, holder);
    if (!target) break;
    const swapped = provisional(state).lowestLiving!;
    const ok = target === 'hero' ? await askHero(holder, swapped) : npcAcceptsRescue(state, target as NpcId, holder);
    if (ok) { applyRescue(state, holder, target); return r; }
    declineRescue(state, target);
  }
  forgoRescue(state, holder);
  return r;
}

/** 画面なしで進める時の処理（自動進行、検証用）。主人公が 1 位なら使わず、主人公が指名されたら受ける */
export function autoRescue(state: GameState): RescueState | null {
  const r = issueMedal(state);
  if (!r || r.status !== 'pending') return r;
  if (r.holder === 'hero') { forgoRescue(state, 'hero'); return r; }
  const holder = r.holder as NpcId;
  for (let guard = 0; guard < 6; guard++) {
    const target = npcChooseRescue(state, holder);
    if (!target) break;
    if (target === 'hero' || npcAcceptsRescue(state, target as NpcId, holder)) { applyRescue(state, holder, target); return r; }
    declineRescue(state, target);
  }
  forgoRescue(state, holder);
  return r;
}

/** 競技の前に、親しい NPC 同士が救済を約束し合う（主人公も同じ条件で約束の相手になる） */
export function npcRescuePromises(state: GameState): void {
  if (!medalIssued(state.day)) return;
  for (const a of aliveIds(state)) {
    if (a === 'hero') continue;
    for (const b of aliveIds(state)) {
      if (a === b || promised(state, a, b)) continue;
      const r = rel(state, a, b);
      if ((r.like >= 45 && r.trust >= 50) || allied(state, a, b, ['alliance'])) promiseRescue(state, a, b);
    }
  }
}
