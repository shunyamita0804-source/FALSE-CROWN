/** P06 一筆の迷宮の画面。盤面を中央に大きく置き、指でなぞって線を引く。終点に着いた瞬間に提出する。 */
import { Sound } from '../../audio/audio';
import { transfer } from '../../core/state';
import type { CharId, NpcId } from '../../data/characters';
import { t } from '../../i18n/i18n';
import { AID_COST, CHECK_MAX, CHECK_PTS, DONE_PTS, STAGE_MS, TIME_PTS, hintFor, type P06Move, type P06Result, type P06View } from '../../matches/p06';
import { face } from '../art';
import { button, confirmDialog, h, type Child } from '../dom';
import type { MatchUi } from '../matchui';
import { PathBoard } from '../pathboard';

interface Local { board?: PathBoard; sent?: boolean }

function table(v: P06View, ui: MatchUi): HTMLElement {
  const order = [...v.players].sort((a, b) => v.totals[b] - v.totals[a]);
  const n = v.results[v.players[0]].length;
  return h('div', { class: 'p01-table' }, order.map((p, i) => {
    const last: P06Result | undefined = v.results[p][n - 1];
    return h('div', { class: `p01-row${p === v.self ? ' me' : ''}${i === order.length - 1 ? ' last' : ''}` },
      h('span', { class: 'no' }, String(i + 1)), face(p), h('span', { class: 'nm' }, ui.name(p)),
      last ? h('span', { class: `p01-ans ${last.done ? 'ok' : ''}` }, last.done ? t('p06.doneSec', { s: Math.round(last.ms / 1000) }) : t('p06.checksN', { n: last.checks })) : null, h('b', { class: 'tot' }, String(v.totals[p])));
  }));
}

export function renderP06(v: P06View, ui: MatchUi): { main: Child; side: Child } {
  const me = v.self as CharId;
  const L = ui.local as Local;
  const watching = v.self === 'spectator';
  const rank = h('div', { class: 'box scroll grow' }, h('h4', null, t('m01.rank')), table(v, ui), h('div', { class: 'small dim', style: 'margin-top:6px' }, t('p01.lastNote')));
  const n = v.results[v.players[0]].length;
  const mine: P06Result | undefined = !watching ? v.results[me]?.[n - 1] : undefined;

  if (v.phase !== 'solve' || watching || v.submitted) {
    const review = v.lastMaze && mine && !v.submitted ? new PathBoard(v.lastMaze, { readonly: true, path: mine.path, cell: Math.floor(250 / v.lastMaze.size) }).el : null;
    const main = h('div', { class: 'm02-break p06-break' },
      h('div', { class: 'm01-big' }, v.phase === 'done' ? t('p01.finished') : v.submitted ? t('p06.sent') : v.phase === 'break' ? t('p06.breakTitle', { n: v.stageNo + 1 }) : t('m03.watching')),
      mine && !v.submitted ? h('div', { class: 'row', style: 'gap:18px;align-items:center' }, review, h('div', { class: 'col', style: 'gap:6px' },
        h('div', null, t('p06.lastTitle', { n })), h('b', { class: 'gold', style: 'font-size:1.3em' }, mine.done ? t('p06.lastDone', { s: Math.round(mine.ms / 1000), p: mine.points }) : t('p06.lastPart', { n: mine.checks, p: mine.points })))) : null,
      v.phase === 'break' && !watching ? h('div', { class: 'row mq-talk', style: 'gap:8px;justify-content:center' }, h('span', { class: 'small dim' }, t('mq.talk')), v.players.filter((p) => p !== me).map((p) => button([face(p), ui.name(p)], () => ui.talk(p as NpcId), { small: true }))) : null,
      v.phase === 'break' && !watching && !v.ready[me] ? button(t('p06.nextStage', { n: v.stageNo + 1 }), () => ui.submit({ t: 'ready' } satisfies P06Move), { kind: 'primary', autofocus: true }) : null);
    return { main, side: [rank] };
  }

  if (!L.board) {
    const send = (path: number[], ms: number) => {
      if (L.sent) return;
      L.sent = true;
      ui.timeoutMove = undefined;
      ui.submit({ t: 'solve', path, ms } satisfies P06Move);
    };
    const board = new PathBoard(v.maze, {
      cell: Math.floor(Math.min(92, 486 / v.maze.size)),
      onChange: () => ui.rerender(),
      onComplete: (path) => {
        const ms = Math.min(STAGE_MS, Math.max(1, ui.elapsed()));
        Sound.se('result');
        // 完成の表示を一瞬見せてから提出する
        setTimeout(() => send(path, ms), 550);
      },
    });
    L.board = board;
    ui.timeoutMove = () => ({ t: 'solve', path: [...board.path], ms: STAGE_MS } satisfies P06Move);
  }
  const board = L.board;
  const hero = ui.state.actors.hero;
  const passed = board.checks;
  const total = v.maze.checks.length;
  const aid = button(t('p06.aid', { n: AID_COST }), async () => {
    if (!(await confirmDialog(t('p06.aidTitle'), t('p06.aidText', { n: AID_COST, have: hero.pieces }), { ok: t('m01.hintOk', { n: AID_COST }), cancel: t('common.cancel'), pauses: false }))) return;
    if (v.aidUsed || board.complete || hero.pieces < AID_COST || !ui.engine.validate(ui.slot.state, 'hero', { t: 'aid' }) || !transfer(ui.state, 'hero', 'host', AID_COST, 'P06 補助')) return;
    Sound.se('coins');
    board.setHint(hintFor(v.maze, board.path));
    ui.submit({ t: 'aid' } satisfies P06Move);
  }, { small: true, disabled: v.aidUsed || hero.pieces < AID_COST || board.complete, title: t('p06.aidOnce') });
  const tools = h('div', { class: 'p06-tools' },
    h('div', { class: 'p06-prog' }, h('small', { class: 'dim' }, t('p06.checks')), h('b', null, `${passed} / ${total}`)),
    button(t('p06.undo'), () => board.undo(), { small: true, disabled: board.path.length <= 1 || board.complete }),
    button(t('p06.reset'), () => board.reset(), { small: true, kind: 'ghost', disabled: board.path.length <= 1 || board.complete }),
    aid,
    h('div', { class: 'small dim' }, v.aidUsed ? t('m01.hintUsed') : t('p06.aidOnce')));
  const side = [
    h('div', { class: 'box' }, h('h4', null, t('p06.scoreTitle')), h('div', { class: 'small' }, t('p06.scoreNote', { d: DONE_PTS, tp: TIME_PTS, c: CHECK_PTS, m: CHECK_MAX }))),
    rank,
  ];
  return { main: [h('div', { class: 'p06-play' }, tools, board.el)], side };
}
