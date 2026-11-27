/**
 * M06 クロス・カードの画面。上に場の 5 枚、下に自分の手札を置き、カードを直接タップして選ぶ。
 * 交換：手札 1 枚と場 1 枚を選んで「交換する」。提出：手札から 2 枚までを選んで出す。
 * CPU の交換は一瞬で決まるので、自分の番が来る前に 1 人ずつ順に見せる。
 */
import { Sound } from '../../audio/audio';
import { transfer } from '../../core/state';
import type { CharId, NpcId } from '../../data/characters';
import { t } from '../../i18n/i18n';
import { AID_COST, FLUSH_PTS, MATCH_PTS, TOP_PTS, TRIPLE_PTS, matchesIn, meets, rankOf, suitOf, type M06Log, type M06Move, type M06View, type Target } from '../../matches/m06';
import { face } from '../art';
import { cardBack, cardEl, SUIT_COLOR } from '../cards';
import { button, confirmDialog, h, type Child } from '../dom';
import type { MatchUi } from '../matchui';

interface Seen { n: number; timer?: ReturnType<typeof setTimeout>; hand?: number; field?: number; picks: number[]; key?: string }
const SEEN = new WeakMap<object, Seen>();
const STEP_MS = 900;

const fieldBefore = (l: M06Log) => (l.kind === 'swap' ? l.field.map((c) => (c === l.gave ? l.took! : c)) : l.field);
const targetChip = (tg: Target, cls = '') => h('span', { class: `xc-target ${cls}` }, t(`m06.tg.${tg}`));

function table(v: M06View, ui: MatchUi): HTMLElement {
  const order = [...v.players].sort((a, b) => v.scores[b] - v.scores[a]);
  return h('div', { class: 'm01-rank' }, order.map((p, i) => h('div', { class: `m01-rankrow${p === v.self ? ' me' : ''}` },
    h('span', { class: 'no' }, String(i + 1)), face(p), h('span', { class: 'nm' }, ui.name(p)), h('b', null, String(v.scores[p])))));
}

/** 見えたカードの一覧（公開情報だけ）：捨て札は薄く、場のカードは枠付きで示す */
function seenGrid(v: M06View, field: number[]): HTMLElement {
  return h('div', { class: 'xc-seen' }, [0, 1, 2, 3].map((s) => h('div', { class: 'row' }, h('i', { class: 'sw', style: `background:${SUIT_COLOR[s]}` }),
    Array.from({ length: 13 }, (_, r) => { const c = s * 13 + r; return h('span', { class: v.discard.includes(c) ? 'gone' : field.includes(c) ? 'fld' : v.hand.includes(c) ? 'mine' : '' }, r === 0 ? 'A' : r === 10 ? 'J' : r === 11 ? 'Q' : r === 12 ? 'K' : String(r + 1)); }))));
}

function turnList(v: M06View, ui: MatchUi, shown: number, turnOf: CharId | null): HTMLElement {
  const acts = v.log.slice(0, shown).filter((l) => l.round === v.round);
  return h('div', { class: 'xc-turns' }, v.order.map((p) => {
    const a = acts.find((l) => l.who === p);
    return h('div', { class: `xc-turn${turnOf === p ? ' now' : ''}${p === v.self ? ' me' : ''}` }, face(p), h('span', { class: 'nm' }, ui.name(p)),
      a ? (a.kind === 'pass' ? h('small', { class: 'dim' }, t('m06.passed')) : h('span', { class: 'xc-act' }, cardEl(a.took!, { cls: 'tiny' }), h('small', null, '⇄'), cardEl(a.gave!, { cls: 'tiny' }))) : turnOf === p ? h('small', { class: 'gold' }, t('p05.turnTag')) : null);
  }));
}

function subRow(v: M06View, ui: MatchUi, round: number): HTMLElement {
  const res = v.history[round];
  return h('div', { class: 'xc-subs' }, v.players.map((p) => {
    const r = res[p];
    return h('div', { class: `xc-sub${r.ok ? ' ok' : ''}${p === v.self ? ' me' : ''}` }, face(p), h('span', { class: 'nm' }, ui.name(p)),
      h('span', { class: 'xc-act' }, r.cards.length ? r.cards.map((c) => cardEl(c, { cls: 'tiny' })) : h('small', { class: 'dim' }, t('m06.noSub'))),
      h('b', { class: r.ok ? 'gold' : 'dim' }, r.ok ? `+${MATCH_PTS + (r.top ? TOP_PTS : 0)}` : '0'), r.top ? h('i', { class: 'tag' }, t('m06.topTag')) : null);
  }));
}

export function renderM06(v: M06View, ui: MatchUi): { main: Child; side: Child } {
  const me = v.self as CharId;
  const watching = v.self === 'spectator';
  let S = SEEN.get(ui.slot);
  if (!S) {
    const lastMine = v.log.map((l) => l.who).lastIndexOf(me);
    S = { n: Math.max(0, lastMine + 1, v.log.length - v.players.length), picks: [] };
    SEEN.set(ui.slot, S);
  }
  const St = S;
  if (St.n > v.log.length) St.n = v.log.length;
  const replaying = St.n < v.log.length;
  if (replaying && !St.timer) {
    St.timer = setTimeout(() => {
      St.timer = undefined;
      St.n = Math.min(v.log.length, St.n + 1);
      Sound.se(v.log[St.n - 1]?.kind === 'swap' ? 'card' : 'click');
      ui.rerender();
    }, STEP_MS);
  }
  const field = replaying ? fieldBefore(v.log[St.n]) : v.field;
  const turnOf = replaying ? v.log[St.n].who : v.toMove;
  const sideBase = (fld: number[]) => [
    h('div', { class: 'box' }, h('h4', null, t('m06.seen')), seenGrid(v, fld), h('div', { class: 'small dim', style: 'margin-top:4px' }, t('m06.seenNote', { n: v.deckCount }))),
    h('div', { class: 'box scroll grow' }, h('h4', null, t('m01.rank')), table(v, ui)),
  ];

  if (v.phase === 'done' && !replaying) {
    const hands = v.finalHands ?? {};
    const main = h('div', { class: 'm01-break xc-done' },
      h('div', { class: 'm01-big' }, t('m06.finalTitle')),
      h('div', { class: 'small dim' }, t('m06.finalNote', { a: TRIPLE_PTS, b: FLUSH_PTS })),
      h('div', { class: 'xc-subs' }, v.players.map((p) => { const b = v.bonus[p]; return h('div', { class: `xc-sub${b?.points ? ' ok' : ''}${p === me ? ' me' : ''}` }, face(p), h('span', { class: 'nm' }, ui.name(p)), h('span', { class: 'xc-act' }, (hands[p] ?? []).map((c) => cardEl(c, { cls: 'tiny' }))), h('b', { class: b?.points ? 'gold' : 'dim' }, b?.points ? `+${b.points}` : '0'), b?.kind ? h('i', { class: 'tag' }, t(`m06.bonus.${b.kind}`)) : null); })));
    return { main, side: [h('div', { class: 'box scroll grow' }, h('h4', null, t('m01.rank')), table(v, ui))] };
  }

  if (v.phase === 'break' && !replaying) {
    const main = h('div', { class: 'm01-break xc-break' },
      h('div', { class: 'row', style: 'gap:12px;align-items:center' }, h('div', { class: 'm01-big' }, t('m03.roundResult', { n: v.round + 1 })), h('span', { class: 'small dim' }, t('m06.topNote', { n: TOP_PTS }))),
      subRow(v, ui, v.round),
      h('div', { class: 'row', style: 'gap:14px;align-items:center' }, h('span', { class: 'small' }, t('m06.nextIs')), targetChip(v.target), h('div', { class: 'xc-row mini' }, v.hand.map((c) => cardEl(c, { cls: 'small' })))),
      !watching ? h('div', { class: 'row mq-talk', style: 'gap:6px;justify-content:center;flex-wrap:wrap' }, h('span', { class: 'small dim' }, t('mq.talk')), v.players.filter((p) => p !== me).map((p) => button([face(p)], () => ui.talk(p as NpcId), { small: true, title: ui.name(p) }))) : null,
      !watching && !v.ready[me] ? button(t('p01.next', { n: v.round + 2 }), () => ui.submit({ t: 'ready' } satisfies M06Move), { kind: 'primary', autofocus: true }) : null);
    return { main, side: sideBase(v.field) };
  }

  const mySwap = !replaying && !watching && v.phase === 'swap' && v.toMove === me;
  const mySubmit = !replaying && !watching && v.phase === 'submit' && !v.submitted;
  if (St.hand !== undefined && !v.hand.includes(St.hand)) St.hand = undefined;
  if (St.field !== undefined && !field.includes(St.field)) St.field = undefined;
  // 段階が替わったら、前の選択は持ち越さない
  const key = `${v.round}-${v.phase}`;
  if (St.key !== key) { St.key = key; St.picks = []; St.hand = St.field = undefined; }
  St.picks = St.picks.filter((c) => v.hand.includes(c));
  const hero = ui.state.actors.hero;
  const pairs = matchesIn(v.target, v.hand);
  const inPair = new Set(pairs.flat());

  const fieldRow = h('div', { class: 'xc-row' }, h('span', { class: 'xc-lbl' }, t('m06.field')), field.map((c) => {
    const el = cardEl(c, { button: true, disabled: !mySwap, cls: St.field === c ? 'sel' : '' });
    el.addEventListener('click', () => { if (!mySwap) return; St.field = St.field === c ? undefined : c; Sound.se('select'); ui.rerender(); });
    return el;
  }), h('div', { class: 'xc-deck' }, cardBack('small'), h('small', null, t('m06.deck', { n: v.deckCount }))));

  const handRow = h('div', { class: 'xc-row hand' }, h('span', { class: 'xc-lbl' }, t('m06.hand')), v.hand.map((c) => {
    const sel = mySubmit ? St.picks.includes(c) : St.hand === c;
    const el = cardEl(c, { button: true, disabled: !(mySwap || mySubmit), cls: `${sel ? 'sel' : ''}${inPair.has(c) ? ' hint' : ''}` });
    el.addEventListener('click', () => {
      if (mySwap) St.hand = St.hand === c ? undefined : c;
      else if (mySubmit) {
        if (St.picks.includes(c)) St.picks = St.picks.filter((x) => x !== c);
        else if (St.picks.length < 2) St.picks.push(c);
        else { Sound.se('error'); return; }
      } else return;
      Sound.se('select');
      ui.rerender();
    });
    return el;
  }));

  let controls: Child = null;
  let note: Child = null;
  if (mySwap) {
    const ready = St.hand !== undefined && St.field !== undefined;
    const aid = button(t('m06.aid', { n: AID_COST }), async () => {
      if (St.hand === undefined) return;
      const card = St.hand;
      if (!(await confirmDialog(t('m06.aidTitle'), t('m06.aidText', { n: AID_COST, have: hero.pieces }), { ok: t('m01.hintOk', { n: AID_COST }), cancel: t('common.cancel'), pauses: true }))) return;
      if (!ui.engine.validate(ui.slot.state, 'hero', { t: 'aid', card }) || hero.pieces < AID_COST || !transfer(ui.state, 'hero', 'host', AID_COST, 'M06 山札と交換')) return;
      Sound.se('coins');
      St.hand = undefined;
      ui.submit({ t: 'aid', card } satisfies M06Move);
    }, { small: true, disabled: v.aidUsed || St.hand === undefined || hero.pieces < AID_COST, title: t('m06.aidOnce') });
    controls = [
      button(t('m06.swap'), () => { const mv = { t: 'swap', hand: St.hand!, field: St.field! } satisfies M06Move; St.hand = St.field = undefined; St.n = v.log.length + 1; Sound.se('card'); ui.submit(mv); }, { kind: 'primary', disabled: !ready }),
      button(t('m06.pass'), () => { St.hand = St.field = undefined; St.n = v.log.length + 1; ui.submit({ t: 'pass' } satisfies M06Move); }, {}),
      aid,
    ];
    note = t(ready ? 'm06.swapReady' : 'm06.swapHow');
  } else if (mySubmit) {
    const ok = St.picks.length === 2 && meets(v.target, St.picks[0], St.picks[1]);
    const sum = St.picks.reduce((n, c) => n + rankOf(c), 0);
    controls = [
      button(St.picks.length ? t('m06.submitN', { n: St.picks.length }) : t('m06.submit0'), () => { const cards = [...St.picks]; St.picks = []; Sound.se('card'); ui.submit({ t: 'submit', cards } satisfies M06Move); }, { kind: 'primary' }),
    ];
    note = ok ? h('span', { class: 'gold' }, t('m06.subOk', { p: MATCH_PTS, s: sum })) : St.picks.length ? h('span', null, t('m06.subNg')) : t(pairs.length ? 'm06.subHowHint' : 'm06.subHowNone');
    ui.timeoutMove = () => ({ t: 'submit', cards: [] } satisfies M06Move);
  } else {
    note = v.phase === 'submit' && !replaying ? t('m06.subWait') : turnOf ? t('p05.waitTurn', { name: turnOf === me ? t('p05.you') : ui.name(turnOf) }) : '';
  }
  void suitOf;
  const main = h('div', { class: 'xc' },
    h('div', { class: 'xc-head' }, h('span', { class: 'small dim' }, t('m06.targetIs')), targetChip(v.target, 'big'), h('span', { class: 'gold' }, `+${MATCH_PTS}`), v.nextTarget ? [h('span', { class: 'small dim', style: 'margin-left:14px' }, t('m06.nextIs')), targetChip(v.nextTarget)] : h('span', { class: 'small gold', style: 'margin-left:14px' }, t('m06.lastRound'))),
    fieldRow, handRow,
    h('div', { class: 'xc-foot' }, h('span', { class: 'small xc-note' }, note), controls));
  const side = [h('div', { class: 'box' }, h('h4', null, t('m06.order')), turnList(v, ui, St.n, v.phase === 'swap' || replaying ? turnOf : null)), ...sideBase(field)];
  return { main, side };
}
