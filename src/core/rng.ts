/**
 * シード付き乱数（mulberry32）。状態は 1 つの数値なのでそのままセーブできる。
 * 勝敗をこれ単体で決めることはしない。席順・出題・NPC の誤差などの決定に使う。
 */
export interface RngState {
  s: number;
}

export function hashString(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class Rng {
  constructor(public state: RngState) {}

  static from(seed: number | string): Rng {
    return new Rng({ s: typeof seed === 'string' ? hashString(seed) : seed >>> 0 });
  }

  /** 親シードとラベルから独立した系列を作る（再現性のため） */
  static derive(seed: number, label: string): Rng {
    return new Rng({ s: (hashString(label) ^ Math.imul(seed >>> 0, 2654435761)) >>> 0 });
  }

  next(): number {
    let t = (this.state.s = (this.state.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** a 以上 b 以下の整数 */
  int(a: number, b: number): number {
    return a + Math.floor(this.next() * (b - a + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** 正規分布近似（誤差モデル用） */
  gauss(mean = 0, sd = 1): number {
    const u = this.next() + this.next() + this.next() + this.next() - 2;
    return mean + u * sd * 0.866;
  }

  /** 重み付き選択 */
  weighted<T>(items: readonly T[], weight: (t: T) => number): T {
    const ws = items.map((t) => Math.max(0, weight(t)));
    const total = ws.reduce((a, b) => a + b, 0);
    if (total <= 0) return items[0];
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= ws[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }
}
