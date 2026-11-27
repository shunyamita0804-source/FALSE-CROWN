/** P08 数字の天秤の画面。中央に天秤とタイル、右に条件の一覧（満たすと印が付く）と提出ボタンを置く。 */
import { Sound } from '../../audio/audio';
import type { CharId, NpcId } from '../../data/characters';
import { t } from '../../i18n/i18n';
import { OK_PTS, ROUND_MS, TIME_PTS, type Judge, type P08Move, type P08Result, type P08View, type Scale } from '../../matches/p08';
import { face } from '../art';
import { button, h, type Child } from '../dom';
import type { MatchUi } from '../matchui';
import { ScaleBoard } from '../scaleboard';

interface Local { board?: ScaleBoard; sent?: boolean }

function table(v: P08View, ui: MatchUi): HTMLElement {
  const order = [...v.players].sort((a, b) => v.totals[b] - v.totals[a]);
  const n = v.results[v.players[0]].length;
  return h('div', { class: 'p01-table' }, order.map((p, i) => {
    const last: P08Result | undefined = v.results[p][n - 1];
    return h('div', { class: `p01-row${p === v.self ? ' me' : ''}${i === order.length - 1 ? ' last' : ''}` },
      h('span', { class: 'no' }, String(i + 1)), face(p), h('span', { class: 'nm' }, ui.name(p)),
      last ? h('span', { class: `p01-ans ${last.ok ? 'ok' : ''}` }, last.ok ? t('p06.doneSec', { s: Math.round(last.ms / 1000) }) : t('p01.miss')) : null, h('b', { class: 'tot' }, String(v.totals[p])));
  }));
}

/** 条件の一覧。j を渡すと、満たしているかどうかの印を付ける */
export function condList(sc: Scale, j?: Judge, place?: number[]): HTMLElement {
  const row = (ok: boolean | undefined, text: string) => h('div', { class: `sb-cond${ok === undefined ? '' : ok ? ' ok' : ' ng'}` }, h('i', null, ok === undefined ? '・' : ok ? '✓' : '　'), h('span', null, text));
  const rows = [row(j?.balanced, t('p08.cBalance')), row(j ? j.panOk : undefined, t('p08.cPan'))];
  if (sc.minUse >= sc.tiles.length) rows.push(row(j?.useOk, t('p08.cAll')));
  else if (sc.minUse > 1) rows.push(row(j?.useOk, t('p08.cUse', { n: sc.minUse })));
  for (const i of sc.mustL) rows.push(row(place ? place[i] === 1 : undefined, t('p08.cLeft', { n: sc.tiles[i] })));
  for (const i of sc.mustR) rows.push(row(place ? place[i] === 2 : undefined, t('p08.cRight', { n: sc.tiles[i] })));
  return h('div', { class: 'sb-conds' }, rows);
}

export function renderP08(v: P08View, ui: MatchUi): { main: Child; side: Child } {
  const me = v.self as CharId;
  const L = ui.local as Local;
  const watching = v.self === 'spectator';
  const rank = h('div', { class: 'box scroll grow' }, h('h4', null, t('m01.rank')), table(v, ui), h('div', { class: 'small dim', style: 'margin-top:6px' }, t('p01.lastNote')));
  const n = v.results[v.players[0]].length;
  const mine: P08Result | undefined = !watching ? v.results[me]?.[n - 1] : undefined;

  if (v.phase !== 'solve' || watching || v.submitted) {
    // 振り返り：自分の答え（不正解の時は正解の一例）
    const show = v.lastScale && mine && !v.submitted ? new ScaleBoard(v.lastScale, { readonly: true, place: mine.ok ? mine.place : v.lastExample ?? mine.place, scale: 0.6 }).el : null;
    const main = h('div', { class: 'm02-break p08-break' },
      h('div', { class: 'm01-big' }, v.phase === 'done' ? t('p01.finished') : v.submitted ? t('p06.sent') : v.phase === 'break' ? t('p08.breakTitle', { n: v.round + 1 }) : t('m03.watching')),
      mine && !v.submitted ? h('div', { class: 'row', style: 'gap:18px;align-items:center' }, show, h('div', { class: 'col', style: 'gap:6px' },
        h('div', null, t('p08.lastTitle', { n })), h('b', { class: mine.ok ? 'gold' : '', style: 'font-size:1.3em' }, mine.ok ? t('p08.lastOk', { s: Math.round(mine.ms / 1000), p: mine.points }) : t('p08.lastNg')),
        mine.ok ? null : h('div', { class: 'small dim' }, t('p08.exampleNote')))) : null,
      v.phase === 'break' && !watching ? h('div', { class: 'row mq-talk', style: 'gap:8px;justify-content:center' }, h('span', { class: 'small dim' }, t('mq.talk')), v.players.filter((p) => p !== me).map((p) => button([face(p), ui.name(p)], () => ui.talk(p as NpcId), { small: true }))) : null,
      v.phase === 'break' && !watching && !v.ready[me] ? button(t('p01.next', { n: v.round + 1 }), () => ui.submit({ t: 'ready' } satisfies P08Move), { kind: 'primary', autofocus: true }) : null);
    return { main, side: [rank] };
  }

  if (!L.board) {
    const board = new ScaleBoard(v.scale, { onChange: () => ui.rerender() });
    L.board = board;
    ui.timeoutMove = () => ({ t: 'answer', place: [...board.place], ms: ROUND_MS } satisfies P08Move);
  }
  const board = L.board;
  const j = board.judge();
  const send = () => {
    if (L.sent || !board.judge().ok) return;
    L.sent = true;
    ui.timeoutMove = undefined;
    Sound.se('result');
    ui.submit({ t: 'answer', place: [...board.place], ms: Math.min(ROUND_MS, Math.max(1, ui.elapsed())) } satisfies P08Move);
  };
  const panel = h('div', { class: 'sb-panel' },
    h('h4', null, t('p08.condTitle')), condList(v.scale, j, board.place),
    h('div', { class: 'small dim' }, j.ok ? t('p08.readyNote') : t('p08.howNote')),
    h('div', { class: 'row', style: 'gap:10px' },
      button(t('p08.submit'), send, { kind: 'primary', disabled: !j.ok }),
      button(t('p06.reset'), () => board.reset(), { small: true, kind: 'ghost', disabled: j.used === 0 })));
  const side = [
    h('div', { class: 'box' }, h('h4', null, t('p06.scoreTitle')), h('div', { class: 'small' }, t('p08.scoreNote', { d: OK_PTS, tp: TIME_PTS }))),
    rank,
  ];
  return { main: [h('div', { class: 'p08-play' }, board.el, panel)], side };
}
