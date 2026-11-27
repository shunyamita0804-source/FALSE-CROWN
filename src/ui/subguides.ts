/**
 * サブゲーム S01〜S06 の段階的な説明と練習。図は本番と同じ部品で描く。練習の盤面は本番とは別。
 */
import { Sound } from '../audio/audio';
import { t } from '../i18n/i18n';
import { judge, type S01Guess } from '../matches/s01';
import { S02_N } from '../matches/s02';
import { S03_N, flipsOf, legalOf } from '../matches/s03';
import { holds } from '../matches/s05';
import { solved } from '../matches/s06';
import { button, h } from './dom';
import { codePad, die, guessList, memFace, stone, tileStyle } from './games/subs';
import type { Guide } from './tutorial';

const cap = (el: HTMLElement, text: string) => h('div', { class: 'tg-fig' }, el, h('div', { class: 'tg-cap' }, text));

function s01Guide(): Guide {
  const ex: S01Guess[] = [{ code: '528', ...judge('582', '528') }, { code: '825', ...judge('582', '825') }];
  return {
    name: '数字当て',
    pages: [
      { title: t('tut.s01.t1'), text: t('tut.s01.p1'), figure: () => h('div', { class: 'sg-slots' }, ['?', '?', '?'].map((c) => h('span', { class: 'sg-slot on' }, c))) },
      { title: t('tut.s01.t2'), text: t('tut.s01.p2'), figure: () => h('div', { class: 'tg-row' }, cap(h('div', { class: 'sg-slots' }, '582'.split('').map((c) => h('span', { class: 'sg-slot on' }, c))), t('tut.s01.capSecret')), cap(guessList([ex[0]], ''), t('tut.s01.capGuess'))) },
      { title: t('tut.s01.t3'), text: t('tut.s01.p3'), figure: () => guessList([{ code: '136', hit: 1, blow: 0 }, { code: '194', hit: 1, blow: 1 }, { code: '149', hit: 3, blow: 0 }], '') },
    ],
    practice: {
      text: t('tut.s01.practice'),
      build: (onDone) => {
        const box = h('div', { class: 'sg sg-s01 prac' });
        const hist = [...ex];
        let code = '';
        let finished = false;
        const draw = () => {
          box.replaceChildren(h('div', { class: 'col', style: 'gap:6px' }, guessList(hist, ''), h('div', { class: 'small dim' }, finished ? t('tut.s01.pracDone') : t('tut.s01.pracAsk'))),
            finished ? h('span') : codePad(code, (c) => { code = c; draw(); }, hist.some((g) => g.code === code) ? null : () => {
              const j = judge('582', code);
              hist.push({ code, ...j });
              code = '';
              if (j.hit === 3) { finished = true; onDone(); } else Sound.se('click');
              draw();
            }, t('sub.s01.okGuess')));
        };
        draw();
        return box;
      },
    },
  };
}

/** 五目並べの小さな盤面（練習と図で使う） */
function goBoard(stones: Record<number, number>, opts: { onTap?: (c: number) => void; line?: number[]; sel?: number } = {}): HTMLElement {
  return h('div', { class: 'sg-go tg', style: `--sg-n:${S02_N}` }, Array.from({ length: S02_N * S02_N }, (_, i) => {
    const el = h('button', { class: `sg-pt${opts.line?.includes(i) ? ' line' : ''}${opts.sel === i ? ' sel' : ''}`, type: 'button', 'data-cell': String(i), disabled: !opts.onTap || stones[i] !== undefined }, stones[i] !== undefined ? stone(stones[i]) : null);
    if (opts.onTap) el.addEventListener('click', () => opts.onTap!(i));
    return el;
  }));
}

function s02Guide(): Guide {
  const base: Record<number, number> = { 30: 0, 31: 0, 32: 0, 33: 0, 39: 1, 40: 1, 41: 1, 22: 1 };
  return {
    name: '五目並べ',
    pages: [
      { title: t('tut.s02.t1'), text: t('tut.s02.p1'), figure: () => goBoard({ 40: 0, 41: 1, 31: 0 }) },
      { title: t('tut.s02.t2'), text: t('tut.s02.p2'), figure: () => goBoard({ 20: 0, 30: 0, 40: 0, 50: 0, 60: 0, 21: 1, 31: 1, 41: 1, 51: 1 }, { line: [20, 30, 40, 50, 60] }) },
      { title: t('tut.s02.t3'), text: t('tut.s02.p3'), figure: () => goBoard({ ...base }, { sel: 34 }) },
    ],
    practice: {
      text: t('tut.s02.practice'),
      build: (onDone) => {
        const box = h('div', { class: 'col', style: 'gap:8px;align-items:center' });
        const st = { ...base };
        let finished = false;
        const draw = (msg: string) => box.replaceChildren(goBoard(st, {
          line: finished ? [29, 30, 31, 32, 33, 34].filter((c) => st[c] === 0) : [],
          onTap: finished ? undefined : (c) => {
            if (c === 34 || c === 29) { st[c] = 0; finished = true; Sound.se('chip'); onDone(); draw(t('tut.s02.pracDone')); } else { Sound.se('click'); draw(t('tut.s02.pracMiss')); }
          },
        }), h('div', { class: 'small' }, msg));
        draw(t('tut.s02.pracAsk'));
        return box;
      },
    },
  };
}

function rvBoard(board: number[], who: number, opts: { onTap?: (c: number) => void; flipped?: number[]; showLegal?: boolean } = {}): HTMLElement {
  const legal = opts.showLegal ? legalOf(board, who) : [];
  return h('div', { class: 'sg-rv tg', style: `--sg-n:${S03_N}` }, board.map((c, i) => {
    const el = h('button', { class: `sg-sq${legal.includes(i) ? ' can' : ''}`, type: 'button', 'data-cell': String(i), disabled: !opts.onTap || !legal.includes(i) }, c !== -1 ? stone(c, opts.flipped?.includes(i) ? 'flip' : '') : null);
    if (opts.onTap) el.addEventListener('click', () => opts.onTap!(i));
    return el;
  }));
}

function s03Guide(): Guide {
  const start = () => { const b = Array(S03_N * S03_N).fill(-1); b[14] = 1; b[15] = 0; b[20] = 0; b[21] = 1; return b; };
  const after = () => { const b = start(); b[13] = 0; b[14] = 0; return b; };
  return {
    name: 'ミニリバーシ',
    pages: [
      { title: t('tut.s03.t1'), text: t('tut.s03.p1'), figure: () => rvBoard(start(), 0) },
      { title: t('tut.s03.t2'), text: t('tut.s03.p2'), figure: () => h('div', { class: 'tg-row' }, cap(rvBoard(start(), 0, { showLegal: true }), t('tut.s03.capBefore')), cap(rvBoard(after(), 0, { flipped: [14] }), t('tut.s03.capAfter'))) },
      { title: t('tut.s03.t3'), text: t('tut.s03.p3'), figure: () => rvBoard(after(), 1, { showLegal: true }) },
    ],
    practice: {
      text: t('tut.s03.practice'),
      build: (onDone) => {
        const box = h('div', { class: 'col', style: 'gap:8px;align-items:center' });
        let b = start();
        let finished = false;
        const draw = (msg: string, flipped: number[] = []) => box.replaceChildren(rvBoard(b, 0, {
          showLegal: !finished, flipped,
          onTap: finished ? undefined : (c) => {
            const fl = flipsOf(b, c, 0);
            if (!fl.length) return;
            b = [...b];
            for (const f of fl) b[f] = 0;
            b[c] = 0;
            finished = true;
            Sound.se('chip');
            onDone();
            draw(t('tut.s03.pracDone'), fl);
          },
        }), h('div', { class: 'small' }, msg));
        draw(t('tut.s03.pracAsk'));
        return box;
      },
    },
  };
}

function memCard(f: number | null, cls = ''): HTMLElement {
  return h('span', { class: `sg-card tg ${f !== null ? 'up' : ''} ${cls}` }, f !== null ? memFace(f) : h('i', { class: 'sg-back' }));
}

function s04Guide(): Guide {
  return {
    name: '記憶カード',
    pages: [
      { title: t('tut.s04.t1'), text: t('tut.s04.p1'), figure: () => h('div', { class: 'row', style: 'gap:10px' }, [null, null, 2, null, null, null].map((f) => memCard(f))) },
      { title: t('tut.s04.t2'), text: t('tut.s04.p2'), figure: () => h('div', { class: 'tg-row' }, cap(h('div', { class: 'row', style: 'gap:8px' }, memCard(1, 'hit'), memCard(1, 'hit')), t('tut.s04.capHit')), cap(h('div', { class: 'row', style: 'gap:8px' }, memCard(3, 'miss'), memCard(4, 'miss')), t('tut.s04.capMiss'))) },
      { title: t('tut.s04.t3'), text: t('tut.s04.p3'), figure: () => h('div', { class: 'row', style: 'gap:10px' }, [0, 1, 2, 3, 4, 5].map((f) => memCard(f))) },
    ],
    practice: {
      text: t('tut.s04.practice'),
      build: (onDone) => {
        const box = h('div', { class: 'col', style: 'gap:8px;align-items:center' });
        const faces = [0, 3, 3, 0];
        const taken = [false, false, false, false];
        let open: number[] = [];
        let lock = false;
        const draw = (msg: string) => box.replaceChildren(h('div', { class: 'row', style: 'gap:12px' }, faces.map((f, i) => {
          const el = h('button', { class: `sg-card${open.includes(i) || taken[i] ? ' up' : ''}${taken[i] ? ' hit' : ''}`, type: 'button', 'data-cell': String(i), disabled: lock || taken[i] || open.includes(i) }, open.includes(i) || taken[i] ? memFace(f) : h('i', { class: 'sg-back' }));
          el.addEventListener('click', () => {
            if (lock || taken[i] || open.includes(i)) return;
            Sound.se('card');
            open.push(i);
            if (open.length < 2) { draw(t('sub.s04.second')); return; }
            const [a, b2] = open;
            if (faces[a] === faces[b2]) {
              taken[a] = taken[b2] = true;
              open = [];
              if (taken.every(Boolean)) { onDone(); draw(t('tut.s04.pracDone')); } else draw(t('tut.s04.pracHit'));
            } else {
              lock = true;
              draw(t('tut.s04.pracMiss'));
              setTimeout(() => { lock = false; open = []; draw(t('tut.s04.pracAsk')); }, 1100);
            }
          });
          return el;
        })), h('div', { class: 'small' }, msg));
        draw(t('tut.s04.pracAsk'));
        return box;
      },
    },
  };
}

function s05Guide(): Guide {
  const dice = (ds: number[], re: number[] = []) => h('div', { class: 'sg-dice sm' }, ds.map((d, i) => die(d, re.includes(i) ? 're' : '')));
  return {
    name: 'ダイスパズル',
    pages: [
      { title: t('tut.s05.t1'), text: t('tut.s05.p1'), figure: () => dice([6, 6, 5, 1, 1]) },
      { title: t('tut.s05.t2'), text: t('tut.s05.p2'), figure: () => h('div', { class: 'tg-row' }, cap(dice([6, 5, 4, 3, 2]), t('sub.s05.c0')), cap(dice([4, 4, 4, 1, 6]), t('sub.s05.c1')), cap(dice([2, 3, 4, 5, 5]), t('sub.s05.c2'))) },
      { title: t('tut.s05.t3'), text: t('tut.s05.p3'), figure: () => h('div', { class: 'tg-row' }, cap(dice([6, 6, 5, 1, 1]), t('tut.s05.capBefore')), h('span', { class: 'plus' }, '→'), cap(dice([6, 6, 5, 4, 3], [3, 4]), t('tut.s05.capAfter'))) },
      { title: t('tut.s05.t4'), text: t('tut.s05.p4'), figure: () => h('div', { class: 'sg-conds' }, [0, 1, 2].map((c) => h('span', { class: `sg-cond${c === 0 ? ' used' : ''}` }, h('b', null, t(`sub.s05.c${c}`)), h('small', null, c === 0 ? t('sub.s05.used') : t(`sub.s05.c${c}ex`))))) },
    ],
    practice: {
      text: t('tut.s05.practice'),
      build: (onDone) => {
        const box = h('div', { class: 'sg sg-s05 prac' });
        const base = [6, 6, 5, 1, 1];
        let re: number[] = [];
        let cond: number | undefined;
        let result: number[] | null = null;
        const draw = (msg: string) => {
          if (result) { box.replaceChildren(h('div', { class: 'sg-dice' }, result.map((d, i) => die(d, re.includes(i) ? 're' : ''))), h('div', { class: 'small' }, msg)); return; }
          box.replaceChildren(
            h('div', { class: 'sg-dice' }, base.map((d, j) => {
              const el = h('button', { class: `sg-dbtn${re.includes(j) ? ' re' : ''}`, type: 'button', 'data-die': String(j) }, die(d), h('small', null, re.includes(j) ? t('sub.s05.reroll') : t('sub.s05.keep')));
              el.addEventListener('click', () => { re = re.includes(j) ? re.filter((x) => x !== j) : [...re, j]; Sound.se('select'); draw(msg); });
              return el;
            })),
            h('div', { class: 'sg-conds' }, [0, 1, 2].map((c) => {
              const el = h('button', { class: `sg-cond${cond === c ? ' sel' : ''}`, type: 'button', 'data-cond': String(c) }, h('b', null, t(`sub.s05.c${c}`)));
              el.addEventListener('click', () => { cond = c; Sound.se('select'); draw(msg); });
              return el;
            })),
            h('div', { class: 'small' }, msg),
            button(re.length ? t('sub.s05.go', { n: re.length }) : t('sub.s05.goKeep'), () => {
              if (cond !== 0 || re.length !== 2 || !re.includes(3) || !re.includes(4)) { Sound.se('click'); draw(t('tut.s05.pracMiss')); return; }
              result = [6, 6, 5, 4, 3];
              if (holds(0, result)) onDone();
              draw(t('tut.s05.pracDone'));
            }, { kind: 'primary', disabled: cond === undefined, cls: 'sg-ok' }));
        };
        draw(t('tut.s05.pracAsk'));
        return box;
      },
    },
  };
}

function jig(perm: number[], n: number, size: number, opts: { onTap?: (pos: number) => void; sel?: number } = {}): HTMLElement {
  return h('div', { class: 'sg-jig tg', style: `grid-template-columns:repeat(${n}, ${size}px)` }, perm.map((tile, pos) => {
    const el = h('button', { class: `sg-tile${opts.sel === pos ? ' sel' : ''}`, type: 'button', 'data-pos': String(pos), disabled: !opts.onTap, style: tileStyle(0, n, tile, size) });
    if (opts.onTap) el.addEventListener('click', () => opts.onTap!(pos));
    return el;
  }));
}

function s06Guide(): Guide {
  const mixed = [0, 4, 2, 3, 1, 5, 8, 7, 6];
  return {
    name: 'ミニジグソー',
    pages: [
      { title: t('tut.s06.t1'), text: t('tut.s06.p1'), figure: () => h('div', { class: 'tg-row' }, cap(jig(mixed, 3, 96), t('tut.s06.capMixed')), h('span', { class: 'plus' }, '→'), cap(jig([0, 1, 2, 3, 4, 5, 6, 7, 8], 3, 96), t('sub.s06.ref'))) },
      { title: t('tut.s06.t2'), text: t('tut.s06.p2'), figure: () => jig(mixed, 3, 110, { sel: 1 }) },
      { title: t('tut.s06.t3'), text: t('tut.s06.p3'), figure: () => h('div', { class: 'tg-row' }, h('span', { class: 'sg-mode' }, t('sub.s06.modeAdj')), h('span', { class: 'sg-mode' }, t('sub.s06.modeAny'))) },
    ],
    practice: {
      text: t('tut.s06.practice'),
      build: (onDone) => {
        const box = h('div', { class: 'col', style: 'gap:8px;align-items:center' });
        const perm = [...mixed];
        let sel: number | undefined;
        let finished = false;
        const draw = (msg: string) => box.replaceChildren(h('div', { class: 'tg-row' }, jig(perm, 3, 120, {
          sel,
          onTap: finished ? undefined : (pos) => {
            if (sel === undefined) { sel = pos; Sound.se('select'); draw(t('sub.s06.lead2')); return; }
            if (sel === pos) { sel = undefined; draw(t('tut.s06.pracAsk')); return; }
            [perm[sel], perm[pos]] = [perm[pos], perm[sel]];
            sel = undefined;
            Sound.se('chip');
            if (solved(perm)) { finished = true; onDone(); draw(t('tut.s06.pracDone')); } else draw(t('tut.s06.pracAsk'));
          },
        }), cap(jig([0, 1, 2, 3, 4, 5, 6, 7, 8], 3, 56), t('sub.s06.ref'))), h('div', { class: 'small' }, msg));
        draw(t('tut.s06.pracAsk'));
        return box;
      },
    },
  };
}

export const SUB_GUIDES: Record<string, () => Guide> = { s01: s01Guide, s02: s02Guide, s03: s03Guide, s04: s04Guide, s05: s05Guide, s06: s06Guide };
