import { ROOMS, doorApproach, type RoomDef } from './maps';

export interface P {
  x: number;
  y: number;
}

/** 4方向 A*。blocked は衝突グリッド、occupied は一時的に避けたいマス */
export function findPath(grid: boolean[][], from: P, to: P, occupied?: Set<string>, maxIter = 4000): P[] | null {
  const h = grid.length;
  const w = grid[0]?.length ?? 0;
  const key = (x: number, y: number) => y * w + x;
  if (to.x < 0 || to.y < 0 || to.x >= w || to.y >= h) return null;
  if (grid[to.y][to.x]) return null;
  const open: { x: number; y: number; f: number; g: number }[] = [{ x: from.x, y: from.y, f: 0, g: 0 }];
  const came = new Map<number, number>();
  const gScore = new Map<number, number>([[key(from.x, from.y), 0]]);
  let iter = 0;
  while (open.length && iter++ < maxIter) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    if (cur.x === to.x && cur.y === to.y) {
      const path: P[] = [];
      let k = key(cur.x, cur.y);
      while (k !== key(from.x, from.y)) {
        path.push({ x: k % w, y: Math.floor(k / w) });
        const prev = came.get(k);
        if (prev === undefined) break;
        k = prev;
      }
      return path.reverse();
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || grid[ny][nx]) continue;
      const isGoal = nx === to.x && ny === to.y;
      const extra = !isGoal && occupied?.has(`${nx},${ny}`) ? 6 : 0;
      const ng = cur.g + 1 + extra;
      const nk = key(nx, ny);
      if (ng < (gScore.get(nk) ?? Infinity)) {
        gScore.set(nk, ng);
        came.set(nk, key(cur.x, cur.y));
        open.push({ x: nx, y: ny, g: ng, f: ng + Math.abs(nx - to.x) + Math.abs(ny - to.y) });
      }
    }
  }
  return null;
}

/** 近くの通行可能マス */
export function nearestFree(grid: boolean[][], p: P, avoid?: Set<string>): P {
  for (let r = 0; r < 12; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = p.x + dx;
        const y = p.y + dy;
        if (y < 0 || x < 0 || y >= grid.length || x >= grid[0].length) continue;
        if (!grid[y][x] && !avoid?.has(`${x},${y}`)) return { x, y };
      }
    }
  }
  return p;
}

/** 部屋グラフ上の最短経路（部屋IDの列、開始部屋を含まない） */
export function roomRoute(from: string, to: string, canPass: (room: RoomDef, doorLock?: string, toRoom?: string) => boolean): string[] | null {
  if (from === to) return [];
  const prev = new Map<string, string>();
  const q = [from];
  const seen = new Set([from]);
  while (q.length) {
    const cur = q.shift()!;
    const room = ROOMS[cur];
    for (const d of room.doors) {
      if (seen.has(d.to)) continue;
      const target = ROOMS[d.to];
      if (!target || !canPass(target, d.lock, d.to)) continue;
      seen.add(d.to);
      prev.set(d.to, cur);
      if (d.to === to) {
        const route = [to];
        let c = cur;
        while (c !== from) {
          route.push(c);
          c = prev.get(c)!;
        }
        return route.reverse();
      }
      q.push(d.to);
    }
  }
  return null;
}

export function approachTiles(room: RoomDef, doorId: string): P[] {
  const d = room.doors.find((x) => x.id === doorId);
  return d ? doorApproach(room, d) : [];
}
