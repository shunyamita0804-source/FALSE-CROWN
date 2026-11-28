/**
 * 交渉・約束・裏切りの評価。NPC 同士もプレイヤー相手も同じ関数を使う（プレイヤー専用の補正なし）。
 * 評価は「ピース換算の効用」で行い、受諾/拒否/対案と、その理由（台詞キー）を返す。
 */
import { NPC_BY_ID, PROFILES, type CharId, type NpcId } from '../data/characters';
import { activeDeals, addInfo, adjustRel, allied, pledged, fact, learn, log, nameOf, rel, shortName, transfer, uid } from '../core/state';
import type { Deal, DealKind, GameState, Info, PlanTerm } from '../core/types';
import type { LineKey } from './lines';

export interface Proposal {
  kind: DealKind | 'accuse';
  from: CharId;
  to: CharId;
  /** from→to に今すぐ渡すピース（負なら to→from を要求） */
  payNow: number;
  /** 条件成立後に from→to へ支払う約束 */
  payOnSuccess: number;
  plan?: PlanTerm;
  performer?: CharId;
  planBack?: PlanTerm;
  infoId?: string;
  infoBackId?: string;
  target?: CharId;
  untilDay: number;
  /** 作戦のコスト見積もり（競技側が計算して渡す。to が実行する場合） */
  planCost?: number;
  /** 告発が虚偽か（内部のみ。NPC の評価には使わない） */
  fabricated?: boolean;
  text?: string;
}

export interface Verdict {
  accept: boolean;
  reason: LineKey;
  /** 効用（デバッグ・テスト用） */
  score: number;
  counter?: Partial<Proposal>;
  counterText?: string;
}

const P = (id: CharId) => (id === 'hero' ? null : NPC_BY_ID[id as NpcId]);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** ピース1個の主観価値 */
export function pieceValue(state: GameState, id: CharId): number {
  const def = P(id);
  const greed = def ? def.personality.greed / 100 : 0.5;
  const w = def ? PROFILES[def.id]?.utilityWeights.pieceValue ?? 1 : 1;
  const have = state.actors[id].pieces;
  return (0.6 + greed * 0.6) * w * (have <= 1 ? 1.3 : have >= 8 ? 0.85 : 1);
}

/** 相手の「強さ」の印象（公開された過去の順位から） */
export function perceivedStrength(state: GameState, of: CharId): number {
  if (!state.history.length) return 0.5;
  let sum = 0;
  let n = 0;
  for (const h of state.history) {
    const idx = h.mainRanking.indexOf(of);
    if (idx >= 0) {
      sum += 1 - idx / Math.max(1, h.mainRanking.length - 1);
      n++;
    }
  }
  return n ? sum / n : 0.5;
}

function affinity(state: GameState, a: CharId, b: CharId): number {
  const r = rel(state, a, b);
  return r.like / 40 + (r.trust - 40) / 30 - (r.wary - 30) / 50 - r.hostility / 30 + r.debt / 40;
}

/**
 * v03 の要求額: need = clamp(b + ceil((警戒-信頼)/35) + ceil(敵対/50) + 希少 + 危険 - 信頼割引 - 恩義割引 - 相互利益, 0, 12)
 * benefit / risk は受け手自身の知識による 0..100 の見積もり。
 */
export function needPrice(state: GameState, me: CharId, from: CharId, base: number, benefit: number, risk: number): number {
  const def = P(me)!;
  const r = rel(state, me, from);
  const scarcity = state.actors[me].pieces <= 1 && def.personality.greed >= 60 ? 1 : 0;
  const riskPremium = clamp(Math.floor(risk / 35), 0, 2);
  const trustDiscount = r.trust >= 70 ? 1 : 0;
  const debtDiscount = r.debt >= 40 ? 1 : 0;
  const mutual = clamp(Math.floor(benefit / 35), 0, 2);
  return clamp(base + Math.ceil((r.wary - r.trust) / 35) + Math.min(2, Math.ceil(r.hostility / 50)) + scarcity + riskPremium - trustDiscount - debtDiscount - mutual, 0, 12);
}

/** 提案が持つ「支払い」の実質額（後払いは信頼で割り引く） */
function offered(state: GameState, p: Proposal): number {
  const r = rel(state, p.to, p.from);
  return p.payNow + p.payOnSuccess * clamp(r.trust / 80, 0.2, 1);
}

/** NPC `to` が提案を評価する。ハード拒否 → 要求額 → 期待効用の順に判定 */
export function evaluate(state: GameState, p: Proposal): Verdict {
  const me = p.to;
  const def = P(me);
  if (!def) return { accept: false, reason: 'refuse', score: 0 };
  if (!state.actors[me].alive || !state.actors[p.from].alive) return { accept: false, reason: 'refuse', score: -99 };
  if (!Number.isInteger(p.payNow) || !Number.isInteger(p.payOnSuccess) || p.payOnSuccess < 0) return { accept: false, reason: 'refuse', score: -99 };
  if (p.payNow > 0 && state.actors[p.from].pieces < p.payNow) return { accept: false, reason: 'reject_price', score: -99 };
  if (p.payNow < 0 && state.actors[me].pieces < -p.payNow) return { accept: false, reason: 'reject_price', score: -9 };
  // 未払い総額は、新規契約時の支払者の所持数以下
  if (p.payOnSuccess > 0 && p.kind !== 'loan') {
    const owed = state.deals.filter((d) => d.status === 'active' && d.from === p.from && d.payOnSuccess > 0 && !d.paidLater && d.kind !== 'loan').reduce((a, d) => a + d.payOnSuccess, 0);
    if (owed + p.payOnSuccess + Math.max(0, p.payNow) > state.actors[p.from].pieces) return { accept: false, reason: 'reject_price', score: -9 };
  }
  const per = def.personality;
  const prof = PROFILES[def.id];
  const r = rel(state, me, p.from);
  const pv = pieceValue(state, me);
  const aff = affinity(state, me, p.from);
  const pay = offered(state, p);
  const myAlliances = activeDeals(state, me).filter((d) => d.kind === 'alliance').length;
  const strength = perceivedStrength(state, p.from);
  const counterPrice = (need: number, max = 8): Verdict | null => {
    const ask = Math.ceil(need);
    if (ask > p.payNow && ask <= max) return { accept: false, reason: 'counter', score: pay - need, counter: { payNow: ask }, counterText: `${ask}ピース` };
    return null;
  };

  // 緩い約束（生活中に交わした「次は協力しよう」）は、同じ競技での協力の話の材料になる（必ず受けるわけではない）
  const pledge = !!pledged(state, me, p.from);
  switch (p.kind) {
    case 'pledge': {
      if (pledge || allied(state, me, p.from)) return { accept: false, reason: 'refuse', score: -1 };
      if (r.hostility > 55 || r.wary > 75) return { accept: false, reason: 'trust_low', score: -5 };
      // 中身を決めない約束なので、額では動かない。関係、相手の強さの印象、味方の少なさ、律儀さで決める
      const mine = activeDeals(state, me).filter((d) => d.kind === 'pledge').length;
      const v = aff * 0.8 + (strength - 0.4) * 1.5 + (mine === 0 ? 0.4 : -mine * 0.3) + (per.loyalty - 50) / 100 + (def.rules.requireRational ? (strength - 0.5) * 2 : 0);
      return v >= -0.2 ? { accept: true, reason: 'accept', score: v } : { accept: false, reason: r.trust < 35 ? 'trust_low' : 'refuse', score: v };
    }
    case 'gift':
      return { accept: true, reason: 'gift_received', score: pay };
    case 'loan': {
      // from が to から借りる（payNow < 0）。返済額の上限は元本（利息なし）
      const lend = -p.payNow;
      if (lend <= 0 || p.payOnSuccess > lend) return { accept: false, reason: 'refuse', score: -9 };
      const score = (p.payOnSuccess * clamp(r.trust / 70, 0, 1) - lend) * pv + aff * 0.8 + r.debt / 25 + (per.morality - 50) / 60;
      if (r.trust < 50) return { accept: false, reason: 'trust_low', score };
      if (state.actors[me].pieces - lend < 1 && per.morality < 90) return { accept: false, reason: 'reject_price', score };
      return score >= -0.6 ? { accept: true, reason: 'accept', score } : { accept: false, reason: 'reject_price', score };
    }
    case 'alliance': {
      if (allied(state, me, p.from)) return { accept: false, reason: 'refuse', score: -1 };
      // 黒瀬：条件が定義されていない成功報酬は具体化を求める
      if (def.id === 'npc_03_kurose' && p.payOnSuccess > 0) return { accept: false, reason: 'counter', score: 0, counter: { payOnSuccess: 0, payNow: p.payNow + p.payOnSuccess }, counterText: '成功報酬ではなく、条件の明確な前払い' };
      if (r.hostility > 55 || r.wary > 75) return { accept: false, reason: 'trust_low', score: -5 };
      const benefit = clamp(strength * 55 + aff * 12 + 15, 0, 100);
      const risk = clamp(r.wary * 0.6 + r.threat * 0.3 + myAlliances * (per.loyalty / 4), 0, 100);
      const base = prof.basePrices.ALLIANCE;
      if (base < 0) {
        // 神崎・久世：額では動かない。合理性（相手の強さ・関係）だけで判断
        const v = (strength - 0.45) * 3 + aff * 0.8 - myAlliances * 0.6 + (r.trust - 40) / 25 + (pledge ? 0.4 : 0);
        return v >= 0.2 ? { accept: true, reason: 'accept', score: v } : { accept: false, reason: r.trust < 40 ? 'trust_low' : 'reject_principle', score: v };
      }
      const need = Math.max(0, needPrice(state, me, p.from, base, benefit, risk) + Math.round(myAlliances * (per.loyalty / 60)) - (pledge ? 1 : 0));
      if (pay >= need) return { accept: true, reason: 'accept', score: pay - need };
      return counterPrice(need) ?? { accept: false, reason: r.trust < 40 ? 'trust_low' : 'reject_price', score: pay - need };
    }
    case 'nonaggression': {
      if (allied(state, me, p.from, ['nonaggression', 'alliance'])) return { accept: false, reason: 'refuse', score: -1 };
      if (r.hostility > 65) return { accept: false, reason: 'trust_low', score: -5 };
      const base = Math.max(0, (prof.basePrices.ALLIANCE < 0 ? 1 : prof.basePrices.ALLIANCE) - 1);
      const benefit = clamp(40 + aff * 10 + (100 - per.ambition) * 0.3, 0, 100);
      const need = needPrice(state, me, p.from, base, benefit, r.wary * 0.5);
      if (pay >= need) return { accept: true, reason: 'accept', score: pay - need };
      return counterPrice(need, 5) ?? { accept: false, reason: 'trust_low', score: pay - need };
    }
    case 'plan': {
      const iPerform = p.performer === me;
      const cost = iPerform ? p.planCost ?? 1 : p.planBack ? p.planCost ?? 0 : 0;
      if (cost >= 50) return { accept: false, reason: 'reject_principle', score: -cost };
      // 橘：信頼している仲間を不利にする依頼は額に関係なく拒否（planCost 側でも 99 を返す）
      // 神崎：自分の期待改善が 0 以下の協力依頼は、ピースだけでは受けない
      if (def.rules.requireRational && iPerform && cost > 0.6) return { accept: false, reason: 'reject_principle', score: -cost };
      // 桐生：自分の不利だけを求める八百長は拒否
      if (def.id === 'npc_06_kiryu' && iPerform && cost > 2.5) return { accept: false, reason: 'reject_principle', score: -cost };
      if (!iPerform && !p.planBack) {
        // 相手が何かをしてくれる約束：対価を求められていなければ受ける
        const worth = 1.2 * clamp(r.trust / 60, 0.2, 1.2);
        const score = worth + pay * pv;
        return score >= 0 ? { accept: true, reason: 'accept', score } : { accept: false, reason: 'reject_price', score };
      }
      const base = prof.basePrices.PLAN < 0 ? 0 : prof.basePrices.PLAN;
      const benefit = clamp(60 - cost * 25 + (allied(state, me, p.from) ? 25 : 0), 0, 100);
      const need = Math.max(0, needPrice(state, me, p.from, base, benefit, cost * 25) + Math.max(0, Math.round(cost - 0.5)) - (pledge ? 1 : 0));
      if (pay >= need) return { accept: true, reason: 'accept', score: pay - need };
      return counterPrice(need, 6) ?? { accept: false, reason: r.trust < 35 ? 'trust_low' : 'reject_price', score: pay - need };
    }
    case 'poach': {
      const t = p.target!;
      const d = allied(state, me, t);
      if (!d) return { accept: false, reason: 'refuse', score: -1 };
      const tr = rel(state, me, t);
      // 橘：信頼 65 以上の仲間への裏切りは、いくら積まれても拒否
      if (def.rules.refuseBetrayFriends && tr.trust >= 65) return { accept: false, reason: 'reject_principle', score: -99 };
      // 黒瀬：既存の約束と衝突する契約は原則拒否
      if (def.rules.keepsContracts) return { accept: false, reason: 'reject_principle', score: -99 };
      const base = prof.basePrices.RECRUIT;
      if (base < 0) return { accept: false, reason: 'reject_principle', score: -99 };
      const bond = Math.round(per.loyalty / 30 + tr.trust / 40 + tr.like / 40 + tr.debt / 30);
      const need = needPrice(state, me, p.from, base, clamp(strength * 60 + aff * 10, 0, 100), 50) + bond;
      if (pay >= need) return { accept: true, reason: 'accept', score: pay - need };
      return counterPrice(need, 10) ?? { accept: false, reason: 'reject_price', score: pay - need };
    }
    case 'info_sell': {
      // from が to に情報を売る（payNow < 0 = to が支払う代金）
      const info = p.infoId ? state.infos[p.infoId] : undefined;
      if (!info || state.actors[me].knows[info.id]) return { accept: false, reason: 'refuse', score: -1 };
      const price = -p.payNow;
      const worth = info.value * (0.5 + per.explore / 120) * clamp(r.trust / 60, 0.3, 1.2) / pv;
      if (price <= worth) return { accept: true, reason: 'accept', score: worth - price };
      const fair = Math.floor(worth);
      return { accept: false, reason: fair > 0 ? 'counter' : 'reject_price', score: worth - price, counter: { payNow: -fair }, counterText: fair > 0 ? `${fair}ピース` : '' };
    }
    case 'info_swap': {
      const info = p.infoId ? state.infos[p.infoId] : undefined;
      const back = p.infoBackId ? state.infos[p.infoBackId] : undefined;
      if (!info || !back || state.actors[me].knows[info.id] || !state.actors[me].knows[back.id]) return { accept: false, reason: 'noInfo', score: -1 };
      const score = info.value * clamp(r.trust / 60, 0.3, 1.2) - back.value * 0.7 + aff * 0.4 + pay * pv;
      return score >= 0 ? { accept: true, reason: 'accept', score } : { accept: false, reason: r.trust < 40 ? 'trust_low' : 'reject_price', score };
    }
    case 'accuse': {
      // 告発：信頼・相手との関係・証拠の有無で信じるかを決める（内部の真偽は参照しない）
      const t = p.target!;
      const tr = rel(state, me, t);
      const hasEvidence = !!p.infoId && !!state.infos[p.infoId] && !!state.actors[p.from].knows[p.infoId];
      // 堂島：根拠のない告発は採用しない
      if (def.id === 'npc_08_dojima' && !hasEvidence) return { accept: false, reason: 'accuseDoubt', score: -1 };
      // 橘：信頼している仲間への告発は、証拠がなければ取り合わない
      if (def.rules.refuseBetrayFriends && tr.trust >= 65 && !hasEvidence) return { accept: false, reason: 'accuseDoubt', score: -1 };
      const oral = clamp(20 + 0.6 * r.trust - 0.3 * r.wary, 10, 80) / 100;
      const friend = !!allied(state, me, t) || tr.like > 30;
      const score = (hasEvidence ? 0.9 : oral) + (tr.wary - tr.trust) / 300 - (friend ? 0.2 : 0) - def.stats.observation / 60;
      return { accept: score > 0.28, reason: score > 0.28 ? 'accuseBelieve' : 'accuseDoubt', score };
    }
  }
  return { accept: false, reason: 'refuse', score: 0 };
}

/** 合意を成立させる：支払いを原子的に実行し、約束を記録する */
export function commit(state: GameState, p: Proposal, witnesses: CharId[] = []): Deal | null {
  if (p.kind === 'accuse') return null;
  if (p.payNow > 0 && state.actors[p.from].pieces < p.payNow) return null;
  if (p.payNow < 0 && state.actors[p.to].pieces < -p.payNow) return null;
  if (!transfer(state, p.from, p.to, p.payNow, `取引（${nameOf(state, p.from)}→${nameOf(state, p.to)}）`)) return null;
  const deal: Deal = {
    id: uid(state, 'deal'),
    day: state.day,
    from: p.from,
    to: p.to,
    kind: p.kind,
    payNow: p.payNow,
    payOnSuccess: p.payOnSuccess,
    plan: p.plan,
    performer: p.performer,
    planBack: p.planBack,
    infoId: p.infoId,
    infoBackId: p.infoBackId,
    target: p.target,
    untilDay: p.untilDay,
    status: 'active',
    witnesses,
    createdAt: state.simTime,
  };
  // 即時に完了する取引
  if (p.kind === 'gift') {
    deal.status = 'fulfilled';
    // 無条件贈与：好感+2、信頼+min(額,3)（1日+6まで）、恩義+min(2×額,10)
    const key = `gift_trust_${state.day}_${p.from}_${p.to}`;
    const used = Number(state.flags[key] ?? 0);
    const t = Math.max(0, Math.min(Math.min(p.payNow, 3), 6 - used));
    state.flags[key] = used + t;
    adjustRel(state, p.to, p.from, { like: 2, trust: t, debt: Math.min(2 * p.payNow, 10) });
  } else if (p.kind === 'info_sell') {
    if (p.infoId) absorb(state, p.to, p.infoId, p.from, 0.5 + rel(state, p.to, p.from).trust / 200);
    deal.status = 'fulfilled';
    adjustRel(state, p.to, p.from, { like: 1, trust: 3, wary: -2 });
    adjustRel(state, p.from, p.to, { like: 1, trust: 3, wary: -2 });
  } else if (p.kind === 'info_swap') {
    if (p.infoId) absorb(state, p.to, p.infoId, p.from, 0.5 + rel(state, p.to, p.from).trust / 200);
    if (p.infoBackId) absorb(state, p.from, p.infoBackId, p.to, 0.5 + rel(state, p.from, p.to).trust / 200);
    deal.status = 'fulfilled';
    adjustRel(state, p.to, p.from, { like: 1, trust: 3, wary: -2 });
    adjustRel(state, p.from, p.to, { like: 1, trust: 3, wary: -2 });
  } else if (p.kind === 'poach') {
    const d = p.target ? allied(state, p.to, p.target) : undefined;
    if (d) {
      d.status = 'broken';
      d.note = `${nameOf(state, p.to)}が一方的に破棄`;
      // 破棄された側は、次に相手と接した時に気づく（ここでは事実だけ記録）
      recordBetrayal(state, p.to, p.target!, [p.from, p.to], `${nameOf(state, p.to)}は${nameOf(state, p.target!)}との同盟を裏で破棄した。`);
    }
    deal.status = 'fulfilled';
  } else {
    adjustRel(state, p.to, p.from, { like: 2, trust: 1 });
    adjustRel(state, p.from, p.to, { like: 2, trust: 1 });
  }
  state.deals.push(deal);
  fact(state, 'deal', [p.from, p.to], `${nameOf(state, p.from)}と${nameOf(state, p.to)}が取引（${dealLabel(deal.kind)}）`, { deal: deal.id });
  // 目撃者には「何か約束した」という噂だけが伝わる（内容は非公開）
  if (witnesses.length && deal.kind !== 'gift') {
    const info = addInfo(state, {
      kind: 'deal',
      text: `${nameOf(state, p.from)}と${nameOf(state, p.to)}が、何か約束を交わしていた。`,
      truth: true,
      about: [p.from, p.to],
      source: witnesses[0],
      value: 1,
      tags: ['deal'],
    });
    for (const w of witnesses) learn(state, w, info.id, 'self', 0.9);
  }
  return deal;
}

export function dealLabel(kind: DealKind | 'accuse'): string {
  return { info_sell: '情報の売買', info_swap: '情報交換', alliance: '同盟', nonaggression: '不可侵', plan: '作戦の約束', poach: '引抜き', loan: '貸借', gift: '贈与', pledge: '協力の約束', accuse: '告発' }[kind];
}

export function describeDeal(state: GameState, d: Deal, viewer: CharId = 'hero'): string {
  const other = d.from === viewer ? d.to : d.from;
  const on = shortName(state, other);
  const pay = d.payNow ? `（${d.payNow > 0 ? nameOf(state, d.from) : nameOf(state, d.to)}が${Math.abs(d.payNow)}ピース支払い済み）` : '';
  const later = d.payOnSuccess ? `　成功報酬 ${d.payOnSuccess}ピース（${shortName(state, d.from)}→${shortName(state, d.to)}）` : '';
  switch (d.kind) {
    case 'alliance': return `${on}と同盟（DAY${d.untilDay}まで）${pay}`;
    case 'nonaggression': return `${on}と不可侵（DAY${d.untilDay}まで）${pay}`;
    case 'plan': return `${on}との作戦：${shortName(state, d.performer ?? d.from)}が「${d.plan?.label ?? ''}」${d.planBack ? `／見返りに相手が「${d.planBack.label}」` : ''}${pay}${later}`;
    case 'loan': return `${on}との貸借：${shortName(state, d.from)}が${-d.payNow}ピース借り、${d.payOnSuccess}ピース返す約束（DAY${d.untilDay}まで）`;
    case 'gift': return `${on}へ贈与${pay}`;
    case 'pledge': return `${on}と「次は協力しよう」（DAY${d.untilDay}まで。同じ競技に出たら話のきっかけになる）`;
    case 'poach': return `${on}に${d.target ? shortName(state, d.target) : ''}との同盟を破棄させた${pay}`;
    default: return `${on}と${dealLabel(d.kind)}${pay}`;
  }
}

// ---------------- 情報と信念 ----------------

/** 情報を受け取り、内容に応じて関係（信念）を更新する。本人が観測/伝聞した時だけ評価が変わる */
export function absorb(state: GameState, who: CharId, infoId: string, from: CharId | 'self' | 'public', conf: number): boolean {
  const info = state.infos[infoId];
  if (!info) return false;
  const isNew = learn(state, who, infoId, from, conf);
  if (!isNew) return false;
  if (info.kind === 'betrayal' && info.about.length) {
    const traitor = info.about[0];
    const victim = info.about[1];
    if (who !== traitor) {
      // 直接確認（from = self）は全量、伝聞は確度に応じて最大 40%
      const w = from === 'self' ? 1 : Math.min(0.4, conf * 0.5);
      const late = info.tags.includes('nonpayment');
      const lie = info.tags.includes('lie');
      const t = lie ? { like: -6, trust: -15, wary: 12, hostility: 8 } : late ? { like: -8, trust: -20, wary: 15, hostility: 12 } : { like: -10, trust: -25, wary: 20, hostility: 18 };
      const hv = victim === who ? 1 : 0.5;
      adjustRel(state, who, traitor, { like: t.like * w, trust: t.trust * w, wary: t.wary * w, hostility: t.hostility * w * hv });
    }
  }
  if (info.kind === 'rumor' && info.tags.includes('danger') && info.about.length && who !== info.about[0]) {
    adjustRel(state, who, info.about[0], { wary: 10 * conf, threat: 8 * conf });
  }
  return true;
}

/** 直近に記録された裏切り（画面側が、被害者本人が気づいた時の反応に使う。取り出すと空になる） */
const betrayalLog: { traitor: CharId; victim: CharId; aware: boolean }[] = [];
export function drainBetrayals(): { traitor: CharId; victim: CharId; aware: boolean }[] {
  return betrayalLog.splice(0);
}

export function recordBetrayal(state: GameState, traitor: CharId, victim: CharId, observers: CharId[], text: string, certainty = 1, tag: 'betrayal' | 'nonpayment' | 'lie' = 'betrayal'): Info {
  const info = addInfo(state, { kind: 'betrayal', text, truth: true, about: [traitor, victim], source: observers[0] ?? 'world', value: 2, tags: ['betrayal', tag] });
  for (const o of observers) if (state.actors[o]?.alive) absorb(state, o, info.id, 'self', certainty);
  fact(state, 'betrayal', [traitor, victim], text);
  state.flags[`betrayals_${traitor}`] = Number(state.flags[`betrayals_${traitor}`] ?? 0) + 1;
  if (tag === 'betrayal') betrayalLog.push({ traitor, victim, aware: observers.includes(victim) });
  if (betrayalLog.length > 20) betrayalLog.shift();
  return info;
}

/** 告発：対象についての噂を相手に伝える（真偽は内部のみ保持） */
export function accuse(state: GameState, from: CharId, to: CharId, target: CharId, text: string, fabricated: boolean, believed: boolean): void {
  const info = addInfo(state, { kind: 'rumor', text, truth: !fabricated, about: [target], source: from, value: 1, tags: ['danger', 'accuse'] });
  learn(state, from, info.id, 'self', 1);
  if (believed) {
    absorb(state, to, info.id, from, 0.4 + rel(state, to, from).trust / 200);
    adjustRel(state, to, target, { trust: -8, wary: 8 });
  } else {
    adjustRel(state, to, from, { trust: -4, wary: 3 });
  }
  fact(state, 'accuse', [from, to, target], `${nameOf(state, from)}が${nameOf(state, to)}に${nameOf(state, target)}を告発（${fabricated ? '虚偽' : '事実'}）`);
}

// ---------------- 履行の精算 ----------------

export interface Settlement {
  deal: Deal;
  result: 'kept' | 'broken' | 'unknown';
  paid?: number;
  defaulted?: boolean;
}

/**
 * 競技終了後、その競技に関する作戦の約束を精算する。
 * check は「observer から見て履行されたか」を返す（観測できない場合は unknown）。
 */
export function settlePlans(
  state: GameState,
  matchId: string,
  check: (plan: PlanTerm, actor: CharId, observer: CharId) => 'kept' | 'broken' | 'pending' | 'unknown',
): Settlement[] {
  const out: Settlement[] = [];
  for (const d of state.deals) {
    if (d.status !== 'active' || d.kind !== 'plan' || !d.plan || d.plan.match !== matchId) continue;
    const performer = d.performer ?? d.from;
    const other = performer === d.from ? d.to : d.from;
    let res = check(d.plan, performer, other);
    if (res === 'pending') res = 'unknown';
    const s: Settlement = { deal: d, result: res };
    if (res === 'broken') {
      d.status = 'broken';
      recordBetrayal(state, performer, other, [other], `${nameOf(state, performer)}は「${d.plan.label}」という約束を破った。`);
    } else {
      d.status = res === 'kept' ? 'fulfilled' : 'expired';
      if (res === 'kept') {
        adjustRel(state, other, performer, { like: 3, trust: 8, wary: -5, debt: 3 });
        // 成功報酬（支払う側は other とは限らない：from→to）
        if (d.payOnSuccess > 0) {
          const payer = d.from;
          const payee = d.to;
          const pays = payer === 'hero' ? null : willPay(state, payer, payee, d.payOnSuccess);
          if (pays === null) {
            // プレイヤーが支払う側：UI で選択させる（未処理として残す）
            d.status = 'active';
            d.paidLater = false;
            s.paid = undefined;
          } else if (pays && transfer(state, payer, payee, d.payOnSuccess, '成功報酬')) {
            d.paidLater = true;
            s.paid = d.payOnSuccess;
          } else {
            s.defaulted = true;
            d.status = 'broken';
            recordBetrayal(state, payer, payee, [payee], `${nameOf(state, payer)}は約束の成功報酬${d.payOnSuccess}ピースを支払わなかった。`, 1, 'nonpayment');
          }
        }
      }
    }
    // 見返りの作戦
    if (d.planBack) {
      const r2 = check(d.planBack, other, performer);
      if (r2 === 'broken') recordBetrayal(state, other, performer, [performer], `${nameOf(state, other)}は「${d.planBack.label}」という約束を破った。`);
      else if (r2 === 'kept') adjustRel(state, performer, other, { like: 3, trust: 8, wary: -5, debt: 3 });
    }
    out.push(s);
  }
  return out;
}

/** NPC が後払いの約束を守るか（人格と関係から決まる。乱数は使わない） */
export function willPay(state: GameState, payer: CharId, payee: CharId, amount: number): boolean {
  const def = P(payer);
  if (!def) return true;
  if (state.actors[payer].pieces < amount) return false;
  if (def.rules.keepsContracts) return true;
  const r = rel(state, payer, payee);
  // v03 の違反コストと同じ重み。支払額が大きく、強欲で評判を気にしない人物ほど踏み倒す
  const prof = PROFILES[def.id];
  const cost = 0.28 * def.personality.loyalty + 0.18 * def.personality.morality + 0.15 * r.trust + 0.08 * r.debt + 0.12 * 90 * prof.reputationWeight - 0.08 * def.personality.ambition;
  const gain = amount * 6 * (0.5 + def.personality.greed / 100);
  return gain <= cost;
}

/** 貸借の期限処理・期限切れの約束の整理（1日の終わりに呼ぶ） */
export function expireDeals(state: GameState): { text: string }[] {
  const notes: { text: string }[] = [];
  for (const d of state.deals) {
    if (d.status !== 'active') continue;
    const dead = !state.actors[d.from].alive || !state.actors[d.to].alive;
    if (d.kind === 'loan' && (d.untilDay <= state.day || dead)) {
      const borrower = d.from;
      const lender = d.to;
      if (!state.actors[lender].alive) {
        d.status = 'expired';
        continue;
      }
      if (borrower === 'hero' && state.actors.hero.alive) continue; // プレイヤーは UI で返済を選ぶ
      const pays = state.actors[borrower].alive && willPay(state, borrower, lender, d.payOnSuccess);
      if (pays && transfer(state, borrower, lender, d.payOnSuccess, '返済')) {
        d.status = 'fulfilled';
        adjustRel(state, lender, borrower, { trust: 10, like: 3 });
        if (lender === 'hero') notes.push({ text: `${nameOf(state, borrower)}から${d.payOnSuccess}ピースの返済があった。` });
      } else {
        d.status = 'broken';
        recordBetrayal(state, borrower, lender, [lender], `${nameOf(state, borrower)}は借りた${-d.payNow}ピースを返さなかった。`, 1, 'nonpayment');
        if (lender === 'hero') notes.push({ text: `${nameOf(state, borrower)}は期限までに返済しなかった。` });
      }
    } else if (dead || d.untilDay < state.day) {
      d.status = d.status === 'active' ? 'expired' : d.status;
    }
  }
  return notes;
}

/** プレイヤーへの通知つきのログ */
export function noteDeal(state: GameState, d: Deal): void {
  if (d.from === 'hero' || d.to === 'hero') log(state, `約束：${describeDeal(state, d)}`, 'deal');
}

/**
 * 緩い約束を使い終える。2 人とも出た競技が終わったら、約束は果たしたものとして閉じる。
 * 協力が成立しなかった（断られた、ルール上協力できなかった）場合も、約束破りにはしない（本人の決定 2026-11-28）。
 * 状態は 'expired'（使い終えた）にする。'fulfilled' にすると、結末の判定で「果たした約束」に数えてしまうため。
 */
export function consumePledges(state: GameState, players: CharId[]): void {
  for (const d of state.deals) {
    if (d.status !== 'active' || d.kind !== 'pledge') continue;
    if (players.includes(d.from) && players.includes(d.to)) {
      d.status = 'expired';
      d.note = `DAY${state.day}の競技で同じ場に立った`;
    }
  }
}
