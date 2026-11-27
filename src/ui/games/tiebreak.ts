import { Sound } from '../../audio/audio';
import type { CharId } from '../../data/characters';
import { t } from '../../i18n/i18n';
import type { TbMove, TbView } from '../../matches/tiebreak';
import { face } from '../art';
import { button, h, type Child } from '../dom';
import type { MatchUi } from '../matchui';

export function renderTiebreak(v: TbView, ui: MatchUi): { main: Child; side: Child } {
  const me = v.self as CharId;
  const results = v.results.map((r, i) => h('div', { class: 'box' }, h('h4', null, t('tb.q', { n: i + 1 })), h('div', { class: 'small' }, r.puzzle.text),
    h('div', { class: 'small gold' }, t('tb.answer', { a: r.puzzle.choices[r.puzzle.answer], why: r.puzzle.why })),
    h('div', { class: 'small' }, v.players.map((p) => `${ui.name(p)} ${r.answers[p].choice === r.puzzle.answer ? '○' : '×'} ${(r.answers[p].time / 1000).toFixed(1)}${t('tb.sec')}`).join('　'))));
  let q: Child = null;
  if (v.puzzle && !v.answered) {
    q = h('div', { class: 'box col', style: 'gap:12px' }, h('h4', null, t('tb.q', { n: v.q + 1 })), h('div', { class: 'text', style: 'font-size:1.15em' }, v.puzzle.text),
      h('div', { class: 'act-grid' }, v.puzzle.choices.map((c, i) => button(c, () => {
        Sound.se('confirm');
        ui.submit({ t: 'answer', choice: i, time: ui.elapsed() } satisfies TbMove);
      }, { kind: 'secondary' }))),
      h('div', { class: 'dim small' }, t('tb.note')));
  } else if (v.stage === 'done') q = h('div', { class: 'box' }, t('tb.finished'));
  const side = h('div', { class: 'box' }, h('h4', null, t('tb.players')), h('div', { class: 'plist' }, v.players.map((p) => h('div', { class: `prow${p === me ? ' me' : ''}` }, face(p), h('span', { class: 'nm' }, ui.name(p))))));
  return { main: [h('div', { class: 'box' }, t('tb.lead')), q, ...results.reverse()], side };
}
