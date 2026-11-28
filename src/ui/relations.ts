/**
 * 手帳「関係一覧」タブ。主人公と各参加者の関係を一覧にし、人を選ぶと人物と約束の詳細を開く。
 * 表示だけを担当する（中身は core/relationview.ts。状態を書き換えず、一覧を開くだけで新しい情報は得ない）。
 */
import { heroStatus, otherRelations, profileLine, relationRows, rescueWith, dealsWith, type OtherRelation, type PromiseView, type RelationRow, type RelFilter, type RelSort } from '../core/relationview';
import { shortName } from '../core/state';
import type { Deal, GameState } from '../core/types';
import { NPC_BY_ID, type NpcId } from '../data/characters';
import { t } from '../i18n/i18n';
import { describeDeal } from '../npc/negotiation';
import { Sound } from '../audio/audio';
import { face } from './art';
import { abilityBlock } from './abilitychart';
import { button, closeLayer, h, openLayer, panel, type Child, type Layer } from './dom';

/** 手帳を開いている間の並べ替えと絞り込み（閉じても次に開いた時に同じ） */
const view: { sort: RelSort; filter: RelFilter; side: 'mine' | 'others' } = { sort: 'name', filter: {}, side: 'mine' };

/** 親密度〈推定〉のゲージ（0 = 未確認） */
export function stepGauge(step: number, cls = ''): HTMLElement {
  return h('div', { class: `rl-step ${cls}` },
    step === 0 ? h('span', { class: 'dim small' }, t('rel.unconfirmed'))
      : [h('span', { class: `rel-steps s${step}` }, [1, 2, 3, 4, 5].map((n) => h('i', { class: n <= step ? 'on' : '' }))), h('small', { class: 'dim' }, t(`people.step${step}`))]);
}

function houseTag(r: { alive: boolean; outDay?: number; house: 'living' | 'prison' | null }): HTMLElement {
  if (!r.alive) return h('span', { class: 'tag out' }, t('people.out', { day: r.outDay ?? 0 }));
  if (!r.house) return h('span', { class: 'dim small' }, t('rel.houseNone'));
  return h('span', { class: `tag ${r.house}` }, t(r.house === 'prison' ? 'house.prison' : 'house.living'));
}

const pvList = (list: PromiseView[]): Child => (list.length ? list.map((p) => h('div', { class: 'rl-pv' }, p.short)) : h('span', { class: 'dim small' }, t('rel.none')));

export function renderRelations(s: GameState, rerender: () => void): Child[] {
  const seg = (label: string, on: boolean, fn: () => void) => h('button', { class: `rl-seg${on ? ' on' : ''}`, type: 'button', 'aria-pressed': String(on), onclick: () => { Sound.se('page'); fn(); rerender(); } }, label);
  const controls = h('div', { class: 'rl-controls' },
    h('div', { class: 'rl-group' }, seg(t('rel.side.mine'), view.side === 'mine', () => (view.side = 'mine')), seg(t('rel.side.others'), view.side === 'others', () => (view.side = 'others'))),
    view.side === 'mine' ? [
      h('div', { class: 'rl-group' }, h('small', { class: 'dim' }, t('rel.sort')), seg(t('rel.sort.name'), view.sort === 'name', () => (view.sort = 'name')), seg(t('rel.sort.step'), view.sort === 'step', () => (view.sort = 'step'))),
      h('div', { class: 'rl-group' }, h('small', { class: 'dim' }, t('rel.filter')), seg(t('rel.filter.coop'), !!view.filter.coop, () => (view.filter.coop = !view.filter.coop)), seg(t('rel.filter.promise'), !!view.filter.promise, () => (view.filter.promise = !view.filter.promise))),
    ] : null);
  if (view.side === 'others') return [controls, ...renderOthers(s)];
  const rows = relationRows(s, view.sort, view.filter);
  const head = h('div', { class: 'rl-row rl-head', role: 'row' }, h('span', null, t('rel.col.person')), h('span', null, t('rel.col.step')), h('span', null, t('rel.col.coop')), h('span', null, t('rel.col.promise')), h('span', null, t('rel.col.house')));
  const list = rows.map((r) => h('button', { class: `rl-row${r.alive ? '' : ' rl-out'}`, type: 'button', onclick: () => { Sound.se('page'); openRelationDetail(s, r.id); } },
    h('span', { class: 'rl-who' }, face(r.id), h('b', null, r.name)),
    stepGauge(r.step),
    h('span', { class: 'rl-cell' }, pvList(r.coop)),
    h('span', { class: 'rl-cell' }, pvList(r.promises)),
    h('span', { class: 'rl-cell' }, houseTag(r))));
  return [
    h('div', { class: 'dim small rl-note' }, t('rel.note')),
    controls,
    h('div', { class: 'rl-table', role: 'table' }, head, ...(list.length ? list : [h('div', { class: 'dim rl-empty' }, t('rel.empty'))])),
  ];
}

const SOURCE_CLS: Record<OtherRelation['source'], string> = { sight: 'fact', self: 'self', rumor: 'rumor', public: 'pub' };

function otherLine(s: GameState, o: OtherRelation): HTMLElement {
  const src = o.source === 'rumor' && o.teller ? t('rel.src.rumorFrom', { name: shortName(s, o.teller) }) : o.source === 'self' && o.teller ? t('rel.src.selfFrom', { name: shortName(s, o.teller) }) : t(`rel.src.${o.source}`);
  return h('div', { class: 'entry rl-other' },
    h('span', { class: 'rl-pair' }, face(o.pair[0], 'sm'), face(o.pair[1], 'sm')),
    h('div', { class: 'col grow', style: 'gap:2px' },
      h('div', null, h('span', { class: `tag ${SOURCE_CLS[o.source]}` }, src), h('span', { class: 'tag pub' }, t(`rel.sure.${o.sure}`)), h('span', { class: 'dim small' }, `DAY${o.day}`)),
      h('div', { class: 'small' }, o.info.text)));
}

function renderOthers(s: GameState): Child[] {
  const list = otherRelations(s);
  return [h('div', { class: 'dim small rl-note' }, t('rel.othersNote')), ...(list.length ? list.map((o) => otherLine(s, o)) : [h('div', { class: 'dim rl-empty' }, t('rel.othersNone'))])];
}

/** pledge（v0.29.0 の協力の約束）は、まだ describeDeal に無い版でも読める文にする */
function dealText(s: GameState, d: Deal): string {
  if ((d.kind as string) === 'pledge') return t('rel.pledgeText', { name: shortName(s, d.from === 'hero' ? d.to : d.from), day: d.untilDay });
  return describeDeal(s, d);
}

function detailBody(s: GameState, id: NpcId): HTMLElement {
  const r = relationRows(s).find((x) => x.id === id) as RelationRow;
  const def = NPC_BY_ID[id];
  const prof = profileLine(s, id);
  const deals = dealsWith(s, id);
  const dealRows = deals.map((d) => {
    const st = heroStatus(s, d);
    return h('div', { class: 'entry' }, h('span', { class: `tag ${st === 'active' ? 'fact' : ''}` }, t(`deal.status.${st}`)), h('span', { class: 'dim small' }, `DAY${d.day}　`), dealText(s, d));
  });
  const rescue = rescueWith(s, id).map((p) => h('div', { class: 'entry' }, h('span', { class: 'tag fact' }, t('deal.status.active')), p.short));
  const others = otherRelations(s, id);
  return h('div', { class: 'col rl-detail', style: 'gap:10px' },
    h('div', { class: 'row', style: 'gap:16px;align-items:center' }, face(id, 'lg'),
      h('div', { class: 'col grow', style: 'gap:4px' },
        h('div', null, h('b', { class: 'gold', style: 'font-size:1.15em' }, r.name), '　', h('span', { class: 'dim small' }, prof ?? t('people.unmet')), '　', houseTag(r)),
        prof ? h('div', { class: 'small' }, def.profile) : null)),
    h('div', { class: 'note-box' }, h('div', { class: 'row', style: 'gap:12px;align-items:center' }, h('b', null, t('rel.col.step')), stepGauge(r.step)), h('div', { class: 'small dim', style: 'margin-top:4px' }, t('rel.stepNote'))),
    abilityBlock(s, id),
    h('h4', { class: 'gold' }, t('rel.detail.coop')),
    r.coop.length ? r.coop.map((p) => h('div', { class: 'entry' }, h('span', { class: 'tag fact' }, t('deal.status.active')), dealText(s, p.deal!))) : h('div', { class: 'dim small' }, t('rel.none')),
    h('h4', { class: 'gold' }, t('rel.detail.deals')),
    h('div', { class: 'small dim' }, t('rel.promiseNote')),
    ...(dealRows.length || rescue.length ? [...rescue, ...dealRows] : [h('div', { class: 'dim small' }, t('deals.none'))]),
    h('h4', { class: 'gold' }, t('rel.detail.others')),
    ...(others.length ? others.map((o) => otherLine(s, o)) : [h('div', { class: 'dim small' }, t('rel.othersNone'))]));
}

export function openRelationDetail(s: GameState, id: NpcId): void {
  let layer: Layer;
  const done = () => closeLayer(layer);
  const el = h('div', { class: 'overlay' }, panel(t('rel.detail.title'), h('div', { class: 'scroll rl-detail-scroll' }, detailBody(s, id)), { wide: true, cls: 'rl-dialog', footer: button(t('common.close'), done, { kind: 'primary', autofocus: true }) }));
  layer = openLayer(el, { onCancel: done, pausesClock: true, name: 'relation' });
}
