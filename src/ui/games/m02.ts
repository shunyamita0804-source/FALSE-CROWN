/**
 * M02 フラッグ・フラッシュの画面。国旗の盤面を中央に大きく置き、文字は最小限にする。
 * 出題者の時は候補のカードを選び、誰に何を伝えるかを顔のボタンで決める。
 */
import { rel } from '../../core/state';
import type { CharId, NpcId } from '../../data/characters';
import { t } from '../../i18n/i18n';
import { BOOST_COST, BOOST_MAX, QUESTIONS, type Cand, type M02Move, type M02View } from '../../matches/m02';
import { face } from '../art';
import { button, h, type Child } from '../dom';
import type { MatchUi } from '../matchui';
import { MemQuiz } from '../memquiz';
import { boostButton, memTable, reviewEl, talkRow } from './memcommon';

interface Local { quiz?: MemQuiz; pick?: number; tell?: Record<string, number> }

export function candCard(c: Cand, i: number, opts: { cls?: string; onclick?: () => void; note?: Child } = {}): HTMLElement {
  const el = h(opts.onclick ? 'button' : 'div', { class: `m02-cand ${opts.cls ?? ''}`, type: opts.onclick ? 'button' : undefined },
    h('small', null, t('m02.candNo', { n: i + 1 })), h('b', null, t(`m02.mix.${c.mix}`)), h('span', { class: 'ds' }, t(`m02.mixd.${c.mix}`)),
    h('span', { class: 'nm' }, t('m02.candSpec', { n: c.n, s: (c.showMs / 1000).toFixed(1) })), opts.note ?? null);
  if (opts.onclick) el.addEventListener('click', opts.onclick);
  return el;
}

export function renderM02(v: M02View, ui: MatchUi): { main: Child; side: Child } {
  const me = v.self as CharId;
  const L = ui.local as Local;
  const spectator = v.self === 'spectator';
  const side = [h('div', { class: 'box scroll grow' }, h('h4', null, t('p01.rank')), memTable(v.players, v.totals, v.last?.results ?? null, QUESTIONS, v.self, ui, { setter: v.phase === 'done' ? undefined : v.setter }))];
  const setterLine = h('div', { class: 'm02-setter' }, face(v.setter), h('span', null, t(v.setter === me ? 'm02.setterMe' : 'm02.setter', { name: ui.name(v.setter) })));

  if (v.phase === 'pick' && me === v.setter) {
    const pick = L.pick ?? -1;
    const tell = (L.tell ??= {});
    const cycle = (p: CharId) => {
      tell[p] = ((tell[p] ?? 0) + 1) % 3;
      ui.rerender();
    };
    const main = h('div', { class: 'm02-pick' },
      h('div', { class: 'm01-big' }, t('m02.pickTitle')),
      h('div', { class: 'm02-cands' }, v.cands.map((c, i) => candCard(c, i, { cls: pick === i ? 'sel' : '', onclick: () => { L.pick = i; ui.rerender(); } }))),
      h('div', { class: 'm02-tell' }, h('div', { class: 'small dim' }, t('m02.tellNote')),
        h('div', { class: 'm02-tellrow' }, v.players.filter((p) => p !== me).map((p) => {
          const st = tell[p] ?? 0;
          const b = h('button', { class: `m02-tellbtn s${st}`, type: 'button' }, face(p), h('span', { class: 'nm' }, ui.name(p)), h('b', null, t(`m02.tell${st}`)));
          b.addEventListener('click', () => cycle(p));
          return b;
        }))),
      button(t('m02.pickOk'), () => {
        const out: Record<string, number> = {};
        for (const [p, st] of Object.entries(tell)) {
          if (!st) continue;
          out[p] = st === 1 ? pick : (pick + 1) % v.cands.length;
          // 本当を伝えれば信頼が少し上がり、嘘は（ラウンド後に分かるので）信頼を下げる
          const r = rel(ui.state, p as NpcId, 'hero');
          if (st === 1) r.trust = Math.min(100, r.trust + 3);
          else { r.trust = Math.max(0, r.trust - 9); r.hostility = Math.min(100, r.hostility + 4); }
        }
        ui.submit({ t: 'pick', i: pick, tell: out } satisfies M02Move);
      }, { kind: 'primary', disabled: pick < 0 }));
    return { main, side };
  }

  if (v.phase === 'prep' && !spectator && !v.ready[me]) {
    const main = h('div', { class: 'm02-prep' },
      h('div', { class: 'm01-big' }, t('m02.roundTitle', { n: v.round + 1, max: v.rounds })),
      setterLine,
      h('div', { class: 'm02-cands' }, v.cands.map((c, i) => candCard(c, i, { cls: v.chosen === i ? 'sel' : v.tip === i ? 'tip' : '', note: v.chosen === i ? h('i', { class: 'tag' }, t('m02.chosenTag')) : v.tip === i ? h('i', { class: 'tag' }, t('m02.tipTag', { name: ui.name(v.setter) })) : null }))),
      h('div', { class: 'small dim' }, t(v.chosen != null ? 'm02.prepSetter' : v.tip != null ? 'm02.prepTip' : 'm02.prepNote')),
      h('div', { class: 'row', style: 'gap:14px;justify-content:center;align-items:center' }, boostButton(ui, v, BOOST_COST, BOOST_MAX, 'M02 表示延長'),
        button(t('mq.start'), () => ui.submit({ t: 'ready' } satisfies M02Move), { kind: 'primary', autofocus: true })));
    return { main, side };
  }

  if (v.phase === 'quiz' && !spectator && !v.submitted && v.set) {
    if (!L.quiz) {
      const quiz = new MemQuiz(v.set, { elapsed: ui.elapsed, onDone: (a) => { ui.timeoutMove = undefined; ui.submit({ t: 'answers', a } satisfies M02Move); } });
      L.quiz = quiz;
      ui.timeoutMove = () => ({ t: 'answers', a: quiz.current() } satisfies M02Move);
    }
    return { main: [h('div', { class: 'm01-play' }, L.quiz.el)], side };
  }

  // 休憩と終了：直前のラウンドの振り返り
  const last = v.last;
  const mine = last && !spectator ? last.results[me] : undefined;
  const main = h('div', { class: 'm02-break' },
    h('div', { class: 'm01-big' }, v.phase === 'done' ? t('p01.finished') : last ? t('m02.roundResult', { n: last.round + 1 }) : ''),
    last ? h('div', { class: 'm02-reveal' }, face(last.setter), h('span', null, t('m02.reveal', { name: ui.name(last.setter), n: last.chosen + 1, mix: t(`m02.mix.${last.cands[last.chosen].mix}`) })),
      last.tip != null ? h('b', { class: last.tip === last.chosen ? 'good' : 'bad' }, t(last.tip === last.chosen ? 'm02.tipTrue' : 'm02.tipFalse', { n: last.tip + 1 })) : null,
      mine ? h('b', { class: 'gold' }, t('m02.myPts', { c: mine.correct, max: QUESTIONS, p: mine.points })) : null) : null,
    last ? reviewEl(last.set, mine, 84) : null,
    v.phase === 'break' && v.nextCands ? h('div', { class: 'm02-next' }, h('div', { class: 'small gold' }, t('m02.nextMine')), h('div', { class: 'm02-cands small' }, v.nextCands.map((c, i) => candCard(c, i)))) : null,
    v.phase === 'break' && !spectator ? talkRow(v.players, me, ui) : null,
    v.phase === 'break' && !spectator && !v.ready[me] ? button(t('p01.next', { n: v.round + 2 }), () => ui.submit({ t: 'ready' } satisfies M02Move), { kind: 'primary', autofocus: true }) : null);
  return { main, side };
}
