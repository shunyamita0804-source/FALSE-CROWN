import type { CharId, Personality, Stats } from '../data/characters';
import type { Rng } from '../core/rng';
import type { PlanTerm, Relation } from '../core/types';

export type MatchKind = 'main' | 'prison' | 'hidden' | 'sub' | 'final' | 'tiebreak';

/** NPC の思考に渡す文脈。NPC 自身が知り得る情報だけを含む */
export interface AiCtx {
  self: CharId;
  stats: Stats;
  personality: Personality;
  rng: Rng;
  /** 誤差の大きさ（難易度と能力で変わる） */
  noise: number;
  /** 先読みの深さ（難易度と能力で変わる） */
  depth: number;
  /** 記憶の欠落率 */
  memoryLoss: number;
  relation: (other: CharId) => Relation;
  allies: CharId[];
  nonAggression: CharId[];
  /** 自分が約束した作戦 */
  myPlans: { to: CharId; plan: PlanTerm; reward: number }[];
  /** 相手が自分に約束した作戦 */
  theirPlans: { from: CharId; plan: PlanTerm }[];
  /** 名前（ログ用） */
  name: (id: CharId) => string;
}

export interface StageInfo {
  /** 画面に表示する段階名 */
  label: string;
  /** この判断の制限時間（ミリ秒）。undefined は無制限 */
  time?: number;
  /** 交渉時間（全員 ready で終了） */
  negotiation?: boolean;
}

export interface MatchEngine<S = any, M = any, V = any> {
  id: string;
  name: string;
  kind: MatchKind;
  minPlayers: number;
  maxPlayers: number;
  /** ルール説明（段落） */
  rules: string[];
  /** 一行要約 */
  summary: string;
  init(players: CharId[], rng: Rng, opts?: Record<string, unknown>): S;
  /** 現在、手を出す必要がある参加者 */
  pending(s: S): CharId[];
  stage(s: S): StageInfo;
  validate(s: S, p: CharId, m: M): boolean;
  /** 時間切れ・入力不能時の合法手（パス可能ならパス、必須なら決定論的な合法手） */
  defaultMove(s: S, p: CharId): M;
  /** 手を記録する。全員揃ったら内部で解決する。不正手は例外 */
  submit(s: S, p: CharId, m: M): void;
  /** 参加者別の表示情報（他人の非公開情報を含めない） */
  view(s: S, p: CharId | 'spectator'): V;
  ai(v: V, ctx: AiCtx): M;
  done(s: S): boolean;
  /** 最終得点 */
  scores(s: S): Partial<Record<CharId, number>>;
  /** 順位（同点グループ、上位から）。ゲーム内副得点で解消した後の結果 */
  ranking(s: S): CharId[][];
  /** 作戦提示で約束できる行動（a が b に約束） */
  clauses?(s: S, a: CharId, b: CharId): PlanTerm[];
  /** 作戦の履行判定（観測可能な範囲で）。observer から見た結果 */
  checkPlan?(s: S, plan: PlanTerm, actor: CharId, observer: CharId): 'kept' | 'broken' | 'pending' | 'unknown';
  /** 約束した作戦を実行する場合の損失見積もり（自分の最善手との差。99 は拒否） */
  planCost?(v: V, ctx: AiCtx, plan: PlanTerm): number;
  /** 現時点で自分が選ぶつもりの手（交渉で尋ねられた時に使う） */
  intent?(v: V, ctx: AiCtx): { code: string; label: string } | null;
  /** 同盟の価値（NPC の交渉判断用、a から見た b） */
  allyValue?(s: S, a: CharId, b: CharId): number;
}

export function sortGroups(players: CharId[], primary: (p: CharId) => number, secondary?: (p: CharId) => number): CharId[][] {
  const key = (p: CharId) => [primary(p), secondary ? secondary(p) : 0];
  const sorted = [...players].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return kb[0] - ka[0] || kb[1] - ka[1];
  });
  const groups: CharId[][] = [];
  for (const p of sorted) {
    const last = groups[groups.length - 1];
    if (last) {
      const a = key(last[0]);
      const b = key(p);
      if (a[0] === b[0] && a[1] === b[1]) {
        last.push(p);
        continue;
      }
    }
    groups.push([p]);
  }
  return groups;
}

/** 能力値（1〜10）を 0〜1 に */
export const skill = (v: number) => Math.max(0, Math.min(1, (v - 1) / 9));

export function argmaxNoisy<T>(items: T[], score: (t: T) => number, ctx: AiCtx, scale = 1): T {
  let best = items[0];
  let bv = -Infinity;
  for (const it of items) {
    const v = score(it) + ctx.rng.gauss(0, ctx.noise * scale);
    if (v > bv) {
      bv = v;
      best = it;
    }
  }
  return best;
}
