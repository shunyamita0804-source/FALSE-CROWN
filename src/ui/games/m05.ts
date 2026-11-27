/**
 * M05 ナンバー・リレーの画面。数字カードと記号を直接タップして式を組む。
 * 出題の段階：出題担当だけが、カードを見ながら目標を 3 つの候補から選び、組の人へ先に教えるかどうかを決める。
 * 準備の段階：直前の結果と解答例、次のラウンドの組、担当から教わった内容（教わった時だけ）を見せる。
 */
import { Sound } from '../../audio/audio';
import { transfer } from '../../core/state';
import type { CharId, NpcId } from '../../data/characters';
import { t } from '../../i18n/i18n';
import { EXTRA_COST, EXTRA_MAX, SOLVE_MS, TEAM_BONUS, TIME_MAX, type M05Move, type M05Result, type M05View } from '../../matches/m05';
import { face } from '../art';
import { button, confirmDialog, h, type Child } from '../dom';
import { ExprPad, exprEl } from '../exprpad';
import type { MatchUi } from '../matchui';

interface Local { pad?: ExprPad; pick?: number; tell?: boolean; timer?: ReturnType<typeof setInterval> }

function standings(v: M05View, ui: MatchUi, limit = 8): HTMLElement {
  const order = [...v.players].sort((a, b) => v.totals[b] - v.totals[a]);
  const mates = v.teams[v.team] ?? [];
  return h('div', { class: 'm01-rank' }, order.slice(0, limit).map((p, i) => h('div', { class: `m01-rankrow${p === v.self ? ' me' : ''}${p !== v.self && mates.includes(p) ? ' mate' : ''}` },
    h('span', { class: 'no' }, String(i + 1)), face(p), h('span', { class: 'nm' }, ui.name(p)), h('b', null, String(v.totals[p])))));
}

const numCards = (cards: number[], extra: number | null) => h('div', { class: 'm05-nums' }, cards.map((c, i) => h('b', { class: `xp-card mini${extra !== null && i === cards.length - 1 ? ' extra' : ''}` }, String(c))));

function teamRow(v: M05View, ui: MatchUi, talk: boolean): HTMLElement {
  const me = v.self as CharId;
  return h('div', { class: 'm05-team' }, (v.teams[v.team] ?? []).map((p) => {
    const el = h(talk && p !== me ? 'button' : 'div', { class: `m05-mate${p === v.setter ? ' setter' : ''}${p === me ? ' me' : ''}`, type: 'button', title: ui.name(p) }, face(p), h('span', { class: 'nm' }, ui.name(p)), p === v.setter ? h('i', { class: 'tag' }, t('m05.setterTag')) : null);
    if (talk && p !== me) el.addEventListener('click', () => ui.talk(p as NpcId));
    return el;
  }));
}

function resultBox(v: M05View, r: M05Result, roundNo: number): Child {
  const mates = v.players.filter((p) => v.results[p][roundNo - 1]?.team === r.team);
  return [
    h('div', { class: 'm01-big' }, t('m03.roundResult', { n: roundNo })),
    h('div', { class: 'm05-mine' }, h('small', { class: 'dim' }, t('m05.targetWas', { n: r.target })),
      r.correct ? exprEl(r.toks, r.cards, 'small') : h('span', { class: 'dim' }, t('m05.noAnswer'))),
    h('div', { class: 'm01-score' },
      h('div', { class: `m01-chip${r.correct ? ' on' : ''}` }, h('small', null, t(r.correct ? 'm05.correctN' : 'm05.wrong', { n: r.used })), h('b', null, String(r.points))),
      h('span', { class: 'plus' }, '+'),
      h('div', { class: `m01-chip fin-hide${r.bonus ? ' on' : ''}` }, h('small', null, t('m05.teamAll')), h('b', null, String(r.bonus))),
      h('span', { class: 'plus' }, '='),
      h('div', { class: 'm01-chip total' }, h('small', null, t('m03.roundPts')), h('b', null, String(r.points + r.bonus)))),
    h('div', { class: 'm05-marks' }, mates.map((p) => { const x = v.results[p][roundNo - 1]; return h('span', { class: `m05-mark${x.correct ? ' ok' : ' ng'}` }, face(p), h('b', null, x.correct ? `○ ${x.used}` : '✕')); })),
    v.lastExample && v.lastExample.sols.length ? h('div', { class: 'm05-ex' }, h('small', { class: 'dim' }, t('m05.example')), v.lastExample.sols.slice(0, r.correct ? 1 : 2).map((sol) => exprEl(sol, v.lastExample!.cards, 'small'))) : null,
  ];
}

const candRow = (v: M05View, sel: number | null, onPick?: (i: number) => void) => h('div', { class: 'm05-cands' }, v.cands.map((c, i) => {
  const el = h(onPick ? 'button' : 'div', { class: `m05-cand${sel === i ? ' sel' : ''}`, type: 'button' }, String(c));
  if (onPick) el.addEventListener('click', () => onPick(i));
  return el;
}));

export function renderM05(v: M05View, ui: MatchUi): { main: Child; side: Child } {
  const me = v.self as CharId;
  const L = ui.local as Local;
  const watching = v.self === 'spectator';
  const rank = h('div', { class: 'box scroll grow' }, h('h4', null, t('m01.rank')), standings(v, ui));
  const prev = v.round > 0 || v.phase === 'done' ? v.results[me]?.[v.phase === 'done' ? v.rounds - 1 : v.round - 1] : undefined;

  if (v.phase === 'done' || watching) {
    return { main: [h('div', { class: 'm01-break' }, prev && !watching ? resultBox(v, prev, v.rounds) : h('div', { class: 'm01-big' }, t('m03.watching')))], side: [rank] };
  }

  if (v.phase === 'pick') {
    if (!v.isSetter) return { main: [h('div', { class: 'm01-break' }, h('div', { class: 'm01-big' }, t('m05.pickWait', { name: ui.name(v.setter!) })), candRow(v, null))], side: [rank] };
    const pick = L.pick ?? 0;
    const tell = L.tell ?? true;
    const main = h('div', { class: 'm05-pick' },
      h('div', { class: 'm01-big' }, t('m05.pickTitle', { n: v.round + 1 })),
      h('div', { class: 'small' }, t('m05.pickText')),
      numCards(v.cards ?? [], null),
      candRow(v, pick, (i) => { L.pick = i; Sound.se('select'); ui.rerender(); }),
      h('div', { class: 'm05-tell' }, h('span', { class: 'small' }, t('m05.tellAsk')),
        h('div', { class: 'seg' }, button(t('m05.tellYes'), () => { L.tell = true; ui.rerender(); }, { small: true, kind: tell ? 'primary' : undefined }), button(t('m05.tellNo'), () => { L.tell = false; ui.rerender(); }, { small: true, kind: tell ? undefined : 'primary' }))),
      h('div', { class: 'small dim' }, t('m05.tellNote', { b: TEAM_BONUS })),
      button(t('m05.pickOk', { n: v.cands[pick] }), () => ui.submit({ t: 'set', pick, tell } satisfies M05Move), { kind: 'primary', autofocus: true }));
    ui.timeoutMove = () => ({ t: 'set', pick: L.pick ?? 0, tell: L.tell ?? true } satisfies M05Move);
    return { main, side: [h('div', { class: 'box fin-hide' }, h('h4', null, t('m05.team')), teamRow(v, ui, false)), rank] };
  }

  if (v.phase === 'prep') {
    const waiting = !!v.ready[me];
    const hero = ui.state.actors.hero;
    const extraBtn = v.hasExtra ? h('span', { class: 'gold small' }, t('m05.extraOn')) : button(t('m05.extra', { n: EXTRA_COST }), async () => {
      const left = EXTRA_MAX - v.extraUsed;
      if (!(await confirmDialog(t('m05.extraTitle'), t('m05.extraText', { n: EXTRA_COST, have: hero.pieces, left }), { ok: t('mq.boostOk', { n: EXTRA_COST }), cancel: t('common.cancel'), pauses: true }))) return;
      if (!ui.engine.validate(ui.slot.state, 'hero', { t: 'extra' }) || hero.pieces < EXTRA_COST || !transfer(ui.state, 'hero', 'host', EXTRA_COST, 'M05 追加カード')) return;
      Sound.se('coins');
      ui.submit({ t: 'extra' } satisfies M05Move);
    }, { small: true, cls: 'fin-hide', disabled: waiting || v.extraUsed >= EXTRA_MAX || hero.pieces < EXTRA_COST });
    const info: Child = v.isSetter
      ? [h('div', { class: 'small gold' }, t('m05.youSet', { n: v.target ?? 0 })), numCards(v.cards ?? [], v.extraCard)]
      : v.told
        ? [h('div', { class: 'small gold' }, t('m05.toldBy', { name: ui.name(v.setter!), n: v.target ?? 0 })), numCards(v.cards ?? [], v.extraCard)]
        : [h('div', { class: 'small dim' }, t('m05.notTold', { name: ui.name(v.setter!) })), candRow(v, null)];
    const main = h('div', { class: 'm03-prep m05-prep' },
      prev ? h('div', { class: 'm03-prev' }, resultBox(v, prev, v.round)) : null,
      h('div', { class: 'm03-next' },
        h('div', { class: 'm01-big' }, t('m03.roundTitle', { n: v.round + 1, max: v.rounds })),
        v.nextRegroup ? h('div', { class: 'small gold' }, t('m05.regroup')) : null,
        teamRow(v, ui, !waiting),
        info,
        h('div', { class: 'row', style: 'gap:12px;align-items:center;justify-content:center' }, extraBtn,
          waiting ? h('span', { class: 'dim' }, t('m05.readyWait')) : button(t('m03.start'), () => ui.submit({ t: 'ready' } satisfies M05Move), { kind: 'primary', autofocus: true }))));
    return { main, side: [rank] };
  }

  // 解く段階
  if (v.submitted || !v.cards || v.target === null) {
    return { main: [h('div', { class: 'm01-break' }, h('div', { class: 'm01-big' }, t('m03.waiting')), L.pad ? exprEl(L.pad.closed(), v.cards ?? [], '') : null)], side: [rank] };
  }
  if (!L.pad) {
    const cards = v.cards;
    const bonus = () => Math.round((TIME_MAX * Math.max(0, SOLVE_MS - ui.elapsed())) / SOLVE_MS);
    const pad = new ExprPad(cards, v.target, {
      extraIndex: v.extraCard !== null ? cards.length - 1 : undefined,
      timeBonus: bonus,
      onSubmit: (toks) => { ui.timeoutMove = undefined; ui.submit({ t: 'answer', toks, ms: Math.min(SOLVE_MS, Math.max(1, ui.elapsed())) } satisfies M05Move); },
    });
    L.pad = pad;
    // 時間切れ：その時点の式が目標と一致していれば正解として出す
    ui.timeoutMove = () => ({ t: 'answer', toks: pad.correct ? pad.closed() : [], ms: SOLVE_MS } satisfies M05Move);
    let lastBonus = bonus();
    L.timer = setInterval(() => {
      if (!pad.el.isConnected) { if (L.timer && ui.elapsed() > 1500) clearInterval(L.timer); return; }
      const b = bonus();
      if (b !== lastBonus && pad.correct) pad.draw();
      lastBonus = b;
    }, 500);
  }
  const side = [
    h('div', { class: 'box fin-hide' }, h('h4', null, t('m05.team')), teamRow(v, ui, false), h('div', { class: 'small dim', style: 'margin-top:4px' }, t('m05.teamNote', { b: TEAM_BONUS }))),
    h('div', { class: 'box scroll grow' }, h('h4', null, t('m01.rank')), standings(v, ui, 8)),
  ];
  return { main: [h('div', { class: 'm05-play' }, L.pad.el)], side };
}
