import { GAME_ART } from '../../assets/registry';
import { Sound } from '../../audio/audio';
import type { CharId, NpcId } from '../../data/characters';
import { t } from '../../i18n/i18n';
import { ITEMS, ITEM_POINTS, itemScore, moneyScore, totalScore, type Bag, type Item, type LotResult, type M02Move, type M02View, type Offer, type Side } from '../../matches/m02';
import { face, gameArt } from '../art';
import { button, h, type Child } from '../dom';
import type { MatchUi } from '../matchui';

const ART = GAME_ART.m02;
const itemName = (k: Item) => t(`m02.item.${k}`);

interface Draft { to: CharId | null; give: Side; take: Side }
const emptySide = (): Side => ({ money: 0, items: {} });

function bagIcons(b: Bag, size = 22): Child {
  const cells = ITEMS.filter((k) => b[k] > 0).map((k) => h('span', { class: 'm02-own' }, gameArt(ART[k], size), b[k] > 1 ? h('small', null, `×${b[k]}`) : null));
  return cells.length ? cells : h('span', { class: 'dim small' }, t('m02.noItems'));
}

function sideText(s: Side): string {
  const parts = ITEMS.filter((k) => (s.items[k] ?? 0) > 0).map((k) => `${itemName(k)}${(s.items[k] ?? 0) > 1 ? `×${s.items[k]}` : ''}`);
  if (s.money > 0) parts.push(t('m02.money', { n: s.money }));
  return parts.join('、') || t('m02.nothing');
}

function applyTo(b: Bag, gain: Side, lose: Side): Bag {
  const out = { ...b };
  for (const k of ITEMS) out[k] += (gain.items[k] ?? 0) - (lose.items[k] ?? 0);
  return out;
}

export function renderM02(v: M02View, ui: MatchUi): { main: Child; side: Child } {
  const me = v.self as CharId;
  const playing = v.self !== 'spectator';
  const local = ui.local as { bid?: number; draft?: Draft };
  const myFunds = playing ? v.funds[me] : 0;
  const myBag = playing ? v.items[me] : null;
  const last: LotResult | undefined = v.history[v.history.length - 1];

  // ---- 参加者の一覧（資金と持ち物は公開） ----
  const table = h('div', { class: 'm02-players' }, v.players.map((p) => {
    const sc = totalScore(v.items[p], v.funds[p]);
    const cls = `m02-player${p === me ? ' me' : ''}${last?.winner === p && v.stage !== 'trade' ? ' won' : ''}${v.stage === 'rebid' && v.tied.includes(p) ? ' tied' : ''}`;
    return h('div', { class: cls },
      face(p),
      h('div', { class: 'm02-pinfo' },
        h('div', { class: 'm02-pname' }, h('b', null, ui.name(p)), h('span', { class: 'm02-funds' }, gameArt(ART.coin, 16), String(v.funds[p]))),
        h('div', { class: 'm02-bag' }, bagIcons(v.items[p], 20))),
      h('div', { class: 'm02-pscore' }, h('b', null, String(sc)), h('small', null, t('m02.pts'))));
  }));

  // ---- 直前の結果 ----
  const lastBox = last ? h('div', { class: 'box m02-last' },
    gameArt(ART[last.item], 44),
    h('div', { class: 'grow' },
      h('h4', null, t('m02.lastTitle', { n: last.lot + 1, item: itemName(last.item) })),
      h('div', null, last.winner ? t('m02.lastWon', { name: ui.name(last.winner), price: last.price }) : t(last.rebid ? 'm02.lastTiedOut' : 'm02.lastNone')),
      h('div', { class: 'small dim' }, t('m02.lastBids', { bids: v.players.filter((p) => (last.bids[p] ?? 0) > 0).sort((a, b) => last.bids[b] - last.bids[a]).map((p) => `${ui.name(p)} ${last.bids[p]}`).join('　') || t('m02.allPassed') })),
      last.rebid ? h('div', { class: 'small dim' }, t('m02.lastRebid', { bids: Object.entries(last.rebid).map(([p, n]) => `${ui.name(p as CharId)} ${n === 0 ? t('m02.dropped') : n}`).join('　') })) : null)) : null;

  // ---- 残りの出品 ----
  const remain = h('div', { class: 'm02-remain' }, h('span', { class: 'small dim' }, t('m02.remaining')), ITEMS.map((k) => h('span', { class: `m02-own${v.remaining[k] === 0 ? ' out' : ''}` }, gameArt(ART[k], 22), h('small', null, `×${v.remaining[k]}`))));

  let controls: Child = null;
  if (v.stage === 'done') {
    const fs = v.finalScores ?? {};
    const order = [...v.players].sort((a, b) => (fs[b] ?? 0) - (fs[a] ?? 0) || v.funds[b] - v.funds[a]);
    controls = h('div', { class: 'box' }, h('h4', null, t('m02.finalTitle')),
      h('div', { class: 'm02-final' }, order.map((p, i) => h('div', { class: `m02-frow${p === me ? ' me' : ''}` },
        h('span', { class: 'm02-rank' }, String(i + 1)), face(p), h('b', null, ui.name(p)),
        h('span', { class: 'm02-bag' }, bagIcons(v.items[p], 20)),
        h('span', { class: 'small dim' }, t('m02.breakdown', { items: itemScore(v.items[p]), money: moneyScore(v.funds[p]), funds: v.funds[p] })),
        h('b', { class: 'gold' }, String(fs[p] ?? 0))))));
  } else if (v.stage === 'bid' || v.stage === 'rebid') {
    const item = v.item!;
    const inRebid = v.stage === 'rebid';
    const canBid = playing && v.myBid === null && (!inRebid || v.tied.includes(me));
    const gain = myBag ? itemScore({ ...myBag, [item]: myBag[item] + 1 }) - itemScore(myBag) : 0;
    const min = inRebid ? v.rebidMin : 0;
    const bid = Math.max(0, Math.min(myFunds, local.bid ?? (inRebid ? Math.min(myFunds, v.rebidMin) : 0)));
    const set = (n: number) => {
      local.bid = Math.max(0, Math.min(myFunds, n));
      Sound.se('chip');
      ui.rerender();
    };
    const legal = bid === 0 || bid >= min;
    const podium = h('div', { class: 'm02-podium' },
      h('div', { class: 'm02-lotart' }, gameArt(ART[item], 112)),
      h('div', { class: 'm02-lotinfo' },
        h('div', { class: 'm02-lotno' }, gameArt(ART.gavel, 30), t('m02.lotNo', { n: v.lot + 1, total: v.totalLots })),
        h('div', { class: 'm02-lotname' }, itemName(item)),
        h('div', { class: 'small' }, t('m02.basePoints', { p: ITEM_POINTS[item] })),
        playing ? h('div', { class: 'small gold' }, t('m02.ifWin', { p: gain })) : null,
        inRebid ? h('div', { class: 'small m02-tie' }, t('m02.rebidInfo', { names: v.tied.map((p) => ui.name(p)).join('、'), min: v.rebidMin })) : null));
    let bidBox: Child;
    if (canBid) {
      const step = (d: number) => button(d > 0 ? `+${d}` : String(d), () => set(bid + d), { small: true, disabled: d > 0 ? bid >= myFunds : bid <= 0 });
      bidBox = h('div', { class: 'm02-bidbox' },
        h('div', { class: 'm02-bidnum' }, h('small', null, t('m02.yourBid')), h('b', { class: legal ? '' : 'bad' }, String(bid)), h('small', null, t('m02.ofFunds', { n: myFunds }))),
        h('div', { class: 'm02-steps' }, step(-10), step(-5), step(-1), step(1), step(5), step(10)),
        h('div', { class: 'm02-steps' },
          button(t(inRebid ? 'm02.drop' : 'm02.pass'), () => set(0), { small: true, kind: 'ghost' }),
          inRebid ? button(t('m02.minBid', { n: min }), () => set(min), { small: true, kind: 'ghost', disabled: myFunds < min }) : null,
          button(t('m02.allIn'), () => set(myFunds), { small: true, kind: 'ghost' }),
          button(t(bid === 0 ? (inRebid ? 'm02.confirmDrop' : 'm02.confirmPass') : 'm02.confirmBid', { n: bid }), () => {
            Sound.se('chips');
            ui.submit({ t: 'bid', amount: bid } satisfies M02Move);
          }, { kind: 'primary', disabled: !legal })),
        h('div', { class: 'dim small' }, t(inRebid ? 'm02.rebidHint' : 'm02.bidHint')));
    } else if (playing && inRebid && !v.tied.includes(me)) bidBox = h('div', { class: 'box dim' }, t('m02.rebidWatch'));
    else bidBox = h('div', { class: 'box dim' }, t(playing ? 'm02.waiting' : 'm02.spectating'));
    controls = h('div', { class: 'box m02-stage' }, podium, bidBox);
  } else if (v.stage === 'trade') {
    controls = renderTrade(v, ui, me, playing);
  }

  const side = [
    h('div', { class: 'box' }, h('h4', null, t('m02.scoreTitle')),
      h('div', { class: 'm02-scoretable' },
        ...ITEMS.map((k) => h('span', { class: 'm02-own' }, gameArt(ART[k], 20), h('small', null, `${itemName(k)} ${ITEM_POINTS[k]}`))),
      ),
      h('div', { class: 'small' }, t('m02.sets')),
      h('div', { class: 'small dim' }, t('m02.moneyRule'))),
    h('div', { class: 'box scroll grow' }, h('h4', null, t('m02.history')),
      ...(v.history.length ? v.history.slice().reverse().map((x) => h('div', { class: 'logline m02-hist' }, h('span', { class: 'dim' }, `${x.lot + 1}.`), gameArt(ART[x.item], 18), h('span', { class: 'grow' }, x.winner ? ui.name(x.winner) : t('m02.unsold')), x.winner ? h('b', null, String(x.price)) : null)) : [h('div', { class: 'dim small' }, t('m02.noHistory'))]),
      ...(v.trades.filter((x) => x.accepted).length ? [h('h4', { style: 'margin-top:10px' }, t('m02.tradeLog')), ...v.trades.filter((x) => x.accepted).slice().reverse().map((x) => h('div', { class: 'logline small' }, t('m02.tradeLine', { a: ui.name(x.from), b: ui.name(x.to), give: sideText(x.give), take: sideText(x.take) })))] : [])),
  ];
  return { main: [table, v.stage === 'trade' ? null : remain, controls, v.stage === 'done' ? null : lastBox], side };
}

function renderTrade(v: M02View, ui: MatchUi, me: CharId, playing: boolean): Child {
  const local = ui.local as { draft?: Draft };
  if (!playing) return h('div', { class: 'box dim' }, t('m02.spectating'));
  const myBag = v.items[me];
  const offer: Offer | null = v.offer;
  const now = totalScore(myBag, v.funds[me]);

  // 自分宛ての提案
  if (offer && offer.to === me) {
    const after = totalScore(applyTo(myBag, offer.give, offer.take), v.funds[me] + offer.give.money - offer.take.money);
    return h('div', { class: 'box col m02-offer', style: 'gap:10px' },
      h('h4', null, t('m02.offerFrom', { name: ui.name(offer.from) })),
      h('div', { class: 'm02-swap' },
        h('div', { class: 'm02-swapside' }, face(offer.from), h('small', null, t('m02.theyGive')), h('b', null, sideText(offer.give))),
        h('div', { class: 'm02-arrow' }, '⇄'),
        h('div', { class: 'm02-swapside' }, face(me), h('small', null, t('m02.youGive')), h('b', null, sideText(offer.take)))),
      h('div', { class: 'small' }, t('m02.scoreChange', { a: now, b: after })),
      h('div', { class: 'row', style: 'gap:12px' },
        button(t('m02.accept'), () => { Sound.se('coins'); ui.submit({ t: 'answer', accept: true } satisfies M02Move); }, { kind: 'primary' }),
        button(t('m02.decline'), () => { Sound.se('select'); ui.submit({ t: 'answer', accept: false } satisfies M02Move); }, { kind: 'danger', autofocus: true })),
      h('div', { class: 'dim small' }, t('m02.offerTimeout')));
  }
  if (v.ready[me]) return h('div', { class: 'box dim' }, t('m02.tradeWaiting'));

  const d: Draft = local.draft ?? { to: null, give: emptySide(), take: emptySide() };
  const upd = (f: (x: Draft) => void) => {
    f(d);
    local.draft = d;
    Sound.se('select');
    ui.rerender();
  };
  const lastMine = [...v.trades].reverse().find((x) => x.from === me && x.after === v.lot);
  const notice = lastMine ? h('div', { class: `small ${lastMine.accepted ? 'good' : 'bad'}` }, t(lastMine.accepted ? 'm02.wasAccepted' : 'm02.wasDeclined', { name: ui.name(lastMine.to) })) : null;

  const partners = h('div', { class: 'm02-partners' }, v.players.filter((p) => p !== me).map((p) => h('button', { type: 'button', class: `m02-partner${d.to === p ? ' sel' : ''}`, onclick: () => upd((x) => { x.to = p; x.take = emptySide(); }) },
    face(p), h('span', null, ui.name(p)))));

  const sideEditor = (label: string, s: Side, bag: Bag, funds: number, other: Side) => h('div', { class: 'm02-side' },
    h('h4', null, label),
    h('div', { class: 'm02-siderow' }, ITEMS.map((k) => {
      const n = s.items[k] ?? 0;
      return h('button', { type: 'button', class: `m02-pick${n > 0 ? ' sel' : ''}`, disabled: bag[k] === 0, onclick: () => upd(() => { s.items[k] = n >= bag[k] ? 0 : n + 1; }) },
        gameArt(ART[k], 30), h('small', null, `${n} / ${bag[k]}`));
    })),
    h('div', { class: 'm02-siderow' },
      h('span', { class: 'small' }, t('m02.moneyLabel')),
      button('−5', () => upd(() => { s.money = Math.max(0, s.money - 5); }), { small: true, disabled: s.money <= 0 }),
      h('b', { class: 'm02-money' }, String(s.money)),
      button('+5', () => upd(() => { s.money = Math.min(funds, s.money + 5); other.money = 0; }), { small: true, disabled: s.money >= funds }),
      h('span', { class: 'small dim' }, t('m02.ofFunds', { n: funds }))));

  let builder: Child = h('div', { class: 'dim small' }, t('m02.pickPartner'));
  let send: Child = null;
  if (d.to) {
    const to = d.to;
    const empty = (s: Side) => s.money === 0 && ITEMS.every((k) => !(s.items[k] ?? 0));
    const after = totalScore(applyTo(myBag, d.take, d.give), v.funds[me] + d.take.money - d.give.money);
    const move: M02Move = { t: 'offer', to, give: d.give, take: d.take };
    const ok = !(empty(d.give) && empty(d.take)) && ui.engine.validate(ui.slot.state, me, move);
    builder = h('div', { class: 'm02-builder' },
      sideEditor(t('m02.youGive'), d.give, myBag, v.funds[me], d.take),
      h('div', { class: 'm02-arrow' }, '⇄'),
      sideEditor(t('m02.youGet', { name: ui.name(to) }), d.take, v.items[to], v.funds[to], d.give));
    send = h('div', { class: 'row', style: 'gap:12px;flex-wrap:wrap' },
      h('span', { class: 'small grow' }, t('m02.scoreChange', { a: now, b: after })),
      to !== 'hero' ? button(t('m02.talk'), () => ui.talk(to as NpcId), { small: true, kind: 'ghost' }) : null,
      button(t('m02.sendOffer', { n: v.offersLeft }), () => {
        local.draft = undefined;
        Sound.se('card');
        ui.submit(move);
      }, { kind: 'primary', disabled: !ok || v.offersLeft <= 0 }));
  }
  return h('div', { class: 'box col m02-trade', style: 'gap:8px' },
    h('div', { class: 'row', style: 'gap:12px' }, h('h4', { class: 'grow', style: 'margin:0' }, t('m02.tradeTitle', { n: v.offersLeft })), button(t('m02.tradeEnd'), () => ui.submit({ t: 'ready' } satisfies M02Move), { small: true, kind: v.offersLeft > 0 ? 'secondary' : 'primary' })),
    notice,
    v.offersLeft > 0 ? [partners, builder, send] : h('div', { class: 'dim small' }, t('m02.noOffersLeft')));
}
