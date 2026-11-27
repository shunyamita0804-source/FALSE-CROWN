/**
 * P06 一筆の迷宮（v11、3 人）
 * 6 ステージ（5×5 から 7×7）。始点から終点まで、縦横に 1 本の線を引く。番号の付いたチェック点を、番号順にすべて通る。
 * 同じマスは 2 度通れない。壁は越えられない。1 ステージ 90 秒。
 * 完成 30 点 ＋ 残り時間の割合 × 10。未完成は、順に通ったチェック点 1 つ 2 点（上限 10）。
 * 問題は、先に正しい線を引いてから壁とチェック点を置いて作るので、必ず解ける。別の道でも規則を満たせば正解。
 * 全員が同じ問題を解く。順位は合計点、完成した数、完成にかかった時間の合計の順。
 */
import type { CharId } from '../data/characters';
import type { Rng } from '../core/rng';
import { neighbours } from './link';
import { skill, sortGroups, type AiCtx, type MatchEngine } from './types';

export const STAGES = 6;
export const SIZES = [5, 5, 6, 6, 7, 7];
export const STAGE_MS = 90_000;
export const BREAK_MS = 20_000;
export const DONE_PTS = 30;
export const TIME_PTS = 10;
export const CHECK_PTS = 2;
export const CHECK_MAX = 10;
export const AID_COST = 2;

export interface Maze {
  size: number;
  start: number;
  goal: number;
  /** チェック点（通る順） */
  checks: number[];
  /** 壁：隣り合う 2 マスの組（小さい番号 * 100 + 大きい番号） */
  walls: number[];
}

export const wallKey = (a: number, b: number) => Math.min(a, b) * 100 + Math.max(a, b);

/** 隣のマスへ進めるか（壁と盤面の外を除く） */
export function openNeighbours(m: Maze, c: number, walls = new Set(m.walls)): number[] {
  return neighbours(m.size, c).filter((n) => !walls.has(wallKey(c, n)));
}

/**
 * 線の検査。規則どおりに引けている所までの長さ、順に通ったチェック点の数、完成したかを返す。
 * チェック点は番号順にしか通れない。終点は、全部のチェック点の後にだけ入れる。
 */
export function trace(m: Maze, path: number[]): { valid: number; checks: number; done: boolean } {
  const walls = new Set(m.walls);
  const seen = new Set<number>();
  let checks = 0;
  if (!Array.isArray(path) || path[0] !== m.start) return { valid: 0, checks: 0, done: false };
  seen.add(m.start);
  let valid = 1;
  for (let i = 1; i < path.length; i++) {
    const c = path[i];
    const prev = path[i - 1];
    if (!Number.isInteger(c) || seen.has(c) || !openNeighbours(m, prev, walls).includes(c)) break;
    const ci = m.checks.indexOf(c);
    if (ci >= 0 && ci !== checks) break;
    if (c === m.goal && checks < m.checks.length) break;
    if (prev === m.goal) break;
    if (ci >= 0) checks++;
    seen.add(c);
    valid++;
  }
  return { valid, checks, done: path.length === valid && path[valid - 1] === m.goal && checks === m.checks.length };
}

export function scoreStage(m: Maze, path: number[], ms: number): { done: boolean; checks: number; points: number } {
  const t = trace(m, path);
  if (t.done) return { done: true, checks: t.checks, points: DONE_PTS + Math.round((TIME_PTS * Math.max(0, STAGE_MS - ms)) / STAGE_MS) };
  return { done: false, checks: t.checks, points: Math.min(CHECK_MAX, t.checks * CHECK_PTS) };
}

/**
 * 今の線の続きを探す（深さ優先）。見つかれば、終点までの線全体を返す。
 * 行き止まりの刈り込み：残りのチェック点と終点に、まだ通っていないマスだけで届くかを先に確かめる。
 */
export function solveFrom(m: Maze, prefix: number[], budget = 60_000): { path: number[] | null; nodes: number } {
  const walls = new Set(m.walls);
  const t = trace(m, prefix);
  if (t.valid !== prefix.length) return { path: null, nodes: 0 };
  const path = [...prefix];
  const seen = new Set(prefix);
  let checks = t.checks;
  let nodes = 0;
  const reach = (from: number): boolean => {
    // 次の目的地（次のチェック点、無ければ終点）へ、空いているマスだけで行けるか
    const target = checks < m.checks.length ? m.checks[checks] : m.goal;
    const q = [from];
    const vis = new Set<number>([from]);
    while (q.length) {
      const c = q.pop()!;
      if (c === target) return true;
      for (const n of openNeighbours(m, c, walls)) {
        if (vis.has(n) || seen.has(n)) continue;
        const ci = m.checks.indexOf(n);
        if (n !== target && (ci >= 0 || n === m.goal)) continue;
        vis.add(n);
        q.push(n);
      }
    }
    return false;
  };
  const dfs = (): boolean => {
    const cur = path[path.length - 1];
    if (cur === m.goal) return checks === m.checks.length;
    if (++nodes > budget) return false;
    if (!reach(cur)) return false;
    const target = checks < m.checks.length ? m.checks[checks] : m.goal;
    const d = (c: number) => Math.abs((c % m.size) - (target % m.size)) + Math.abs(Math.floor(c / m.size) - Math.floor(target / m.size));
    const opts = openNeighbours(m, cur, walls).filter((n) => !seen.has(n)).sort((a, b) => d(a) - d(b));
    for (const n of opts) {
      const ci = m.checks.indexOf(n);
      if (ci >= 0 && ci !== checks) continue;
      if (n === m.goal && checks < m.checks.length) continue;
      path.push(n);
      seen.add(n);
      if (ci >= 0) checks++;
      if (dfs()) return true;
      if (ci >= 0) checks--;
      seen.delete(n);
      path.pop();
    }
    return false;
  };
  const ok = dfs();
  return { path: ok ? path : null, nodes };
}

/** 補助：今の線から完成できるなら次の 1 マス、できないなら「ここまで戻す」位置（線の長さ）を返す */
export function hintFor(m: Maze, path: number[]): { next?: number; cutTo?: number } {
  const t = trace(m, path);
  let prefix = path.slice(0, Math.max(1, t.valid));
  for (;;) {
    const r = solveFrom(m, prefix);
    if (r.path) return prefix.length === path.length ? { next: r.path[prefix.length] } : { cutTo: prefix.length };
    if (prefix.length <= 1) return {};
    prefix = prefix.slice(0, -1);
  }
}

/** 問題を作る：自分と交わらない線を先に引き、その線が使わない辺の一部を壁にする */
export function makeMaze(rng: Rng, size: number): Maze {
  const total = size * size;
  const want = Math.round(total * 0.62);
  for (let attempt = 0; attempt < 400; attempt++) {
    const start = rng.int(0, total - 1);
    const path = [start];
    const seen = new Set(path);
    for (let guard = 0; guard < 400 && path.length < want; guard++) {
      const cur = path[path.length - 1];
      const opts = neighbours(size, cur).filter((n) => !seen.has(n));
      if (!opts.length) break;
      // まっすぐ進みすぎないように、空きの少ない方へ寄せる（盤面を広く使う線になる）
      const free = (c: number) => neighbours(size, c).filter((n) => !seen.has(n)).length;
      opts.sort((a, b) => free(a) - free(b) + rng.gauss(0, 0.9));
      const n = opts[0];
      path.push(n);
      seen.add(n);
    }
    if (path.length < want - 2) continue;
    const k = size <= 5 ? 3 : size === 6 ? 4 : 5;
    const checks: number[] = [];
    for (let i = 1; i <= k; i++) checks.push(path[Math.round((i * (path.length - 1)) / (k + 1))]);
    if (new Set(checks).size !== k) continue;
    const used = new Set<number>();
    for (let i = 1; i < path.length; i++) used.add(wallKey(path[i - 1], path[i]));
    const edges: number[] = [];
    for (let c = 0; c < total; c++) for (const n of neighbours(size, c)) if (n > c && !used.has(wallKey(c, n))) edges.push(wallKey(c, n));
    const walls = rng.shuffle(edges).slice(0, Math.round(edges.length * 0.42));
    const m: Maze = { size, start, goal: path[path.length - 1], checks, walls };
    // 近道が短すぎる問題は使わない（チェック点を結ぶだけで終わる問題を避ける）
    const quick = solveFrom(m, [start], 20_000);
    if (!quick.path || quick.path.length < Math.round(total * 0.4)) continue;
    return m;
  }
  throw new Error('p06: 問題を作れませんでした');
}

export type P06Move = { t: 'solve'; path: number[]; ms: number } | { t: 'aid' } | { t: 'ready' };

export interface P06Result { path: number[]; done: boolean; checks: number; ms: number; points: number }

export interface P06State {
  players: CharId[];
  stage_: number;
  phase: 'solve' | 'break' | 'done';
  mazes: Maze[];
  current: Record<string, { path: number[]; ms: number } | undefined>;
  results: Record<string, P06Result[]>;
  aidUsed: Record<string, boolean>;
  ready: Record<string, boolean>;
}

export interface P06View {
  self: CharId | 'spectator';
  players: CharId[];
  stageNo: number;
  stages: number;
  phase: P06State['phase'];
  maze: Maze;
  submitted: boolean;
  aidUsed: boolean;
  results: Record<string, P06Result[]>;
  totals: Record<string, number>;
  ready: Record<string, boolean>;
  /** 直前のステージの問題（振り返り用） */
  lastMaze: Maze | null;
}

const totalOf = (r: P06Result[]) => r.reduce((n, x) => n + x.points, 0);

/** CPU：見えている盤面を深さ優先で探す。探した量と線の長さから、かかった時間を決める（能力で変わる） */
function p06Ai(v: P06View, ctx: AiCtx): P06Move {
  if (v.phase !== 'solve') return { t: 'ready' };
  const lg = skill(ctx.stats.logic);
  const ob = skill(ctx.stats.observation);
  const m = v.maze;
  const r = solveFrom(m, [m.start], 40_000);
  if (!r.path) return { t: 'solve', path: [m.start], ms: STAGE_MS };
  const cells = r.path.length;
  // 引き直し：盤面が大きいほど、行き止まりに入ってやり直すことが増える
  const redo = 1 + Math.max(0, ctx.rng.gauss(0.6 + (1 - lg) * 1.0, 0.4)) * (m.size - 3.5) * 0.5;
  const sec = (6 + (1 - ob) * 7 + cells * (0.95 + (1 - lg) * 0.6) * redo + r.nodes / (25 + lg * 60)) * Math.max(0.65, 1 + ctx.rng.gauss(0, 0.24)) * (1 + ctx.noise * 0.25);
  if (sec * 1000 <= STAGE_MS - 400) return { t: 'solve', path: r.path, ms: Math.round(sec * 1000) };
  // 時間切れ：進んだ所までの線を出す
  const part = Math.max(1, Math.floor((cells * (STAGE_MS / 1000)) / sec));
  return { t: 'solve', path: r.path.slice(0, part), ms: STAGE_MS };
}

export const P06: MatchEngine<P06State, P06Move, P06View> = {
  id: 'p06',
  name: '一筆の迷宮',
  kind: 'prison',
  minPlayers: 2,
  maxPlayers: 4,
  summary: '始点から終点まで 1 本の線を引く。番号の付いたチェック点を順に通り、同じマスは 2 度通らない。',
  rules: [
    '全 6 ステージ（5×5 から 7×7 へ大きくなります）。全員が同じ問題を同時に解きます。',
    '始点（S）から終点（G）まで、縦横に 1 本の線を引きます。番号の付いたチェック点を、番号順にすべて通ります。',
    '同じマスは 2 度通れません。太い壁は越えられません。すべてのマスを通る必要はありません。',
    '線は、戻したり引き直したりできます（時間は戻りません）。終点に着くと、その時点で提出されます。',
    '制限時間は 90 秒。完成で 30 点、残り時間に応じて最大 10 点。未完成の時は、順に通ったチェック点 1 つにつき 2 点（最大 10 点）。',
    '3 ステージの後に 20 秒の休憩があり、話せます。',
    `ピース ${AID_COST} 個で、次に進むマスを 1 つ示します（この競技で 1 回。今の線から完成できない時は、戻すべき位置を示します）。`,
    '合計点の最下位が脱落します。同点は、完成した数、完成にかかった時間の合計の順で決めます。それでも同じなら共通決定戦です。',
    '時間切れの場合：その時点の線で採点します。',
  ],
  init(players, rng) {
    return {
      players: [...players], stage_: 0, phase: 'solve',
      mazes: SIZES.map((sz) => makeMaze(rng, sz)),
      current: {},
      results: Object.fromEntries(players.map((p) => [p, []])),
      aidUsed: Object.fromEntries(players.map((p) => [p, false])),
      ready: Object.fromEntries(players.map((p) => [p, false])),
    };
  },
  pending(s) {
    if (s.phase === 'done') return [];
    if (s.phase === 'break') return s.players.filter((p) => !s.ready[p]);
    return s.players.filter((p) => !s.current[p]);
  },
  stage(s) {
    if (s.phase === 'done') return { label: '終了' };
    if (s.phase === 'break') return { label: `休憩（次はステージ ${s.stage_ + 1}）`, time: BREAK_MS, negotiation: true };
    return { label: `ステージ ${s.stage_ + 1} / ${STAGES}`, time: STAGE_MS };
  },
  validate(s, p, m) {
    if (!m || s.phase === 'done' || !s.players.includes(p)) return false;
    if (s.phase === 'break') return m.t === 'ready' && !s.ready[p];
    if (s.current[p]) return false;
    if (m.t === 'aid') return !s.aidUsed[p];
    if (m.t !== 'solve' || !Array.isArray(m.path) || m.path.length > 60) return false;
    return typeof m.ms === 'number' && Number.isFinite(m.ms) && m.ms >= 0 && m.ms <= STAGE_MS + 1000;
  },
  defaultMove(s) {
    return s.phase === 'break' ? { t: 'ready' } : { t: 'solve', path: [], ms: STAGE_MS };
  },
  submit(s, p, m) {
    if (!this.validate(s, p, m)) throw new Error(`p06: illegal move ${JSON.stringify(m).slice(0, 80)}`);
    if (m.t === 'aid') {
      // 代金の支払いは呼び出し側が行う。示す内容は、本人に見えている盤面と自分の線だけから求める
      s.aidUsed[p] = true;
      return;
    }
    if (m.t === 'ready') {
      s.ready[p] = true;
      if (s.players.every((x) => s.ready[x])) s.phase = 'solve';
      return;
    }
    s.current[p] = { path: [...m.path], ms: Math.min(STAGE_MS, m.ms) };
    if (!s.players.every((x) => s.current[x])) return;
    const maze = s.mazes[s.stage_];
    for (const x of s.players) {
      const cur = s.current[x]!;
      const t = trace(maze, cur.path);
      const sc = scoreStage(maze, cur.path, cur.ms);
      s.results[x].push({ path: cur.path.slice(0, t.valid), done: sc.done, checks: sc.checks, ms: sc.done ? cur.ms : STAGE_MS, points: sc.points });
    }
    s.current = {};
    if (s.stage_ >= STAGES - 1) {
      s.phase = 'done';
      return;
    }
    s.stage_ += 1;
    if (s.stage_ === STAGES / 2) {
      s.phase = 'break';
      s.ready = Object.fromEntries(s.players.map((x) => [x, false]));
    }
  },
  view(s, p) {
    const i = Math.min(s.stage_, STAGES - 1);
    const me = p === 'spectator' ? null : p;
    const n = s.results[s.players[0]].length;
    return {
      self: p, players: s.players, stageNo: s.stage_, stages: STAGES, phase: s.phase,
      maze: s.mazes[i],
      submitted: !!me && !!s.current[me],
      aidUsed: !!me && s.aidUsed[me],
      results: s.results,
      totals: Object.fromEntries(s.players.map((x) => [x, totalOf(s.results[x])])),
      ready: { ...s.ready },
      lastMaze: n > 0 ? s.mazes[n - 1] : null,
    };
  },
  ai: p06Ai,
  done(s) {
    return s.phase === 'done';
  },
  scores(s) {
    return Object.fromEntries(s.players.map((p) => [p, totalOf(s.results[p])]));
  },
  ranking(s) {
    const done = (p: CharId) => s.results[p].filter((r) => r.done).length;
    const time = (p: CharId) => s.results[p].reduce((n, r) => n + r.ms, 0);
    return sortGroups(s.players, (p) => totalOf(s.results[p]) * 100 + done(p), (p) => -time(p));
  },
};

/** 説明と練習に使う問題（本番とは別） */
export const P06_PRACTICE: Maze = { size: 4, start: 0, goal: 15, checks: [6, 9], walls: [wallKey(1, 5), wallKey(9, 10), wallKey(2, 3), wallKey(12, 13)] };
export const P06_PRACTICE_SOL = [0, 1, 2, 6, 5, 9, 13, 14, 15];
