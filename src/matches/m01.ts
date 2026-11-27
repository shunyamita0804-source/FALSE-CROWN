/**
 * M01 三国の盟約（12人・5ラウンド）
 * 仕様: docs/specs/v01/02_MATCH_RULES.md。暫定処理は docs/decisions.md D-M01-*。
 */
import type { CharId } from '../data/characters';
import { Rng, type RngState } from '../core/rng';
import type { PlanTerm } from '../core/types';
import { argmaxNoisy, skill, sortGroups, type AiCtx, type MatchEngine } from './types';

export const NATIONS = ['紅', '蒼', '金'] as const;
export const NATION_COLORS = ['#c8384a', '#3a78c8', '#d8b04a'];
export const TERRITORY_NAMES = ['紅都', '紅砦', '紅港', '蒼都', '蒼砦', '蒼港', '金都', '金砦', '金港', '北の丘', '東の森', '南の湖'];
const ROUNDS = 5;
export const NEGOTIATION_MS = 60_000;
/** 得点（v02 バランス監査の改訂値。docs/balance-report.md） */
export const PTS = { invade: 3, defend: 3, produce: 2, hoard: 3, spy: 1 };
export const HOARD_LIMIT = 2;

export type M01Move =
  | { t: 'invade'; terr: number }
  | { t: 'defend'; terr: number }
  | { t: 'produce' }
  | { t: 'hoard' }
  | { t: 'spy'; target: CharId }
  | { t: 'ready' }
  | { t: 'pass' };

export interface TerrReport {
  terr: number;
  attack: number[]; // 国別の攻撃合計
  defense: number;
  before: number | null;
  after: number | null;
}

export interface M01State {
  rng: RngState;
  players: CharId[];
  nation: Record<string, number>;
  owner: (number | null)[];
  resources: number[];
  personal: Record<string, number>;
  round: number;
  stage: 'negotiate' | 'act' | 'done';
  moves: Record<string, M01Move>;
  /** 実行された行動（資源不足でパスになった場合は pass） */
  executed: Record<string, M01Move[]>;
  reports: TerrReport[][];
  /** 諜報結果（本人のみ閲覧） */
  intel: Record<string, { round: number; target: CharId; action: M01Move | null }[]>;
  log: string[];
  /** 蓄財の成功回数（1人2回まで） */
  hoards: Record<string, number>;
  /** 資源不足でパスになった通知（本人のみ） */
  shortfall: Record<string, number[]>;
  /** 国別の個人得点内訳（本人のみ） */
  gains: Record<string, { round: number; text: string; pts: number }[]>;
}

export interface M01View {
  self: CharId | 'spectator';
  players: CharId[];
  nation: Record<string, number>;
  owner: (number | null)[];
  resources: number[];
  /** 自分の個人点のみ（他人の個人点は非公開。最終結果で公開） */
  myPoints: number | null;
  round: number;
  stage: M01State['stage'];
  submitted: boolean;
  reports: TerrReport[][];
  myHistory: M01Move[];
  intel: M01State['intel'][string];
  log: string[];
  gains: M01State['gains'][string];
  myHoards: number;
  /** 資源不足でパスになったラウンド */
  shortfall: number[];
  finalScores?: Record<string, number>;
}

function nationMembers(s: M01State, n: number): CharId[] {
  return s.players.filter((p) => s.nation[p] === n);
}

function resolveRound(s: M01State): void {
  const rng = new Rng(s.rng);
  const startOwner = [...s.owner];
  const exec: Record<string, M01Move> = {};
  // 1) 開始時の所有権で対象を検証
  for (const p of s.players) {
    const m = s.moves[p] ?? { t: 'pass' };
    const n = s.nation[p];
    if (m.t === 'invade' && (m.terr < 0 || m.terr > 11 || startOwner[m.terr] === n)) exec[p] = { t: 'pass' };
    else if (m.t === 'defend' && startOwner[m.terr] !== n) exec[p] = { t: 'pass' };
    else if (m.t === 'spy' && (!s.players.includes(m.target) || m.target === p || s.round === 1)) exec[p] = { t: 'pass' };
    else if (m.t === 'hoard' && s.hoards[p] >= HOARD_LIMIT) exec[p] = { t: 'pass' };
    else exec[p] = m;
  }
  const gain = (p: CharId, pts: number, text: string) => {
    s.personal[p] += pts;
    (s.gains[p] ??= []).push({ round: s.round, text, pts });
  };
  // 2) 生産を先に処理
  for (const p of s.players) {
    if (exec[p].t === 'produce') {
      s.resources[s.nation[p]] += 3;
      gain(p, PTS.produce, '生産');
    }
  }
  // 3) 消費（国ごとに交代する処理順）
  for (let n = 0; n < 3; n++) {
    const mem = nationMembers(s, n);
    const start = (s.round - 1 + n) % mem.length;
    const order = mem.map((_, i) => mem[(start + i) % mem.length]);
    for (const p of order) {
      const m = exec[p];
      const cost = m.t === 'invade' ? 1 : m.t === 'hoard' ? 2 : 0;
      if (cost === 0) continue;
      if (s.resources[n] >= cost) s.resources[n] -= cost;
      else {
        exec[p] = { t: 'pass' };
        (s.shortfall[p] ??= []).push(s.round);
      }
    }
  }
  // 4) 蓄財・諜報
  for (const p of s.players) {
    const m = exec[p];
    if (m.t === 'hoard') {
      s.hoards[p] += 1;
      gain(p, PTS.hoard, '蓄財');
    }
    if (m.t === 'spy') {
      const hist = s.executed[m.target];
      const prev = hist.length ? hist[hist.length - 1] : null;
      (s.intel[p] ??= []).push({ round: s.round, target: m.target, action: prev });
      gain(p, PTS.spy, '諜報');
    }
  }
  // 5) 領土の解決（同時反映）
  const report: TerrReport[] = [];
  const newOwner = [...s.owner];
  for (let t = 0; t < 12; t++) {
    const attack = [0, 0, 0];
    for (const p of s.players) {
      const m = exec[p];
      if (m.t === 'invade' && m.terr === t) attack[s.nation[p]] += 2;
    }
    const own = startOwner[t];
    let defense = 0;
    if (own !== null) for (const p of s.players) if (exec[p].t === 'defend' && (exec[p] as { terr: number }).terr === t) defense += 3;
    const max = Math.max(...attack);
    const tops = attack.filter((a) => a === max).length;
    let after = own;
    if (max > 0 && tops === 1 && max > defense) {
      const winner = attack.indexOf(max);
      after = winner;
      for (const p of s.players) {
        const m = exec[p];
        if (m.t === 'invade' && m.terr === t && s.nation[p] === winner) gain(p, PTS.invade, `${TERRITORY_NAMES[t]}を占領`);
      }
    } else if (max > 0 && own !== null && max <= defense) {
      for (const p of s.players) {
        const m = exec[p];
        if (m.t === 'defend' && m.terr === t) gain(p, PTS.defend, `${TERRITORY_NAMES[t]}を防衛`);
      }
    }
    newOwner[t] = after;
    if (max > 0 || defense > 0) report.push({ terr: t, attack, defense, before: own, after });
  }
  s.owner = newOwner;
  s.reports.push(report);
  for (const p of s.players) s.executed[p].push(exec[p]);
  const lines = report
    .filter((r) => r.attack.some((a) => a > 0))
    .map((r) => {
      const atk = r.attack.map((a, i) => (a ? `${NATIONS[i]}${a}` : '')).filter(Boolean).join('・');
      const res = r.after !== r.before ? `→ ${r.after === null ? '中立' : NATIONS[r.after] + 'が占領'}` : '→ 維持';
      return `R${s.round} ${TERRITORY_NAMES[r.terr]}：攻撃 ${atk} / 防御 ${r.defense} ${res}`;
    });
  s.log.push(...(lines.length ? lines : [`R${s.round} 侵攻なし`]));
  s.rng = rng.state;
  s.moves = {};
  if (s.round >= ROUNDS) {
    s.stage = 'done';
  } else {
    s.round += 1;
    s.stage = 'negotiate';
  }
}

function finalScores(s: M01State): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of s.players) {
    const terr = s.owner.filter((o) => o === s.nation[p]).length;
    out[p] = s.personal[p] + terr * 2;
  }
  return out;
}

// ---------------- AI ----------------

/** 公開された結果から、各国が各領土を攻撃する傾向を推定 */
function threatEstimate(v: M01View, myNation: number): number[] {
  const threat = new Array(12).fill(0.15);
  for (let t = 0; t < 12; t++) if (v.owner[t] === myNation) threat[t] = 0.25;
  v.reports.forEach((rep, i) => {
    const w = 0.5 + i * 0.25;
    for (const r of rep) {
      const enemyAtk = r.attack.reduce((a, b, n) => (n === myNation ? a : a + b), 0);
      if (enemyAtk > 0) threat[r.terr] += (enemyAtk / 2) * 0.35 * w;
    }
  });
  return threat.map((x) => Math.min(0.95, x));
}

/** 国としての作戦を、公開情報だけから決定論的に組み立てる（同国 NPC は同じ結論に達する） */
export function nationPlan(v: M01View, n: number): { target: number; invaders: CharId[]; defenders: { p: CharId; terr: number }[]; producers: CharId[] } {
  const members = v.players.filter((p) => v.nation[p] === n);
  const res = v.resources[n];
  const roundsLeft = 5 - v.round + 1;
  // 侵攻目標：中立 > 防御が薄そうな敵領土（直近で攻撃されず、所有国の資源が少ない）
  let best = -1;
  let bestScore = -Infinity;
  for (let t = 0; t < 12; t++) {
    if (v.owner[t] === n) continue;
    const own = v.owner[t];
    let sc = own === null ? 3 : 1.2;
    // 前回そこを守っていた形跡（攻撃されたのに維持）があれば避ける
    for (const rep of v.reports.slice(-2)) for (const r of rep) if (r.terr === t && r.defense > 0) sc -= r.defense / 3;
    if (own !== null) sc += (v.owner.filter((o) => o === own).length - 3) * 0.3; // 大国を削る
    sc += ((t * 7 + v.round * 3 + n * 5) % 5) * 0.05; // 同点崩し（決定論）
    if (sc > bestScore) {
      bestScore = sc;
      best = t;
    }
  }
  const sorted = [...members].sort();
  const rot = (v.round + n) % sorted.length;
  const order = sorted.map((_, i) => sorted[(i + rot) % sorted.length]);
  const invaders: CharId[] = [];
  const producers: CharId[] = [];
  const defenders: { p: CharId; terr: number }[] = [];
  // 資源が乏しければまず生産
  const needProduce = res < 3 ? 2 : res < 6 ? 1 : 0;
  let i = 0;
  for (; i < needProduce && i < order.length; i++) producers.push(order[i]);
  if (best >= 0 && roundsLeft >= 1) {
    const need = v.owner[best] === null ? 1 : 2;
    for (let k = 0; k < need && i < order.length; k++, i++) invaders.push(order[i]);
  }
  // 残りは最も危険な自国領土を防衛
  const threat = threatEstimate(v, n);
  const mine = v.owner.map((o, t) => (o === n ? t : -1)).filter((t) => t >= 0).sort((a, b) => threat[b] - threat[a]);
  if (i < order.length && mine.length && threat[mine[0]] > 0.3) defenders.push({ p: order[i++], terr: mine[0] });
  return { target: best, invaders, defenders, producers };
}

/** 各合法手の評価値（誤差なし）。NPC 自身の view と文脈だけを使う */
export function m01Options(v: M01View, ctx: AiCtx): { m: M01Move; sc: number }[] {
  const me = ctx.self;
  const n = v.nation[me];
  const res = v.resources[n];
  const plan = nationPlan(v, n);
  const roundsLeft = 5 - v.round + 1;
  const threat = threatEstimate(v, n);
  const p = ctx.personality;
  const loyalty = p.loyalty / 100;
  const greed = (p.greed + p.ambition) / 200;
  const strategic = skill(ctx.stats.strategy);
  // 同盟・不可侵相手の国は攻撃しない（約束を守る価値と比較）
  const protectedNations = new Set<number>();
  for (const a of [...ctx.allies, ...ctx.nonAggression]) if (v.nation[a] !== undefined && v.nation[a] !== n) protectedNations.add(v.nation[a]);
  const cands: M01Move[] = [{ t: 'produce' }];
  if (res >= 2 && v.myHoards < HOARD_LIMIT) cands.push({ t: 'hoard' });
  for (let t = 0; t < 12; t++) {
    if (v.owner[t] !== n && res >= 1) cands.push({ t: 'invade', terr: t });
    if (v.owner[t] === n) cands.push({ t: 'defend', terr: t });
  }
  const others = v.players.filter((x) => x !== me);
  if (v.round > 1) {
    // 諜報の対象：最も警戒している相手
    const tgt = [...others].sort((x, y) => ctx.relation(y).wary + ctx.relation(y).threat - ctx.relation(x).wary - ctx.relation(x).threat)[0];
    cands.push({ t: 'spy', target: tgt });
  }
  // 約束した作戦
  const promised = ctx.myPlans.find((pl) => pl.plan.match === 'm01' && (pl.plan.round === undefined || pl.plan.round === v.round));
  const roleInvade = plan.invaders.includes(me);
  const roleProduce = plan.producers.includes(me);
  const roleDefend = plan.defenders.find((d) => d.p === me);
  const score = (m: M01Move): number => {
    let sc = 0;
    switch (m.t) {
      case 'produce':
        sc = PTS.produce + (res < 4 ? 1.6 : 0.6) * (roundsLeft > 1 ? 1 : 0.2);
        if (roleProduce) sc += 1.5 * loyalty;
        break;
      case 'hoard':
        // 個人点 +3 は大きいが、国庫を減らし仲間の侵攻を止める。終盤ほど国庫を残す意味が薄れる
        sc = PTS.hoard - (roundsLeft > 1 ? (res < 4 ? 1.4 : 0.7) : 0);
        sc += greed * 1.4 - 0.4;
        if (res < 4) sc -= 0.6; // 処理順によっては資源不足でパスになる危険
        if (roleInvade || roleProduce || roleDefend) sc -= 1.3 * loyalty * (roundsLeft > 1 ? 1 : 0.5);
        break;
      case 'invade': {
        const own = v.owner[m.terr];
        const isTarget = m.terr === plan.target;
        const allies = isTarget ? plan.invaders.filter((x) => x !== me).length : 0;
        const atk = 2 * (1 + allies);
        const expDef = own === null ? 0 : 3 * Math.min(1, threat[m.terr] * 0.5 + 0.25);
        const pSucc = atk > expDef ? 0.75 : atk > expDef - 1 ? 0.4 : 0.15;
        // 占領 +2、最終の領土 +2（保持できれば）
        sc = pSucc * (PTS.invade + 2 * Math.min(1, roundsLeft / 3) * strategic + 0.5) - 0.6;
        if (isTarget && roleInvade) sc += 1.5 * loyalty;
        if (own !== null && protectedNations.has(own)) sc -= 3 + loyalty * 3;
        break;
      }
      case 'defend': {
        const t = threat[m.terr];
        sc = t * (PTS.defend + 2) * (0.6 + strategic * 0.4) - 0.3;
        if (roleDefend && roleDefend.terr === m.terr) sc += 1.2 * loyalty;
        break;
      }
      case 'spy':
        sc = PTS.spy + 0.5 * skill(ctx.stats.observation) + (ctx.allies.includes(m.target) || ctx.nonAggression.includes(m.target) ? 0.6 * (1 - loyalty) : 0);
        break;
    }
    if (promised && promised.plan.code === codeOf(m)) sc += 2 + loyalty * 3 + promised.reward * 0.6;
    return sc;
  };
  return cands.map((m) => ({ m, sc: score(m) }));
}

function m01Ai(v: M01View, ctx: AiCtx): M01Move {
  if (v.stage === 'negotiate') return { t: 'ready' };
  const opts = m01Options(v, ctx);
  return argmaxNoisy(opts, (o) => o.sc, ctx, 0.8).m;
}


export function codeOf(m: M01Move): string {
  if (m.t === 'invade') return `invade:${m.terr}`;
  if (m.t === 'defend') return `defend:${m.terr}`;
  if (m.t === 'spy') return `spy:${m.target}`;
  return m.t;
}

export function moveLabel(m: M01Move | null | undefined, name?: (id: CharId) => string): string {
  if (!m) return '（行動履歴なし）';
  switch (m.t) {
    case 'invade': return `侵攻（${TERRITORY_NAMES[m.terr]}）`;
    case 'defend': return `防衛（${TERRITORY_NAMES[m.terr]}）`;
    case 'produce': return '生産';
    case 'hoard': return '蓄財';
    case 'spy': return `諜報（${name ? name(m.target) : m.target}）`;
    case 'pass': return 'パス';
    default: return '準備完了';
  }
}

export const M01: MatchEngine<M01State, M01Move, M01View> = {
  id: 'm01',
  name: '三国の盟約',
  kind: 'main',
  minPlayers: 3,
  maxPlayers: 12,
  summary: '三つの国に分かれ、5ラウンドで領土と個人点を競う。',
  rules: [
    '参加者は紅・蒼・金の三国に4人ずつ分かれます。各国は領土3つと国庫の資源6を持ち、ほかに中立の領土が3つあります。',
    '各ラウンド、60秒の交渉の後、全員が同時に1つの行動を選びます。',
    '侵攻：自国以外の領土を指定。資源1を使い攻撃2。占領に成功すると個人点+3（占領した国の侵攻者のみ）。',
    '防衛：自国の領土を指定。防御3。実際に攻撃を防げば、その領土の防衛者は各+3（攻撃がなければ0）。',
    '生産：国の資源+3、個人点+2。　蓄財：資源2を使い個人点+3（1人2回まで）。　諜報：指定した人の前ラウンドの非公開行動を知る。個人点+1（第1ラウンドは選べません）。',
    '処理順：開始時の所有権で対象を確認 → 生産 → 資源の消費（国ごとに毎ラウンド交代する順番。不足した手はパスになり、本人に通知されます）。',
    '領土ごとに国別の攻撃合計を比べ、単独最大の攻撃が防御を上回れば占領。最大が同値なら現所有のまま。中立領土も同様（防御0）。占領は同時に反映。',
    '最終得点＝個人点＋自国の領土数×2。下位4人が監獄棟へ送られます。各自の行動は非公開、領土ごとの攻撃・防御の合計だけが公開されます。',
  ],
  init(players, rng) {
    const order = rng.shuffle([...players]);
    const nation: Record<string, number> = {};
    const per = Math.ceil(order.length / 3);
    order.forEach((p, i) => (nation[p] = Math.min(2, Math.floor(i / per))));
    const owner: (number | null)[] = [0, 0, 0, 1, 1, 1, 2, 2, 2, null, null, null];
    const s: M01State = {
      rng: { s: rng.state.s ^ 0x5bd1e995 },
      players: [...players],
      nation,
      owner,
      resources: [6, 6, 6],
      personal: Object.fromEntries(players.map((p) => [p, 0])),
      round: 1,
      stage: 'negotiate',
      moves: {},
      executed: Object.fromEntries(players.map((p) => [p, []])),
      reports: [],
      intel: {},
      log: [],
      gains: {},
      hoards: Object.fromEntries(players.map((p) => [p, 0])),
      shortfall: {},
    };
    return s;
  },
  pending(s) {
    if (s.stage === 'done') return [];
    return s.players.filter((p) => !s.moves[p]);
  },
  stage(s) {
    if (s.stage === 'negotiate') return { label: `第${s.round}ラウンド 交渉`, time: NEGOTIATION_MS, negotiation: true };
    if (s.stage === 'act') return { label: `第${s.round}ラウンド 行動選択`, time: 30_000 };
    return { label: '終了' };
  },
  validate(s, p, m) {
    if (s.stage === 'negotiate') return m.t === 'ready';
    if (s.stage !== 'act') return false;
    const n = s.nation[p];
    switch (m.t) {
      case 'invade': return m.terr >= 0 && m.terr < 12 && s.owner[m.terr] !== n;
      case 'defend': return m.terr >= 0 && m.terr < 12 && s.owner[m.terr] === n;
      case 'spy': return s.round > 1 && m.target !== p && s.players.includes(m.target);
      case 'hoard': return s.hoards[p] < HOARD_LIMIT;
      case 'produce': case 'pass': return true;
      default: return false;
    }
  },
  defaultMove(s) {
    return s.stage === 'negotiate' ? { t: 'ready' } : { t: 'produce' };
  },
  submit(s, p, m) {
    if (!this.validate(s, p, m)) throw new Error(`m01: illegal move ${JSON.stringify(m)}`);
    s.moves[p] = m;
    if (this.pending(s).length === 0) {
      if (s.stage === 'negotiate') {
        s.stage = 'act';
        s.moves = {};
      } else resolveRound(s);
    }
  },
  view(s, p) {
    const me = p === 'spectator' ? null : p;
    return {
      self: p,
      players: s.players,
      nation: s.nation,
      owner: [...s.owner],
      resources: [...s.resources],
      myPoints: me ? s.personal[me] : null,
      round: s.round,
      stage: s.stage,
      submitted: me ? !!s.moves[me] : false,
      reports: s.reports,
      myHistory: me ? s.executed[me] : [],
      intel: me ? s.intel[me] ?? [] : [],
      log: s.log,
      gains: me ? s.gains[me] ?? [] : [],
      myHoards: me ? s.hoards[me] : 0,
      shortfall: me ? s.shortfall[me] ?? [] : [],
      finalScores: s.stage === 'done' ? finalScores(s) : undefined,
    };
  },
  ai: m01Ai,
  done(s) {
    return s.stage === 'done';
  },
  scores(s) {
    return finalScores(s);
  },
  ranking(s) {
    const f = finalScores(s);
    // 副得点：個人点（領土点を除く）
    return sortGroups(s.players, (p) => f[p], (p) => s.personal[p]);
  },
  clauses(s, a) {
    const n = s.nation[a];
    const out: PlanTerm[] = [];
    const r = s.round;
    for (let t = 0; t < 12; t++) {
      if (s.owner[t] !== n) out.push({ match: 'm01', code: `invade:${t}`, label: `R${r}で${TERRITORY_NAMES[t]}に侵攻する`, round: r });
    }
    for (let t = 0; t < 12; t++) {
      if (s.owner[t] === n) out.push({ match: 'm01', code: `defend:${t}`, label: `R${r}で${TERRITORY_NAMES[t]}を防衛する`, round: r });
    }
    out.push({ match: 'm01', code: 'produce', label: `R${r}で生産する`, round: r });
    return out;
  },
  checkPlan(s, plan, actor, observer) {
    if (plan.round !== undefined && s.executed[actor].length < plan.round) return 'pending';
    const idx = (plan.round ?? 1) - 1;
    const done = s.executed[actor][idx];
    if (!done) return 'pending';
    if (actor === observer) return codeOf(done) === plan.code ? 'kept' : 'broken';
    // 観測可能な範囲：侵攻なら、その領土への自国の攻撃合計から推定する
    const [kind, ts] = plan.code.split(':');
    if (kind === 'invade') {
      const t = Number(ts);
      const rep = s.reports[idx]?.find((r) => r.terr === t);
      const myNation = s.nation[actor];
      const total = rep ? rep.attack[myNation] / 2 : 0;
      // 観測者自身も同じ国で同じ領土を攻めた場合、自分の分を差し引く
      const mine = s.nation[observer] === myNation && codeOf(s.executed[observer][idx]) === plan.code ? 1 : 0;
      if (total - mine <= 0) return 'broken';
      return 'kept';
    }
    if (kind === 'defend') {
      const t = Number(ts);
      const rep = s.reports[idx]?.find((r) => r.terr === t);
      if (rep && rep.attack.some((a) => a > 0)) return rep.defense > 0 ? 'kept' : 'broken';
      return 'unknown';
    }
    return 'unknown';
  },
  allyValue(s, a, b) {
    return s.nation[a] === s.nation[b] ? 2 : 1;
  },
  planCost(v, ctx, plan) {
    if (v.stage === 'done') return 99;
    const opts = m01Options({ ...v, stage: 'act' }, ctx);
    const best = Math.max(...opts.map((o) => o.sc));
    const mine = opts.find((o) => codeOf(o.m) === plan.code);
    if (!mine) return 99;
    // 同盟・不可侵の相手の国を攻める約束は、信義を重んじる人物には受け入れられない
    const [kind, ts] = plan.code.split(':');
    if (kind === 'invade') {
      const own = v.owner[Number(ts)];
      const friends = [...ctx.allies, ...ctx.nonAggression].filter((a) => v.nation[a] === own);
      if (friends.length && own !== v.nation[ctx.self] && ctx.personality.morality >= 90) return 99;
    }
    return Math.max(0, best - mine.sc);
  },
  intent(v, ctx) {
    if (v.stage === 'done') return null;
    const opts = m01Options({ ...v, stage: 'act' }, ctx);
    const best = opts.reduce((a, b) => (b.sc > a.sc ? b : a));
    return { code: codeOf(best.m), label: moveLabel(best.m, ctx.name) };
  },
};
