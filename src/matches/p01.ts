/**
 * P01 偽りの数字（4人）
 * 全員10点、1〜9各1枚。順番に1枚伏せて1〜9を宣言、他の全員が信用/虚偽を同時選択。
 */
import type { CharId } from '../data/characters';
import type { Rng } from '../core/rng';
import { skill, sortGroups, type AiCtx, type MatchEngine } from './types';

/** 各自の手番数（v02 改訂：6手ずつ） */
export const TURNS_EACH = 6;

export type P01Move = { t: 'play'; card: number; claim: number } | { t: 'judge'; trust: boolean };

export interface P01Turn {
  declarer: CharId;
  claim: number;
  card: number;
  judges: Record<string, boolean>;
  delta: Record<string, number>;
}

export interface P01State {
  players: CharId[];
  hands: Record<string, number[]>;
  score: Record<string, number>;
  turn: number; // 0..(9*n-1)
  stage: 'play' | 'judge' | 'done';
  current: { declarer: CharId; card: number; claim: number } | null;
  judges: Record<string, boolean>;
  history: P01Turn[];
  /** 副得点：看破に成功した回数 */
  catches: Record<string, number>;
}

export interface P01View {
  self: CharId | 'spectator';
  players: CharId[];
  myHand: number[];
  score: Record<string, number>;
  turn: number;
  totalTurns: number;
  stage: P01State['stage'];
  declarer: CharId | null;
  claim: number | null;
  /** 各自が宣言済みの数字（再宣言不可） */
  claimed: Record<string, number[]>;
  /** 各自の公開済み使用カード */
  used: Record<string, number[]>;
  history: P01Turn[];
  judged: boolean;
}

function declarerOf(s: P01State): CharId {
  return s.players[s.turn % s.players.length];
}

function claimedBy(s: P01State, p: CharId): number[] {
  return s.history.filter((h) => h.declarer === p).map((h) => h.claim);
}

function resolve(s: P01State): void {
  const cur = s.current!;
  const truth = cur.card === cur.claim;
  const delta: Record<string, number> = Object.fromEntries(s.players.map((p) => [p, 0]));
  for (const p of s.players) {
    if (p === cur.declarer) continue;
    const trust = s.judges[p];
    if (truth && trust) { /* 0 / 0 */ }
    else if (truth && !trust) { delta[cur.declarer] += 2; delta[p] -= 2; }
    else if (!truth && trust) { delta[cur.declarer] += 2; delta[p] -= 2; }
    else { delta[cur.declarer] -= 2; delta[p] += 2; s.catches[p] += 1; }
  }
  for (const p of s.players) s.score[p] += delta[p];
  s.history.push({ declarer: cur.declarer, claim: cur.claim, card: cur.card, judges: { ...s.judges }, delta });
  s.hands[cur.declarer] = s.hands[cur.declarer].filter((c) => c !== cur.card);
  s.current = null;
  s.judges = {};
  s.turn += 1;
  s.stage = s.turn >= s.players.length * TURNS_EACH ? 'done' : 'play';
}

function p01Ai(v: P01View, ctx: AiCtx): P01Move {
  const me = ctx.self;
  const n = v.players.length;
  if (v.stage === 'play') {
    const hand = v.myHand;
    const usedMine = v.used[me] ?? [];
    // 自分の過去の発覚率から、相手がどれだけ疑うかを推定
    const myTurns = v.history.filter((h) => h.declarer === me);
    const doubted = myTurns.reduce((a, h) => a + Object.values(h.judges).filter((t) => !t).length, 0);
    const pDoubt = myTurns.length ? (doubted + 1) / (myTurns.length * (n - 1) + 2) : 0.35;
    const acting = skill(ctx.stats.acting);
    const riskLove = ctx.personality.risk / 100;
    const moral = ctx.personality.morality / 100;
    // 期待値（相手 n-1 人あたり）：真実 = +1、嘘 = 2(1-q) - 2q （q は「疑われる確率」）
    // ただし既に使った数字を宣言すると嘘が確定で見抜かれるので候補から外す
    const claimedMine = v.claimed[me] ?? [];
    const legalClaims = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((c) => !claimedMine.includes(c));
    const plausible = legalClaims.filter((c) => !usedMine.includes(c));
    const qLie = Math.min(0.95, pDoubt + 0.12 - acting * 0.15);
    // 真実 = 疑われた分だけ +2、嘘 = 信用 +2 / 看破 -2。疑い率 1/3 が損益分岐
    const evTruthRel = 2 * pDoubt * (n - 1);
    const evLie = (2 * (1 - qLie) - 2 * qLie) * (n - 1);
    const lieBias = (riskLove - 0.5) * 1.2 - (moral - 0.5) * 0.8 + ctx.rng.gauss(0, ctx.noise * 0.8);
    const truthCards = hand.filter((c) => legalClaims.includes(c));
    const wantLie = evLie + lieBias > evTruthRel;
    if (truthCards.length && (!wantLie || plausible.length < 2)) {
      const card = ctx.rng.pick(truthCards);
      return { t: 'play', card, claim: card };
    }
    const card = ctx.rng.pick(hand);
    const lies = (plausible.length > 1 ? plausible : legalClaims).filter((c) => c !== card);
    return { t: 'play', card, claim: ctx.rng.pick(lies.length ? lies : legalClaims) };
  }
  // 判定
  const d = v.declarer!;
  const claim = v.claim!;
  const used = v.used[d] ?? [];
  // 記憶の欠落：使用済みカードを見落とすことがある
  const remembered = used.filter(() => !ctx.rng.chance(ctx.memoryLoss * (1 - skill(ctx.stats.memory))));
  if (remembered.includes(claim)) return { t: 'judge', trust: false }; // 使用済みの数字 = 嘘確定
  const remaining = 9 - used.length;
  void remaining;
  // 相手の嘘の頻度（公開履歴から）
  const theirs = v.history.filter((h) => h.declarer === d);
  const lies = theirs.filter((h) => h.card !== h.claim).length;
  const obs = skill(ctx.stats.observation);
  // 事前確率は卓全体の嘘の割合（公開履歴）から推定する
  const allLies = v.history.filter((h) => h.card !== h.claim).length;
  const prior = (allLies + 1.2) / (v.history.length + 4);
  const weight = 0.6 + obs * 1.4;
  let pLie = (lies * weight + prior * 3) / (theirs.length * weight + 3);

  // 残り1枚で、その数字が唯一の未使用なら真実の可能性が高い…が嘘も可能。枚数が少ないほど推定しやすい

  const rel = ctx.relation(d);
  pLie += (rel.wary - rel.trust) / 400;
  pLie += ctx.rng.gauss(0, 0.12 * ctx.noise);
  // 信用の期待値: -2p ／ 疑う: -2(1-p) + 2p = 4p-2 → p > 1/3 で疑う方が得
  return { t: 'judge', trust: pLie <= 1 / 3 };
}

export const P01: MatchEngine<P01State, P01Move, P01View> = {
  id: 'p01',
  name: '偽りの数字',
  kind: 'prison',
  minPlayers: 2,
  maxPlayers: 4,
  summary: '伏せた数字カードの宣言が本当か嘘かを見抜く。',
  rules: [
    '全員が10点と、1〜9のカードを1枚ずつ持ちます。',
    '手番の人はカードを1枚伏せて出し、1〜9のいずれかの数字を宣言します（嘘でもよい）。',
    '他の全員が同時に「信用」か「虚偽」を選び、その後カードを公開します。',
    '宣言が真実で信用された：双方0。真実なのに疑われた：宣言者+2・回答者−2。',
    '嘘を信用させた：宣言者+2・回答者−2。嘘を見抜かれた：宣言者−2・回答者+2。（回答者ごとに計算。点はマイナスにもなります）',
    '各自の手番は6回（全員で一巡ずつ）。同じ数字を2度宣言することはできません。出したカードと宣言した数字の履歴はどちらも公開されます。',
    '全員が6手を終えた時点の合計点で、最下位が脱落します。',
    '時間切れの場合：宣言者は「まだ宣言していない最小の手札」を正直に宣言（なければ最小の手札と宣言可能な最小の数字）、回答者は「信用」になります。',
  ],
  init(players) {
    return {
      players: [...players],
      hands: Object.fromEntries(players.map((p) => [p, [1, 2, 3, 4, 5, 6, 7, 8, 9]])),
      score: Object.fromEntries(players.map((p) => [p, 10])),
      turn: 0,
      stage: 'play',
      current: null,
      judges: {},
      history: [],
      catches: Object.fromEntries(players.map((p) => [p, 0])),
    };
  },
  pending(s) {
    if (s.stage === 'done') return [];
    if (s.stage === 'play') return [declarerOf(s)];
    return s.players.filter((p) => p !== s.current!.declarer && s.judges[p] === undefined);
  },
  stage(s) {
    if (s.stage === 'done') return { label: '終了' };
    return { label: `${s.turn + 1} / ${s.players.length * TURNS_EACH} 手目`, time: 30_000 };
  },
  validate(s, p, m) {
    if (s.stage === 'play') return m.t === 'play' && p === declarerOf(s) && s.hands[p].includes(m.card) && Number.isInteger(m.claim) && m.claim >= 1 && m.claim <= 9 && !claimedBy(s, p).includes(m.claim);
    if (s.stage === 'judge') return m.t === 'judge' && p !== s.current!.declarer && s.players.includes(p) && s.judges[p] === undefined && typeof m.trust === 'boolean';
    return false;
  },
  defaultMove(s, p) {
    if (s.stage === 'play') {
      const claimed = claimedBy(s, p);
      const honest = s.hands[p].filter((c) => !claimed.includes(c));
      if (honest.length) return { t: 'play', card: Math.min(...honest), claim: Math.min(...honest) };
      const free = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((c) => !claimed.includes(c));
      return { t: 'play', card: Math.min(...s.hands[p]), claim: free[0] };
    }
    return { t: 'judge', trust: true };
  },
  submit(s, p, m) {
    if (!this.validate(s, p, m)) throw new Error(`p01: illegal move ${JSON.stringify(m)}`);
    if (m.t === 'play') {
      s.current = { declarer: p, card: m.card, claim: m.claim };
      s.stage = 'judge';
    } else {
      s.judges[p] = m.trust;
      if (this.pending(s).length === 0) resolve(s);
    }
  },
  view(s, p) {
    const used: Record<string, number[]> = {};
    for (const q of s.players) used[q] = s.history.filter((h) => h.declarer === q).map((h) => h.card);
    return {
      self: p,
      players: s.players,
      myHand: p === 'spectator' ? [] : [...(s.hands[p] ?? [])],
      score: { ...s.score },
      turn: s.turn,
      totalTurns: s.players.length * TURNS_EACH,
      claimed: Object.fromEntries(s.players.map((q) => [q, claimedBy(s, q)])),
      stage: s.stage,
      declarer: s.stage === 'done' ? null : s.current?.declarer ?? declarerOf(s),
      claim: s.current?.claim ?? null,
      used,
      history: s.history,
      judged: p !== 'spectator' && s.judges[p] !== undefined,
    };
  },
  ai: p01Ai,
  done(s) {
    return s.stage === 'done';
  },
  scores(s) {
    return { ...s.score };
  },
  ranking(s) {
    return sortGroups(s.players, (p) => s.score[p]);
  },
};

export type { Rng };
