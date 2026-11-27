/**
 * コンテンツ解放（収益化方式：初日無料＋本編買い切り）。
 * - 開発版（GitHub Pages、VITE_CHANNEL 未指定または dev）: 全日程を無料解放
 * - 製品版（VITE_CHANNEL=product）: 2日目以降は購入済みの場合だけ解放
 * 実際の決済はまだ実装していない。将来の iOS 版では PurchaseProvider に
 * StoreKit の非消費型アプリ内購入を実装して差し替える。価格は未確定のため表示しない。
 * 無料・有料のどちらでも競技の勝敗や NPC の思考には一切関与しない。
 */
export type Channel = 'dev' | 'product';
export const CHANNEL: Channel = import.meta.env.VITE_CHANNEL === 'product' ? 'product' : 'dev';

/** 無料で遊べる最終日 */
export const FREE_DAYS = 1;

export interface PurchaseProvider {
  /** 決済手段が利用できるか */
  available(): boolean;
  /** 購入済みか（端末に保存された購入情報） */
  owned(): boolean;
  purchase(): Promise<boolean>;
  restore(): Promise<boolean>;
}

/** 決済未実装の間の仮プロバイダー：購入はできず、購入済みにもならない */
const stub: PurchaseProvider = {
  available: () => false,
  owned: () => false,
  purchase: async () => false,
  restore: async () => false,
};

let provider: PurchaseProvider = stub;

export function setPurchaseProvider(p: PurchaseProvider): void {
  provider = p;
}

export const Purchase = {
  available: () => provider.available(),
  purchase: () => provider.purchase(),
  restore: () => provider.restore(),
};

/** 完全版が解放されているか */
export function fullUnlocked(): boolean {
  return CHANNEL === 'dev' || provider.owned();
}

/** その日をプレイできるか */
export function dayUnlocked(day: number): boolean {
  return day <= FREE_DAYS || fullUnlocked();
}
