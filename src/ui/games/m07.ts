/**
 * M07 六角領域の画面。左に盤面、右に自分のタイルと操作を置く。
 * タイルをタップして選び、盤面のマスをタップ（またはなぞる）と置いた時の形が出る。回して、位置を決めてから「置く」で確定する。
 * CPU の手は一瞬で決まるので、自分の番が来る前に 1 人ずつ順に見せる。
 */
import { Sound } from '../../audio/audio';
import { transfer } from '../../core/state';
import type { CharId, NpcId } from '../../data/characters';
import { t } from '../../i18n/i18n';
import { AID_COST, CENTER_PTS, LINK_PTS, SHAPES, alternatives, areaCap, areaOf, placements, scoreOf, type M07Move, type M07View } from '../../matches/m07';
import { face } from '../art';
import { button, confirmDialog, h, type Child } from '../dom';
import { HEX_COLORS, shapeSvg } from '../hexboard';
import type { MatchUi } from '../matchui';
import { TilePlacer, type PlacerSel } from '../tileplacer';

interface Seen { n: number; timer?: ReturnType<typeof setTimeout>; sel: PlacerSel; alt?: boolean }
const SEEN = new WeakMap<object, Seen>();
const STEP_MS = 750;
const SIZE = 36;

export function renderM07(v: M07View, ui: MatchUi): { main: Child; side: Child } {
  const me = v.self as CharId;
  const watching = v.self === 'spectator';
  let S = SEEN.get(ui.slot);
  if (!S) {
    const mine = v.log.map((l) => l.seat).lastIndexOf(v.seat);
    S = { n: Math.max(0, mine + 1, v.log.length - v.players.length), sel: { rot: 0 } };
    SEEN.set(ui.slot, S);
  }
  const St = S;
  if (St.n > v.log.length) St.n = v.log.length;
  const replaying = St.n < v.log.length;
  if (replaying && !St.timer) {
    St.timer = setTimeout(() => {
      St.timer = undefined;
      St.n = Math.min(v.log.length, St.n + 1);
      Sound.se(v.log[St.n - 1]?.cells ? 'chip' : 'click');
      ui.rerender();
    }, v.log[St.n].cells ? STEP_MS : 380);
  }
  // 見せている時点の盤面
  const owner = [...v.owner];
  for (let i = St.n; i < v.log.length; i++) for (const c of v.log[i].cells ?? []) owner[c] = -1;
  const last = St.n > 0 ? v.log[St.n - 1] : undefined;
  const whoOf = (seat: number) => v.players[v.seats.indexOf(seat)];
  const turnOf = replaying ? whoOf(v.log[St.n].seat) : v.toMove;
  const round = replaying ? v.log[St.n].round : v.round;
  const cap = replaying ? areaCap(round) : v.cap;
  const scores = Object.fromEntries(v.players.map((p, i) => [p, scoreOf(owner, v.seats[i])]));

  const order = [...v.players].sort((a, b) => scores[b].points - scores[a].points);
  const table = h('div', { class: 'm01-rank hx7-rank' }, order.map((p) => {
    const sc = scores[p];
    const seat = v.seats[v.players.indexOf(p)];
    return h('div', { class: `m01-rankrow${p === me ? ' me' : ''}${turnOf === p ? ' now' : ''}` },
      h('i', { class: 'hx-sw', style: `background:${HEX_COLORS[seat]}` }), face(p), h('span', { class: 'nm' }, ui.name(p)),
      h('small', { class: 'dim' }, `${sc.cells}${sc.center ? `+${sc.center * CENTER_PTS}` : ''}${sc.link ? `+${LINK_PTS}` : ''}`), h('b', null, String(sc.points)));
  }));
  const side = [
    h('div', { class: 'box scroll grow' }, h('h4', null, t('m01.rank')), table, h('div', { class: 'small dim', style: 'margin-top:6px' }, t('m07.tableNote', { c: CENTER_PTS, l: LINK_PTS }))),
    h('div', { class: 'box' }, h('h4', null, t('m07.orderTitle')), h('div', { class: 'hx7-order' }, v.order.map((p) => h('span', { class: `hx7-ord${turnOf === p ? ' now' : ''}`, style: `--c:${HEX_COLORS[v.seats[v.players.indexOf(p)]]}`, title: ui.name(p) }, face(p))))),
  ];

  const myTurn = !replaying && !watching && v.phase === 'play' && v.toMove === me;
  const tiles = watching ? [] : v.tiles[me] ?? [];
  if (St.sel.shape && (!tiles.includes(St.sel.shape) || areaOf(St.sel.shape) > cap)) { St.sel.shape = undefined; St.sel.at = undefined; }
  if (!myTurn) { St.sel.at = undefined; St.alt = false; }

  const hero = ui.state.actors.hero;
  const foot = h('div', { class: 'hx7-foot' });
  const note = h('div', { class: 'small hx7-note' });
  const drawFoot = () => {
    foot.replaceChildren();
    if (!myTurn) return;
    const g = placer.ghost();
    const shape = St.sel.shape;
    if (St.alt && shape) {
      note.textContent = t('m07.altPick');
      for (const to of alternatives(shape)) {
        const b = h('button', { class: 'hx-tile alt', type: 'button', 'data-alt': to });
        b.innerHTML = shapeSvg(SHAPES[to], 0, HEX_COLORS[v.seat], 12);
        b.addEventListener('click', async () => {
          const tile = tiles.indexOf(shape);
          if (!(await confirmDialog(t('m07.aidTitle'), t('m07.aidText', { n: AID_COST, have: hero.pieces }), { ok: t('m01.hintOk', { n: AID_COST }), cancel: t('common.cancel'), pauses: true }))) return;
          const mv = { t: 'aid', tile, to } satisfies M07Move;
          if (!ui.engine.validate(ui.slot.state, 'hero', mv) || hero.pieces < AID_COST || !transfer(ui.state, 'hero', 'host', AID_COST, 'M07 タイルの形を替える')) return;
          Sound.se('coins');
          St.alt = false;
          St.sel = { rot: 0, shape: to };
          ui.submit(mv);
        });
        foot.append(b);
      }
      foot.append(button(t('common.cancel'), () => { St.alt = false; ui.rerender(); }, { small: true }));
      return;
    }
    const canPlaceAny = placements(v.owner, v.seat, tiles, v.cap).length > 0;
    note.textContent = !canPlaceAny ? t('m07.noMove') : !shape ? t('m07.howPick', { n: v.cap }) : !g ? t('m07.howPut') : g.ok ? t('m07.howOk', { n: g.cells.length }) : t('m07.howBad');
    note.classList.toggle('gold', !!g?.ok);
    foot.append(
      button('⟲', () => placer.rotate(-1), { small: true, disabled: !shape, title: t('m07.rotL') }),
      button('⟳', () => placer.rotate(1), { small: true, disabled: !shape, title: t('m07.rotR') }),
      button(t('m07.put'), () => {
        const gg = placer.ghost();
        if (!gg?.ok || !St.sel.shape) return;
        const mv = { t: 'place', tile: tiles.indexOf(St.sel.shape), rot: St.sel.rot, at: gg.at } satisfies M07Move;
        St.sel = { rot: 0 };
        St.n = v.log.length + 1;
        Sound.se('chip');
        ui.submit(mv);
      }, { kind: 'primary', disabled: !g?.ok }),
      button(t('m06.pass'), async () => {
        if (canPlaceAny && !(await confirmDialog(t('m07.passTitle'), t('m07.passText'), { ok: t('m06.pass'), cancel: t('common.cancel'), pauses: true }))) return;
        St.sel = { rot: 0 };
        St.n = v.log.length + 1;
        ui.submit({ t: 'pass' } satisfies M07Move);
      }, { small: true }),
      button(t('m07.aid', { n: AID_COST }), () => { St.alt = true; ui.rerender(); }, { small: true, disabled: v.aidUsed || !shape || !alternatives(shape).length || hero.pieces < AID_COST, title: t('m07.aidOnce') }));
  };
  const placer = new TilePlacer({ owner, seat: v.seat, seats: v.seats, tiles, cap, size: SIZE, active: myTurn && !St.alt, fresh: last?.cells ?? undefined, sel: St.sel, onChange: drawFoot });
  drawFoot();

  let head: Child;
  let body: Child = null;
  if (v.phase === 'done' && !replaying) {
    head = h('div', { class: 'm01-big' }, t('p01.finished'));
    body = h('div', { class: 'small dim' }, t('m07.doneNote'));
  } else if (v.phase === 'break' && !replaying) {
    head = h('div', { class: 'm01-big' }, t('m07.breakTitle', { n: v.round + 1 }));
    body = [
      h('div', { class: 'small dim' }, t('m07.breakNote')),
      !watching ? h('div', { class: 'row mq-talk', style: 'gap:6px;flex-wrap:wrap' }, v.players.filter((p) => p !== me).map((p) => button([face(p)], () => ui.talk(p as NpcId), { small: true, title: ui.name(p) }))) : null,
      !watching && !v.ready[me] ? button(t('m07.resume'), () => ui.submit({ t: 'ready' } satisfies M07Move), { kind: 'primary', autofocus: true }) : null,
    ];
  } else {
    head = h('div', { class: 'hx7-head' },
      h('b', { class: myTurn ? 'gold' : '' }, myTurn ? t('m07.yourTurn') : turnOf ? t('p05.waitTurn', { name: turnOf === me ? t('p05.you') : ui.name(turnOf) }) : ''),
      h('span', { class: 'small dim' }, cap < 4 ? t('m07.capNote', { n: cap }) : t('m07.capFree')));
  }
  const main = h('div', { class: 'hx7' },
    h('div', { class: 'hx7-left' }, placer.board),
    h('div', { class: 'hx7-panel' }, head, body,
      watching ? null : [h('div', { class: 'small dim' }, t('m07.trayTitle', { n: tiles.length })), placer.tray],
      note, foot));
  return { main, side };
}
