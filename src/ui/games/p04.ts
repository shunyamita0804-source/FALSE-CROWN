/** P04 消えた図形の画面。盤面を中央に大きく置き、変わったマスを直接タップして選ぶ。 */
import type { CharId } from '../../data/characters';
import { t } from '../../i18n/i18n';
import { ANSWER_MS, BOOST_COST, SIZE, type P04Move, type P04View } from '../../matches/p04';
import { button, h, type Child } from '../dom';
import { DiffQuiz, diffReview } from '../diffquiz';
import type { MatchUi } from '../matchui';
import { boostButton, memTable, talkRow, type RoundResult } from './memcommon';

interface Local { quiz?: DiffQuiz }

export function renderP04(v: P04View, ui: MatchUi): { main: Child; side: Child } {
  const me = v.self as CharId;
  const L = ui.local as Local;
  const spectator = v.self === 'spectator';
  const last = v.last;
  const lastRes: Record<string, RoundResult> | null = last ? Object.fromEntries(v.players.map((p) => { const r = v.results[p][last.round]; return [p, { correct: r.hits, points: r.points, ok: [], picks: [] }]; })) : null;
  const side = [h('div', { class: 'box scroll grow' }, h('h4', null, t('p01.rank')), memTable(v.players, v.totals, lastRes, last?.set.k ?? 0, v.self, ui, { markLast: true }), h('div', { class: 'small dim', style: 'margin-top:6px' }, t('p01.lastNote')))];

  if (v.phase === 'quiz' && !spectator && !v.submitted && v.set) {
    if (!L.quiz) {
      const quiz = new DiffQuiz(v.set, { elapsed: ui.elapsed, showMs: v.showMs, answerMs: ANSWER_MS, cell: 86, onDone: (cells, ms) => { ui.timeoutMove = undefined; ui.submit({ t: 'answer', cells, ms } satisfies P04Move); } });
      L.quiz = quiz;
      ui.timeoutMove = () => ({ t: 'answer', ...quiz.current() } satisfies P04Move);
    }
    return { main: [h('div', { class: 'p01-play' }, L.quiz.el)], side };
  }

  const mine = last && !spectator ? v.results[me][last.round] : undefined;
  const prep = v.phase === 'prep' && !spectator && !v.ready[me];
  const main = h('div', { class: 'm02-break p04-break' },
    h('div', { class: 'm01-big' }, v.phase === 'done' ? t('p01.finished') : v.isBreak ? t('p04.breakTitle', { n: v.round + 1 }) : t('m02.roundTitle', { n: v.round + 1, max: v.rounds })),
    v.phase !== 'done' ? h('div', { class: 'p02-spec' }, t('p04.spec', { size: SIZE, n: v.spec.n, s: v.showMs / 1000, k: v.spec.k })) : null,
    last ? h('div', { class: 'm02-reveal' }, h('span', null, t('p02.lastTitle', { n: last.round + 1 })), mine ? h('b', { class: 'gold' }, t(mine.perfect ? 'p04.myPtsPerfect' : 'p04.myPts', { h: mine.hits, k: last.set.k, m: mine.misses, p: mine.points })) : null) : null,
    last ? diffReview(last.set, mine?.cells, 38) : null,
    v.isBreak && !spectator ? talkRow(v.players, me, ui) : null,
    prep ? h('div', { class: 'row', style: 'gap:14px;justify-content:center;align-items:center' }, boostButton(ui, { boostOn: v.boosted, boostUsed: v.boostUsed ? 1 : 0 }, BOOST_COST, 1, 'P04 表示延長'),
      button(t('mq.start'), () => ui.submit({ t: 'ready' } satisfies P04Move), { kind: 'primary', autofocus: true })) : null);
  return { main, side };
}
