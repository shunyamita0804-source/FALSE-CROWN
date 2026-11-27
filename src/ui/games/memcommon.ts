/** 記憶の競技（M02、P02）の画面で共用する部品：順位表、直前のラウンドの振り返り、表示延長の購入。 */
import { Sound } from '../../audio/audio';
import { transfer } from '../../core/state';
import type { CharId, NpcId } from '../../data/characters';
import { FLAG_BY_ID } from '../../data/flags';
import { t } from '../../i18n/i18n';
import { answerOf, type MemSet } from '../../matches/memory';
import { face } from '../art';
import { button, confirmDialog, h, type Child } from '../dom';
import type { MatchUi } from '../matchui';
import { boardFigure, itemEl } from '../memquiz';

export interface RoundResult { correct: number; points: number; ok: boolean[]; picks: number[] }

/** 順位表（合計点の高い順）。直前のラウンドの正解数も添える */
export function memTable(players: CharId[], totals: Record<string, number>, last: Record<string, RoundResult> | null, questions: number, me: CharId | 'spectator', ui: MatchUi, opts: { markLast?: boolean; setter?: CharId } = {}): HTMLElement {
  const order = [...players].sort((a, b) => totals[b] - totals[a]);
  return h('div', { class: 'p01-table' }, order.map((p, i) => h('div', { class: `p01-row${p === me ? ' me' : ''}${opts.markLast && i === order.length - 1 ? ' last' : ''}` },
    h('span', { class: 'no' }, String(i + 1)), face(p), h('span', { class: 'nm' }, ui.name(p), opts.setter === p ? h('small', { class: 'gold' }, ` ${t('mq.setterMark')}`) : null),
    last?.[p] ? h('span', { class: `p01-ans ${last[p].correct === questions ? 'ok' : ''}` }, `${last[p].correct}/${questions}`) : null, h('b', { class: 'tot' }, String(totals[p])))));
}

/** 直前のラウンドの振り返り：盤面を開いて見せ、各問題の正誤を示す */
export function reviewEl(set: MemSet, mine: RoundResult | undefined, cell?: number): HTMLElement {
  const marks: Record<number, { cls: string; label?: string }> = {};
  const rows: Child[] = [];
  const flag = set.board.cells.some((c) => c != null && c in FLAG_BY_ID);
  set.questions.forEach((q, i) => {
    const ok = !!mine?.ok[i];
    const cls = mine ? (ok ? 'ok' : 'ng') : 'asked';
    const ans = answerOf(set.board, q);
    if (q.kind === 'place') marks[ans] = { cls, label: String(i + 1) };
    else if (q.kind === 'item') marks[q.cell] = { cls, label: String(i + 1) };
    else marks[set.board.cells.indexOf(q.options[ans])] = { cls, label: String(i + 1) };
    const pick = mine?.picks[i] ?? -1;
    const picked: Child = pick < 0 ? h('span', { class: 'dim' }, t('mq.noAnswer')) : q.kind === 'place' ? (ok ? null : h('span', { class: 'dim' }, t('mq.wrongCell'))) : ok ? null : itemEl(q.options[pick], 'tiny');
    rows.push(h('div', { class: `mq-rv-row ${cls}` }, h('b', { class: 'no' }, String(i + 1)), h('span', { class: 'kd' }, t(q.kind === 'item' && flag ? 'mq.kind.itemFlag' : `mq.kind.${q.kind}`)), h('b', { class: 'mk' }, mine ? (ok ? '○' : '✕') : ''), picked));
  });
  return h('div', { class: 'mq-review' }, boardFigure(set.board, { cell, marks }), h('div', { class: 'mq-rv-list' }, rows));
}

/** 表示時間の延長を買うボタン。主人公も CPU も同じ価格、同じ回数制限 */
export function boostButton(ui: MatchUi, v: { boostOn: boolean; boostUsed: number }, cost: number, max: number, reason: string): Child {
  const hero = ui.state.actors.hero;
  if (v.boostOn) return h('span', { class: 'gold' }, t('mq.boostOn'));
  const left = max - v.boostUsed;
  return button(t('mq.boost', { n: cost }), async () => {
    if (!(await confirmDialog(t('mq.boostTitle'), t('mq.boostText', { n: cost, have: hero.pieces, left }), { ok: t('mq.boostOk', { n: cost }), cancel: t('common.cancel'), pauses: true }))) return;
    if (!ui.engine.validate(ui.slot.state, 'hero', { t: 'boost' }) || hero.pieces < cost || !transfer(ui.state, 'hero', 'host', cost, reason)) return;
    Sound.se('coins');
    ui.submit({ t: 'boost' });
  }, { small: true, cls: 'fin-hide', disabled: left <= 0 || hero.pieces < cost, title: t('mq.boostLeft', { n: left }) });
}

export function talkRow(players: CharId[], me: CharId, ui: MatchUi): HTMLElement {
  return h('div', { class: 'row mq-talk', style: 'gap:8px;justify-content:center;flex-wrap:wrap' }, h('span', { class: 'small dim' }, t('mq.talk')), players.filter((p) => p !== me).map((p) => button(players.length > 7 ? [face(p)] : [face(p), ui.name(p)], () => ui.talk(p as NpcId), { small: true, title: ui.name(p) })));
}
