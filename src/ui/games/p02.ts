/** P02 瞬間記憶の画面。盤面を中央に大きく置き、図柄の候補を直接タップして答える。 */
import type { CharId } from '../../data/characters';
import { t } from '../../i18n/i18n';
import { BOOST_COST, BOOST_MAX, QUESTIONS, type P02Move, type P02View } from '../../matches/p02';
import { button, h, type Child } from '../dom';
import type { MatchUi } from '../matchui';
import { MemQuiz } from '../memquiz';
import { boostButton, memTable, reviewEl, talkRow } from './memcommon';

interface Local { quiz?: MemQuiz }

export function renderP02(v: P02View, ui: MatchUi): { main: Child; side: Child } {
  const me = v.self as CharId;
  const L = ui.local as Local;
  const spectator = v.self === 'spectator';
  const side = [h('div', { class: 'box scroll grow' }, h('h4', null, t('p01.rank')), memTable(v.players, v.totals, v.last?.results ?? null, QUESTIONS, v.self, ui, { markLast: true }), h('div', { class: 'small dim', style: 'margin-top:6px' }, t('p01.lastNote')))];

  if (v.phase === 'quiz' && !spectator && !v.submitted && v.set) {
    if (!L.quiz) {
      const quiz = new MemQuiz(v.set, { elapsed: ui.elapsed, onDone: (a) => { ui.timeoutMove = undefined; ui.submit({ t: 'answers', a } satisfies P02Move); } });
      L.quiz = quiz;
      ui.timeoutMove = () => ({ t: 'answers', a: quiz.current() } satisfies P02Move);
    }
    return { main: [h('div', { class: 'p01-play' }, L.quiz.el)], side };
  }

  const last = v.last;
  const mine = last && !spectator ? last.results[me] : undefined;
  const prep = v.phase === 'prep' && !spectator && !v.ready[me];
  const main = h('div', { class: 'm02-break' },
    h('div', { class: 'm01-big' }, v.phase === 'done' ? t('p01.finished') : prep ? t('m02.roundTitle', { n: v.round + 1, max: v.rounds }) : t('p01.breakTitle', { n: v.round + 1 })),
    prep ? h('div', { class: 'p02-spec' }, t('p02.spec', { size: v.spec.size, n: v.spec.n, s: v.spec.showMs / 1000, q: QUESTIONS })) : null,
    last ? h('div', { class: 'm02-reveal' }, h('span', null, t('p02.lastTitle', { n: last.round + 1 })), mine ? h('b', { class: 'gold' }, t('m02.myPts', { c: mine.correct, max: QUESTIONS, p: mine.points })) : null) : null,
    last ? reviewEl(last.set, mine, last.set.board.w >= 5 ? 52 : 60) : null,
    v.phase === 'break' && !spectator ? talkRow(v.players, me, ui) : null,
    prep ? h('div', { class: 'row', style: 'gap:14px;justify-content:center;align-items:center' }, boostButton(ui, v, BOOST_COST, BOOST_MAX, 'P02 表示延長'),
      button(t('mq.start'), () => ui.submit({ t: 'ready' } satisfies P02Move), { kind: 'primary', autofocus: true })) : null,
    v.phase === 'break' && !spectator && !v.ready[me] ? button(t('p01.next', { n: v.round + 2 }), () => ui.submit({ t: 'ready' } satisfies P02Move), { kind: 'primary', autofocus: true }) : null);
  return { main, side };
}
