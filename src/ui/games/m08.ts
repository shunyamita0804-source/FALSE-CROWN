/**
 * M08 バリケードの画面。左に盤面、右に手番と操作、横に全員の残りの距離を置く。
 * 「動く」では、動ける点が光る。タップで選び、もう一度タップするか「動く」で確定。
 * 「壁を置く」では、置ける道に印が出る。タップすると、全員の距離がどう変わるかが先に分かる。
 * CPU の手は一瞬で決まるので、自分の番が来る前に 1 手ずつ順に見せる。
 */
import { Sound } from '../../audio/audio';
import type { CharId, NpcId } from '../../data/characters';
import { t } from '../../i18n/i18n';
import { EDGES, ROUNDS, WALLS, distTo, goalNode, startNode, type M08Move, type M08View } from '../../matches/m08';
import { face } from '../art';
import { button, h, type Child } from '../dom';
import { HEX_COLORS } from '../hexboard';
import type { MatchUi } from '../matchui';
import { ringBoard } from '../ringboard';

interface Seen { n: number; timer?: ReturnType<typeof setTimeout>; mode: 'move' | 'wall'; node?: number; edge?: number; key?: string }
const SEEN = new WeakMap<object, Seen>();
const STEP_MS = 800;

export function renderM08(v: M08View, ui: MatchUi): { main: Child; side: Child } {
  const me = v.self as CharId;
  const watching = v.self === 'spectator';
  let S = SEEN.get(ui.slot);
  if (!S) {
    const mine = v.me >= 0 ? v.log.map((l) => l.seat).lastIndexOf(v.seats[v.me]) : -1;
    S = { n: Math.max(0, mine + 1, v.log.length - (v.players.length - 1)), mode: 'move' };
    SEEN.set(ui.slot, S);
  }
  const St = S;
  if (St.n > v.log.length) St.n = v.log.length;
  const replaying = St.n < v.log.length;
  if (replaying && !St.timer) {
    St.timer = setTimeout(() => {
      St.timer = undefined;
      St.n = Math.min(v.log.length, St.n + 1);
      const l = v.log[St.n - 1];
      Sound.se(l?.kind === 'wall' ? 'chipsHit' : l?.kind === 'move' ? (l.to === goalNode(l.seat) ? 'result' : 'chip') : 'click');
      ui.rerender();
    }, STEP_MS);
  }
  // 見せている時点の盤面（最初の配置から記録をたどる）
  const pos = v.seats.map(startNode);
  const walls = new Array<boolean>(EDGES.length).fill(false);
  const wallsLeft = v.players.map(() => WALLS);
  const arrived = v.players.map(() => -1);
  for (let k = 0; k < St.n; k++) {
    const l = v.log[k];
    const i = v.seats.indexOf(l.seat);
    if (l.kind === 'move') { pos[i] = l.to!; if (l.to === goalNode(l.seat)) { pos[i] = -1; arrived[i] = l.round; } }
    if (l.kind === 'wall') { walls[l.edge!] = true; wallsLeft[i] -= 1; }
  }
  const last = St.n > 0 ? v.log[St.n - 1] : undefined;
  const turnOf = replaying ? v.players[v.seats.indexOf(v.log[St.n].seat)] : v.toMove;
  const myTurn = !replaying && !watching && v.phase === 'play' && v.toMove === me;
  const key = `${v.round}-${v.log.length}`;
  if (St.key !== key || !myTurn) { St.key = key; St.node = St.edge = undefined; if (!myTurn) St.mode = 'move'; }
  if (St.mode === 'wall' && (v.me < 0 || v.wallsLeft[v.me] <= 0)) St.mode = 'move';

  const dist = v.players.map((_, i) => (pos[i] < 0 ? 0 : distTo(walls, pos[i], goalNode(v.seats[i]))));
  // 壁を選んでいる時は、置いた後の距離も出す
  const after = St.edge !== undefined ? v.players.map((_, i) => (pos[i] < 0 ? 0 : distTo(walls.map((w, e) => w || e === St.edge), pos[i], goalNode(v.seats[i])))) : null;
  const idx = v.players.map((_, i) => i).sort((a, b) => (arrived[a] >= 0 ? arrived[a] - 100 : dist[a]) - (arrived[b] >= 0 ? arrived[b] - 100 : dist[b]));
  const table = h('div', { class: 'm01-rank rb-rank' }, idx.map((i) => {
    const p = v.players[i];
    const delta = after && after[i] > dist[i] ? after[i] - dist[i] : 0;
    return h('div', { class: `m01-rankrow${p === me ? ' me' : ''}${turnOf === p ? ' now' : ''}` },
      h('i', { class: 'hx-sw', style: `background:${HEX_COLORS[v.seats[i]]}` }), face(p), h('span', { class: 'nm' }, ui.name(p)),
      h('small', { class: 'dim' }, t('m08.wallsLeft', { n: wallsLeft[i] })),
      arrived[i] >= 0 ? h('b', { class: 'gold' }, t('m08.arrivedAt', { n: arrived[i] + 1 })) : h('b', null, t('m08.left', { n: dist[i] }), delta ? h('span', { class: 'rb-delta' }, `+${delta}`) : null));
  }));
  const side = [
    h('div', { class: 'box scroll grow' }, h('h4', null, t('m08.rankTitle')), table, h('div', { class: 'small dim', style: 'margin-top:6px' }, t('m08.tableNote'))),
    h('div', { class: 'box' }, h('h4', null, t('m07.orderTitle')), h('div', { class: 'hx7-order' }, v.order.map((p) => h('span', { class: `hx7-ord${turnOf === p ? ' now' : ''}`, style: `--c:${HEX_COLORS[v.seats[v.players.indexOf(p)]]}`, title: ui.name(p) }, face(p))))),
  ];

  const done = (mv: M08Move) => { St.node = St.edge = undefined; St.mode = 'move'; St.n = v.log.length + 1; ui.submit(mv); };
  const confirmMove = () => { if (St.node === undefined) return; Sound.se('chip'); done({ t: 'move', to: St.node }); };
  const confirmWall = () => { if (St.edge === undefined) return; Sound.se('chipsHit'); done({ t: 'wall', edge: St.edge }); };
  const board = ringBoard({
    seats: v.seats, pos, walls, me: v.me, mode: myTurn ? St.mode : 'none', canMove: myTurn ? v.canMove : [], canWall: myTurn ? v.canWall : [],
    selNode: St.node, selEdge: St.edge, showPath: !watching, last,
  }, myTurn ? (n) => {
    if (St.mode !== 'move') return;
    if (!v.canMove.includes(n)) { Sound.se('error'); return; }
    if (St.node === n) { confirmMove(); return; }
    St.node = n; Sound.se('select'); ui.rerender();
  } : undefined, myTurn ? (e) => {
    if (St.mode !== 'wall') return;
    St.edge = e; Sound.se('select'); ui.rerender();
  } : undefined);

  let head: Child;
  let body: Child = null;
  let note = '';
  const foot: Child[] = [];
  if (v.phase === 'done' && !replaying) {
    head = h('div', { class: 'm01-big' }, t('p01.finished'));
    body = h('div', { class: 'small dim' }, t('m08.doneNote'));
  } else if (v.phase === 'break' && !replaying) {
    head = h('div', { class: 'm01-big' }, t('p07.breakTitle', { n: v.round + 1 }));
    body = [
      h('div', { class: 'small dim' }, t('m08.breakNote')),
      !watching ? h('div', { class: 'row mq-talk', style: 'gap:6px;flex-wrap:wrap' }, v.players.filter((p) => p !== me).map((p) => button([face(p)], () => ui.talk(p as NpcId), { small: true, title: ui.name(p) }))) : null,
      !watching && !v.ready[me] ? button(t('m07.resume'), () => ui.submit({ t: 'ready' } satisfies M08Move), { kind: 'primary', autofocus: true }) : null,
    ];
  } else {
    const gone = v.me >= 0 && arrived[v.me] >= 0;
    head = h('div', { class: 'hx7-head' },
      h('b', { class: myTurn ? 'gold' : '' }, gone ? t('m08.youArrived', { n: arrived[v.me] + 1 }) : myTurn ? t('m07.yourTurn') : turnOf ? t('p05.waitTurn', { name: turnOf === me ? t('p05.you') : ui.name(turnOf) }) : ''),
      !watching && !gone ? h('span', { class: 'small dim' }, t('m08.goalNote', { n: dist[v.me] })) : null,
      last ? h('span', { class: 'small dim' }, t(`m08.last.${last.kind}`, { name: ui.name(v.players[v.seats.indexOf(last.seat)]) })) : null);
    if (myTurn) {
      const canAny = v.canMove.length > 0;
      const wl = v.wallsLeft[v.me];
      body = h('div', { class: 'rb-modes' },
        button(t('m08.modeMove'), () => { St.mode = 'move'; St.edge = undefined; Sound.se('click'); ui.rerender(); }, { small: true, kind: St.mode === 'move' ? 'primary' : undefined }),
        button(t('m08.modeWall', { n: wl }), () => { St.mode = 'wall'; St.node = undefined; Sound.se('click'); ui.rerender(); }, { small: true, kind: St.mode === 'wall' ? 'primary' : undefined, disabled: wl <= 0 || v.canWall.length === 0 }));
      if (St.mode === 'move') {
        if (!canAny) { note = t('m08.noMove'); foot.push(button(t('m06.pass'), () => done({ t: 'pass' }), { kind: 'primary' })); }
        else {
          note = St.node !== undefined ? t('m08.moveReady') : t('m08.howMove');
          foot.push(button(t('m08.doMove'), confirmMove, { kind: 'primary', disabled: St.node === undefined }));
        }
      } else {
        if (St.edge !== undefined && after) {
          const hit = v.players.map((p, i) => ({ p, d: after[i] - dist[i] })).filter((x) => x.d > 0);
          note = hit.length ? t('m08.wallEffect', { list: hit.map((x) => `${x.p === me ? t('p05.you') : ui.name(x.p)} +${x.d}` ).join('、') }) : t('m08.wallNoEffect');
        } else note = t('m08.howWall');
        foot.push(button(t('m08.doWall'), confirmWall, { kind: 'primary', disabled: St.edge === undefined }));
      }
    }
  }
  void ROUNDS;
  const main = h('div', { class: 'hx7 rb7' }, h('div', { class: 'hx7-left' }, board),
    h('div', { class: 'hx7-panel' }, head, body, h('div', { class: `small fb-note${myTurn && (St.node !== undefined || St.edge !== undefined) ? ' gold' : ''}` }, note), h('div', { class: 'hx7-foot' }, foot)));
  return { main, side };
}
