/** P09 鏡の決闘の画面。中央に盤面、左に札の道具、右に提出ボタンと得点を置く。 */
import { Sound } from '../../audio/audio';
import { transfer } from '../../core/state';
import type { CharId, NpcId } from '../../data/characters';
import { t } from '../../i18n/i18n';
import { AID_COST, OK_PTS, PART_PTS, ROUND_MS, TIME_PTS, hintFor, type P09Move, type P09Result, type P09View } from '../../matches/p09';
import { face } from '../art';
import { button, confirmDialog, h, type Child } from '../dom';
import type { MatchUi } from '../matchui';
import { MirrorBoard, tileEl, type MirrorTool } from '../mirrorboard';

interface Local { board?: MirrorBoard; sent?: boolean }

function table(v: P09View, ui: MatchUi): HTMLElement {
  const order = [...v.players].sort((a, b) => v.totals[b] - v.totals[a]);
  const n = v.results[v.players[0]].length;
  return h('div', { class: 'p01-table' }, order.map((p, i) => {
    const last: P09Result | undefined = v.results[p][n - 1];
    return h('div', { class: `p01-row${p === v.self ? ' me' : ''}${i === order.length - 1 ? ' last' : ''}` },
      h('span', { class: 'no' }, String(i + 1)), face(p), h('span', { class: 'nm' }, ui.name(p)),
      last ? h('span', { class: `p01-ans ${last.perfect ? 'ok' : ''}` }, last.perfect ? t('p06.doneSec', { s: Math.round(last.ms / 1000) }) : t('p09.partN', { n: last.correct, m: last.total })) : null, h('b', { class: 'tot' }, String(v.totals[p])));
  }));
}

/** 札の道具（四角、矢印、消しゴム） */
export function toolBar(board: MirrorBoard, arrows: boolean): HTMLElement {
  const item = (tool: MirrorTool, icon: Child, label: string) => h('button', { class: `mb-tool${board.tool === tool ? ' on' : ''}`, type: 'button', 'data-tool': tool, onclick: () => board.setTool(tool) }, icon, h('small', null, label));
  return h('div', { class: 'mb-tools' },
    item('b', tileEl('b'), t('p09.toolBlock')),
    arrows ? item('a', tileEl('u'), t('p09.toolArrow')) : null,
    item('x', h('span', { class: 'mb-erase' }, '✕'), t('p09.toolErase')));
}

export function renderP09(v: P09View, ui: MatchUi): { main: Child; side: Child } {
  const me = v.self as CharId;
  const L = ui.local as Local;
  const watching = v.self === 'spectator';
  const rank = h('div', { class: 'box scroll grow' }, h('h4', null, t('m01.rank')), table(v, ui), h('div', { class: 'small dim', style: 'margin-top:6px' }, t('p01.lastNote')));
  const n = v.results[v.players[0]].length;
  const mine: P09Result | undefined = !watching ? v.results[me]?.[n - 1] : undefined;

  if (v.phase !== 'solve' || watching || v.submitted) {
    const review = v.lastMirror && mine && !v.submitted ? new MirrorBoard(v.lastMirror, { readonly: true, grid: mine.grid, marked: true, cell: Math.floor(300 / v.lastMirror.n) }).el : null;
    const main = h('div', { class: 'm02-break p09-break' },
      h('div', { class: 'm01-big' }, v.phase === 'done' ? t('p01.finished') : v.submitted ? t('p06.sent') : v.phase === 'break' ? t('p08.breakTitle', { n: v.round + 1 }) : t('m03.watching')),
      mine && !v.submitted ? h('div', { class: 'row', style: 'gap:22px;align-items:center' }, review, h('div', { class: 'col', style: 'gap:6px' },
        h('div', null, t('p08.lastTitle', { n })), h('b', { class: mine.perfect ? 'gold' : '', style: 'font-size:1.3em' }, mine.perfect ? t('p08.lastOk', { s: Math.round(mine.ms / 1000), p: mine.points }) : t('p09.lastPart', { n: mine.correct, m: mine.total, x: mine.extra, p: mine.points })),
        mine.perfect ? null : h('div', { class: 'small dim' }, t('p09.reviewNote')))) : null,
      v.phase === 'break' && !watching ? h('div', { class: 'row mq-talk', style: 'gap:8px;justify-content:center' }, h('span', { class: 'small dim' }, t('mq.talk')), v.players.filter((p) => p !== me).map((p) => button([face(p), ui.name(p)], () => ui.talk(p as NpcId), { small: true }))) : null,
      v.phase === 'break' && !watching && !v.ready[me] ? button(t('p01.next', { n: v.round + 1 }), () => ui.submit({ t: 'ready' } satisfies P09Move), { kind: 'primary', autofocus: true }) : null);
    return { main, side: [rank] };
  }

  if (!L.board) {
    const board = new MirrorBoard(v.mirror, { cell: Math.floor(Math.min(104, 546 / v.mirror.n)), onChange: () => ui.rerender() });
    L.board = board;
    ui.timeoutMove = () => ({ t: 'answer', grid: { ...board.grid }, ms: ROUND_MS } satisfies P09Move);
  }
  const board = L.board;
  const hero = ui.state.actors.hero;
  const arrows = Object.values(v.mirror.src).some((x) => x !== 'b');
  const total = Object.keys(v.mirror.src).length;
  const send = () => {
    if (L.sent || board.count === 0) return;
    L.sent = true;
    ui.timeoutMove = undefined;
    Sound.se('result');
    ui.submit({ t: 'answer', grid: { ...board.grid }, ms: Math.min(ROUND_MS, Math.max(1, ui.elapsed())) } satisfies P09Move);
  };
  const aid = button(t('p09.aid', { n: AID_COST }), async () => {
    if (!(await confirmDialog(t('p09.aidTitle'), t('p09.aidText', { n: AID_COST, have: hero.pieces }), { ok: t('m01.hintOk', { n: AID_COST }), cancel: t('common.cancel'), pauses: false }))) return;
    const hint = hintFor(v.mirror, board.grid);
    if (v.aidUsed || L.sent || !hint || hero.pieces < AID_COST || !ui.engine.validate(ui.slot.state, 'hero', { t: 'aid' }) || !transfer(ui.state, 'hero', 'host', AID_COST, 'P09 補助')) return;
    Sound.se('coins');
    board.setHint(hint);
    ui.submit({ t: 'aid' } satisfies P09Move);
  }, { small: true, disabled: v.aidUsed || hero.pieces < AID_COST, title: t('p09.aidOnce') });
  const left = h('div', { class: 'mb-left' },
    h('h4', null, t('p09.toolTitle')), toolBar(board, arrows),
    h('div', { class: 'small dim' }, t(board.tool === 'a' ? 'p09.howArrow' : board.tool === 'x' ? 'p09.howErase' : 'p09.howBlock')));
  const right = h('div', { class: 'mb-right' },
    h('div', { class: 'p06-prog' }, h('small', { class: 'dim' }, t('p09.placed')), h('b', null, `${board.count} / ${total}`)),
    button(t('p08.submit'), send, { kind: 'primary', disabled: board.count === 0 }),
    button(t('p06.reset'), () => board.reset(), { small: true, kind: 'ghost', disabled: board.count === 0 }),
    aid,
    h('div', { class: 'small dim' }, v.aidUsed ? t('m01.hintUsed') : t('p09.aidOnce')));
  const side = [
    h('div', { class: 'box' }, h('h4', null, t('p06.scoreTitle')), h('div', { class: 'small' }, t('p09.scoreNote', { d: OK_PTS, tp: TIME_PTS, pp: PART_PTS }))),
    rank,
  ];
  return { main: [h('div', { class: 'p09-play' }, left, board.el, right)], side };
}
