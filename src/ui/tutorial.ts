/**
 * 競技の説明（v11）。長文を一度に見せず、1 画面に 1 つのことだけを、盤面の図と短い文で説明する。
 * 最後に、本番とは別の問題を実際に操作する練習を 1 問行う。いつでも飛ばせる。
 * 全文のルールは、競技中の「ルール」ボタンと手帳で読める。
 */
import { Sound } from '../audio/audio';
import { t } from '../i18n/i18n';
import { L4, M01_DEMO, M01_PRACTICE, SQ } from '../matches/m01';
import { M03_DEMO, M03_PRACTICE } from '../matches/m03';
import { P03_PRACTICE } from '../matches/p03';
import { LinkBoard } from './linkboard';
import { SpeedTable } from './speedtable';
import { M02_PRACTICE } from '../matches/m02';
import { P01_PRACTICE } from '../matches/p01';
import { COLORS, P02_PRACTICE, SHAPES } from '../matches/p02';
import { rotated, type Cell } from '../matches/poly';
import { ChainBoard } from './chainboard';
import { append, button, clear, closeLayer, h, openLayer, type Child, type Layer } from './dom';
import { candCard } from './games/m02';
import { boardFigure, COLOR_NAME, itemEl, MemQuiz, SHAPE_NAME } from './memquiz';
import { PolyBoard } from './polyboard';

export interface GuidePage {
  title: string;
  text: string;
  figure: () => Child;
}

export interface Guide {
  name: string;
  pages: GuidePage[];
  practice: { text: string; build: (onDone: () => void) => HTMLElement };
}

// ---- 図の部品 ----

/** 小さなマス目の図。cells の cls で色や印を付ける */
function mini(w: number, hh: number, cells: { x: number; y: number; cls: string; label?: string }[], size = 40, caption?: Child, mark?: 'ok' | 'ng'): HTMLElement {
  const grid = h('div', { class: 'tg-grid', style: `width:${w * size}px;height:${hh * size}px` });
  for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) grid.append(h('span', { class: 'tg-cell', style: `left:${x * size}px;top:${y * size}px;width:${size}px;height:${size}px` }));
  for (const c of cells) grid.append(h('span', { class: `tg-cell ${c.cls}`, style: `left:${c.x * size}px;top:${c.y * size}px;width:${size}px;height:${size}px` }, c.label ?? ''));
  return h('div', { class: `tg-fig${mark ? ` ${mark}` : ''}` }, grid, mark ? h('div', { class: `tg-mark ${mark}` }, mark === 'ok' ? '○' : '✕') : null, caption ? h('div', { class: 'tg-cap' }, caption) : null);
}

const shape = (cells: Cell[], ox: number, oy: number, cls: string) => cells.map(([x, y]) => ({ x: x + ox, y: y + oy, cls }));

function chips(items: { label: string; value: string; on?: boolean }[], ops: string[]): HTMLElement {
  const out: Child[] = [];
  items.forEach((it, i) => {
    out.push(h('div', { class: `m01-chip${it.on === false ? '' : ' on'}` }, h('small', null, it.label), h('b', null, it.value)));
    if (ops[i]) out.push(h('span', { class: 'plus' }, ops[i]));
  });
  return h('div', { class: 'm01-score' }, out);
}

const facts = (items: [string, string][]) => h('div', { class: 'tg-facts' }, items.map(([big, small]) => h('div', { class: 'tg-fact' }, h('b', null, big), h('small', null, small))));

// ---- M01 ピース・アセンブル ----

function m01Guide(): Guide {
  return {
    name: 'ピース・アセンブル',
    pages: [
      { title: t('tut.m01.t1'), text: t('tut.m01.p1'), figure: () => new PolyBoard(M01_DEMO, { readonly: true, cell: 64, placed: [{ piece: 1, rot: 0, x: 1, y: 0 }] }).el },
      {
        title: t('tut.m01.t2'), text: t('tut.m01.p2'),
        figure: () => h('div', { class: 'tg-row' }, [0, 1, 2, 3].flatMap((r, i) => [i ? h('span', { class: 'tg-arrow' }, '↻') : null, mini(3, 3, shape(rotated(L4, r), 0, 0, 'pc0'), 36)])),
      },
      {
        title: t('tut.m01.t3'), text: t('tut.m01.p3'),
        figure: () => h('div', { class: 'tg-row' },
          mini(4, 3, [...shape(SQ, 0, 0, 'pc1'), ...shape(L4, 2, 0, 'pc0')], 38, t('tut.m01.ok'), 'ok'),
          mini(4, 3, [...shape(SQ, 0, 0, 'pc1'), ...shape(L4, 1, 0, 'pc0'), { x: 1, y: 0, cls: 'clash' }, { x: 1, y: 1, cls: 'clash' }], 38, t('tut.m01.ng1'), 'ng'),
          mini(4, 3, [{ x: 3, y: 2, cls: 'hole' }, ...shape(L4, 2, 0, 'pc0'), { x: 3, y: 2, cls: 'clash' }], 38, t('tut.m01.ng2'), 'ng')),
      },
      {
        title: t('tut.m01.t4'), text: t('tut.m01.p4'),
        figure: () => h('div', { class: 'col', style: 'gap:14px;align-items:center' },
          chips([{ label: t('m01.done'), value: '100' }, { label: t('m01.speed'), value: '0〜20' }, { label: t('m01.team'), value: '10' }], ['+', '+']),
          h('div', { class: 'tg-cap' }, t('tut.m01.partial')),
          facts([['6', t('tut.m01.f1')], ['120', t('tut.m01.f2')], ['4', t('tut.m01.f3')]])),
      },
    ],
    practice: {
      text: t('tut.m01.practice'),
      build: (onDone) => new PolyBoard(M01_PRACTICE, { cell: 70, onComplete: onDone }).el,
    },
  };
}

// ---- P01 数字の鎖 ----

const P01_DEMO = [3, 7, 2, 9, 5, 4, 8, 1, 6, 2, 3, 7, 9, 1, 5, 4];

function p01Guide(): Guide {
  return {
    name: '数字の鎖',
    pages: [
      { title: t('tut.p01.t1'), text: t('tut.p01.p1'), figure: () => new ChainBoard(P01_DEMO, 12, { readonly: true, cell: 78, path: [0, 4, 5] }).el },
      {
        title: t('tut.p01.t2'), text: t('tut.p01.p2'),
        figure: () => h('div', { class: 'tg-row' },
          h('div', { class: 'tg-fig ok' }, new ChainBoard(P01_DEMO, 15, { readonly: true, cell: 52, path: [1, 5, 9, 10] }).el.firstElementChild as HTMLElement, h('div', { class: 'tg-mark ok' }, '○'), h('div', { class: 'tg-cap' }, t('tut.p01.ok'))),
          h('div', { class: 'tg-fig ng' }, new ChainBoard(P01_DEMO, 15, { readonly: true, cell: 52, path: [0, 5, 10] }).el.firstElementChild as HTMLElement, h('div', { class: 'tg-mark ng' }, '✕'), h('div', { class: 'tg-cap' }, t('tut.p01.ng')))),
      },
      {
        title: t('tut.p01.t3'), text: t('tut.p01.p3'),
        figure: () => h('div', { class: 'col', style: 'gap:14px;align-items:center' },
          chips([{ label: t('tut.p01.c1'), value: '10' }, { label: t('tut.p01.c2'), value: '3〜6' }, { label: t('tut.p01.c3'), value: '0〜3' }], ['+', '+']),
          facts([['6', t('tut.p01.f1')], ['2', t('tut.p01.f2')], ['25', t('tut.p01.f3')]])),
      },
    ],
    practice: {
      text: t('tut.p01.practice'),
      build: (onDone) => {
        const b = new ChainBoard(P01_PRACTICE, 14, { cell: 80, onSubmit: () => { b.lock(); onDone(); } });
        return b.el;
      },
    },
  };
}

// ---- M02 フラッグ・フラッシュ、P02 瞬間記憶 ----

/** 練習用の記憶問題。時計は画面を開いた時から数える */
function memPractice(set: typeof M02_PRACTICE, onDone: () => void): HTMLElement {
  const start = performance.now();
  return new MemQuiz(set, { elapsed: () => performance.now() - start, onDone, cell: set.board.w === 3 ? 104 : 124 }).el;
}

const optRow = (items: string[], pick: number) => h('div', { class: 'tg-opts' }, items.map((x, i) => h('span', { class: `mq-opt${i === pick ? ' ok' : ''}` }, itemEl(x))));

function m02Guide(): Guide {
  const b = M02_PRACTICE.board;
  return {
    name: 'フラッグ・フラッシュ',
    pages: [
      { title: t('tut.m02.t1'), text: t('tut.m02.p1'), figure: () => boardFigure(b, { cell: 124 }) },
      {
        title: t('tut.m02.t2'), text: t('tut.m02.p2'),
        figure: () => h('div', { class: 'tg-row mem' },
          h('div', { class: 'tg-fig' }, h('div', { class: 'row', style: 'gap:10px;align-items:center' }, itemEl('se', 'tgt'), boardFigure(b, { cell: 50, hidden: true, marks: { 5: { cls: 'ok' } } })), h('div', { class: 'tg-cap' }, t('tut.m02.q1'))),
          h('div', { class: 'tg-fig' }, h('div', { class: 'row', style: 'gap:10px;align-items:center' }, boardFigure(b, { cell: 50, hidden: true, marks: { 7: { cls: 'asked', label: '？' } } }), optRow(['fr', 'de'], 1)), h('div', { class: 'tg-cap' }, t('tut.m02.q2'))),
          h('div', { class: 'tg-fig' }, optRow(['pl', 'vn', 'gh'], 1), h('div', { class: 'tg-cap' }, t('tut.m02.q3')))),
      },
      {
        title: t('tut.m02.t3'), text: t('tut.m02.p3'),
        figure: () => h('div', { class: 'm02-cands' }, candCard({ mix: 'place', n: 8, showMs: 6300 }, 0), candCard({ mix: 'item', n: 11, showMs: 8100 }, 1, { cls: 'sel', note: h('i', { class: 'tag' }, t('m02.chosenTag')) }), candCard({ mix: 'present', n: 9, showMs: 4500 }, 2)),
      },
      {
        title: t('tut.m02.t4'), text: t('tut.m02.p4'),
        figure: () => h('div', { class: 'col', style: 'gap:14px;align-items:center' },
          chips([{ label: t('tut.m02.c1'), value: '10' }, { label: t('tut.m02.c2'), value: '5' }, { label: t('tut.m02.c3'), value: '10' }], ['×', '+']),
          facts([['11', t('tut.m02.f1')], ['5', t('tut.m02.f2')], ['8', t('tut.m02.f3')]])),
      },
    ],
    practice: { text: t('tut.m02.practice'), build: (onDone) => memPractice(M02_PRACTICE, onDone) },
  };
}

function p02Guide(): Guide {
  return {
    name: '瞬間記憶',
    pages: [
      { title: t('tut.p02.t1'), text: t('tut.p02.p1'), figure: () => boardFigure(P02_PRACTICE.board, { cell: 104 }) },
      {
        title: t('tut.p02.t2'), text: t('tut.p02.p2'),
        figure: () => h('div', { class: 'col', style: 'gap:12px;align-items:center' },
          h('div', { class: 'tg-opts' }, SHAPES.map((sh) => h('span', { class: 'tg-leg' }, itemEl(`${sh}:red`), h('small', null, SHAPE_NAME[sh])))),
          h('div', { class: 'tg-opts' }, COLORS.map((c) => h('span', { class: 'tg-leg' }, itemEl(`circle:${c}`), h('small', null, COLOR_NAME[c]))))),
      },
      {
        title: t('tut.p02.t3'), text: t('tut.p02.p3'),
        figure: () => h('div', { class: 'col', style: 'gap:14px;align-items:center' },
          chips([{ label: t('tut.p02.c1'), value: '2' }, { label: t('tut.p02.c2'), value: '6' }, { label: t('tut.p02.c3'), value: '2' }], ['×', '+']),
          facts([['8', t('tut.p02.f1')], ['6', t('tut.p02.f2')], ['8', t('tut.p02.f3')]])),
      },
    ],
    practice: { text: t('tut.p02.practice'), build: (onDone) => memPractice(P02_PRACTICE, onDone) },
  };
}

// ---- M03 ツイン・リンク ----

const M03_DEMO_SOL = [[0, 4, 8, 12], [1, 2, 3, 7], [5, 6, 10, 14]];

function m03Guide(): Guide {
  const fig = (paths: number[][], cell: number) => new LinkBoard(M03_DEMO, { readonly: true, cell, paths }).el;
  return {
    name: 'ツイン・リンク',
    pages: [
      { title: t('tut.m03.t1'), text: t('tut.m03.p1'), figure: () => fig(M03_DEMO_SOL, 76) },
      { title: t('tut.m03.t2'), text: t('tut.m03.p2'), figure: () => fig([[0, 4, 8], [], [5, 6]], 76) },
      {
        title: t('tut.m03.t3'), text: t('tut.m03.p3'),
        figure: () => h('div', { class: 'tg-row' },
          h('div', { class: 'tg-fig ok' }, fig(M03_DEMO_SOL, 54), h('div', { class: 'tg-mark ok' }, '○'), h('div', { class: 'tg-cap' }, t('tut.m03.ok'))),
          h('div', { class: 'tg-fig ng' }, fig([[0, 4, 8, 12], [1, 2, 6, 7], [5, 6, 10, 14]], 54), h('div', { class: 'tg-mark ng' }, '✕'), h('div', { class: 'tg-cap' }, t('tut.m03.ng')))),
      },
      {
        title: t('tut.m03.t4'), text: t('tut.m03.p4'),
        figure: () => h('div', { class: 'col', style: 'gap:14px;align-items:center' },
          chips([{ label: t('tut.m03.c1'), value: '20' }, { label: t('tut.m03.c2'), value: '0〜4' }, { label: t('tut.m03.c3'), value: '15' }], ['×', '+']),
          facts([['5', t('tut.m03.f1')], ['4', t('tut.m03.f2')], ['150', t('tut.m03.f3')]])),
      },
    ],
    practice: {
      text: t('tut.m03.practice'),
      build: (onDone) => {
        const b: LinkBoard = new LinkBoard(M03_PRACTICE, { cell: 84, onComplete: () => { b.lock(); onDone(); } });
        return b.el;
      },
    },
  };
}

// ---- P03 スピードカード ----

function p03Guide(): Guide {
  return {
    name: 'スピードカード',
    pages: [
      { title: t('tut.p03.t1'), text: t('tut.p03.p1'), figure: () => new SpeedTable(P03_PRACTICE, { readonly: true }).el },
      { title: t('tut.p03.t2'), text: t('tut.p03.p2'), figure: () => new SpeedTable({ deck: [1, 12, 6, 1], piles: [4, 9], reserve: [7, 3, 5, 9, 2, 10, 4, 8] }, { readonly: true }).el },
      {
        title: t('tut.p03.t3'), text: t('tut.p03.p3'),
        figure: () => h('div', { class: 'col', style: 'gap:14px;align-items:center' },
          chips([{ label: t('tut.p03.c1'), value: '2' }, { label: t('tut.p03.c2'), value: '0〜24' }, { label: t('tut.p03.c3'), value: '8' }], ['×', '+']),
          facts([['3', t('tut.p03.f1')], ['24', t('tut.p03.f2')], ['180', t('tut.p03.f3')]])),
      },
    ],
    practice: {
      text: t('tut.p03.practice'),
      build: (onDone) => {
        // 出し切れずに止まった時は、同じ並びでやり直せる
        const box = h('div', { class: 'col', style: 'align-items:center' });
        const start = (): void => {
          box.replaceChildren(new SpeedTable(P03_PRACTICE, { onEnd: (_a, cleared) => { if (cleared) onDone(); else setTimeout(start, 1600); } }).el);
        };
        start();
        return box;
      },
    },
  };
}

const GUIDES: Record<string, () => Guide> = { m01: m01Guide, p01: p01Guide, m02: m02Guide, p02: p02Guide, m03: m03Guide, p03: p03Guide };

export const hasGuide = (id: string) => id in GUIDES;

/** 段階的な説明と練習。終えるか飛ばすと解決する。開いている間、大会の時計は止まる */
export function tutorialScreen(matchId: string, opts: { cutNote?: string } = {}): Promise<void> {
  const g = GUIDES[matchId]();
  return new Promise((resolve) => {
    let layer: Layer;
    let page = 0;
    let practiced = false;
    const total = g.pages.length + 1;
    const head = h('div', { class: 'tut-head' });
    const fig = h('div', { class: 'tut-fig' });
    const text = h('div', { class: 'tut-text' });
    const foot = h('div', { class: 'tut-foot' });
    const done = () => {
      closeLayer(layer);
      resolve();
    };
    const render = () => {
      const isPractice = page === g.pages.length;
      clear(head);
      head.append(h('span', { class: 'tut-id' }, `${matchId.toUpperCase()}　${g.name}`), h('b', { class: 'tut-title' }, isPractice ? t('tut.practice') : g.pages[page].title),
        h('span', { class: 'tut-dots' }, Array.from({ length: total }, (_, i) => h('i', { class: i === page ? 'on' : i < page ? 'past' : '' }))));
      clear(fig);
      clear(text);
      if (isPractice) {
        fig.append(g.practice.build(() => {
          practiced = true;
          Sound.se('result');
          text.textContent = t('tut.practiceDone');
          render2();
        }));
        text.textContent = g.practice.text;
      } else {
        const f = g.pages[page].figure();
        fig.append(...(Array.isArray(f) ? (f as Node[]) : [f as Node]));
        text.textContent = g.pages[page].text;
      }
      render2();
    };
    const render2 = () => {
      const isPractice = page === g.pages.length;
      clear(foot);
      append(foot, [
        isPractice ? h('span', { class: 'dim small' }, opts.cutNote ?? '') : button(t('tut.skip'), done, { kind: 'ghost', small: true }),
        h('span', { class: 'spacer' }),
        page > 0 ? button(t('common.back'), () => { page--; render(); }, { small: true }) : null,
        isPractice ? button(t(practiced ? 'tut.start' : 'tut.startSkip'), done, { kind: 'primary', autofocus: practiced }) : button(page === g.pages.length - 1 ? t('tut.toPractice') : t('common.next'), () => { page++; render(); }, { kind: 'primary', autofocus: true }),
      ]);
    };
    render();
    layer = openLayer(h('div', { class: 'overlay solid' }, h('div', { class: 'tut' }, head, fig, text, foot)), { pausesClock: true, name: 'tutorial' });
  });
}
