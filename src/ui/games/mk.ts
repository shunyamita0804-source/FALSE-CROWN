/**
 * 市場予測（試作）の画面。左に値段の表（銘柄ごとに、値段、前の期の動き、値動きの線、売り買いの差、持ち数、分かっていること、注文）、
 * 右に資産の順位と相談の欄。相談の欄では、相手の顔を選んで、見せ合う・聞く・伝えるを選ぶ。届いた申し出には返事をする。
 * 見込みの合計や「買うべき」は出さない（分かっている要因を並べるだけ。足し算と判断はプレイヤーが行う）。
 */
import { Sound } from '../../audio/audio';
import { applyMarketSocial, mkLine } from '../../core/market_social';
import { transfer } from '../../core/state';
import type { CharId } from '../../data/characters';
import { t } from '../../i18n/i18n';
import { affordable, EXTRA_COST, FACTORS, GOODS, IMPACT_CAP, MAX_ORDER, PERIODS, PRICE_MAX, type Claim, type MkMove, type MkState, type MkView, type Offer } from '../../matches/mk';
import { face } from '../art';
import { button, h, type Child } from '../dom';
import type { MatchUi } from '../matchui';

interface Local { sel?: CharId; q?: number[]; mode?: 'swap' | 'ask' | 'tell'; good?: number; value?: number; give?: number; keep?: boolean; reply?: Record<number, number> }

const gname = (g: number) => t(`mk.good.${GOODS[g]}`);
const sgn = (v: number) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '±0');
const dirOf = (c: Claim) => (c.sign ?? Math.sign(c.value ?? 0)) >= 0 ? t('mk.dirUp') : t('mk.dirDown');

function spark(hist: number[]): HTMLElement {
  const w = 84;
  const hh = 40;
  const n = Math.max(2, PERIODS + 1);
  const pts = hist.map((p, i) => `${(i / (n - 1)) * (w - 6) + 3},${hh - 3 - ((p - 1) / (PRICE_MAX - 1)) * (hh - 6)}`).join(' ');
  const el = h('span', { class: 'mk-spark' });
  el.innerHTML = `<svg viewBox="0 0 ${w} ${hh}" width="${w}" height="${hh}"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/></svg>`;
  return el;
}

/** その銘柄について分かっていること（自分の札、見せてもらった札、言われた話、まだ分からない数） */
function infoChips(v: MkView, g: number, ui: MatchUi): HTMLElement {
  const out: Child[] = [];
  const seen = new Set<number>();
  for (const c of v.cards) if (c.good === g) { seen.add(c.k); out.push(h('span', { class: `mk-chip own ${c.value > 0 ? 'up' : c.value < 0 ? 'down' : ''}` }, sgn(c.value), h('small', null, t('mk.ownCard')))); }
  for (const x of v.shown) if (x.good === g && !seen.has(x.k)) { seen.add(x.k); out.push(h('span', { class: `mk-chip shown ${x.value > 0 ? 'up' : x.value < 0 ? 'down' : ''}` }, sgn(x.value), h('small', null, t('mk.shownBy', { name: ui.name(x.from) })))); }
  for (const c of v.claims) if (c.period === v.period && c.good === g) out.push(h('span', { class: `mk-chip said${v.liars.includes(c.from) ? ' liar' : ''}` }, c.value !== undefined ? `${sgn(c.value)}?` : `${dirOf(c)}?`, h('small', null, t('mk.saidBy', { name: ui.name(c.from) }))));
  const unknown = Math.max(0, FACTORS - seen.size);
  if (unknown) out.push(h('span', { class: 'mk-chip unknown' }, `？×${unknown}`));
  return h('div', { class: 'mk-chips' }, out);
}

function board(v: MkView, ui: MatchUi, L: Local): HTMLElement {
  const ordering = v.phase === 'order' && !v.submitted && v.self !== 'spectator';
  const q = (L.q ??= GOODS.map(() => 0));
  const head = h('div', { class: 'mk-row head' }, h('span', null, t('mk.colGood')), h('span', null, t('mk.colPrice')), h('span', null, t('mk.colMove')), h('span', null, t('mk.colNet')), h('span', null, t('mk.colHold')), h('span', null, t('mk.colInfo')), h('span', null, ordering ? t('mk.colOrder') : ''));
  const rows = GOODS.map((_, g) => {
    const ch = v.last?.change[g] ?? 0;
    const step = (d: number) => {
      const next = [...q];
      next[g] = Math.max(-Math.min(MAX_ORDER, v.holdings[g]), Math.min(MAX_ORDER, next[g] + d));
      if (!affordable(v, v.coins, v.holdings, next)) { Sound.se('error'); return; }
      L.q = next;
      Sound.se('select');
      ui.rerender();
    };
    return h('div', { class: 'mk-row', 'data-good': String(g) },
      h('b', { class: 'mk-name' }, gname(g)),
      h('span', { class: 'mk-price' }, String(v.prices[g])),
      // 前の期：値動きと、公開された要因（足すと値動きになる）、これまでの値段の線
      h('span', { class: `mk-move ${ch > 0 ? 'up' : ch < 0 ? 'down' : ''}` }, h('b', null, v.last ? sgn(ch) : '—'), v.last ? h('small', { class: 'mk-fac' }, `(${v.last.factors[g].map(sgn).join(' ')})`) : null, spark(v.history.map((x) => x[g]))),
      h('span', { class: 'mk-net' }, v.last ? sgn(v.last.net[g]) : '—'),
      h('span', { class: 'mk-hold' }, String(v.holdings[g])),
      infoChips(v, g, ui),
      ordering ? h('span', { class: 'mk-step' }, button('−', () => step(-1), { small: true, cls: 'mk-minus' }), h('b', { class: q[g] > 0 ? 'up' : q[g] < 0 ? 'down' : '' }, q[g] > 0 ? t('mk.buyN', { n: q[g] }) : q[g] < 0 ? t('mk.sellN', { n: -q[g] }) : t('mk.none')), button('+', () => step(1), { small: true, cls: 'mk-plus' })) : h('span', null, v.phase === 'order' && v.submitted ? t('mk.waiting') : ''));
  });
  return h('div', { class: 'mk-board' }, head, ...rows);
}

/** 前の期の後始末：口で聞いた話が本当だったか、嘘や約束破りへの反応（要因そのものは表の「前の期」に出す） */
function lastBox(v: MkView, ui: MatchUi): Child {
  if (!v.last) return null;
  const l = v.last;
  const mine = v.claims.filter((c) => c.period === l.period && c.verdict);
  const evs = v.events.filter((e) => e.period === l.period && (e.kind === 'lie_found' || e.kind === 'broken') && e.a === v.self);
  return h('div', { class: 'mk-last' },
    h('b', { class: 'gold' }, t('mk.lastTitle', { n: l.period + 1 })),
    !mine.length && !evs.length ? h('div', { class: 'small dim' }, t('mk.lastNone')) : null,
    ...mine.map((c) => h('div', { class: `small ${c.verdict === 'lie' ? 'bad' : 'ok'}` }, t(c.verdict === 'lie' ? 'mk.wasLie' : 'mk.wasTrue', { name: ui.name(c.from), good: gname(c.good) }))),
    ...evs.map((e) => h('div', { class: 'mk-say' }, face(e.b), h('b', { class: 'mk-who' }, ui.name(e.b)), h('span', null, `「${mkLine(e.b, e.kind === 'broken' ? 'react_broken' : 'react_lie', { good: gname(e.good ?? 0) }, l.period)}」`))));
}

/** 相手の返事（自分が出した申し出の結果） */
function replyLine(o: Offer, ui: MatchUi): Child {
  const who = o.to;
  let key: Parameters<typeof mkLine>[1];
  let vars: Record<string, string | number> = {};
  if (o.req.kind === 'swap') key = o.status === 'accepted' ? 'swap_yes' : o.status === 'countered' ? 'swap_counter' : 'swap_no';
  else if (o.req.kind === 'ask') {
    const a = o.answer;
    vars = { good: gname(o.req.good) };
    if (!a) key = 'ask_refuse';
    else if (a.value !== undefined) { key = 'ask_value'; vars.value = sgn(a.value); } else { key = 'ask_vague'; vars.dir = dirOf(a); }
  } else key = 'told';
  const got = o.got?.length ? h('span', { class: 'mk-got' }, o.got.map((x) => `${gname(x.good)} ${sgn(x.value)}`).join('、')) : null;
  return h('div', { class: 'mk-say' }, face(who), h('b', { class: 'mk-who' }, ui.name(who)), h('span', null, `「${mkLine(who, key, vars, o.id)}」`), got);
}

function inboxCard(v: MkView, ui: MatchUi, L: Local, o: Offer): HTMLElement {
  const who = o.from;
  const reply = (L.reply ??= {});
  if (o.req.kind === 'swap') {
    const pick = reply[o.id] ?? 0;
    return h('div', { class: 'mk-offer' }, h('div', { class: 'mk-say' }, face(who), h('b', { class: 'mk-who' }, ui.name(who)), h('span', null, `「${mkLine(who, o.req.keep ? 'invite_keep' : 'invite_swap', {}, o.id)}」`)),
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, h('small', { class: 'dim' }, t('mk.pickShow')), v.cards.map((c, i) => button(`${gname(c.good)} ${sgn(c.value)}`, () => { reply[o.id] = i; ui.rerender(); }, { small: true, kind: pick === i ? 'primary' : 'ghost' }))),
      h('div', { class: 'row', style: 'gap:6px' }, button(t('mk.accept'), () => ui.submit({ t: 'reply', offer: o.id, accept: true, give: [pick] } satisfies MkMove), { small: true, kind: 'primary' }), button(t('mk.refuse'), () => ui.submit({ t: 'reply', offer: o.id, accept: false } satisfies MkMove), { small: true })));
  }
  const good = (o.req as { good: number }).good;
  const known = v.cards.filter((c) => c.good === good).map((c) => c.value).concat(v.shown.filter((x) => x.good === good).map((x) => x.value));
  const best = known.sort((a, b) => Math.abs(b) - Math.abs(a))[0];
  const ans = (answer: { value?: number; sign?: 1 | -1 } | null) => ui.submit({ t: 'reply', offer: o.id, accept: answer !== null, answer } satisfies MkMove);
  return h('div', { class: 'mk-offer' }, h('div', { class: 'mk-say' }, face(who), h('b', { class: 'mk-who' }, ui.name(who)), h('span', null, `「${mkLine(who, 'invite_ask', { good: gname(good) }, o.id)}」`)),
    h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
      best !== undefined ? button(t('mk.ansTrue', { v: sgn(best) }), () => ans({ value: best }), { small: true, kind: 'primary' }) : null,
      button(t('mk.ansUp'), () => ans({ sign: 1 }), { small: true }), button(t('mk.ansDown'), () => ans({ sign: -1 }), { small: true }),
      button(t('mk.ansNo'), () => ans(null), { small: true, kind: 'ghost' })));
}

function talkPanel(v: MkView, ui: MatchUi, L: Local): Child[] {
  const me = v.self as CharId;
  const others = v.players.filter((p) => p !== me);
  const out: Child[] = [];
  for (const o of v.inbox) out.push(inboxCard(v, ui, L, o));
  for (const c of v.claims.filter((x) => x.period === v.period && !v.sent.some((o) => o.req.kind === 'ask' && o.to === x.from && (o.req as { good: number }).good === x.good)))
    out.push(h('div', { class: 'mk-say' }, face(c.from), h('b', { class: 'mk-who' }, ui.name(c.from)), h('span', null, `「${c.value !== undefined ? mkLine(c.from, 'tell', { good: gname(c.good), value: sgn(c.value) }) : mkLine(c.from, 'ask_vague', { good: gname(c.good), dir: dirOf(c) })}」`)));
  for (const o of v.sent) out.push(replyLine(o, ui));
  // 相手を選ぶ
  out.push(h('div', { class: 'mk-faces' }, others.map((p) => {
    const b = h('button', { class: `mk-face${L.sel === p ? ' sel' : ''}${v.liars.includes(p) ? ' liar' : ''}${v.partners.includes(p) ? ' partner' : ''}`, type: 'button', 'data-who': p }, face(p), h('small', null, ui.name(p)), h('small', { class: 'mk-fa' }, String(v.assets[p]?.at(-1) ?? 0)));
    b.addEventListener('click', () => { L.sel = L.sel === p ? undefined : p; L.mode = undefined; Sound.se('select'); ui.rerender(); });
    return b;
  })));
  const sel = L.sel;
  if (sel) {
    const give = L.give ?? 0;
    out.push(h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
      button(t('mk.doSwap'), () => { L.mode = 'swap'; ui.rerender(); }, { small: true, kind: L.mode === 'swap' ? 'primary' : undefined }),
      button(t('mk.doAsk'), () => { L.mode = 'ask'; ui.rerender(); }, { small: true, kind: L.mode === 'ask' ? 'primary' : undefined }),
      button(t('mk.doTell'), () => { L.mode = 'tell'; ui.rerender(); }, { small: true, kind: L.mode === 'tell' ? 'primary' : undefined }),
      v.partners.includes(sel) ? button(t('mk.doCancel'), () => ui.submit({ t: 'cancel', to: sel } satisfies MkMove), { small: true, kind: 'ghost' }) : null));
    if (L.mode === 'swap') {
      const countered = v.sent.some((o) => o.to === sel && o.req.kind === 'swap' && o.status === 'countered');
      out.push(h('div', { class: 'col', style: 'gap:6px' }, h('small', { class: 'dim' }, t(countered ? 'mk.counterNote' : 'mk.pickShow')),
        h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, v.cards.map((c, i) => button(`${gname(c.good)} ${sgn(c.value)}`, () => { L.give = i; ui.rerender(); }, { small: true, kind: give === i ? 'primary' : 'ghost' }))),
        h('label', { class: 'small row', style: 'gap:6px;align-items:center' }, (() => { const cb = h('input', { type: 'checkbox' }) as HTMLInputElement; cb.checked = !!L.keep; cb.addEventListener('change', () => { L.keep = cb.checked; }); return cb; })(), t('mk.keep')),
        button(t(countered ? 'mk.sendSwap2' : 'mk.sendSwap'), () => ui.submit({ t: 'swap', to: sel, give: countered ? [give, (give + 1) % Math.max(1, v.cards.length)] : [give], keep: !!L.keep } satisfies MkMove), { small: true, kind: 'primary' })));
    }
    if (L.mode === 'ask' || L.mode === 'tell') {
      const g = L.good ?? 0;
      out.push(h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, GOODS.map((_, i) => button(gname(i), () => { L.good = i; ui.rerender(); }, { small: true, kind: g === i ? 'primary' : 'ghost' }))));
      if (L.mode === 'ask') out.push(button(t('mk.sendAsk', { good: gname(g) }), () => ui.submit({ t: 'ask', to: sel, good: g } satisfies MkMove), { small: true, kind: 'primary' }));
      else {
        const val = L.value ?? 2;
        out.push(h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, [-2, -1, 0, 1, 2].map((x) => button(sgn(x), () => { L.value = x; ui.rerender(); }, { small: true, kind: val === x ? 'primary' : 'ghost' }))),
          h('small', { class: 'dim' }, t('mk.tellNote')),
          button(t('mk.sendTell', { good: gname(g), v: sgn(val) }), () => ui.submit({ t: 'tell', to: sel, good: g, value: val } satisfies MkMove), { small: true, kind: 'primary' }));
      }
    }
  }
  return out;
}

function standings(v: MkView, ui: MatchUi): HTMLElement {
  const me = v.self;
  const cur = (p: CharId) => v.assets[p]?.at(-1) ?? 0;
  const order = [...v.players].sort((a, b) => cur(b) - cur(a));
  return h('div', { class: 'm01-rank' }, order.map((p, i) => h('div', { class: `m01-rankrow${p === me ? ' me' : ''}` }, h('span', { class: 'no' }, String(i + 1)), face(p), h('span', { class: 'nm' }, ui.name(p)), h('b', null, String(cur(p))))));
}

export function renderMk(v: MkView, ui: MatchUi): { main: Child; side: Child } {
  const L = ui.local as Local;
  const me = v.self;
  if (me !== 'spectator') applyMarketSocial(ui.state, ui.slot.state as MkState);
  const hero = ui.state.actors.hero;
  const playing = me !== 'spectator';
  const top = h('div', { class: 'mk-top' },
    h('div', { class: 'mk-coins' }, h('small', null, t('mk.coins')), h('b', null, String(v.coins))),
    h('div', { class: 'mk-coins' }, h('small', null, t('mk.asset')), h('b', null, String(playing ? v.assets[me as CharId]?.at(-1) ?? 0 : 0))),
    v.phase === 'talk' && playing ? h('div', { class: 'small dim grow' }, t('mk.talkLead')) : v.phase === 'order' && playing ? h('div', { class: 'small dim grow' }, t('mk.orderLead', { k: v.impactK, cap: IMPACT_CAP })) : h('div', { class: 'grow' }),
    v.phase === 'talk' && playing && !v.extraUsed ? button(t('mk.extra', { n: EXTRA_COST }), () => {
      if (hero.pieces < EXTRA_COST || !ui.engine.validate(ui.slot.state, 'hero', { t: 'extra' }) || !transfer(ui.state, 'hero', 'host', EXTRA_COST, '市場予測 予報札')) { Sound.se('error'); return; }
      ui.submit({ t: 'extra' } satisfies MkMove);
    }, { small: true, cls: 'mk-extra' }) : null,
    v.phase === 'talk' && playing ? button(t('mk.ready'), () => ui.submit({ t: 'ready' } satisfies MkMove), { kind: 'primary', cls: 'mk-ready' }) : null,
    v.phase === 'order' && playing && !v.submitted ? button(t('mk.sendOrder'), () => ui.submit({ t: 'order', q: L.q ?? GOODS.map(() => 0) } satisfies MkMove), { kind: 'primary', cls: 'mk-send' }) : null);
  if (v.phase === 'order' && playing && !v.submitted) ui.timeoutMove = () => ({ t: 'order', q: L.q ?? GOODS.map(() => 0) });
  const main = h('div', { class: 'mk-main' }, top, board(v, ui, L), v.last ? null : h('div', { class: 'mk-note small dim' }, t('mk.firstNote', { k: v.impactK, cap: IMPACT_CAP })));
  // 相談の間は、右の欄を相談に使う（資産は顔の下に出す）。注文の間と観戦中は、資産の順位
  const talking = v.phase === 'talk' && playing;
  const side = h('div', { class: 'col', style: 'gap:8px;min-height:0;height:100%' },
    talking ? h('div', { class: 'box scroll grow mk-talk' }, lastBox(v, ui), h('h4', null, t('mk.talk')), ...talkPanel(v, ui, L)) : h('div', { class: 'box scroll grow' }, lastBox(v, ui), h('h4', null, t('mk.rank')), standings(v, ui)));
  return { main, side };
}
