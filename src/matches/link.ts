/**
 * 経路つなぎ（M03 ツイン・リンク）の盤面。
 * 同じ記号の端点 2 つを、縦横につながる 1 本の経路で結ぶ。経路どうしは交差も共有もできない。全マスを埋める必要はない。
 * 問題は「先に経路を敷いてから端点だけ残す」方法で作るので、必ず解ける。別の結び方でも、規則を満たせば正解。
 */
import type { Rng } from '../core/rng';

export interface LinkPuzzle {
  size: number;
  /** 記号ごとの端点 2 つ（マス番号 = y * size + x） */
  ends: [number, number][];
}

/** 記号ごとの経路（端点から端点までのマス番号の列）。引いていない記号は null か空 */
export type LinkSol = (number[] | null)[];

export function neighbours(size: number, c: number): number[] {
  const x = c % size;
  const y = Math.floor(c / size);
  const out: number[] = [];
  if (y > 0) out.push(c - size);
  if (x < size - 1) out.push(c + 1);
  if (y < size - 1) out.push(c + size);
  if (x > 0) out.push(c - 1);
  return out;
}

const adjacent = (size: number, a: number, b: number) => Math.abs((a % size) - (b % size)) + Math.abs(Math.floor(a / size) - Math.floor(b / size)) === 1;
const dist = (size: number, a: number, b: number) => Math.abs((a % size) - (b % size)) + Math.abs(Math.floor(a / size) - Math.floor(b / size));

/**
 * 経路の検査。規則に反していれば -1、そうでなければ結び終えた記号の数を返す。
 * 途中まで引いた経路（片方の端点から始まり、もう片方に届いていない）は、反則ではなく未完成として数える。
 */
export function linked(p: LinkPuzzle, sol: LinkSol | undefined): number {
  if (!Array.isArray(sol) || sol.length > p.ends.length) return -1;
  const total = p.size * p.size;
  const endOf = new Map<number, number>();
  p.ends.forEach((e, i) => { endOf.set(e[0], i); endOf.set(e[1], i); });
  const used = new Set<number>();
  let done = 0;
  for (let i = 0; i < p.ends.length; i++) {
    const path = sol[i];
    if (path == null || path.length === 0) continue;
    if (!Array.isArray(path)) return -1;
    const [a, b] = p.ends[i];
    if (path[0] !== a && path[0] !== b) return -1;
    for (let k = 0; k < path.length; k++) {
      const c = path[k];
      if (!Number.isInteger(c) || c < 0 || c >= total || used.has(c)) return -1;
      if (k > 0 && !adjacent(p.size, path[k - 1], c)) return -1;
      // 他の記号の端点は通れない。自分の端点は、経路の両端にだけ置ける
      const owner = endOf.get(c);
      if (owner !== undefined && (owner !== i || (k !== 0 && k !== path.length - 1))) return -1;
      used.add(c);
    }
    const last = path[path.length - 1];
    if (path.length >= 2 && (last === a || last === b) && last !== path[0]) done++;
  }
  return done;
}

export const linkComplete = (p: LinkPuzzle, sol: LinkSol | undefined): boolean => linked(p, sol) === p.ends.length;

/** 問題を作る。先に経路を敷くので必ず解ける（返り値の solution がその一例） */
export function generateLink(rng: Rng, size: number, colors: number): { puzzle: LinkPuzzle; solution: number[][] } {
  const total = size * size;
  for (let attempt = 0; attempt < 400; attempt++) {
    const used = new Array<number>(total).fill(-1);
    const paths: number[][] = [];
    let ok = true;
    for (let c = 0; c < colors && ok; c++) {
      let placed = false;
      for (let tries = 0; tries < 40 && !placed; tries++) {
        const free = used.map((u, i) => (u < 0 ? i : -1)).filter((i) => i >= 0);
        if (free.length < 3) break;
        const start = rng.pick(free);
        const path = [start];
        const want = rng.int(3, size + 4);
        while (path.length < want) {
          const last = path[path.length - 1];
          // 自分の経路の別のマスに隣り合う所へは伸ばさない（近道ができて、端点が隣同士になるのを防ぐ）
          const cand = neighbours(size, last).filter((n) => used[n] < 0 && !path.includes(n) && neighbours(size, n).every((m) => m === last || !path.includes(m)));
          if (!cand.length) break;
          path.push(rng.pick(cand));
        }
        if (path.length < 3) continue;
        for (const cell of path) used[cell] = c;
        paths.push(path);
        placed = true;
      }
      if (!placed) ok = false;
    }
    if (!ok) continue;
    // 盤面がすかすかだと簡単すぎるので、6 割以上のマスを経路が通る問題だけを使う
    if (used.filter((u) => u >= 0).length < total * 0.6) continue;
    return { puzzle: { size, ends: paths.map((p) => [p[0], p[p.length - 1]] as [number, number]) }, solution: paths };
  }
  // ここへは通常来ない。来た時は、横一列ずつ結ぶだけの必ず解ける問題を返す
  const n = Math.min(colors, size);
  const solution = Array.from({ length: n }, (_, y) => Array.from({ length: size }, (_, x) => y * size + x));
  return { puzzle: { size, ends: solution.map((p) => [p[0], p[p.length - 1]] as [number, number]) }, solution };
}

export interface LinkSearch {
  solved: boolean;
  sol: number[][];
  /** 調べた手の数（CPU の所要時間の見積もりに使う） */
  nodes: number;
}

/**
 * 端点からの経路探索。見えている盤面（端点の位置）だけを使う。budget は調べられる手の数の上限。
 * fixed は、すでに分かっている経路の出だし（記号 → マスの列）。そこから先だけを探す。
 */
export function solveLink(p: LinkPuzzle, budget: number, fixed: Record<number, number[]> = {}): LinkSearch {
  const { size } = p;
  const total = size * size;
  const n = p.ends.length;
  let nodes = 0;
  const order = p.ends.map((_, i) => i).sort((a, b) => dist(size, p.ends[a][0], p.ends[a][1]) - dist(size, p.ends[b][0], p.ends[b][1]));
  const endCell = new Array<number>(total).fill(-1);
  p.ends.forEach((e, i) => { endCell[e[0]] = i; endCell[e[1]] = i; });

  for (const slack of [0, 2, 4, 6, 10, 16, 40]) {
    const used = new Array<boolean>(total).fill(false);
    const sol: number[][] = Array.from({ length: n }, () => []);
    /** まだ結んでいない記号の端点どうしが、空いているマスを通って届くか（届かなければ、この先は調べない） */
    const reachable = (from: number): boolean => {
      for (let k = from; k < n; k++) {
        const c = order[k];
        const [a, b] = p.ends[c];
        const seen = new Set<number>([a]);
        const q = [a];
        let hit = false;
        while (q.length && !hit) {
          const cur = q.pop()!;
          for (const nb of neighbours(size, cur)) {
            if (nb === b) { hit = true; break; }
            if (seen.has(nb) || used[nb] || endCell[nb] >= 0) continue;
            seen.add(nb);
            q.push(nb);
          }
        }
        if (!hit) return false;
      }
      return true;
    };
    const place = (k: number): boolean => {
      if (k >= n) return true;
      const c = order[k];
      const [a, b] = p.ends[c];
      const pre = fixed[c] && fixed[c].length && (fixed[c][0] === a || fixed[c][0] === b) ? fixed[c] : null;
      const startPath = pre ?? [a];
      const goal = pre && pre[0] === b ? a : b;
      if (startPath.some((cell) => used[cell])) return false;
      const max = dist(size, a, b) + 1 + slack;
      const path = [...startPath];
      for (const cell of path) used[cell] = true;
      const walk = (): boolean => {
        if (nodes++ > budget) return false;
        const last = path[path.length - 1];
        if (last === goal) {
          sol[c] = [...path];
          if (reachable(k + 1) && place(k + 1)) return true;
          return false;
        }
        if (path.length + dist(size, last, goal) > max) return false;
        const cand = neighbours(size, last).filter((nb) => !used[nb] && (endCell[nb] < 0 || nb === goal)).sort((x, y) => dist(size, x, goal) - dist(size, y, goal));
        for (const nb of cand) {
          used[nb] = true;
          path.push(nb);
          if (walk()) return true;
          path.pop();
          used[nb] = false;
          if (nodes > budget) return false;
        }
        return false;
      };
      const okWalk = walk();
      if (!okWalk) for (const cell of startPath) used[cell] = false;
      return okWalk;
    };
    if (place(0)) return { solved: true, sol, nodes };
    if (nodes > budget) break;
  }
  return { solved: false, sol: [], nodes };
}
