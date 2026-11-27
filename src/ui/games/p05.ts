/**
 * P05 21の攻防の画面。中央に場の合計、上に相手 2 人の残りの手札（公開情報）、下に自分の手札を置く。
 * カードをタップして選び、もう一度タップするか「出す」で確定する。各カードの下に、出した後の合計を表示する。
 * CPU の手は一瞬で決まるので、自分の番が来る前に、出されたカードを 1 枚ずつ順に見せる。
 */
import { Sound } from '../../audio/audio';
import type { CharId, NpcId } from '../../data/characters';
import { t } from '../../i18n/i18n';
import { BUST, GOAL, HIT, outcome, type P05Log, type P05Move, type P05View } from '../../matches/p05';
import { face } from '../art';
import { button, h, type Child } from '../dom';
import type { MatchUi } from '../matchui';

interface Seen { n: number; timer?: ReturnType<typeof setTimeout>; sel?: number }
const SEEN = new WeakMap<object, Seen>();
const STEP_MS = 850;

/** 記録の先頭 n 件までを反映した場の様子 */
function boardAt(v: P05View, n: number) {
  const log = v.log.slice(0, n);
  const last: P05Log | undefined = log[n - 1];
  const set = n < v.log.length ? v.log[n].set : v.set;
  const hands: Record<string, number[]> = {};
  const scores: Record<string, number> = {};
  for (const p of v.players) {
    const played = log.filter((l) => l.set === set && l.who === p).map((l) => l.card);
    hands[p] = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((c) => !played.includes(c));
    scores[p] = log.filter((l) => l.who === p).reduce((a, l) => a + (l.kind === 'hit' ? HIT : l.kind === 'bust' ? BUST : 0), 0);
  }
  const total = last && last.set === set && last.kind === 'add' ? last.total : 0;
  return { set, hands, scores, total, last };
}

function table(v: P05View, ui: MatchUi, scores: Record<string, number>): HTMLElement {
  const order = [...v.players].sort((a, b) => scores[b] - scores[a]);
  return h('div', { class: 'p01-table' }, order.map((p, i) => h('div', { class: `p01-row${p === v.self ? ' me' : ''}${i === order.length - 1 ? ' last' : ''}` },
    h('span', { class: 'no' }, String(i + 1)), face(p), h('span', { class: 'nm' }, ui.name(p)),
    h('span', { class: 'p01-ans' }, `${v.hits[p]}・${v.busts[p]}`), h('b', { class: 'tot' }, String(scores[p])))));
}

const mini = (hand: number[]) => h('div', { class: 'p05-mini' }, [1, 2, 3, 4, 5, 6, 7, 8, 9].map((c) => h('i', { class: hand.includes(c) ? '' : 'gone' }, String(c))));

export function renderP05(v: P05View, ui: MatchUi): { main: Child; side: Child } {
  const me = v.self as CharId;
  const watching = v.self === 'spectator';
  let S = SEEN.get(ui.slot);
  if (!S) {
    // 再開した時は、自分が最後に出した後からを見せる
    const lastMine = v.log.map((l) => l.who).lastIndexOf(me);
    S = { n: Math.max(lastMine + 1, v.log.length - (v.players.length - 1)) };
    if (S.n < 0) S.n = 0;
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
      Sound.se(l?.kind === 'hit' ? 'result' : l?.kind === 'bust' ? 'error' : 'card');
      ui.rerender();
    }, St.n === 0 ? 300 : STEP_MS);
  }
  const B = boardAt(v, St.n);
  const side = [h('div', { class: 'box scroll grow' }, h('h4', null, t('m01.rank')), table(v, ui, B.scores),
    h('div', { class: 'small dim', style: 'margin-top:6px' }, t('p05.tableNote')), h('div', { class: 'small dim', style: 'margin-top:4px' }, t('p01.lastNote')))];

  if (!replaying && (v.phase === 'break' || v.phase === 'done')) {
    const main = h('div', { class: 'm02-break' },
      h('div', { class: 'm01-big' }, v.phase === 'done' ? t('p01.finished') : t('p05.setDone', { n: v.set })),
      h('div', { class: 'p05-sum' }, v.players.map((p) => h('div', { class: `p05-sumrow${p === me ? ' me' : ''}` }, face(p), h('span', { class: 'nm' }, ui.name(p)), h('span', { class: 'small dim' }, t('p05.hb', { h: v.hits[p], b: v.busts[p] })), h('b', null, String(v.scores[p]))))),
      v.phase === 'break' && !watching ? h('div', { class: 'row mq-talk', style: 'gap:8px;justify-content:center' }, h('span', { class: 'small dim' }, t('mq.talk')), v.players.filter((p) => p !== me).map((p) => button([face(p), ui.name(p)], () => ui.talk(p as NpcId), { small: true }))) : null,
      v.phase === 'break' && !watching && !v.ready[me] ? button(t('p05.nextSet', { n: v.set + 1 }), () => ui.submit({ t: 'ready' } satisfies P05Move), { kind: 'primary', autofocus: true }) : null);
    return { main, side };
  }

  const myTurn = !replaying && !watching && v.phase === 'play' && v.toMove === me;
  const hand = B.hands[me] ?? [];
  if (St.sel !== undefined && !hand.includes(St.sel)) St.sel = undefined;
  const play = (card: number) => {
    St.sel = undefined;
    St.n = v.log.length + 1;
    const o = outcome(v.total, card);
    Sound.se(o.kind === 'hit' ? 'result' : o.kind === 'bust' ? 'error' : 'card');
    ui.submit({ t: 'play', card } satisfies P05Move);
  };
  const turnOf = replaying ? v.log[St.n].who : v.toMove;
  const others = v.players.filter((p) => p !== me);
  const last = B.last;
  const banner = last
    ? h('div', { class: `p05-last ${last.kind}` }, face(last.who), h('span', null, t(`p05.log.${last.kind}`, { name: last.who === me ? t('p05.you') : ui.name(last.who), c: last.card, s: last.total })))
    : h('div', { class: 'p05-last' }, t('p05.start'));
  const main = h('div', { class: 'p05' },
    h('div', { class: 'p05-opps' }, others.map((p) => h('div', { class: `p05-opp${turnOf === p ? ' turn' : ''}` }, face(p), h('div', { class: 'col' }, h('div', { class: 'row', style: 'gap:8px;align-items:baseline' }, h('b', null, ui.name(p)), h('span', { class: 'gold' }, t('p05.pts', { n: B.scores[p] })), turnOf === p ? h('i', { class: 'tag' }, t('p05.turnTag')) : null), mini(B.hands[p])))) ),
    h('div', { class: 'p05-mid' },
      h('div', { class: `p05-total${B.total >= 12 ? ' hot' : ''}` }, h('small', null, t('p05.total')), h('b', null, String(B.total)), h('span', null, `/ ${GOAL}`)),
      h('div', { class: 'col', style: 'gap:6px;align-items:flex-start' }, banner,
        h('div', { class: 'small dim' }, myTurn ? t('p05.yourTurn', { c: Math.min(...hand) }) : turnOf ? t('p05.waitTurn', { name: turnOf === me ? t('p05.you') : ui.name(turnOf) }) : ''))),
    h('div', { class: 'p05-hand' }, hand.map((c) => {
      const o = outcome(B.total, c);
      const el = h('button', { class: `p05-card ${o.kind}${St.sel === c ? ' sel' : ''}`, type: 'button', 'data-card': String(c), disabled: !myTurn },
        h('b', null, String(c)), h('small', null, o.kind === 'hit' ? t('p05.pvHit', { n: HIT }) : o.kind === 'bust' ? t('p05.pvBust', { n: BUST }) : t('p05.pvAdd', { s: B.total + c })));
      el.addEventListener('click', () => {
        if (!myTurn) return;
        if (St.sel === c) play(c);
        else { St.sel = c; Sound.se('select'); ui.rerender(); }
      });
      return el;
    }), myTurn ? button(St.sel !== undefined ? t('p05.play', { c: St.sel }) : t('p05.pick'), () => { if (St.sel !== undefined) play(St.sel); }, { kind: 'primary', disabled: St.sel === undefined, cls: 'p05-go' }) : null));
  return { main, side };
}
