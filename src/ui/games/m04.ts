/**
 * M04 鉄道王国・改の画面。地図を左に大きく置き、右に自分の資金、任務、行動を並べる。
 * 区間をタップして選び、「敷く」で確定する。任務の札をタップすると、達成までの道筋が地図に出る。
 */
import { Sound } from '../../audio/audio';
import { transfer } from '../../core/state';
import type { CharId, NpcId } from '../../data/characters';
import { t } from '../../i18n/i18n';
import { AID_COST, CITY_NAMES, EDGES, INCOME, planFor, routeFor, type M04Move, type M04View, type Mission, type RailLog } from '../../matches/m04';
import { face } from '../art';
import { button, confirmDialog, h, type Child } from '../dom';
import type { MatchUi } from '../matchui';
import { RailMap, SEAT_COLORS } from '../railmap';

interface Local { map?: RailMap; sel?: number; ms?: number; cand?: number }

const routeName = (m: Mission) => `${CITY_NAMES[m.from]} → ${CITY_NAMES[m.to]}`;
const edgeName = (e: number) => `${CITY_NAMES[EDGES[e][0]]}–${CITY_NAMES[EDGES[e][1]]}`;

function logLine(v: M04View, ui: MatchUi, l: RailLog): Child {
  const who = ui.name(v.table.players[l.seat]);
  if (l.kind === 'fund') return h('div', null, h('b', null, who), ' ', t('m04.logFund', { n: INCOME }));
  if (l.kind === 'build') return h('div', null, h('b', null, who), ' ', t('m04.logBuild', { e: edgeName(l.edge!) }));
  return h('div', null, h('b', null, who), ' ', t('m04.logMove', { r: routeName(l.mission!), p: l.mission!.points, toll: l.toll ?? 0 }));
}

function seats(v: M04View, ui: MatchUi): HTMLElement {
  const tb = v.table;
  return h('div', { class: 'col', style: 'gap:2px' }, tb.players.map((p, i) => h('div', { class: `m04-seat${tb.toMove === i && v.phase === 'play' ? ' turn' : ''}` },
    h('i', { class: 'sw', style: `background:${SEAT_COLORS[i % SEAT_COLORS.length]}` }), face(p), h('span', { class: 'nm' }, h('span', null, ui.name(p)),
      h('small', null, t('m04.seatInfo', { f: tb.funds[i], b: tb.built[i], d: tb.doneMissions[i].length }))), h('b', null, String(v.totals[p])))));
}

function standings(v: M04View, ui: MatchUi, limit: number): HTMLElement {
  const me = v.self as CharId;
  const order = [...v.players].sort((a, b) => v.totals[b] - v.totals[a]);
  return h('div', { class: 'm01-rank' }, order.slice(0, limit).map((p, i) => h('div', { class: `m01-rankrow${p === me ? ' me' : ''}${v.table.players.includes(p) && p !== me ? ' mate' : ''}` },
    h('span', { class: 'no' }, String(i + 1)), face(p), h('span', { class: 'nm' }, ui.name(p)), h('b', null, String(v.totals[p])))));
}

export function renderM04(v: M04View, ui: MatchUi): { main: Child; side: Child } {
  const me = v.self as CharId;
  const L = ui.local as Local;
  const tb = v.table;
  const marks = tb.players.map((p) => ui.name(p).slice(0, 1));
  const playing = v.self !== 'spectator' && v.seat >= 0;
  const myTurn = playing && v.phase === 'play' && tb.toMove === v.seat;
  if (!L.map) {
    L.map = new RailMap((e) => {
      if (!(ui.local as Local).map) return;
      const cur = ui.local as Local;
      cur.sel = cur.sel === e ? undefined : e;
      Sound.se('select');
      ui.rerender();
    });
  }
  // 直前の自分の手より後に敷かれた区間を目立たせる
  const lastMine = tb.log.map((l) => l.seat).lastIndexOf(v.seat);
  const fresh = tb.log.slice(lastMine + 1).filter((l) => l.kind === 'build').map((l) => l.edge!);
  const selMs = L.ms !== undefined ? (v.phase === 'setup' && v.aid && !v.aid.picked && L.cand !== undefined ? v.aid.cands[L.cand] : v.missions[L.ms]) : undefined;
  const plan = selMs && !selMs.done && v.seat >= 0 ? planFor(tb, v.seat, selMs) : null;
  const planRoute = selMs && v.seat >= 0 ? (routeFor(tb, v.seat, selMs.from, selMs.to)?.edges ?? (plan ? [...plan.builds] : [])) : undefined;
  const sel = myTurn && L.sel !== undefined && tb.owner[L.sel] < 0 ? L.sel : undefined;
  L.map.draw({ costs: tb.costs, owner: tb.owner, marks, sel, route: selMs ? planRoute : undefined, cities: selMs ? [selMs.from, selMs.to] : undefined, fresh });

  const funds = v.seat >= 0 ? tb.funds[v.seat] : 0;
  const msCard = (m: Mission, i: number, opts: { cand?: number } = {}): HTMLElement => {
    const r = v.seat >= 0 && !m.done ? routeFor(tb, v.seat, m.from, m.to) : null;
    const p = v.seat >= 0 && !m.done ? planFor(tb, v.seat, m) : null;
    const state = m.done ? t('m04.msDone') : r ? t('m04.msReady', { toll: r.toll }) : p ? t('m04.msNeed', { n: p.builds.length, c: p.cost, toll: p.toll }) : '';
    const on = opts.cand !== undefined ? L.cand === opts.cand : L.ms === i && L.cand === undefined;
    const el = h('div', { class: `m04-ms${m.done ? ' done' : ''}${on ? ' sel' : ''}`, 'data-ms': String(opts.cand ?? i) },
      h('span', { class: 'rt' }, routeName(m)), h('span', { class: 'pt' }, t('m04.pts', { p: m.points })), h('span', { class: 'st' }, state),
      myTurn && r && !m.done && r.toll <= funds ? button(t('m04.move'), () => ui.submit({ t: 'transport', mission: i } satisfies M04Move), { small: true, kind: 'primary' }) : null);
    el.addEventListener('click', () => {
      if (opts.cand !== undefined) { L.cand = L.cand === opts.cand ? undefined : opts.cand; L.ms = i; } else { L.ms = L.ms === i && L.cand === undefined ? undefined : i; L.cand = undefined; }
      ui.rerender();
    });
    return el;
  };

  const col: Child[] = [];
  if (playing) {
    col.push(h('div', { class: 'm04-me' }, face(me), h('span', { class: 'm04-fund' }, String(funds)),
      h('span', { class: 'small dim' }, v.phase === 'done' ? '' : t('m04.turnsLeft', { n: tb.turnsLeft }))));
    col.push(...v.missions.map((m, i) => msCard(m, i)));
  }
  if (v.phase === 'setup' && playing) {
    const hero = ui.state.actors.hero;
    if (v.ready[me]) col.push(h('div', { class: 'm04-note gold' }, t('m03.waiting')));
    else if (v.aid && !v.aid.picked) {
      col.push(h('div', { class: 'm04-note gold' }, t('m04.pickCand', { r: routeName(v.missions[v.aid.mission]) })),
        h('div', { class: 'm04-cands' }, v.aid.cands.map((c, k) => msCard(c, v.aid!.mission, { cand: k }))),
        h('div', { class: 'm04-acts' }, v.aid.cands.map((c, k) => button(t('m04.take', { r: routeName(c) }), () => { L.cand = undefined; ui.submit({ t: 'pick', c: k as 0 | 1 } satisfies M04Move); }, { small: true, kind: k === (L.cand ?? -1) ? 'primary' : 'secondary' }))));
    } else {
      const canAid = !v.aid && hero.pieces >= AID_COST && L.ms !== undefined;
      col.push(h('div', { class: 'm04-note' }, t(v.aid ? 'm04.setupDone' : 'm04.setupNote', { n: AID_COST })),
        h('div', { class: 'm04-acts' },
          v.aid ? null : button(t('m04.swap', { n: AID_COST }), async () => {
            const i = L.ms;
            if (i === undefined) return;
            if (!(await confirmDialog(t('m01.hintTitle'), t('m04.swapText', { n: AID_COST, r: routeName(v.missions[i]), have: hero.pieces }), { ok: t('m01.hintOk', { n: AID_COST }), cancel: t('common.cancel'), pauses: false }))) return;
            if (hero.pieces < AID_COST || !transfer(ui.state, 'hero', 'host', AID_COST, 'M04 任務の交換')) return;
            Sound.se('coins');
            ui.submit({ t: 'aid', mission: i } satisfies M04Move);
          }, { small: true, disabled: !canAid, title: t('m04.swapOnce') }),
          button(t('m03.start'), () => ui.submit({ t: 'ready' } satisfies M04Move), { kind: 'primary', autofocus: true })));
    }
  } else if (v.phase === 'play' && playing) {
    const cost = sel !== undefined ? tb.costs[sel] : 0;
    col.push(h('div', { class: 'm04-acts' },
      button(sel !== undefined ? t('m04.build', { e: edgeName(sel), c: cost }) : t('m04.buildNone'), () => { const e = sel!; L.sel = undefined; ui.submit({ t: 'build', edge: e } satisfies M04Move); }, { kind: 'primary', disabled: !myTurn || sel === undefined || cost > funds }),
      button(t('m04.fund', { n: INCOME }), () => ui.submit({ t: 'fund' } satisfies M04Move), { disabled: !myTurn })),
      h('div', { class: 'm04-note' }, !myTurn ? t('m04.wait') : sel !== undefined && cost > funds ? h('span', { class: 'bad' }, t('m04.short', { c: cost, f: funds })) : t('m04.hint')));
  } else if (v.phase === 'break' && playing) {
    col.push(h('div', { class: 'm04-note gold' }, t('m04.breakNote')),
      h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, tb.players.filter((p) => p !== me).map((p) => button([face(p), ui.name(p)], () => ui.talk(p as NpcId), { small: true }))),
      v.ready[me] ? null : button(t('m04.resume'), () => ui.submit({ t: 'ready' } satisfies M04Move), { kind: 'primary', autofocus: true }));
  } else if (v.phase === 'done') {
    col.push(h('div', { class: 'm01-big' }, t('p01.finished')), playing ? h('div', { class: 'm04-note' }, t('m04.final', { m: v.missions.filter((m) => m.done).reduce((n, m) => n + m.points, 0), b: tb.built[v.seat], f: Math.floor(funds / 3), s: v.totals[me] })) : null);
  }

  const side = [
    h('div', { class: 'box' }, h('h4', null, t('m04.table')), seats(v, ui), h('div', { class: 'small dim', style: 'margin-top:2px' }, t('m04.seatLegend'))),
    h('div', { class: 'box' }, h('h4', null, t('m04.log')), h('div', { class: 'm04-log' }, tb.log.length ? tb.log.slice(-4).map((l) => logLine(v, ui, l)) : t('m04.logNone'))),
    h('div', { class: 'box scroll grow' }, h('h4', null, t('m01.rank')), standings(v, ui, v.phase === 'done' ? 12 : 4)),
  ];
  return { main: [h('div', { class: 'm04-play' }, L.map.el, h('div', { class: 'm04-col' }, col))], side };
}
