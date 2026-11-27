import { Sound } from '../../audio/audio';
import type { CharId } from '../../data/characters';
import { t } from '../../i18n/i18n';
import type { P01Move, P01View } from '../../matches/p01';
import { face } from '../art';
import { button, h, type Child } from '../dom';
import type { MatchUi } from '../matchui';

export function renderP01(v: P01View, ui: MatchUi): { main: Child; side: Child } {
  const me = v.self as CharId;
  const local = ui.local as { card?: number; claim?: number };
  const pick = (k: 'card' | 'claim', n: number) => {
    local[k] = n;
    Sound.se('cardSlide');
    ui.rerender();
  };
  const scores = h('div', { class: 'score-row' }, v.players.map((p) => h('div', { class: `score-cell${v.declarer === p ? ' turn' : ''}` }, face(p), h('span', null, ui.name(p), v.declarer === p ? h('small', { class: 'gold' }, ` ${t('p01.declarer')}`) : null), h('b', null, String(v.score[p])))));

  const lastTurn = v.history[v.history.length - 1];
  const last = lastTurn ? h('div', { class: 'box' }, h('h4', null, t('p01.last')),
    h('div', null, t(lastTurn.card === lastTurn.claim ? 'p01.wasTruth' : 'p01.wasLie', { name: ui.name(lastTurn.declarer), claim: lastTurn.claim, card: lastTurn.card })),
    h('div', { class: 'small' }, v.players.map((p) => `${ui.name(p)} ${lastTurn.delta[p] > 0 ? '+' : ''}${lastTurn.delta[p]}${p !== lastTurn.declarer ? `（${t(lastTurn.judges[p] ? 'p01.trusted' : 'p01.doubted')}）` : ''}`).join('　'))) : null;

  let controls: Child;
  if (v.stage === 'done') controls = h('div', { class: 'box' }, t('p01.finished'));
  else if (v.stage === 'play' && v.declarer === me) {
    const claimed = v.claimed[me] ?? [];
    const ready = local.card !== undefined && local.claim !== undefined;
    controls = h('div', { class: 'box col', style: 'gap:10px' },
      h('h4', null, t('p01.yourTurn')),
      h('div', { class: 'small' }, t('p01.pickCard')),
      h('div', { class: 'cards' }, v.myHand.map((c) => h('button', { type: 'button', class: `card${local.card === c ? ' sel' : ''}`, onclick: () => pick('card', c) }, String(c)))),
      h('div', { class: 'small' }, t('p01.pickClaim')),
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, [1, 2, 3, 4, 5, 6, 7, 8, 9].map((c) => button(String(c), () => pick('claim', c), { small: true, disabled: claimed.includes(c), cls: local.claim === c ? 'selected' : '' }))),
      h('div', { class: 'row', style: 'gap:12px' },
        h('span', { class: 'grow' }, ready ? t(local.card === local.claim ? 'p01.planTruth' : 'p01.planLie', { card: local.card ?? 0, claim: local.claim ?? 0 }) : ''),
        button(t('common.confirm'), () => {
          Sound.se('card');
          ui.submit({ t: 'play', card: local.card, claim: local.claim } as P01Move);
        }, { kind: 'primary', disabled: !ready })),
      h('div', { class: 'dim small' }, t('p01.timeoutPlay')),
    );
  } else if (v.stage === 'judge' && v.declarer !== me && !v.judged) {
    const d = v.declarer!;
    controls = h('div', { class: 'box col', style: 'gap:10px;align-items:center' },
      h('div', null, t('p01.claims', { name: ui.name(d) })),
      h('div', { class: 'row', style: 'gap:18px' }, h('div', { class: 'card back' }, '？'), h('div', { class: 'big-claim' }, String(v.claim))),
      h('div', { class: 'small dim' }, t('p01.usedBy', { name: ui.name(d), cards: (v.used[d] ?? []).join(' ') || t('p01.none') })),
      h('div', { class: 'row', style: 'gap:12px' },
        button(t('p01.trust'), () => { Sound.se('chip'); ui.submit({ t: 'judge', trust: true } satisfies P01Move); }, { kind: 'primary', autofocus: true }),
        button(t('p01.doubt'), () => { Sound.se('chip'); ui.submit({ t: 'judge', trust: false } satisfies P01Move); }, { kind: 'danger' })),
      h('div', { class: 'dim small' }, t('p01.timeoutJudge')),
    );
  } else controls = h('div', { class: 'box dim' }, t('p01.waiting'));

  const hand = v.stage !== 'done' && !(v.stage === 'play' && v.declarer === me) ? h('div', { class: 'box' }, h('h4', null, t('p01.hand')), h('div', { class: 'cards' }, v.myHand.map((c) => h('div', { class: 'card sm' }, String(c))))) : null;

  const side = [
    h('div', { class: 'box' }, h('h4', null, t('p01.public')), ...v.players.map((p) => h('div', { class: 'logline' }, h('b', null, ui.name(p)), h('div', { class: 'small' }, `${t('p01.usedCards')} ${(v.used[p] ?? []).join(' ') || '—'}`), h('div', { class: 'small' }, `${t('p01.claimedNums')} ${(v.claimed[p] ?? []).join(' ') || '—'}`)))),
    h('div', { class: 'box scroll grow' }, h('h4', null, t('p01.history')), ...v.history.slice().reverse().map((x, i) => h('div', { class: 'logline' }, `${v.history.length - i}. ${ui.name(x.declarer)}　${t('p01.histLine', { claim: x.claim, card: x.card })}${x.card === x.claim ? '' : ` ${t('p01.lieMark')}`}`))),
  ];
  return { main: [scores, last, controls, hand], side };
}
