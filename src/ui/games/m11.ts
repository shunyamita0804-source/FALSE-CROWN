/**
 * M11 最後の王座の画面。進行中の種目は、元の競技の画面をそのまま使う（補助を買うボタン、組の表示、会話のボタンは隠す）。
 * 横に、5 種目の勝敗と今の勝ち数をいつも出す。種目の間は、結果の一覧と「次の種目へ」を出す。
 */
import type { CharId } from '../../data/characters';
import { t } from '../../i18n/i18n';
import { EVENTS, NEED, type M11Move, type M11State, type M11View } from '../../matches/m11';
import type { MatchEngine } from '../../matches/types';
import { face } from '../art';
import { button, h, type Child } from '../dom';
import type { MatchUi, Renderer } from '../matchui';
import { renderDuel } from './duel';
import { renderM01 } from './m01';
import { renderM05 } from './m05';
import { renderM07 } from './m07';
import { renderP02 } from './p02';

const SUB: Record<string, Renderer> = { m01: renderM01 as Renderer, p02: renderP02 as Renderer, m05: renderM05 as Renderer, m07: renderM07 as Renderer, duel: renderDuel as Renderer };
const PROXY = new WeakMap<MatchUi, { sub: object; ui: MatchUi }>();

/** 元の競技の画面に渡す文脈。競技の状態とエンジンを差し替え、手持ちのピースは 0 として見せる（補助を買えない） */
function subUi(ui: MatchUi, engine: MatchEngine, sub: object): MatchUi {
  const hit = PROXY.get(ui);
  if (hit && hit.sub === sub) return hit.ui;
  const slot = Object.create(ui.slot, { state: { value: sub, enumerable: true } }) as MatchUi['slot'];
  const p = Object.create(ui, {
    slot: { value: slot },
    engine: { value: engine },
    state: { get: () => ({ ...ui.state, actors: { ...ui.state.actors, hero: { ...ui.state.actors.hero, pieces: 0 } } }) },
    local: { get: () => ui.local, set: (x: Record<string, unknown>) => { ui.local = x; } },
    timeoutMove: { get: () => ui.timeoutMove, set: (f: (() => unknown) | undefined) => { ui.timeoutMove = f; } },
    finished: { get: () => ui.finished },
    inbox: { get: () => ui.inbox, set: (x: MatchUi['inbox']) => { ui.inbox = x; } },
  }) as MatchUi;
  PROXY.set(ui, { sub, ui: p });
  return p;
}

/** 5 種目の勝敗の一覧 */
function board(v: M11View, ui: MatchUi, big = false): HTMLElement {
  const [a, b] = v.players;
  return h('div', { class: `m11-board${big ? ' big' : ''}` },
    h('div', { class: 'm11-vs' }, h('span', { class: 'pl' }, face(a), h('b', null, ui.name(a))), h('b', { class: 'sc', 'data-wins': v.wins.join('-') }, `${v.wins[0]} － ${v.wins[1]}`), h('span', { class: 'pl' }, h('b', null, ui.name(b)), face(b))),
    h('div', { class: 'm11-events' }, EVENTS.map((e, i) => {
      const r = [...v.results].reverse().find((x) => x.event === i && x.winner >= 0);
      const now = v.phase === 'play' && v.event === i;
      return h('div', { class: `m11-ev${r ? ' done' : ''}${now ? ' now' : ''}` }, h('span', { class: 'no' }, String(i + 1)), h('span', { class: 'nm' }, e.name),
        h('span', { class: 'wn' }, r ? [face(v.players[r.winner]), big ? h('small', null, `${r.scores[0]} － ${r.scores[1]}`) : null] : now ? t('m11.now') : ''));
    })),
    h('div', { class: 'small dim' }, t('m11.need', { n: NEED })));
}

export function renderM11(v: M11View, ui: MatchUi): { main: Child; side: Child } {
  const me = v.self as CharId;
  const watching = v.self === 'spectator';
  if (v.phase !== 'play' || !v.sub) {
    const last = v.results[v.results.length - 1];
    const ev = last ? EVENTS[last.event] : EVENTS[0];
    const champ = v.phase === 'done' ? v.players[v.wins[0] > v.wins[1] ? 0 : 1] : null;
    const title = champ ? t('m11.champion', { name: ui.name(champ) }) : !last ? '' : last.winner >= 0 ? t('m11.eventWon', { n: last.event + 1, ev: ev.name, name: ui.name(v.players[last.winner]) }) : t('m11.eventTie', { n: last.event + 1, ev: ev.name });
    const nextNo = last && last.winner >= 0 ? last.event + 1 : last ? last.event : 0;
    const main = h('div', { class: 'm02-break m11-between' },
      h('div', { class: 'm01-big' }, title),
      last ? h('div', { class: 'small dim' }, t('m11.lastScore', { ev: ev.name, a: last.scores[0], b: last.scores[1], na: ui.name(v.players[0]), nb: ui.name(v.players[1]) })) : null,
      board(v, ui, true),
      v.phase === 'between' && !watching && !v.ready[me]
        ? button(last && last.winner < 0 ? t('m11.rematch', { ev: ev.name }) : t('m11.next', { n: nextNo + 1, ev: EVENTS[Math.min(nextNo, EVENTS.length - 1)].name }), () => ui.submit({ t: 'ready' } satisfies M11Move), { kind: 'primary', autofocus: true }) : null);
    return { main, side: null };
  }
  const e = EVENTS[v.event];
  const st = ui.slot.state as M11State;
  const out = SUB[e.id](v.sub as never, subUi(ui, e.engine, st.sub as object));
  return {
    main: h('div', { class: 'm11-sub' }, out.main),
    side: [h('div', { class: 'box m11-box' }, h('h4', null, t('m11.title', { n: v.event + 1, ev: e.name }), v.rematch ? h('small', { class: 'gold' }, ` ${t('m11.rematchTag')}`) : null), board(v, ui)), h('div', { class: 'm11-sub' }, out.side ?? null)],
  };
}
