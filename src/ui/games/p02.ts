import { Sound } from '../../audio/audio';
import type { CharId } from '../../data/characters';
import { t } from '../../i18n/i18n';
import { INPUTS_EACH, validCode, type P02Move, type P02View } from '../../matches/p02';
import { face } from '../art';
import { button, h, type Child } from '../dom';
import type { MatchUi } from '../matchui';

export function renderP02(v: P02View, ui: MatchUi): { main: Child; side: Child } {
  const me = v.self as CharId;
  const local = ui.local as { safe?: number; digits?: string };
  const myTurn = v.stage === 'play' && v.current === me;
  const firstOpen = v.opened.findIndex((o) => o === null);
  const safe = local.safe !== undefined && v.opened[local.safe] === null ? local.safe : firstOpen;
  const digits = local.digits ?? '';
  const upd = (f: () => void, se: 'select' | 'chip' = 'chip') => {
    f();
    Sound.se(se);
    ui.rerender();
  };

  const scores = h('div', { class: 'score-row' }, v.players.map((p) => h('div', { class: `score-cell${v.current === p ? ' turn' : ''}` }, face(p),
    h('span', null, ui.name(p), h('small', { class: 'dim', style: 'display:block' }, t('p02.left', { n: v.left[p], max: INPUTS_EACH }))), h('b', null, String(v.score[p])))));

  const safes = h('div', { class: 'p02-safes' }, v.opened.map((o, i) => {
    const hist = v.history.filter((g) => g.safe === i);
    const isOpen = o !== null;
    const code = v.codes[i];
    return h('button', { type: 'button', class: `p02-safe${isOpen ? ' open' : ''}${!isOpen && safe === i && myTurn ? ' sel' : ''}`, disabled: isOpen || !myTurn, onclick: () => upd(() => { local.safe = i; }, 'select') },
      h('div', { class: 'p02-safehead' }, h('b', null, t('p02.safe', { n: i + 1 })), isOpen ? h('span', { class: 'good small' }, t('p02.openedBy', { name: ui.name(o) })) : h('span', { class: 'small dim' }, t('p02.best', { n: v.best[i] }))),
      h('div', { class: 'p02-dial' }, (code ?? '???').split('').map((d) => h('span', null, d))),
      h('div', { class: 'p02-hist' }, hist.length ? hist.slice().reverse().map((g) => h('div', { class: `p02-line${g.gain > 0 ? ' gain' : ''}` },
        h('span', { class: 'p02-code' }, g.code), h('span', { class: 'p02-hb' }, h('b', null, String(g.hit)), t('p02.hit'), ' ', h('b', null, String(g.blow)), t('p02.blow')),
        h('small', { class: 'dim' }, ui.name(g.by)), g.gain > 0 ? h('small', { class: 'gold' }, `+${g.gain}`) : null)) : h('div', { class: 'dim small' }, t('p02.noGuess'))));
  }));

  let controls: Child;
  if (v.stage === 'done') controls = h('div', { class: 'box' }, t('p02.finished'));
  else if (myTurn) {
    const code = digits;
    const dup = v.history.some((g) => g.safe === safe && g.code === code);
    const ok = validCode(code) && !dup;
    controls = h('div', { class: 'box p02-input' },
      h('div', { class: 'p02-entry' },
        h('small', null, t('p02.target', { n: safe + 1 })),
        h('div', { class: 'p02-dial big' }, [0, 1, 2].map((i) => h('span', { class: digits[i] ? '' : 'empty' }, digits[i] ?? '・'))),
        h('small', { class: dup ? 'bad' : 'dim' }, dup ? t('p02.dup') : t('p02.entryHint'))),
      h('div', { class: 'p02-keys' },
        ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((d) => h('button', { type: 'button', class: 'p02-key', disabled: digits.length >= 3 || digits.includes(String(d)), onclick: () => upd(() => { local.digits = digits + String(d); }) }, String(d))),
        h('button', { type: 'button', class: 'p02-key wide', disabled: !digits.length, onclick: () => upd(() => { local.digits = digits.slice(0, -1); }, 'select') }, t('p02.del'))),
      h('div', { class: 'col', style: 'gap:8px;align-items:stretch' },
        button(t('p02.submit'), () => {
          Sound.se('latch');
          ui.submit({ t: 'guess', safe, code } satisfies P02Move);
        }, { kind: 'primary', disabled: !ok }),
        h('div', { class: 'dim small' }, t('p02.timeout'))));
  } else controls = h('div', { class: 'box dim' }, v.self === 'spectator' ? t('p02.spectating') : t('p02.waiting', { name: v.current ? ui.name(v.current) : '' }));

  const lastG = v.history[v.history.length - 1];
  const last = lastG ? h('div', { class: 'box small' }, t(lastG.hit === 3 ? 'p02.lastOpen' : 'p02.last', { name: ui.name(lastG.by), n: lastG.safe + 1, code: lastG.code, hit: lastG.hit, blow: lastG.blow }), lastG.gain > 0 && lastG.hit < 3 ? h('span', { class: 'gold' }, ` ${t('p02.record', { n: lastG.gain })}`) : null) : null;

  const side = [
    h('div', { class: 'box' }, h('h4', null, t('p02.howTitle')), h('div', { class: 'small' }, t('p02.how1')), h('div', { class: 'small' }, t('p02.how2')), h('div', { class: 'small dim' }, t('p02.how3'))),
    h('div', { class: 'box scroll grow' }, h('h4', null, t('p02.history')), ...v.history.slice().reverse().map((g, i) => h('div', { class: 'logline' }, `${v.history.length - i}. ${ui.name(g.by)}　${t('p02.safe', { n: g.safe + 1 })} ${g.code}　${g.hit}${t('p02.hit')} ${g.blow}${t('p02.blow')}${g.gain ? `　+${g.gain}` : ''}`))),
  ];
  return { main: [scores, safes, last, controls], side };
}
