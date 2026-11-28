/**
 * 手帳「関係一覧」の中身（表示用の読み取りだけ。状態は一切書き換えない）。
 *
 * 載せるのは、主人公が見聞きして知っていることだけ。
 * - 親密度〈推定〉は、主人公が相手の返事や態度から読み取った好意（npc/social.ts の attitudeStep）。内部の好意・信頼・警戒・恩義・裏切りやすさは使わない。
 * - 協力と約束は、主人公が当事者として成立させた取引（state.deals）と救済の約束だけ。成立した事実であって、相手が守る保証ではない。
 * - 裏で破棄された約束は、主人公がそれを知るまで「破棄」と出さない（一覧を開くだけで新しい情報を得ないように）。
 * - 他の人どうしの関係は、主人公の知っている情報（actors.hero.knows）から、出所（目撃・本人の発言・噂・公表）と確かさを付けて並べる。
 *   内部の同盟や好意から自動で作らない。
 */
import { abilityStep, luckStep, SHOWN_ABILITIES } from '../data/abilities';
import { displayName, NPC_BY_ID, NPC_IDS, type CharId, type NpcId } from '../data/characters';
import { attitudeStep } from '../npc/social';
import { shortName } from './state';
import type { Deal, DealStatus, GameState, Info, Known } from './types';

/** 協力関係として数える取引（その期間、手を組んでいる） */
const COOP_KINDS = new Set<string>(['alliance', 'nonaggression', 'plan']);
/** 生活中の緩い約束「次は協力しよう」（v0.29.0 で追加される取引の種類） */
const PLEDGE = 'pledge';

export type RelSort = 'name' | 'step';
export interface RelFilter {
  coop?: boolean;
  promise?: boolean;
}

export interface PromiseView {
  deal?: Deal;
  /** 一覧に出す短い要約 */
  short: string;
  /** 主人公から見た状態 */
  status: DealStatus;
  /** 誰が何をする約束か（詳細に出す） */
  who: 'hero' | 'them' | 'both';
}

export interface RelationRow {
  id: NpcId;
  name: string;
  kana: string;
  met: boolean;
  alive: boolean;
  outDay?: number;
  house: 'living' | 'prison' | null;
  /** 0 = 未確認、1〜5 = 推定の段階 */
  step: 0 | 1 | 2 | 3 | 4 | 5;
  /** いま有効な協力（同盟・不可侵・作戦） */
  coop: PromiseView[];
  /** いま有効な約束（協力の約束、返済、成功報酬、救済など） */
  promises: PromiseView[];
}

/** 主人公から見た取引の状態。裏で破られていても、主人公が知らなければ期限まで「有効」に見える */
export function heroStatus(s: GameState, d: Deal): DealStatus {
  if (d.status !== 'broken') return d.status;
  const other = d.from === 'hero' ? d.to : d.from;
  if (heroKnowsBreak(s, other, d.day)) return 'broken';
  return d.untilDay >= s.day && s.actors[other]?.alive ? 'active' : 'expired';
}

/** 主人公が、その人との約束が破られたことを知っているか（自分が破った場合も含む） */
function heroKnowsBreak(s: GameState, other: CharId, sinceDay: number): boolean {
  for (const k of Object.keys(s.actors.hero.knows)) {
    const i = s.infos[k];
    if (!i || i.kind !== 'betrayal' || i.day < sinceDay) continue;
    if (i.about.includes(other) && i.about.includes('hero')) return true;
  }
  return false;
}

function who(actor: CharId | undefined): PromiseView['who'] {
  return actor === 'hero' ? 'hero' : actor ? 'them' : 'both';
}

/** 取引の短い要約（一覧用、20 文字前後） */
export function shortDeal(s: GameState, d: Deal): PromiseView {
  const status = heroStatus(s, d);
  const kind = d.kind as string;
  switch (kind) {
    case 'alliance': return { deal: d, status, who: 'both', short: `同盟（DAY${d.untilDay}まで）` };
    case 'nonaggression': return { deal: d, status, who: 'both', short: `不可侵（DAY${d.untilDay}まで）` };
    case 'plan': return { deal: d, status, who: who(d.performer ?? d.from), short: `作戦「${d.plan?.label ?? ''}」` };
    case PLEDGE: return { deal: d, status, who: 'both', short: '次は協力しよう' };
    case 'loan': return { deal: d, status, who: who(d.from), short: `${d.from === 'hero' ? 'あなたが' : '相手が'}${d.payOnSuccess}ピース返す` };
    case 'info_sell': return { deal: d, status, who: 'both', short: '情報の売買' };
    case 'info_swap': return { deal: d, status, who: 'both', short: '情報交換' };
    case 'gift': return { deal: d, status, who: who(d.from), short: '贈与' };
    case 'poach': return { deal: d, status, who: who(d.to), short: `${d.target ? shortName(s, d.target) : ''}との同盟の破棄` };
    default: return { deal: d, status, who: 'both', short: kind };
  }
}

/** まだ果たされていない義務が残っている約束か（協力の約束・返済・成功報酬） */
function isPromise(d: Deal): boolean {
  const kind = d.kind as string;
  return kind === PLEDGE || kind === 'loan' || (d.payOnSuccess > 0 && !d.paidLater);
}

/** 主人公とその人の取引（新しい順）。主人公が当事者のものだけ */
export function dealsWith(s: GameState, id: CharId): Deal[] {
  return s.deals.filter((d) => (d.from === 'hero' && d.to === id) || (d.to === 'hero' && d.from === id)).slice().reverse();
}

/** 今日の救済の約束（主人公が当事者のもの） */
export function rescueWith(s: GameState, id: CharId): PromiseView[] {
  return (s.today.rescuePromises ?? [])
    .filter((p) => (p.from === 'hero' && p.to === id) || (p.to === 'hero' && p.from === id))
    .map((p) => ({ status: 'active' as DealStatus, who: p.from === 'hero' ? ('hero' as const) : ('them' as const), short: p.from === 'hero' ? '救済する（今日）' : '救済してもらう（今日）' }));
}

export function relationRows(s: GameState, sort: RelSort = 'name', filter: RelFilter = {}): RelationRow[] {
  const rows = NPC_IDS.map((id): RelationRow => {
    const a = s.actors[id];
    const dn = displayName(id);
    const live = dealsWith(s, id).map((d) => shortDeal(s, d)).filter((v) => v.status === 'active');
    const coop = live.filter((v) => COOP_KINDS.has(v.deal!.kind));
    const promises = [...live.filter((v) => isPromise(v.deal!)), ...rescueWith(s, id)];
    return {
      id,
      name: dn.name,
      kana: dn.kana || dn.name,
      met: !!s.flags[`heroMet_${id}`],
      alive: a.alive,
      outDay: a.alive ? undefined : a.eliminatedDay,
      house: a.alive ? a.house ?? null : null,
      step: attitudeStep(s, id),
      coop,
      promises,
    };
  }).filter((r) => (!filter.coop || r.coop.length > 0) && (!filter.promise || r.promises.length > 0));
  const byName = (x: RelationRow, y: RelationRow) => x.kana.localeCompare(y.kana, 'ja');
  // 親密度順：推定の高い順。未確認は最後。脱落者は生存者の後ろ
  if (sort === 'step') rows.sort((x, y) => Number(y.alive) - Number(x.alive) || (y.step || -1) - (x.step || -1) || byName(x, y));
  else rows.sort((x, y) => Number(y.alive) - Number(x.alive) || byName(x, y));
  return rows;
}

// ---------------- 他の人どうしの関係 ----------------

export type OtherSource = 'sight' | 'self' | 'rumor' | 'public';
export interface OtherRelation {
  info: Info;
  pair: [CharId, CharId];
  source: OtherSource;
  /** 噂の時、誰から聞いたか */
  teller?: CharId;
  /** 確かさの目安（出所で決める。真偽そのものではない） */
  sure: 'sure' | 'claimed' | 'unconfirmed';
  day: number;
}

/** 関係の情報として扱わない種類 */
const NOT_RELATION = new Set(['profile', 'result', 'clue']);

/**
 * 主人公が知っている「他の人どうしの関係」。主人公の関わらない 2 人以上についての情報だけ。
 * 出所：自分で見た＝目撃、当事者から聞いた＝本人の発言、他の人から聞いた＝噂、公表された＝公表。
 */
export function otherRelations(s: GameState, focus?: CharId): OtherRelation[] {
  const out: OtherRelation[] = [];
  for (const [k, kn] of Object.entries(s.actors.hero.knows) as [string, Known][]) {
    const info = s.infos[k];
    if (!info || NOT_RELATION.has(info.kind)) continue;
    if (info.about.includes('hero')) continue; // 主人公が当事者の話は「あなたとの関係」の側
    const people = [...new Set(info.about)];
    if (people.length < 2) continue;
    if (focus && !people.includes(focus)) continue;
    const pair: [CharId, CharId] = [people[0], people[1]];
    let source: OtherSource;
    let teller: CharId | undefined;
    if (kn.from === 'self') source = 'sight';
    else if (kn.from === 'public') source = 'public';
    else if (info.about.includes(kn.from)) {
      source = 'self';
      teller = kn.from;
    } else {
      source = 'rumor';
      teller = kn.from;
    }
    const sure = source === 'sight' || source === 'public' ? 'sure' : source === 'self' ? 'claimed' : 'unconfirmed';
    out.push({ info, pair, source, teller, sure, day: kn.day });
  }
  return out.sort((a, b) => b.day - a.day);
}

/** その人の年齢・職業（会ったことがある時だけ） */
export function profileLine(s: GameState, id: NpcId): string | null {
  if (!s.flags[`heroMet_${id}`]) return null;
  const def = NPC_BY_ID[id];
  return `${def.age}歳・${def.job}`;
}

/** 表示する段階（会っていなければ null）。画面とテストで共用 */
export function abilityRows(s: GameState, id: NpcId): { key: string; step: number }[] | null {
  if (!s.flags[`heroMet_${id}`]) return null;
  const st = NPC_BY_ID[id].stats;
  return SHOWN_ABILITIES.map((k) => ({ key: k, step: k === 'luck' ? luckStep(st[k]) : abilityStep(st[k]) }));
}
