/**
 * 能力 6 項目（手帳の表示）と、競技ごとに主に効く能力の対応表（match_abilities.json）。
 * 能力は「見えている情報をどれだけうまく使えるか」だけに効く。未公開の問題・他人の手札・未来・正解には触れない。
 */
import table from './match_abilities.json';
import type { Stats } from './characters';

export type AbilityKey = 'logic' | 'memory' | 'observation' | 'strategy' | 'negotiation' | 'luck';
/** 手帳に出す順（レーダーチャートの時計回り） */
export const SHOWN_ABILITIES: AbilityKey[] = ['logic', 'memory', 'observation', 'strategy', 'negotiation', 'luck'];
/** 通常の NPC の調整基準（全キャラクター共通の上限ではない） */
export const NORMAL_TOTAL = 35;
export const NORMAL_LUCK = 5;
export const CORE_ABILITIES: AbilityKey[] = ['logic', 'memory', 'observation', 'strategy', 'negotiation'];

export interface MatchAbility {
  main: Exclude<AbilityKey, 'luck' | 'negotiation'>;
  sub?: Exclude<AbilityKey, 'luck' | 'negotiation'>;
  /** 交渉力が効く場面 */
  talk?: string;
  /** 運の補正の候補（本人の確認待ち。まだ効かない） */
  luck?: string;
}
export const MATCH_ABILITIES = (table as unknown as { matches: Record<string, MatchAbility> }).matches;

export function mainAbility(matchId: string): keyof Stats {
  return MATCH_ABILITIES[matchId]?.main ?? 'strategy';
}

/** 表示の段階（1〜5）。内部の 1〜10 は出さない */
export function abilityStep(v: number): 1 | 2 | 3 | 4 | 5 {
  return v >= 9 ? 5 : v >= 8 ? 4 : v >= 6 ? 3 : v >= 4 ? 2 : 1;
}

/** 運の段階。通常の参加者の 5 が「普通」（5〜7 は補正なしの帯） */
export function luckStep(v: number): 1 | 2 | 3 | 4 | 5 {
  return v >= 9 ? 5 : v >= 8 ? 4 : v >= 5 ? 3 : v >= 3 ? 2 : 1;
}

export function coreTotal(s: Stats): number {
  return s.logic + s.memory + s.observation + s.strategy + s.negotiation;
}
