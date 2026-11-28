/**
 * 集合移動中の短い会話（本人の依頼 2026-11-28）。
 * 通常の会話メニュー（交渉・情報・約束）は開かず、人物らしい一言だけを返す。
 * - ルール未公開の段階なので、作戦・秘密・ルールの中身は話さない（台詞は data/gather_talk.json）。
 * - 親しい相手、緩い約束がある相手、警戒している相手には、関係に合う一言。
 * - 前の競技の結果（公開された順位）を気にする一言もある。
 * - 関係の値は動かさない。同じ相手に 2 度目以降は「続きは会場で」の短い返事だけ（繰り返して親密度を上げられない）。
 */
import data from '../data/gather_talk.json';
import type { CharId, NpcId } from '../data/characters';
import { NPC_BY_ID } from '../data/characters';
import type { GameState } from './types';
import { pledged, rel } from './state';
import { hashString } from './rng';
import type { GatherState } from './gather';

export type GatherMood = 'nervous' | 'confident' | 'observe' | 'joke' | 'lastGood' | 'lastBad' | 'pledge' | 'close' | 'wary' | 'prison' | 'again';
type Table = Partial<Record<GatherMood, string[]>>;
const T = data as unknown as Record<string, Table>;

/** 前の競技（メインか監獄で、いちばん新しいもの）での公開の順位。上位 1/3 なら good、下位 1/3 なら bad */
export function lastResult(state: GameState, who: CharId): 'good' | 'bad' | null {
  const h = state.history[state.history.length - 1];
  if (!h) return null;
  const ranking = h.prisonRanking.includes(who) ? h.prisonRanking : h.mainRanking;
  const i = ranking.indexOf(who);
  if (i < 0 || ranking.length < 3) return null;
  const r = i / (ranking.length - 1);
  return r <= 1 / 3 ? 'good' : r >= 2 / 3 ? 'bad' : null;
}

/** その人の今の気分（性格と関係と前の結果から。同じ日・同じ集合なら同じ答え） */
export function gatherMood(state: GameState, g: GatherState, npc: NpcId): GatherMood {
  if (g.talked.includes(npc)) return 'again';
  const r = rel(state, npc, 'hero');
  if (r.hostility >= 40 || r.wary >= 65) return 'wary';
  if (pledged(state, npc, 'hero')) return 'pledge';
  const roll = (hashString(`${state.seed}:${state.day}:${g.kind}:${npc}`) % 1000) / 1000;
  if (r.like >= 60 && roll < 0.6) return 'close';
  if (g.kind === 'prison' && roll < 0.7) return 'prison';
  const last = lastResult(state, npc);
  if (last && roll < 0.45) return last === 'good' ? 'lastGood' : 'lastBad';
  const p = NPC_BY_ID[npc].personality;
  // 性格ごとの重み：大胆で野心的なら自信、慎重なら緊張、探索好きなら観察、ほかは冗談
  const w: [GatherMood, number][] = [
    ['confident', Math.max(5, p.risk * 0.5 + p.ambition * 0.5)],
    ['nervous', Math.max(5, (100 - p.risk) * 0.7)],
    ['observe', Math.max(5, p.explore * 0.6 + NPC_BY_ID[npc].stats.observation * 3)],
    ['joke', Math.max(5, (100 - p.ambition) * 0.4 + p.morality * 0.2)],
  ];
  const sum = w.reduce((a, [, v]) => a + v, 0);
  let x = ((hashString(`${state.seed}:${state.day}:${npc}:mood`) % 10_000) / 10_000) * sum;
  for (const [m, v] of w) { if ((x -= v) < 0) return m; }
  return 'joke';
}

/** 一言を選ぶ（{name} は主人公の呼び名） */
export function gatherLine(state: GameState, npc: NpcId, mood: GatherMood, heroName: string): string {
  const lines = T[npc]?.[mood] ?? T.default[mood] ?? T.default.again ?? [''];
  const i = hashString(`${state.seed}:${state.day}:${npc}:${mood}:line`) % lines.length;
  return lines[i].replace(/\{name\}/g, heroName);
}

/** 気分に合う表情（立ち絵の差分名） */
export const MOOD_EXPR: Record<GatherMood, string> = {
  nervous: 'sad', confident: 'smile', observe: 'think', joke: 'smile', lastGood: 'smile', lastBad: 'think',
  pledge: 'smile', close: 'smile', wary: 'wary', prison: 'think', again: 'normal',
};
