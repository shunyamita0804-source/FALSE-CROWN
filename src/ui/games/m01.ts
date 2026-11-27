import { Sound } from '../../audio/audio';
import type { CharId, NpcId } from '../../data/characters';
import { t } from '../../i18n/i18n';
import { HOARD_LIMIT, moveLabel, NATION_COLORS, NATIONS, PTS, TERRITORY_NAMES, type M01Move, type M01View } from '../../matches/m01';
import { face } from '../art';
import { button, choose, h, type Child } from '../dom';
import type { MatchUi } from '../matchui';

type Sel = { t: 'invade' | 'defend'; terr: number | null } | { t: 'produce' | 'hoard' } | { t: 'spy'; target: CharId | null } | null;

export function renderM01(v: M01View, ui: MatchUi): { main: Child; side: Child } {
  const me = v.self as CharId;
  const myNation = v.nation[me] ?? -1;
  const sel = (ui.local.sel as Sel) ?? null;
  const setSel = (x: Sel) => {
    ui.local.sel = x;
    Sound.se('select');
    ui.rerender();
  };
  const terrCount = (n: number) => v.owner.filter((o) => o === n).length;
  const last = v.reports[v.reports.length - 1];
  const changed = new Set((last ?? []).filter((r) => r.before !== r.after).map((r) => r.terr));
  const acting = v.stage === 'act' && !v.submitted;

  const nations = h('div', { class: 'nation-row' }, NATIONS.map((n, i) => h('div', { class: `nation${i === myNation ? ' mine' : ''}`, style: `--nc:${NATION_COLORS[i]}` },
    h('b', null, `${n}${t('m01.nation')}`), i === myNation ? h('span', { class: 'tag fact' }, t('m01.mine')) : null,
    h('div', { class: 'small' }, t('m01.nationInfo', { res: v.resources[i], terr: terrCount(i) })))));

  const map = h('div', { class: 'm01-map' }, TERRITORY_NAMES.map((name, i) => {
    const o = v.owner[i];
    const selected = sel && (sel.t === 'invade' || sel.t === 'defend') && sel.terr === i;
    const rep = last?.find((r) => r.terr === i);
    return h('button', { type: 'button', class: `terr${selected ? ' sel' : ''}${changed.has(i) ? ' changed' : ''}`, style: `--nc:${o === null ? '#6a7088' : NATION_COLORS[o]}`, disabled: !acting, onclick: () => {
      if (!acting) return;
      if (o === myNation) setSel({ t: 'defend', terr: i });
      else setSel({ t: 'invade', terr: i });
    } }, h('b', null, name), h('small', null, o === null ? t('m01.neutral') : `${NATIONS[o]}${t('m01.nation')}`),
    rep && (rep.attack.some((a) => a > 0) || rep.defense > 0) ? h('small', null, `${t('m01.atk')} ${rep.attack.map((a, n) => (a ? `${NATIONS[n]}${a}` : '')).filter(Boolean).join(' ') || '0'}／${t('m01.def')} ${rep.defense}`) : null);
  }));

  const status = h('div', { class: 'box row', style: 'gap:18px;flex-wrap:wrap' },
    h('span', null, t('m01.round', { r: Math.min(v.round, 5) })),
    h('span', null, t('m01.myPoints', { p: v.myPoints ?? 0 })),
    h('span', null, t('m01.terrPoints', { p: myNation >= 0 ? terrCount(myNation) * 2 : 0 })),
    h('span', null, t('m01.hoards', { n: v.myHoards, max: HOARD_LIMIT })),
    v.shortfall.includes(v.round - 1) ? h('span', { class: 'bad' }, t('m01.shortfall')) : null,
  );

  let controls: Child = null;
  if (v.stage === 'negotiate' && !v.submitted) {
    controls = h('div', { class: 'box col', style: 'gap:8px' }, h('h4', null, t('m01.negoTitle')), h('div', { class: 'small' }, t('m01.negoText')),
      h('div', { class: 'row' }, button(t('m01.negoEnd'), () => ui.submit({ t: 'ready' } satisfies M01Move), { kind: 'primary', autofocus: true })));
  } else if (acting) {
    const res = v.resources[myNation];
    const move: M01Move | null = !sel ? null : sel.t === 'invade' || sel.t === 'defend' ? (sel.terr === null ? null : { t: sel.t, terr: sel.terr }) : sel.t === 'spy' ? (sel.target ? { t: 'spy', target: sel.target } : null) : { t: sel.t };
    const opt = (key: 'invade' | 'defend' | 'produce' | 'hoard' | 'spy', hint: string, disabled: boolean, onclick: () => void) =>
      h('button', { type: 'button', class: `btn btn-secondary${sel?.t === key ? ' selected' : ''}`, disabled, onclick }, h('span', null, t(`m01.act.${key}`), h('small', null, hint)));
    controls = h('div', { class: 'box col', style: 'gap:8px' },
      h('h4', null, t('m01.actTitle')),
      h('div', { class: 'act-grid' },
        opt('invade', t('m01.hint.invade', { p: PTS.invade }), false, () => setSel({ t: 'invade', terr: null })),
        opt('defend', t('m01.hint.defend', { p: PTS.defend }), false, () => setSel({ t: 'defend', terr: null })),
        opt('produce', t('m01.hint.produce', { p: PTS.produce }), false, () => setSel({ t: 'produce' })),
        opt('hoard', t('m01.hint.hoard', { p: PTS.hoard }), v.myHoards >= HOARD_LIMIT, () => setSel({ t: 'hoard' })),
        opt('spy', t('m01.hint.spy', { p: PTS.spy }), v.round <= 1, async () => {
          const others = v.players.filter((p) => p !== me);
          const target = await choose<CharId | null>(t('m01.act.spy'), t('m01.spyAsk'), [...others.map((p) => ({ label: `${ui.name(p)}（${NATIONS[v.nation[p]]}）`, value: p as CharId | null })), { label: t('common.cancel'), value: null }], { cancel: null, pauses: false });
          if (target) setSel({ t: 'spy', target });
        }),
      ),
      h('div', { class: 'row', style: 'gap:12px' },
        h('span', { class: 'grow' }, move ? t('m01.chosen', { x: moveLabel(move, ui.name) }) : sel && (sel.t === 'invade' || sel.t === 'defend') ? t(sel.t === 'invade' ? 'm01.pickEnemy' : 'm01.pickOwn') : t('m01.pick')),
        h('span', { class: 'dim small' }, t('m01.resNote', { res })),
        button(t('common.confirm'), () => {
          if (!move) return;
          Sound.se('chip');
          ui.submit(move);
        }, { kind: 'primary', disabled: !move }),
      ),
      h('div', { class: 'dim small' }, t('m01.timeoutNote')),
    );
  } else if (v.stage === 'done') {
    controls = h('div', { class: 'box' }, t('m01.finished'));
  }

  const report = last ? h('div', { class: 'box' }, h('h4', null, t('m01.lastReport', { r: v.reports.length })),
    ...last.filter((r) => r.attack.some((a) => a > 0)).map((r) => h('div', { class: 'logline' }, `${TERRITORY_NAMES[r.terr]}：${t('m01.atk')} ${r.attack.map((a, n) => (a ? `${NATIONS[n]}${a}` : '')).filter(Boolean).join('・')}／${t('m01.def')} ${r.defense}　→　${r.before !== r.after ? t('m01.taken', { n: r.after === null ? '' : NATIONS[r.after] }) : t('m01.held')}`)),
    last.every((r) => !r.attack.some((a) => a > 0)) ? h('div', { class: 'logline dim' }, t('m01.noAttack')) : null) : null;

  const mine = h('div', { class: 'box scroll', style: 'max-height:150px' }, h('h4', null, t('m01.myLog')),
    ...v.myHistory.map((m, i) => h('div', { class: 'logline' }, `R${i + 1}　${moveLabel(m, ui.name)}　${v.gains.filter((g) => g.round === i + 1).map((g) => `${g.text}+${g.pts}`).join(' ')}`)),
    ...v.intel.map((x) => h('div', { class: 'logline gold' }, t('m01.intel', { r: x.round, name: ui.name(x.target), x: moveLabel(x.action, ui.name) }))),
    !v.myHistory.length ? h('div', { class: 'dim small' }, t('m01.noLog')) : null);

  const side = h('div', { class: 'box scroll grow' }, h('h4', null, t('m01.members')), h('div', { class: 'plist' }, [0, 1, 2].flatMap((n) => v.players.filter((p) => v.nation[p] === n).map((p) =>
    h('div', { class: `prow${p === me ? ' me' : ''}` }, h('span', { class: 'dot', style: `background:${NATION_COLORS[n]}` }), face(p), h('span', { class: 'nm' }, ui.name(p)),
      v.finalScores ? h('b', null, String(v.finalScores[p])) : p !== me && v.stage === 'negotiate' && !v.submitted ? button(t('match.talk'), () => ui.talk(p as NpcId), { small: true }) : null)))));

  return { main: [nations, status, map, controls, report, mine], side };
}
