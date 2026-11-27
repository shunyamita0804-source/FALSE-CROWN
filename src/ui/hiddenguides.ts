/**
 * 裏ゲーム H01〜H05、H07、H08 の段階的な説明と練習（H06 は tutorial.ts の駒の盤面の説明を使う）。
 * 図は本番と同じ部品で描く。練習の問題は本番とは別で、本番の答えは出さない。
 */
import { assetUrl } from '../assets/registry';
import { Sound } from '../audio/audio';
import { t } from '../i18n/i18n';
import { mirrorStep, atGoal, type Dir } from '../matches/h03';
import { slidable, slideSolved, slideTo } from '../matches/h05';
import type { MirrorStage } from '../story/hiddendata';
import { button, h } from './dom';
import { dpad, keyPad, mazeBoard } from './games/hidden';
import type { Guide } from './tutorial';

const cap = (el: HTMLElement, text: string) => h('div', { class: 'tg-fig' }, el, h('div', { class: 'tg-cap' }, text));
const facts = (rows: [string, string][]) => h('div', { class: 'hd-facts' }, rows.map(([a, b]) => h('div', null, h('b', null, a), h('span', null, b))));
const clueList = (rows: string[]) => h('div', { class: 'hd-clues tg' }, rows.map((c, i) => h('div', { class: 'hd-clue' }, h('span', { class: 'no' }, String(i + 1)), h('span', { class: 'tx' }, c))));
const slots = (s: string[]) => h('div', { class: 'sg-slots' }, s.map((c) => h('span', { class: `sg-slot${c ? ' on' : ''}` }, c)));

function h01Guide(): Guide {
  const clues = [t('tut.h01.c1'), t('tut.h01.c2'), t('tut.h01.c3')];
  const safe = assetUrl('props/safe_closed');
  return {
    name: '賢者の金庫',
    pages: [
      { title: t('tut.h01.t1'), text: t('tut.h01.p1'), figure: () => h('div', { class: 'tg-row' }, safe ? h('img', { class: 'hd-safe tg', src: safe, alt: '', draggable: false }) : null, slots(['?', '?', '?', '?', '?', '?'])) },
      { title: t('tut.h01.t2'), text: t('tut.h01.p2'), figure: () => h('div', { class: 'tg-row' }, clueList(clues), h('span', { class: 'dq-arrow' }, '▶'), slots(['3', '1', '2'])) },
      { title: t('tut.h01.t3'), text: t('tut.h01.p3'), figure: () => facts([['5', t('tut.h01.f1')], ['3', t('tut.h01.f2')]]) },
    ],
    practice: {
      text: t('tut.h01.practice'),
      build: (onDone) => {
        const box = h('div', { class: 'sg hd-h01 prac' });
        let code = '';
        let done = false;
        let miss = false;
        const draw = () => {
          box.replaceChildren(
            h('div', { class: 'col', style: 'gap:6px' }, clueList(clues), h('div', { class: `small ${done ? 'gold' : 'dim'}` }, done ? t('tut.h01.pracDone') : miss ? t('tut.h01.pracMiss') : t('tut.h01.pracAsk'))),
            done ? slots(['3', '1', '2']) : keyPad({ value: code, keys: ['1', '2', '3'], max: 3, cols: 3, unique: true, onChange: (c) => { code = c; draw(); }, ok: t('h01.ok'), onOk: code.length === 3 ? () => {
              if (code === '312') { done = true; Sound.se('latch'); onDone(); } else { miss = true; code = ''; Sound.se('error'); }
              draw();
            } : null }));
        };
        draw();
        return box;
      },
    },
  };
}

function h02Guide(): Guide {
  const card = (n: number, cls = '') => h('span', { class: `p05-card ${cls}` }, h('b', null, String(n)));
  return {
    name: '月下の賭場',
    pages: [
      { title: t('tut.h02.t1'), text: t('tut.h02.p1'), figure: () => h('div', { class: 'tg-row' }, h('div', { class: 'p05-total hot' }, h('small', null, t('duel.target')), h('b', null, '4')), h('div', { class: 'p05-hand' }, [1, 2, 3, 4, 5].map((n) => card(n)))) },
      { title: t('tut.h02.t2'), text: t('tut.h02.p2'), figure: () => h('div', { class: 'tg-row' }, h('div', { class: 'p05-total' }, h('small', null, t('duel.target')), h('b', null, '2')), cap(card(3, 'sel'), t('tut.h02.capYou')), cap(card(5), t('tut.h02.capDealer'))) },
      { title: t('tut.h02.t3'), text: t('tut.h02.p3'), figure: () => facts([['1〜3', t('tut.h02.f1')], ['×2', t('tut.h02.f2')], ['±0', t('tut.h02.f3')]]) },
    ],
    practice: {
      text: t('tut.h02.practice'),
      build: (onDone) => {
        let done = false;
        const note = h('div', { class: 'small dim' }, t('tut.h02.pracAsk'));
        const row = h('div', { class: 'p05-hand' }, [1, 4, 5].map((c) => {
          const el = h('button', { class: 'p05-card', type: 'button', 'data-card': String(c) }, h('b', null, String(c)), h('small', null, t('duel.diff', { n: Math.abs(c - 3) })));
          el.addEventListener('click', () => {
            if (done) return;
            if (c !== 4) { Sound.se('error'); note.textContent = t('tut.m11.duelMiss'); return; }
            done = true; el.classList.add('sel', 'hit'); note.textContent = t('tut.h02.pracDone'); note.classList.add('gold'); Sound.se('card'); onDone();
          });
          return el;
        }));
        return h('div', { class: 'p05 dl prac' }, h('div', { class: 'p05-mid' }, h('div', { class: 'p05-total hot' }, h('small', null, t('duel.target')), h('b', null, '3'))), row, note);
      },
    },
  };
}

function h03Guide(): Guide {
  const st: MirrorStage = { boards: [['...', '.#.', '...'], ['...', '.#.', '...']], start: [[0, 2], [2, 2]], goal: [[2, 0], [0, 0]], maxMoves: 30 };
  const pair = (pos: [[number, number], [number, number]], cell: number) => h('div', { class: 'tg-row' }, cap(mazeBoard(st.boards[0], pos[0], st.goal[0], 'a', cell), t('h03.left')), cap(mazeBoard(st.boards[1], pos[1], st.goal[1], 'b', cell), t('h03.right')));
  const wall: MirrorStage = { boards: [['...', '...', '...'], ['...', '#..', '...']], start: [[1, 1], [1, 1]], goal: [[2, 0], [0, 0]], maxMoves: 30 };
  return {
    name: '鏡の迷宮',
    pages: [
      { title: t('tut.h03.t1'), text: t('tut.h03.p1'), figure: () => pair(st.start, 56) },
      { title: t('tut.h03.t2'), text: t('tut.h03.p2'), figure: () => h('div', { class: 'tg-row' }, h('span', { class: 'hd-dir show' }, '▶'), pair(mirrorStep(st, st.start, 'R'), 56)) },
      { title: t('tut.h03.t3'), text: t('tut.h03.p3'), figure: () => h('div', { class: 'tg-row' }, h('span', { class: 'hd-dir show' }, '▶'), cap(mazeBoard(wall.boards[0], [2, 1], wall.goal[0], 'a', 56), t('tut.h03.capMove')), cap(mazeBoard(wall.boards[1], [1, 1], wall.goal[1], 'b', 56), t('tut.h03.capStop'))) },
      { title: t('tut.h03.t4'), text: t('tut.h03.p4'), figure: () => facts([['3', t('tut.h03.f1')], ['30', t('tut.h03.f2')]]) },
    ],
    practice: {
      text: t('tut.h03.practice'),
      build: (onDone) => {
        const box = h('div', { class: 'sg hd-h03 prac' });
        let pos: [[number, number], [number, number]] = [[...st.start[0]], [...st.start[1]]];
        let done = false;
        const draw = () => {
          box.replaceChildren(
            cap(mazeBoard(st.boards[0], pos[0], st.goal[0], 'a', 70), t('h03.left')),
            h('div', { class: 'col', style: 'gap:8px;align-items:center' }, dpad((d: Dir) => {
              pos = mirrorStep(st, pos, d);
              Sound.se('step');
              if (atGoal(st, pos)) { done = true; Sound.se('result'); onDone(); }
              draw();
            }, !done), h('div', { class: `small ${done ? 'gold' : 'dim'}`, style: 'width:230px;text-align:center' }, done ? t('tut.h03.pracDone') : t('tut.h03.pracAsk'))),
            cap(mazeBoard(st.boards[1], pos[1], st.goal[1], 'b', 70), t('h03.right')));
        };
        draw();
        return box;
      },
    },
  };
}

function h04Guide(): Guide {
  const memos = [{ title: t('tut.h04.m1t'), text: t('tut.h04.m1') }, { title: t('tut.h04.m2t'), text: t('tut.h04.m2') }];
  const opts = ['13:00', '14:00', '15:00'];
  const memo = (i: number) => h('div', { class: 'hd-letter tg' }, h('b', null, memos[i].title), h('p', null, memos[i].text));
  return {
    name: '囚人の遺言',
    pages: [
      { title: t('tut.h04.t1'), text: t('tut.h04.p1'), figure: () => h('div', { class: 'tg-row' }, memo(0), memo(1)) },
      { title: t('tut.h04.t2'), text: t('tut.h04.p2'), figure: () => h('div', { class: 'hd-q tg' }, h('div', { class: 'pr' }, h('span', { class: 'no' }, '1'), t('tut.h04.q')), h('div', { class: 'ops' }, opts.map((o, k) => h('span', { class: `hd-op${k === 1 ? ' on' : ''}` }, o)))) },
      { title: t('tut.h04.t3'), text: t('tut.h04.p3'), figure: () => facts([['5', t('tut.h04.f1')], ['4', t('tut.h04.f2')], ['5', t('tut.h04.f3')]]) },
    ],
    practice: {
      text: t('tut.h04.practice'),
      build: (onDone) => {
        const box = h('div', { class: 'sg hd-h04 prac' });
        let pick: number | undefined;
        let done = false;
        let miss = false;
        const draw = () => {
          box.replaceChildren(
            h('div', { class: 'col', style: 'gap:6px;width:420px' }, memo(0), memo(1)),
            h('div', { class: 'col', style: 'gap:8px;width:420px' },
              h('div', { class: 'hd-q' }, h('div', { class: 'pr' }, h('span', { class: 'no' }, '1'), t('tut.h04.q')), h('div', { class: 'ops' }, opts.map((o, k) => {
                const b = h('button', { class: `hd-op${pick === k ? ' on' : ''}`, type: 'button', 'data-opt': String(k), disabled: done }, o);
                b.addEventListener('click', () => { pick = k; Sound.se('select'); draw(); });
                return b;
              }))),
              h('div', { class: `small ${done ? 'gold' : 'dim'}` }, done ? t('tut.h04.pracDone') : miss ? t('tut.h04.pracMiss') : t('tut.h04.pracAsk')),
              done ? null : button(t('h04.submit'), () => { if (pick === 1) { done = true; Sound.se('confirm'); onDone(); } else { miss = true; Sound.se('error'); } draw(); }, { kind: 'primary', disabled: pick === undefined, cls: 'sg-ok' })));
        };
        draw();
        return box;
      },
    },
  };
}

/** スライド板（図と練習で使う） */
function slideBoard(tiles: number[], onTap?: (pos: number) => void): HTMLElement {
  const ok = slidable(tiles);
  return h('div', { class: 'hd-slide tg' }, tiles.map((n, i) => {
    const b = h('button', { class: `hd-st${n === 0 ? ' blank' : ''}${onTap && ok.includes(i) ? ' can' : ''}`, type: 'button', 'data-pos': String(i), 'data-n': String(n), disabled: !onTap || !ok.includes(i) }, n ? String(n) : '');
    if (onTap) b.addEventListener('click', () => onTap(i));
    return b;
  }));
}

function h05Guide(): Guide {
  return {
    name: '時の牢獄',
    pages: [
      { title: t('tut.h05.t1'), text: t('tut.h05.p1'), figure: () => h('div', { class: 'hd-seq' }, [1, 3, 5, 7].map((n) => h('b', null, String(n))), h('b', { class: 'q' }, '？')) },
      { title: t('tut.h05.t2'), text: t('tut.h05.p2'), figure: () => h('div', { class: 'tg-row' }, cap(slideBoard([1, 2, 3, 4, 5, 6, 7, 0, 8]), t('tut.m09.before')), h('span', { class: 'dq-arrow' }, '▶'), cap(slideBoard([1, 2, 3, 4, 5, 6, 7, 8, 0]), t('tut.m09.after'))) },
      { title: t('tut.h05.t3'), text: t('tut.h05.p3'), figure: () => h('div', { class: 'tg-row' }, h('div', { class: 'col', style: 'gap:6px' }, h('div', { class: 'hd-oclue' }, t('tut.h05.c1')), h('div', { class: 'hd-oclue' }, t('tut.h05.c2'))), h('span', { class: 'dq-arrow' }, '▶'), slots(['○', '△', '□'])) },
      { title: t('tut.h05.t4'), text: t('tut.h05.p4'), figure: () => facts([['3', t('tut.h05.f1')], ['5', t('tut.h05.f2')], ['1', t('tut.h05.f3')]]) },
    ],
    practice: {
      text: t('tut.h05.practice'),
      build: (onDone) => {
        const box = h('div', { class: 'sg hd-col prac' });
        let tiles = [1, 2, 3, 4, 0, 6, 7, 5, 8];
        let done = false;
        const draw = () => {
          box.replaceChildren(h('div', { class: 'hd-row' }, slideBoard(tiles, done ? undefined : (pos) => {
            tiles = slideTo(tiles, pos);
            Sound.se('chip');
            if (slideSolved(tiles)) { done = true; Sound.se('result'); onDone(); }
            draw();
          }), h('div', { class: 'col', style: 'gap:8px;width:300px' }, h('div', { class: 'hd-goal' }, [1, 2, 3, 4, 5, 6, 7, 8, 0].map((n) => h('i', null, n ? String(n) : ''))), h('div', { class: `small ${done ? 'gold' : 'dim'}` }, done ? t('tut.h05.pracDone') : t('tut.h05.pracAsk')))));
        };
        draw();
        return box;
      },
    },
  };
}

function h07Guide(): Guide {
  const opts = [t('tut.h07.o1'), t('tut.h07.o2'), t('tut.h07.o3')];
  const evs = [t('tut.h07.e1'), t('tut.h07.e2')];
  return {
    name: '十二の証明',
    pages: [
      { title: t('tut.h07.t1'), text: t('tut.h07.p1'), figure: () => h('div', { class: 'hd-ops3 tg' }, opts.map((o, k) => h('span', { class: `hd-op${k === 0 ? ' on' : ''}` }, o))) },
      { title: t('tut.h07.t2'), text: t('tut.h07.p2'), figure: () => h('div', { class: 'col', style: 'gap:6px;align-items:center' }, h('div', { class: 'hd-evs tg' }, [1, 2, 3, 4].map((n) => h('span', { class: `hd-ev${n === 1 ? ' on' : ''}` }, String(n)))), h('div', { class: 'hd-evtext tg' }, evs[0])) },
      { title: t('tut.h07.t3'), text: t('tut.h07.p3'), figure: () => facts([['12', t('tut.h07.f1')], ['×', t('tut.h07.f2')], ['8', t('tut.h07.f3')]]) },
    ],
    practice: {
      text: t('tut.h07.practice'),
      build: (onDone) => {
        const box = h('div', { class: 'sg hd-col prac' });
        let opt: number | undefined;
        let ev: number | undefined;
        let done = false;
        let miss = false;
        const draw = () => {
          box.replaceChildren(h('div', { class: 'hd-detail', style: 'width:760px' },
            h('b', { class: 'gold' }, t('tut.h07.who')),
            h('div', { class: 'hd-ops3' }, opts.map((o, k) => { const b = h('button', { class: `hd-op${opt === k ? ' on' : ''}`, type: 'button', 'data-opt': String(k), disabled: done }, o); b.addEventListener('click', () => { opt = k; Sound.se('select'); draw(); }); return b; })),
            h('small', { class: 'dim' }, t('h07.pickEv')),
            h('div', { class: 'hd-evs' }, evs.map((_, i) => { const b = h('button', { class: `hd-ev${ev === i ? ' on' : ''}`, type: 'button', 'data-ev': String(i), disabled: done }, String(i + 1)); b.addEventListener('click', () => { ev = i; Sound.se('page'); draw(); }); return b; })),
            h('div', { class: 'hd-evtext' }, ev === undefined ? t('h07.evNone') : evs[ev]),
            h('div', { class: 'row', style: 'gap:12px;align-items:center' },
              done ? null : button(t('h07.submit'), () => { if (opt === 0 && ev === 0) { done = true; Sound.se('confirm'); onDone(); } else { miss = true; Sound.se('error'); } draw(); }, { kind: 'primary', disabled: opt === undefined || ev === undefined, cls: 'sg-ok' }),
              h('span', { class: `small ${done ? 'gold' : 'dim'}` }, done ? t('tut.h07.pracDone') : miss ? t('tut.h07.pracMiss') : t('tut.h07.pracAsk')))));
        };
        draw();
        return box;
      },
    },
  };
}

function h08Guide(): Guide {
  const AZ = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const nums = (ns: number[]) => h('div', { class: 'hd-seq' }, ns.map((n) => h('b', null, String(n))));
  return {
    name: '神の方程式',
    pages: [
      { title: t('tut.h08.t1'), text: t('tut.h08.p1'), figure: () => h('div', { class: 'hd-steps tg' }, [0, 1, 2, 3, 4].map((i) => h('span', { class: i === 0 ? 'on' : '' }, h('i', null, String(i + 1)), t(`h08.p${i}`)))) },
      { title: t('tut.h08.t2'), text: t('tut.h08.p2'), figure: () => h('div', { class: 'tg-row' }, h('div', { class: 'col', style: 'gap:6px;align-items:center' }, nums([1, 2, 3]), h('div', { class: 'hd-table' }, t('h08.cipherTable'))), h('span', { class: 'dq-arrow' }, '▶'), slots(['A', 'B', 'C'])) },
      { title: t('tut.h08.t3'), text: t('tut.h08.p3'), figure: () => facts([['3', t('tut.h08.f1')], ['✓', t('tut.h08.f2')]]) },
    ],
    practice: {
      text: t('tut.h08.practice'),
      build: (onDone) => {
        const box = h('div', { class: 'sg hd-col prac' });
        let text = '';
        let done = false;
        let miss = false;
        const draw = () => {
          box.replaceChildren(h('div', { class: 'hd-row' },
            h('div', { class: 'col', style: 'gap:8px;align-items:center;width:340px' }, nums([11, 5, 25]), h('div', { class: 'hd-table' }, t('h08.cipherTable')), slots([text[0] ?? '', text[1] ?? '', text[2] ?? '']),
              h('div', { class: `small ${done ? 'gold' : 'dim'}` }, done ? t('tut.h08.pracDone') : miss ? t('tut.h08.pracMiss') : t('tut.h08.pracAsk'))),
            done ? null : keyPad({ value: text, keys: AZ, max: 3, cols: 9, slots: false, onChange: (x) => { text = x; draw(); }, ok: t('h05.enter'), onOk: text.length === 3 ? () => {
              if (text === 'KEY') { done = true; Sound.se('confirm'); onDone(); } else { miss = true; text = ''; Sound.se('error'); }
              draw();
            } : null })));
        };
        draw();
        return box;
      },
    },
  };
}

export const HIDDEN_GUIDES: Record<string, () => Guide> = { h01: h01Guide, h02: h02Guide, h03: h03Guide, h04: h04Guide, h05: h05Guide, h07: h07Guide, h08: h08Guide };
