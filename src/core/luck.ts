/**
 * 運（本人の承認 2026-11-28、試験導入）。強いカードや有利なランダム結果を引きやすい能力。
 *
 * 方法：その人だけに配られる・その人が引くランダムで、発動した時だけ「同じ所からもう 1 つ候補を出し、本人に有利な方を取る」。
 * - 運 5〜7 は補正なし（発動しない。乱数も消費しないので、運 5 の結果は導入前と同じ）。運 8 で 10%、9 で 20%、10 で 30%（暫定の上限）。
 * - 運 5 未満の「悪い方を取る」補正は今回は入れない。
 * - 有利かどうかの評価は、本人の手札・公開情報・本人が得た情報だけで行う。未来の山札、他人の手札や秘密、正解は見ない。
 * - 取らなかった候補は、元の所（山札の無作為な位置）に戻す。枚数・重複は変わらない。
 * - 2 つ目の候補が出せない時（山札が空、候補が 1 つしかない、振り直すサイコロがない）は、普通の引きのまま（「候補なし」と記録）。
 * - 発動の判定には、競技の状態に保存した専用の乱数を使う（中断・再開しても同じ結果。競技の他の乱数の流れは変えない）。
 * - 対象は競技ごとに決める：M06（初期手札・補充・山札との交換）、S05（振り直しの出目）、M04（任務交換の候補の生成）。
 */
import { NPC_BY_ID, type CharId, type NpcId } from '../data/characters';
import { NORMAL_LUCK } from '../data/abilities';

/** 運 10 の発動率（暫定の上限） */
export const LUCK_MAX_RATE = 0.3;

/** 運の値から発動率。運 7 以下は 0 */
export function luckRate(luck: number): number {
  if (luck >= 10) return LUCK_MAX_RATE;
  if (luck >= 9) return 0.2;
  if (luck >= 8) return 0.1;
  return 0;
}

/** 検証用の上書き（自動対戦で、運 5 と運 10 を比べる時だけ使う。本編では使わない） */
const overrides: Partial<Record<CharId, number>> = {};
export function setLuckOverride(id: CharId, luck: number | null): void {
  if (luck === null) delete overrides[id];
  else overrides[id] = luck;
}

/** その人の運。主人公は通常の参加者と同じ 5 */
export function luckOf(id: CharId): number {
  if (overrides[id] !== undefined) return overrides[id]!;
  if (id === 'hero') return NORMAL_LUCK;
  return NPC_BY_ID[id as NpcId]?.stats.luck ?? NORMAL_LUCK;
}

/** 競技の状態に保存する、運の記録と専用の乱数 */
export interface LuckBook {
  /** 専用の乱数の状態（保存される） */
  s: number;
  /** 運の判定をした回数（発動率 0 の人は数えない） */
  tries: Record<string, number>;
  /** 発動して 2 つの候補を比べた回数 */
  fired: Record<string, number>;
  /** 発動したが 2 つ目の候補が出せなかった回数 */
  noAlt: Record<string, number>;
  /** 2 つ目の候補の方を取った回数 */
  took: Record<string, number>;
}

export function newLuckBook(seed: number): LuckBook {
  return { s: (seed ^ 0x9e3779b9) >>> 0, tries: {}, fired: {}, noAlt: {}, took: {} };
}

export function luckNext(b: LuckBook): number {
  b.s = (Math.imul(b.s, 1664525) + 1013904223) >>> 0;
  return b.s / 4294967296;
}

const inc = (r: Record<string, number>, k: string) => { r[k] = (r[k] ?? 0) + 1; };

/**
 * 運の判定。発動率 0 の人は何もしない（乱数も使わない）。
 * 発動したら second() で 2 つ目の候補を出し、score が高い方を返す（同じなら最初の候補）。
 * 取らなかった候補は putBack に渡す（山札へ戻すなど）。2 つ目が出せなければ最初の候補のまま。
 */
export function luckPick<T>(b: LuckBook, who: CharId, first: T, second: () => T | undefined, score: (x: T) => number, putBack: (x: T) => void = () => {}): T {
  const rate = luckRate(luckOf(who));
  if (rate <= 0) return first;
  inc(b.tries, who);
  if (luckNext(b) >= rate) return first;
  inc(b.fired, who);
  const alt = second();
  if (alt === undefined) { inc(b.noAlt, who); return first; }
  if (score(alt) > score(first)) {
    inc(b.took, who);
    putBack(first);
    return alt;
  }
  putBack(alt);
  return first;
}

/** 取らなかったカードを、山札の無作為な位置に戻す（専用の乱数で） */
export function returnToDeck(b: LuckBook, deck: number[], card: number): void {
  const at = Math.floor(luckNext(b) * (deck.length + 1));
  deck.splice(at, 0, card);
}
