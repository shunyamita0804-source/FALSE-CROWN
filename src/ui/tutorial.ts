/**
 * 競技の説明（v11）。長文を一度に見せず、1 画面に 1 つのことだけを、盤面の図と短い文で説明する。
 * 最後に、本番とは別の問題を実際に操作する練習を 1 問行う。いつでも飛ばせる。
 * 全文のルールは、競技中の「ルール」ボタンと手帳で読める。
 */
import { Sound } from '../audio/audio';
import { t } from '../i18n/i18n';
import { emblem } from './art';
import { L4, M01_DEMO, M01_PRACTICE, SQ } from '../matches/m01';
import { M03_DEMO, M03_PRACTICE } from '../matches/m03';
import { applyAct as applyRail, CITY_NAMES, EDGES, ROUNDS as M04_ROUNDS, practiceTable, routeFor } from '../matches/m04';
import { P03_PRACTICE } from '../matches/p03';
import { RailMap, SEAT_COLORS, type RailMapData } from './railmap';
import { LinkBoard } from './linkboard';
import { SpeedTable } from './speedtable';
import { M02_PRACTICE } from '../matches/m02';
import { P01_PRACTICE } from '../matches/p01';
import { COLORS, P02_PRACTICE, SHAPES } from '../matches/p02';
import { P04_PRACTICE, SHAPES as P04_SHAPES } from '../matches/p04';
import { M05_PRACTICE, type Tok } from '../matches/m05';
import { ExprPad, exprEl } from './exprpad';
import { matchesIn } from '../matches/m06';
import { cardBack, cardEl } from './cards';
import { P06_PRACTICE, P06_PRACTICE_SOL } from '../matches/p06';
import { PathBoard } from './pathboard';
import { G as HEX7, startCell as hexStart } from '../matches/m07';
import { cellAt as hexAt } from '../matches/hex';
import { TilePlacer, type PlacerSel } from './tileplacer';
import { G as HEX3, HOLE, HOLE_V, flipsFor as p07Flips, legalFor as p07Legal, startBoard as p07Start } from '../matches/p07';
import { FlipBoard, type FlipSel } from './flipboard';
import { EDGES as M08_EDGES, edgeBetween as m08Edge, movesFor as m08Moves, nodeOf as m08Node, startNode as m08Start, wallsFor as m08Walls } from '../matches/m08';
import { ringBoard } from './ringboard';
import { P08_PRACTICE, type Scale } from '../matches/p08';
import { ScaleBoard } from './scaleboard';
import { CENTER as M09_CENTER, movesOf as m09Moves, startPieces as m09Start, type Piece as M09Piece } from '../matches/m09';
import { duelKind, pieceBoard } from './pieceboard';
import { M09_COLORS } from './games/m09';
import { condList } from './games/p08';
import { P09_PRACTICE, expected as p09Expected, scoreOf as p09Score, type Mirror } from '../matches/p09';
import { toolBar as p09Tools } from './games/p09';
import { MirrorBoard } from './mirrorboard';
import { DELIVER_PTS as M10_DELIVER, HOME_PTS as M10_HOME, M10_PRACTICE, actsOf as m10Acts, applyAct as m10Apply, startBoard as m10Start, type Board as M10Board } from '../matches/m10';
import { triBoard } from './triboard';
import { CENTERS as P10_CENTERS, H06_KEEP, H06_ROUNDS, H06_SIGNALS, applyStep as p10Apply, h06Start, startPieces as p10Start, stepsOf as p10Steps, type Piece as P10Piece } from '../matches/p10';
import { P10_COLORS } from './games/p10';
import { EVENTS as M11_EVENTS } from '../matches/m11';
import type { CharId } from '../data/characters';
import { DiffQuiz, diffFigure, diffReview, figEl, FIG_NAME } from './diffquiz';
import { rotated, type Cell } from '../matches/poly';
import { ChainBoard } from './chainboard';
import { append, button, clear, closeLayer, h, openLayer, type Child, type Layer } from './dom';
import { candCard } from './games/m02';
import { boardFigure, COLOR_NAME, itemEl, MemQuiz, SHAPE_NAME } from './memquiz';
import { PolyBoard } from './polyboard';
import { HIDDEN_GUIDES } from './hiddenguides';
import { SUB_GUIDES } from './subguides';
import { VOICED } from './voiceguides';
import { voicedTutorial, type TutCtx } from './voicetut';

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

// ---- M04 鉄道王国・改 ----

function m04Guide(): Guide {
  const demo = practiceTable();
  const fig = (owner: Record<number, number>, extra: Partial<RailMapData> = {}, scale = 0.72): HTMLElement => {
    const m = new RailMap(undefined, scale);
    m.draw({ costs: demo.costs, owner: EDGES.map((_, e) => owner[e] ?? -1), marks: ['自', '他'], ...extra });
    return m.el;
  };
  return {
    name: '鉄道王国・改',
    pages: [
      { title: t('tut.m04.t1'), text: t('tut.m04.p1'), figure: () => fig({ 0: 0, 8: 0 }, { cities: [0, 4], route: [0, 8] }) },
      { title: t('tut.m04.t2'), text: t('tut.m04.p2'), figure: () => fig({ 0: 0 }, { sel: 8, cities: [0, 4] }) },
      {
        title: t('tut.m04.t3'), text: t('tut.m04.p3'),
        figure: () => h('div', { class: 'tg-row' }, fig({ 0: 0, 8: 1 }, { cities: [0, 4], route: [0, 8] }, 0.62),
          h('div', { class: 'col', style: 'gap:10px' }, h('div', { class: 'row', style: 'gap:8px;align-items:center' }, h('i', { class: 'sw', style: `width:16px;height:16px;border-radius:4px;background:${SEAT_COLORS[0]}` }), t('tut.m04.own')),
            h('div', { class: 'row', style: 'gap:8px;align-items:center' }, h('i', { class: 'sw', style: `width:16px;height:16px;border-radius:4px;background:${SEAT_COLORS[1]}` }), t('tut.m04.toll')))),
      },
      {
        title: t('tut.m04.t4'), text: t('tut.m04.p4'),
        figure: () => h('div', { class: 'col', style: 'gap:14px;align-items:center' },
          chips([{ label: t('tut.m04.c1'), value: '8〜12' }, { label: t('tut.m04.c2'), value: '1' }, { label: t('tut.m04.c3'), value: '1' }], ['+', '+']),
          facts([[String(M04_ROUNDS), t('tut.m04.f1')], ['3', t('tut.m04.f2')], ['12', t('tut.m04.f3')]])),
      },
    ],
    practice: {
      text: t('tut.m04.practice'),
      build: (onDone) => {
        const tb = practiceTable();
        let sel: number | undefined;
        const box = h('div', { class: 'm04-play' });
        const map = new RailMap((e) => { sel = sel === e ? undefined : e; draw(); }, 0.78);
        const draw = (): void => {
          const m = tb.missions[0][0];
          const r = routeFor(tb, 0, m.from, m.to);
          map.draw({ costs: tb.costs, owner: tb.owner, marks: ['自'], sel, cities: [m.from, m.to], route: r?.edges });
          const cost = sel !== undefined ? tb.costs[sel] : 0;
          box.replaceChildren(map.el, h('div', { class: 'm04-col', style: 'width:250px' },
            h('div', { class: 'm04-me' }, h('span', { class: 'm04-fund' }, String(tb.funds[0])), h('span', { class: 'small dim' }, `${CITY_NAMES[m.from]} → ${CITY_NAMES[m.to]}`)),
            button(sel !== undefined ? t('m04.build', { e: `${CITY_NAMES[EDGES[sel][0]]}–${CITY_NAMES[EDGES[sel][1]]}`, c: cost }) : t('m04.buildNone'), () => {
              if (sel === undefined) return;
              // 練習は手数を数えない（何度でも敷ける）。資金が足りない時は増やす
              tb.turn = 0;
              if (applyRail(tb, 0, { t: 'build', edge: sel })) Sound.se('chip');
              sel = undefined;
              draw();
            }, { kind: 'primary', disabled: sel === undefined || cost > tb.funds[0] }),
            button(t('m04.fund', { n: 3 }), () => { tb.turn = 0; applyRail(tb, 0, { t: 'fund' }); draw(); }, {}),
            button(t('m04.move'), () => { tb.turn = 0; if (applyRail(tb, 0, { t: 'transport', mission: 0 })) { draw(); onDone(); } }, { kind: 'primary', disabled: !r || m.done })));
        };
        draw();
        return box;
      },
    },
  };
}

// ---- P04 消えた図形 ----

function p04Guide(): Guide {
  const s = P04_PRACTICE;
  return {
    name: '消えた図形',
    pages: [
      { title: t('tut.p04.t1'), text: t('tut.p04.p1'), figure: () => diffFigure(s.a, { cell: 50 }) },
      { title: t('tut.p04.t2'), text: t('tut.p04.p2'), figure: () => diffReview(s, undefined, 44) },
      {
        title: t('tut.p04.t3'), text: t('tut.p04.p3'),
        figure: () => h('div', { class: 'col', style: 'gap:12px;align-items:center' },
          h('div', { class: 'tg-opts' }, P04_SHAPES.map((sh) => h('span', { class: 'tg-leg dq-leg' }, figEl(`${sh}:0`), h('small', null, FIG_NAME[sh])))),
          h('div', { class: 'tg-opts' }, [0, 1, 2, 3].map((r) => h('span', { class: 'tg-leg dq-leg' }, figEl(`arrow:${r}`), h('small', null, t(`dq.dir${r}`)))))),
      },
      {
        title: t('tut.p04.t4'), text: t('tut.p04.p4'),
        figure: () => h('div', { class: 'tg-row' },
          chips([{ label: t('tut.p04.c1'), value: '+3' }, { label: t('tut.p04.c2'), value: '−1' }, { label: t('tut.p04.c3'), value: '+3' }], ['', '']),
          facts([['10', t('tut.p04.f1')], ['8', t('tut.p04.f2')], ['25', t('tut.p04.f3')]])),
      },
    ],
    practice: {
      text: t('tut.p04.practice'),
      build: (onDone) => {
        const box = h('div', { class: 'p04-prac' });
        const run = () => {
          const start = performance.now();
          const quiz = new DiffQuiz(s, {
            elapsed: () => performance.now() - start, showMs: 6000, answerMs: 60_000, cell: 66,
            onDone: (cells) => {
              const again = button(t('tut.p04.again'), run, { small: true });
              box.replaceChildren(h('div', { class: 'col', style: 'gap:10px;align-items:center' }, diffReview(s, cells, 40), again));
              onDone();
            },
          });
          box.replaceChildren(quiz.el);
        };
        run();
        return box;
      },
    },
  };
}

// ---- M05 ナンバー・リレー ----

function m05Guide(): Guide {
  const { cards, target } = M05_PRACTICE;
  const ex3: Tok[] = ['(', 2, '-', 0, ')', '*', 3];
  const ex6: Tok[] = [0, '+', 2, '*', '(', 3, '-', 1, ')', '+', 5, '-', 4];
  const nums = () => h('div', { class: 'm05-nums' }, cards.map((c) => h('b', { class: 'xp-card mini' }, String(c))));
  const line = (toks: Tok[], n: number) => h('div', { class: 'tg-exline' }, exprEl(toks, cards, 'small'), h('span', { class: 'xp-val ok' }, `＝ ${target}`), h('small', { class: 'dim' }, t('tut.m05.usedN', { n })));
  return {
    name: 'ナンバー・リレー',
    pages: [
      { title: t('tut.m05.t1'), text: t('tut.m05.p1'), figure: () => h('div', { class: 'col', style: 'gap:12px;align-items:center' }, h('div', { class: 'xp-target' }, h('small', null, t('xp.target')), h('b', null, String(target))), nums(), line(ex3, 3)) },
      { title: t('tut.m05.t2'), text: t('tut.m05.p2'), figure: () => h('div', { class: 'col', style: 'gap:10px;align-items:center' }, nums(), line(ex3, 3), line(ex6, 6)) },
      {
        title: t('tut.m05.t3'), text: t('tut.m05.p3'),
        figure: () => h('div', { class: 'tg-row' },
          chips([{ label: t('tut.m05.c1'), value: '40' }, { label: t('tut.m05.c2'), value: '2〜12' }, { label: t('tut.m05.c3'), value: '0〜8' }], ['+', '+']),
          facts([['90', t('tut.m05.f1')], ['+10', t('tut.m05.f2')], ['8', t('tut.m05.f3')]])),
      },
      {
        title: t('tut.m05.t4'), text: t('tut.m05.p4'),
        figure: () => h('div', { class: 'col', style: 'gap:12px;align-items:center' }, h('div', { class: 'm05-cands' }, [38, 45, 57].map((c, i) => h('div', { class: `m05-cand${i === 1 ? ' sel' : ''}` }, String(c)))), nums()),
      },
    ],
    practice: {
      text: t('tut.m05.practice'),
      build: (onDone) => new ExprPad(cards, target, { onSubmit: () => onDone() }).el,
    },
  };
}

// ---- P05 21の攻防 ----

function p05Guide(): Guide {
  const cardRow = (cards: number[], mark?: number, cls = 'hit') => h('div', { class: 'p05-hand tg' }, cards.map((c) => h('div', { class: `p05-card${c === mark ? ` ${cls} sel` : ''}` }, h('b', null, String(c)))));
  const total = (n: number) => h('div', { class: 'p05-total' }, h('small', null, t('p05.total')), h('b', null, String(n)), h('span', null, '/ 21'));
  return {
    name: '21の攻防',
    pages: [
      { title: t('tut.p05.t1'), text: t('tut.p05.p1'), figure: () => h('div', { class: 'row', style: 'gap:20px;align-items:center' }, total(8), h('span', { class: 'plus' }, '+'), cardRow([6]), h('span', { class: 'plus' }, '→'), total(14)) },
      {
        title: t('tut.p05.t2'), text: t('tut.p05.p2'),
        figure: () => h('div', { class: 'tg-row' },
          h('div', { class: 'tg-fig ok' }, h('div', { class: 'row', style: 'gap:10px;align-items:center' }, total(14), cardRow([7], 7)), h('div', { class: 'tg-cap' }, t('tut.p05.hit'))),
          h('div', { class: 'tg-fig ng' }, h('div', { class: 'row', style: 'gap:10px;align-items:center' }, total(14), cardRow([9], 9, 'bust')), h('div', { class: 'tg-cap' }, t('tut.p05.bust')))),
      },
      { title: t('tut.p05.t3'), text: t('tut.p05.p3'), figure: () => h('div', { class: 'col', style: 'gap:8px;align-items:center' }, h('div', { class: 'p05-mini big' }, [1, 2, 3, 4, 5, 6, 7, 8, 9].map((c) => h('i', { class: [2, 5, 9].includes(c) ? 'gone' : '' }, String(c)))), h('small', { class: 'dim' }, t('tut.p05.miniCap'))) },
      {
        title: t('tut.p05.t4'), text: t('tut.p05.p4'),
        figure: () => facts([['3', t('tut.p05.f1')], ['9', t('tut.p05.f2')], ['+4', t('tut.p05.f3')], ['−3', t('tut.p05.f4')]]),
      },
    ],
    practice: {
      text: t('tut.p05.practice'),
      build: (onDone) => {
        const box = h('div', { class: 'p05 prac' });
        const hand = [3, 5, 7, 9];
        let sum = 14;
        let msg = t('tut.p05.pracAsk');
        const draw = () => {
          box.replaceChildren(
            h('div', { class: 'p05-mid' }, total(sum), h('div', { class: 'small' }, msg)),
            h('div', { class: 'p05-hand' }, hand.map((c) => {
              const k = sum + c === 21 ? 'hit' : sum + c > 21 ? 'bust' : 'add';
              const el = h('button', { class: `p05-card ${k}`, type: 'button' }, h('b', null, String(c)), h('small', null, k === 'hit' ? t('p05.pvHit', { n: 4 }) : k === 'bust' ? t('p05.pvBust', { n: -3 }) : t('p05.pvAdd', { s: sum + c })));
              el.addEventListener('click', () => {
                if (k === 'hit') { sum = 0; msg = t('tut.p05.pracOk'); hand.splice(hand.indexOf(c), 1); draw(); onDone(); } else { msg = t(k === 'bust' ? 'tut.p05.pracBust' : 'tut.p05.pracAdd'); draw(); }
              });
              return el;
            })));
        };
        draw();
        return box;
      },
    },
  };
}

// ---- M06 クロス・カード ----

function m06Guide(): Guide {
  const cd = (rank: number, suit: number) => suit * 13 + rank - 1;
  const hand0 = [cd(4, 0), cd(9, 3), cd(2, 1), cd(12, 2), cd(6, 0)];
  const field0 = [cd(9, 2), cd(3, 3), cd(13, 0), cd(5, 1), cd(7, 2)];
  const row = (cards: number[], cls = 'small', mark: number[] = []) => h('div', { class: 'xc-row mini' }, cards.map((c) => cardEl(c, { cls: `${cls}${mark.includes(c) ? ' sel' : ''}` })));
  return {
    name: 'クロス・カード',
    pages: [
      { title: t('tut.m06.t1'), text: t('tut.m06.p1'), figure: () => h('div', { class: 'col', style: 'gap:14px;align-items:center' }, h('div', { class: 'row', style: 'gap:10px;align-items:center' }, h('span', { class: 'xc-lbl' }, t('m06.field')), row(field0), cardBack('small')), h('div', { class: 'row', style: 'gap:10px;align-items:center' }, h('span', { class: 'xc-lbl' }, t('m06.hand')), row(hand0))) },
      { title: t('tut.m06.t2'), text: t('tut.m06.p2'), figure: () => h('div', { class: 'col', style: 'gap:22px;align-items:center' }, row(field0, 'small', [cd(9, 2)]), row(hand0, 'small', [cd(4, 0)])) },
      {
        title: t('tut.m06.t3'), text: t('tut.m06.p3'),
        figure: () => h('div', { class: 'tg-row' },
          h('div', { class: 'tg-fig ok' }, row([cd(9, 3), cd(9, 2)]), h('div', { class: 'tg-mark ok' }, '○'), h('div', { class: 'tg-cap' }, t('tut.m06.ok'))),
          h('div', { class: 'tg-fig ng' }, row([cd(9, 3), cd(6, 0)]), h('div', { class: 'tg-mark ng' }, '✕'), h('div', { class: 'tg-cap' }, t('tut.m06.ng')))),
      },
      { title: t('tut.m06.t4'), text: t('tut.m06.p4'), figure: () => facts([['6', t('tut.m06.f1')], ['+6', t('tut.m06.f2')], ['+8', t('tut.m06.f3')], ['+6', t('tut.m06.f4')]]) },
    ],
    practice: {
      text: t('tut.m06.practice'),
      build: (onDone) => {
        const box = h('div', { class: 'xc prac' });
        let hand = [...hand0];
        let field = [...field0];
        let sh: number | undefined;
        let sf: number | undefined;
        let msg = t('m06.swapHow');
        let done = false;
        const draw = () => {
          const mk = (c: number, sel: boolean, on: () => void) => { const el = cardEl(c, { button: true, disabled: done, cls: `small${sel ? ' sel' : ''}` }); el.addEventListener('click', on); return el; };
          const swap = button(t('m06.swap'), () => {
            const nh = hand.map((c) => (c === sh ? sf! : c));
            if (!matchesIn('pair', nh).length) { msg = t('tut.m06.pracNg'); sh = sf = undefined; draw(); return; }
            field = field.map((c) => (c === sf ? sh! : c));
            hand = nh;
            sh = sf = undefined;
            done = true;
            msg = t('tut.m06.pracDone');
            draw();
            onDone();
          }, { kind: 'primary', disabled: done || sh === undefined || sf === undefined });
          box.replaceChildren(
            h('div', { class: 'xc-head' }, h('span', { class: 'small dim' }, t('m06.targetIs')), h('span', { class: 'xc-target big' }, t('m06.tg.pair'))),
            h('div', { class: 'xc-row' }, h('span', { class: 'xc-lbl' }, t('m06.field')), field.map((c) => mk(c, sf === c, () => { sf = sf === c ? undefined : c; draw(); }))),
            h('div', { class: 'xc-row hand' }, h('span', { class: 'xc-lbl' }, t('m06.hand')), hand.map((c) => mk(c, sh === c, () => { sh = sh === c ? undefined : c; draw(); }))),
            h('div', { class: 'xc-foot' }, h('span', { class: 'small xc-note' }, msg), swap));
        };
        draw();
        return box;
      },
    },
  };
}

// ---- P06 一筆の迷宮 ----

function p06Guide(): Guide {
  const fig = (path: number[], cell = 62) => new PathBoard(P06_PRACTICE, { readonly: true, cell, path }).el;
  return {
    name: '一筆の迷宮',
    pages: [
      { title: t('tut.p06.t1'), text: t('tut.p06.p1'), figure: () => fig(P06_PRACTICE_SOL) },
      { title: t('tut.p06.t2'), text: t('tut.p06.p2'), figure: () => fig([0, 1, 2, 6]) },
      {
        title: t('tut.p06.t3'), text: t('tut.p06.p3'),
        figure: () => h('div', { class: 'tg-row' },
          h('div', { class: 'tg-fig ok' }, fig(P06_PRACTICE_SOL, 46), h('div', { class: 'tg-mark ok' }, '○'), h('div', { class: 'tg-cap' }, t('tut.p06.ok'))),
          h('div', { class: 'tg-fig ng' }, fig([0, 4, 8, 12], 46), h('div', { class: 'tg-mark ng' }, '✕'), h('div', { class: 'tg-cap' }, t('tut.p06.ng')))),
      },
      {
        title: t('tut.p06.t4'), text: t('tut.p06.p4'),
        figure: () => h('div', { class: 'tg-row' }, chips([{ label: t('tut.p06.c1'), value: '30' }, { label: t('tut.p06.c2'), value: '0〜10' }], ['+']), facts([['6', t('tut.p06.f1')], ['90', t('tut.p06.f2')], ['2', t('tut.p06.f3')]])),
      },
    ],
    practice: {
      text: t('tut.p06.practice'),
      build: (onDone) => {
        const board = new PathBoard(P06_PRACTICE, { cell: 64, onComplete: () => onDone() });
        return h('div', { class: 'p06-play' }, h('div', { class: 'p06-tools' }, button(t('p06.undo'), () => board.undo(), { small: true }), button(t('p06.reset'), () => board.reset(), { small: true, kind: 'ghost' })), board.el);
      },
    },
  };
}

// ---- M07 六角領域 ----

function m07Guide(): Guide {
  const seats = [0, 1, 2, 3, 4, 5];
  const base = () => { const o = new Array<number>(HEX7.cells.length).fill(-1); seats.forEach((s) => { o[hexStart(s)] = s; }); return o; };
  const at = (q: number, r: number) => hexAt(HEX7, q, r);
  const withCells = (list: [number, number, number][]) => { const o = base(); for (const [q, r, s] of list) o[at(q, r)] = s; return o; };
  const fig = (owner: number[], size = 22, fresh: number[] = []) => new TilePlacer({ owner, seat: 0, seats, tiles: [], cap: 4, size, active: false, fresh, sel: { rot: 0 }, onChange: () => {} }).board;
  const mine: [number, number, number][] = [[3, 0, 0], [3, 1, 0]];
  return {
    name: '六角領域',
    pages: [
      { title: t('tut.m07.t1'), text: t('tut.m07.p1'), figure: () => fig(withCells([...mine, [0, 3, 1], [-3, 3, 2], [-3, 0, 3]]), 30) },
      {
        title: t('tut.m07.t2'), text: t('tut.m07.p2'),
        figure: () => h('div', { class: 'tg-row' },
          h('div', { class: 'tg-fig ok' }, fig(withCells([...mine, [2, 1, 0], [2, 0, 0], [1, 1, 0]]), 22, [at(2, 1), at(2, 0), at(1, 1)]), h('div', { class: 'tg-mark ok' }, '○'), h('div', { class: 'tg-cap' }, t('tut.m07.ok'))),
          h('div', { class: 'tg-fig ng' }, fig(withCells([...mine, [0, 1, 0], [0, 2, 0], [-1, 2, 0]]), 22, [at(0, 1), at(0, 2), at(-1, 2)]), h('div', { class: 'tg-mark ng' }, '✕'), h('div', { class: 'tg-cap' }, t('tut.m07.ng')))),
      },
      { title: t('tut.m07.t3'), text: t('tut.m07.p3'), figure: () => h('div', { class: 'tg-row' }, fig(withCells([[3, 1, 0], [2, 1, 0], [1, 1, 0]]), 24, [at(3, 1), at(2, 1), at(1, 1)]), facts([['+1', t('tut.m07.f1')], ['+2', t('tut.m07.f2')], ['+5', t('tut.m07.f3')]])) },
      { title: t('tut.m07.t4'), text: t('tut.m07.p4'), figure: () => chips([{ label: t('tut.m07.g1'), value: t('tut.m07.c1') }, { label: t('tut.m07.g2'), value: t('tut.m07.c2') }, { label: t('tut.m07.g3'), value: t('tut.m07.c3') }, { label: t('tut.m07.g4'), value: t('tut.m07.c4') }], ['▶', '▶', '▶']) },
    ],
    practice: {
      text: t('tut.m07.practice'),
      build: (onDone) => {
        const box = h('div', { class: 'hx7 prac' });
        let owner = withCells(mine);
        let tiles = ['bend3', 'line3'];
        const sel: PlacerSel = { rot: 0 };
        let done = false;
        const draw = () => {
          clear(box);
          const foot = h('div', { class: 'hx7-foot' });
          const note = h('div', { class: 'small hx7-note' });
          const upd = () => {
            const g = placer.ghost();
            note.textContent = done ? t('tut.m07.pracDone') : !sel.shape ? t('m07.howPick', { n: 3 }) : !g ? t('m07.howPut') : g.ok ? t('m07.howOk', { n: g.cells.length }) : t('m07.howBad');
            note.classList.toggle('gold', done || !!g?.ok);
            clear(foot);
            if (done) return;
            foot.append(
              button('⟲', () => placer.rotate(-1), { small: true, disabled: !sel.shape }),
              button('⟳', () => placer.rotate(1), { small: true, disabled: !sel.shape }),
              button(t('m07.put'), () => {
                const gg = placer.ghost();
                if (!gg?.ok || !sel.shape) return;
                owner = [...owner];
                for (const c of gg.cells) owner[c] = 0;
                tiles = tiles.filter((x) => x !== sel.shape);
                sel.shape = undefined; sel.at = undefined;
                done = true;
                Sound.se('chip');
                draw();
                onDone();
              }, { kind: 'primary', disabled: !g?.ok }));
          };
          const placer = new TilePlacer({ owner, seat: 0, seats, tiles, cap: 3, size: 26, active: !done, sel, onChange: upd });
          upd();
          box.append(h('div', { class: 'hx7-left' }, placer.board), h('div', { class: 'hx7-panel' }, placer.tray, note, foot));
        };
        draw();
        return box;
      },
    },
  };
}

// ---- P07 ブラック＆ホワイト ----

function p07Guide(): Guide {
  const at = (q: number, r: number) => hexAt(HEX3, q, r);
  const mk = (list: [number, number, number][]) => { const b = new Array<number>(HEX3.cells.length).fill(-1); b[HOLE] = HOLE_V; for (const [q, r, s] of list) b[at(q, r)] = s; return b; };
  const fig = (board: number[], size: number, o: { legal?: number[]; last?: { cell: number | null; flipped: number[] } } = {}) =>
    new FlipBoard({ board, seat: 0, legal: o.legal ?? [], active: !!o.legal, size, last: o.last, sel: {}, onChange: () => {} }).el;
  const row: [number, number, number][] = [[-2, 1, 0], [-1, 1, 1], [0, 1, 2]];
  const cap = (el: HTMLElement, text: string, mark?: 'ok' | 'ng') => h('div', { class: `tg-fig${mark ? ` ${mark}` : ''}` }, el, mark ? h('div', { class: `tg-mark ${mark}` }, mark === 'ok' ? '○' : '✕') : null, h('div', { class: 'tg-cap' }, text));
  return {
    name: 'ブラック＆ホワイト',
    pages: [
      { title: t('tut.p07.t1'), text: t('tut.p07.p1'), figure: () => fig(p07Start(3), 34) },
      {
        title: t('tut.p07.t2'), text: t('tut.p07.p2'),
        figure: () => h('div', { class: 'tg-row' }, cap(fig(mk(row), 27, { legal: [at(1, 1)] }), t('tut.p07.before')), h('span', { class: 'dq-arrow' }, '▶'),
          cap(fig(mk([[-2, 1, 0], [-1, 1, 0], [0, 1, 0], [1, 1, 0]]), 27, { last: { cell: at(1, 1), flipped: [at(-1, 1), at(0, 1)] } }), t('tut.p07.after'))),
      },
      {
        title: t('tut.p07.t3'), text: t('tut.p07.p3'),
        figure: () => h('div', { class: 'tg-row' }, cap(fig(mk(row), 27, { legal: [at(1, 1)] }), t('tut.p07.ok'), 'ok'), cap(fig(mk([[-2, 1, 0], [0, 1, 2]]), 27), t('tut.p07.ng'), 'ng')),
      },
      { title: t('tut.p07.t4'), text: t('tut.p07.p4'), figure: () => facts([['12', t('tut.p07.f1')], ['3', t('tut.p07.f2')], ['1', t('tut.p07.f3')]]) },
    ],
    practice: {
      text: t('tut.p07.practice'),
      build: (onDone) => {
        const box = h('div', { class: 'hx7 fb7 prac' });
        let board = mk([...row, [1, -2, 0], [1, -1, 1]]);
        const sel: FlipSel = {};
        let done = false;
        let msg = t('p07.howFlip');
        let lastMove: { cell: number | null; flipped: number[] } | undefined;
        const draw = () => {
          clear(box);
          const note = h('div', { class: 'small fb-note' });
          const foot = h('div', { class: 'hx7-foot' });
          const confirm = () => {
            if (sel.cell === undefined || done) return;
            const fl = p07Flips(board, 0, sel.cell);
            if (fl.length < 2) { msg = t('tut.p07.pracOne'); sel.cell = undefined; Sound.se('error'); draw(); return; }
            const cell = sel.cell;
            board = [...board];
            board[cell] = 0;
            for (const c of fl) board[c] = 0;
            sel.cell = undefined;
            done = true;
            msg = t('tut.p07.pracDone');
            Sound.se('chip');
            lastMove = { cell, flipped: fl };
            draw();
            onDone();
          };
          const upd = () => {
            const n = fb.flips().length;
            note.textContent = sel.cell !== undefined ? t('p07.willFlip', { n }) : msg;
            note.classList.toggle('gold', done || sel.cell !== undefined);
            clear(foot);
            if (!done) foot.append(button(t('m07.put'), confirm, { kind: 'primary', disabled: sel.cell === undefined }));
          };
          const fb = new FlipBoard({ board, seat: 0, legal: done ? [] : p07Legal(board, 0).cells, active: !done, size: 34, last: lastMove, sel, onChange: upd, onConfirm: confirm });
          upd();
          box.append(h('div', { class: 'hx7-left' }, fb.el), h('div', { class: 'hx7-panel' }, note, foot));
        };
        draw();
        return box;
      },
    },
  };
}

// ---- M08 バリケード ----

function m08Guide(): Guide {
  const seats = [0, 1, 2, 3, 4];
  const noWalls = () => new Array<boolean>(M08_EDGES.length).fill(false);
  const starts = () => seats.map(m08Start);
  const fig = (pos: number[], walls: boolean[], scale = 0.56) => ringBoard({ seats, pos, walls, me: 0, mode: 'none', canMove: [], canWall: [], showPath: true, scale });
  const cap = (el: HTMLElement, text: string) => h('div', { class: 'tg-fig' }, el, h('div', { class: 'tg-cap' }, text));
  return {
    name: 'バリケード',
    pages: [
      { title: t('tut.m08.t1'), text: t('tut.m08.p1'), figure: () => fig(starts(), noWalls(), 0.72) },
      { title: t('tut.m08.t2'), text: t('tut.m08.p2'), figure: () => chips([{ label: '1', value: t('tut.m08.c1') }, { label: '2', value: t('tut.m08.c2') }], [t('tut.m08.or')]) },
      {
        title: t('tut.m08.t3'), text: t('tut.m08.p3'),
        figure: () => {
          const w = noWalls();
          w[m08Edge(m08Node(3, 1), m08Node(3, 2))] = true;
          w[m08Edge(m08Node(3, 9), m08Node(3, 8))] = true;
          const pos = starts();
          pos[0] = m08Node(3, 1);
          pos[1] = m08Node(3, 2);
          return h('div', { class: 'tg-row' }, cap(fig(starts(), w, 0.5), t('tut.m08.wallCap')), cap(fig(pos, noWalls(), 0.5), t('tut.m08.jumpCap')));
        },
      },
      { title: t('tut.m08.t4'), text: t('tut.m08.p4'), figure: () => facts([['25', t('tut.m08.f1')], ['3', t('tut.m08.f2')], ['3', t('tut.m08.f3')]]) },
    ],
    practice: {
      text: t('tut.m08.practice'),
      build: (onDone) => {
        const box = h('div', { class: 'hx7 rb7 prac' });
        const st = { players: seats.map((x) => `p${x}` as CharId), seats, pos: starts(), walls: noWalls(), wallsLeft: seats.map(() => 3), arrived: seats.map(() => -1) };
        let step = 0;
        let mode: 'move' | 'wall' = 'move';
        let node: number | undefined;
        let edge: number | undefined;
        const draw = () => {
          clear(box);
          const canMove = step === 0 ? m08Moves(st, 0) : [];
          const canWall = step === 1 && mode === 'wall' ? m08Walls(st, 0) : [];
          const board = ringBoard({ seats, pos: st.pos, walls: st.walls, me: 0, mode: step === 0 ? 'move' : step === 1 && mode === 'wall' ? 'wall' : 'none', canMove, canWall, selNode: node, selEdge: edge, showPath: true, scale: 0.78 },
            (n) => { if (step !== 0 || !canMove.includes(n)) return; node = n; Sound.se('select'); draw(); },
            (e) => { if (step !== 1) return; edge = e; Sound.se('select'); draw(); });
          const foot = h('div', { class: 'hx7-foot' });
          if (step === 0) foot.append(button(t('m08.doMove'), () => { if (node === undefined) return; st.pos[0] = node; node = undefined; step = 1; Sound.se('chip'); draw(); }, { kind: 'primary', disabled: node === undefined }));
          else if (step === 1) foot.append(
            button(t('m08.modeWall', { n: 3 }), () => { mode = 'wall'; Sound.se('click'); draw(); }, { small: true, kind: mode === 'wall' ? 'primary' : undefined }),
            button(t('m08.doWall'), () => { if (edge === undefined) return; st.walls[edge] = true; edge = undefined; step = 2; Sound.se('chipsHit'); draw(); onDone(); }, { kind: 'primary', disabled: edge === undefined }));
          box.append(h('div', { class: 'hx7-left' }, board), h('div', { class: 'hx7-panel' }, h('div', { class: `small fb-note${step === 2 ? ' gold' : ''}` }, t(step === 0 ? 'tut.m08.prac1' : step === 1 ? 'tut.m08.prac2' : 'tut.m08.pracDone')), foot));
        };
        draw();
        return box;
      },
    },
  };
}

// ---- P08 数字の天秤 ----

function p08Guide(): Guide {
  const demo: Scale = { tiles: [1, 2, 3, 4, 5, 6, 7, 8], fixL: 4, fixR: 0, minUse: 1, mustL: [], mustR: [] };
  const demo2: Scale = { tiles: [1, 2, 3, 4, 5, 6, 7, 9], fixL: 5, fixR: 2, minUse: 4, mustL: [0], mustR: [] };
  const fig = (sc: Scale, place: number[], scale = 0.62) => new ScaleBoard(sc, { readonly: true, place, scale }).el;
  return {
    name: '数字の天秤',
    pages: [
      { title: t('tut.p08.t1'), text: t('tut.p08.p1'), figure: () => fig(demo, [0, 1, 0, 0, 0, 2, 0, 0]) },
      { title: t('tut.p08.t2'), text: t('tut.p08.p2'), figure: () => fig(demo, [0, 0, 0, 0, 0, 0, 0, 0]) },
      { title: t('tut.p08.t3'), text: t('tut.p08.p3'), figure: () => h('div', { class: 'tg-row' }, fig(demo2, [1, 0, 2, 0, 1, 0, 0, 2], 0.5), h('div', { class: 'sb-panel' }, condList(demo2, { left: 11, right: 14, nL: 2, nR: 2, used: 4, balanced: false, useOk: true, mustOk: true, panOk: true, ok: false }, [1, 0, 2, 0, 1, 0, 0, 2]))) },
      { title: t('tut.p08.t4'), text: t('tut.p08.p4'), figure: () => facts([['7', t('tut.p08.f1')], ['90', t('tut.p08.f2')], ['20', t('tut.p08.f3')], ['+5', t('tut.p08.f4')]]) },
    ],
    practice: {
      text: t('tut.p08.practice'),
      build: (onDone) => {
        const box = h('div', { class: 'p08-play prac' });
        let done = false;
        const panel = h('div', { class: 'sb-panel' });
        const upd = () => {
          const j = board.judge();
          clear(panel);
          panel.append(h('h4', null, t('p08.condTitle')), condList(P08_PRACTICE, j, board.place), h('div', { class: `small${j.ok ? ' gold' : ' dim'}` }, j.ok ? t('tut.p08.pracDone') : t('p08.howNote')));
          if (j.ok && !done) { done = true; Sound.se('result'); onDone(); }
        };
        const board = new ScaleBoard(P08_PRACTICE, { onChange: upd, scale: 0.8 });
        upd();
        box.append(board.el, panel);
        return box;
      },
    },
  };
}

// ---- M09 四王の戦場・改 ----

function m09Guide(): Guide {
  const at = (x: number, y: number) => y * 7 + x;
  const toBoard = (ps: M09Piece[]) => ps.map((p) => ({ pos: p.pos, seat: p.seat, kind: p.king ? 'king' as const : 'soldier' as const }));
  const fig = (ps: M09Piece[], cell: number, marks: Record<number, string> = {}) => pieceBoard({ n: 7, cell, pieces: toBoard(ps), colors: M09_COLORS, me: 0, marks: { [M09_CENTER]: 'center', ...marks } });
  const cap = (el: HTMLElement, text: string) => h('div', { class: 'tg-fig' }, el, h('div', { class: 'tg-cap' }, text));
  const mid: M09Piece[] = [{ seat: 0, king: true, pos: at(0, 0) }, { seat: 0, king: false, pos: at(2, 3) }, { seat: 1, king: false, pos: at(3, 3) }, { seat: 1, king: true, pos: at(6, 0) }];
  return {
    name: '四王の戦場・改',
    pages: [
      { title: t('tut.m09.t1'), text: t('tut.m09.p1'), figure: () => fig(m09Start([0, 1, 2, 3]), 54) },
      {
        title: t('tut.m09.t2'), text: t('tut.m09.p2'),
        figure: () => h('div', { class: 'tg-row' }, cap(fig(mid, 40, { [at(2, 3)]: 'sel', [at(3, 3)]: 'center can cap' }), t('tut.m09.before')), h('span', { class: 'dq-arrow' }, '▶'),
          cap(fig([mid[0], { seat: 0, king: false, pos: at(3, 3) }, mid[3]], 40, { [at(2, 3)]: 'from', [at(3, 3)]: 'center to hit' }), t('tut.m09.after'))),
      },
      { title: t('tut.m09.t3'), text: t('tut.m09.p3'), figure: () => facts([['+1', t('tut.m09.f1')], ['+5', t('tut.m09.f2')], ['+2', t('tut.m09.f3')], ['+5', t('tut.m09.f4')]]) },
      { title: t('tut.m09.t4'), text: t('tut.m09.p4'), figure: () => facts([['16', t('tut.m09.g1')], ['4', t('tut.m09.g2')]]) },
    ],
    practice: {
      text: t('tut.m09.practice'),
      build: (onDone) => {
        const box = h('div', { class: 'hx7 pz7 prac' });
        let pieces: M09Piece[] = [{ seat: 0, king: true, pos: at(1, 5) }, { seat: 0, king: false, pos: at(2, 4) }, { seat: 0, king: false, pos: at(3, 5) }, { seat: 2, king: false, pos: at(3, 4) }, { seat: 2, king: true, pos: at(5, 1) }, { seat: 2, king: false, pos: at(4, 2) }];
        let from: number | undefined;
        let to: number | undefined;
        let done = false;
        const draw = () => {
          clear(box);
          const mine = pieces.filter((p) => p.seat === 0);
          const sel = from !== undefined ? mine.find((p) => p.pos === from) : undefined;
          const dests = sel ? m09Moves(pieces, sel) : [];
          const marks: Record<number, string> = { [M09_CENTER]: 'center' };
          const add = (c: number, cls: string) => { marks[c] = `${marks[c] ?? ''} ${cls}`; };
          if (!done) {
            if (sel) { add(sel.pos, 'sel'); for (const c of dests) add(c, pieces.some((p) => p.pos === c) ? 'can cap' : 'can'); } else for (const p of mine) if (m09Moves(pieces, p).length) add(p.pos, 'movable');
            if (to !== undefined) add(to, 'chosen');
          }
          const confirm = () => {
            if (from === undefined || to === undefined || !sel) return;
            const victim = pieces.find((p) => p.pos === to && p.seat !== 0);
            if (!victim) { from = to = undefined; Sound.se('error'); draw(); return; }
            pieces = pieces.filter((p) => p !== victim).map((p) => (p === sel ? { ...p, pos: to! } : p));
            from = to = undefined;
            done = true;
            Sound.se('chipsHit');
            draw();
            onDone();
          };
          const board = pieceBoard({ n: 7, cell: 66, pieces: toBoard(pieces), colors: M09_COLORS, me: 0, marks, onCell: done ? undefined : (c) => {
            const own = mine.find((p) => p.pos === c);
            if (own) { from = c; to = undefined; Sound.se('select'); draw(); return; }
            if (!sel || !dests.includes(c)) return;
            if (to === c) { confirm(); return; }
            to = c; Sound.se('select'); draw();
          } });
          const victim = to !== undefined && pieces.some((p) => p.pos === to && p.seat !== 0);
          box.append(h('div', { class: 'hx7-left' }, board), h('div', { class: 'hx7-panel' },
            h('div', { class: `small fb-note${done || victim ? ' gold' : ''}` }, done ? t('tut.m09.pracDone') : !sel ? t('m09.howPick') : to === undefined ? t('m09.howSoldier') : victim ? t('m09.gainSoldier', { n: 1 }) : t('tut.m09.practice')),
            h('div', { class: 'hx7-foot' }, done ? null : button(t('m09.doMove'), confirm, { kind: 'primary', disabled: to === undefined }))));
        };
        draw();
        return box;
      },
    },
  };
}

// ---- P09 鏡の決闘 ----

function p09Guide(): Guide {
  const d1: Mirror = { n: 5, axis: 'v', src: { 1: 'b', 5: 'b', 6: 'b', 16: 'b' } };
  const d2: Mirror = { n: 5, axis: 'v', src: { 5: 'r', 11: 'u', 16: 'l' } };
  const d3: Mirror = { n: 5, axis: 'd', src: { 5: 'b', 10: 'u', 16: 'b', 22: 'r' } };
  const fig = (m: Mirror, cell = 62) => new MirrorBoard(m, { readonly: true, grid: p09Expected(m), cell }).el;
  return {
    name: '鏡の決闘',
    pages: [
      { title: t('tut.p09.t1'), text: t('tut.p09.p1'), figure: () => fig(d1) },
      { title: t('tut.p09.t2'), text: t('tut.p09.p2'), figure: () => fig(d2) },
      { title: t('tut.p09.t3'), text: t('tut.p09.p3'), figure: () => fig(d3) },
      { title: t('tut.p09.t4'), text: t('tut.p09.p4'), figure: () => facts([['6', t('tut.p09.f1')], ['90', t('tut.p09.f2')], ['20', t('tut.p09.f3')], ['+5', t('tut.p09.f4')]]) },
    ],
    practice: {
      text: t('tut.p09.practice'),
      build: (onDone) => {
        const box = h('div', { class: 'p09-play prac' });
        const left = h('div', { class: 'mb-left' });
        let done = false;
        const upd = () => {
          const ok = p09Score(P09_PRACTICE, board.grid, 0).perfect;
          clear(left);
          left.append(h('h4', null, t('p09.toolTitle')), p09Tools(board, true), h('div', { class: `small${ok ? ' gold' : ' dim'}` }, ok ? t('tut.p09.pracDone') : t(board.tool === 'a' ? 'p09.howArrow' : board.tool === 'x' ? 'p09.howErase' : 'p09.howBlock')));
          if (ok && !done) { done = true; Sound.se('result'); onDone(); }
        };
        const board = new MirrorBoard(P09_PRACTICE, { cell: 84, onChange: upd });
        upd();
        box.append(left, board.el);
        return box;
      },
    },
  };
}

// ---- M10 トライアングル ----

function m10Guide(): Guide {
  const carry: M10Board = { soldiers: [{ seat: 0, pos: 1, gem: 0 }, { seat: 0, pos: 2, gem: -1 }, { seat: 1, pos: 7, gem: -1 }, { seat: 2, pos: 8, gem: -1 }], ground: [], waiting: [0], delivered: [0, 0, 0] };
  const fight: M10Board = { soldiers: [{ seat: 0, pos: 4, gem: -1 }, { seat: 0, pos: 2, gem: -1 }, { seat: 1, pos: 7, gem: 1 }, { seat: 1, pos: 11, gem: -1 }, { seat: 2, pos: 9, gem: -1 }, { seat: 2, pos: 13, gem: -1 }], ground: [{ node: 8, id: 2 }], waiting: [], delivered: [0, 0, 0] };
  const fig = (b: M10Board, marks: Record<number, string> = {}, flagMarks: Record<number, string> = {}) => triBoard({ board: b, seats: [0, 1, 2], me: 0, marks, flagMarks, scale: 0.6 });
  return {
    name: 'トライアングル',
    pages: [
      { title: t('tut.m10.t1'), text: t('tut.m10.p1'), figure: () => fig(m10Start([0, 1, 2]), { 1: 'movable', 2: 'movable' }) },
      { title: t('tut.m10.t2'), text: t('tut.m10.p2'), figure: () => fig(carry, { 1: 'sel' }, { 0: 'deliver' }) },
      { title: t('tut.m10.t3'), text: t('tut.m10.p3'), figure: () => fig(fight, { 4: 'sel', 7: 'can cap' }) },
      { title: t('tut.m10.t4'), text: t('tut.m10.p4'), figure: () => facts([['+4', t('tut.m10.f1')], ['+1', t('tut.m10.f2')], ['+1', t('tut.m10.f3')], [`+${M10_HOME}`, t('tut.m10.f4')]]) },
    ],
    practice: {
      text: t('tut.m10.practice'),
      build: (onDone) => {
        const box = h('div', { class: 'hx7 tb7 prac' });
        let b: M10Board = M10_PRACTICE;
        let from: number | undefined;
        let to: number | undefined;
        let done = false;
        const draw = () => {
          clear(box);
          const acts = done ? [] : m10Acts(b, 0);
          const sel = from !== undefined ? b.soldiers.find((s) => s.pos === from) : undefined;
          const mine = acts.filter((a) => a.from === from);
          const dests = mine.filter((a) => a.t === 'move').map((a) => (a as { to: number }).to);
          const canDel = mine.some((a) => a.t === 'deliver');
          const marks: Record<number, string> = {};
          const flagMarks: Record<number, string> = {};
          if (!done) {
            if (sel) { marks[sel.pos] = 'sel'; for (const c of dests) marks[c] = c === to ? 'can chosen' : 'can'; if (canDel) flagMarks[0] = to === -2 ? 'deliver chosen' : 'deliver'; }
            else for (const s of b.soldiers) marks[s.pos] = 'movable';
          }
          const go = () => {
            if (from === undefined || to === undefined) return;
            const r = m10Apply(b, 0, to === -2 ? { t: 'deliver', from } : { t: 'move', from, to });
            b = r.board;
            Sound.se(r.fx.deliver ? 'coins' : 'chip');
            if (r.fx.deliver) { done = true; onDone(); }
            from = r.fx.deliver || to === undefined || to < 0 ? undefined : to;
            to = undefined;
            draw();
          };
          const board = triBoard({ board: b, seats: [0], me: 0, marks, flagMarks, scale: 0.72 },
            done ? undefined : (c) => {
              if (b.soldiers.some((s) => s.pos === c)) { from = from === c ? undefined : c; to = undefined; Sound.se('select'); draw(); return; }
              if (!sel || !dests.includes(c)) { Sound.se('error'); return; }
              if (to === c) { go(); return; }
              to = c; Sound.se('select'); draw();
            },
            done ? undefined : (fs) => { if (fs !== 0 || !canDel) { Sound.se('error'); return; } if (to === -2) { go(); return; } to = -2; Sound.se('select'); draw(); });
          const carrying = b.soldiers.some((s) => s.gem >= 0);
          box.append(h('div', { class: 'hx7-left' }, board), h('div', { class: 'hx7-panel' },
            h('div', { class: `small fb-note${done ? ' gold' : ''}` }, done ? t('tut.m10.pracDone', { n: M10_DELIVER }) : !sel ? t('m10.howPick') : to !== undefined ? t('m08.moveReady') : canDel ? t('m10.howDeliver') : carrying && sel.gem >= 0 ? t('m10.howCarry') : t('m10.howMove')),
            h('div', { class: 'hx7-foot' }, done ? null : button(t(to === -2 ? 'm10.doDeliver' : 'm09.doMove'), go, { kind: 'primary', disabled: to === undefined }))));
        };
        draw();
        return box;
      },
    },
  };
}

// ---- P10 最後の一手 ----

export function p10Guide(h06 = false): Guide {
  const at = (x: number, y: number) => y * 5 + x;
  const centers = (extra: Record<number, string> = {}) => { const m: Record<number, string> = {}; for (const c of h06 ? H06_SIGNALS : P10_CENTERS) m[c] = 'center'; for (const [c, v] of Object.entries(extra)) m[Number(c)] = `${m[Number(c)] ?? ''} ${v}`; return m; };
  const fig = (ps: P10Piece[], cell: number, marks: Record<number, string> = {}) => pieceBoard({ n: 5, cell, pieces: ps.map((p) => ({ pos: p.pos, seat: p.seat, kind: duelKind(p.seat) })), colors: P10_COLORS, me: 0, marks: centers(marks) });
  const cap = (el: HTMLElement, text: string) => h('div', { class: 'tg-fig' }, el, h('div', { class: 'tg-cap' }, text));
  const mid: P10Piece[] = [{ seat: 0, pos: at(1, 1) }, { seat: 1, pos: at(2, 1) }, { seat: 1, pos: at(4, 3) }, { seat: 0, pos: at(0, 3) }];
  const hold: P10Piece[] = [{ seat: 0, pos: at(2, 2) }, { seat: 0, pos: at(1, 2) }, { seat: 1, pos: at(3, 2) }, { seat: 1, pos: at(4, 0) }, { seat: 0, pos: at(0, 4) }];
  const capPage = {
    title: t('tut.p10.t2'), text: t('tut.p10.p2'),
    figure: () => h('div', { class: 'tg-row' }, cap(fig(mid, 54, { [at(1, 1)]: 'sel', [at(3, 1)]: 'can cap' }), t('tut.m09.before')), h('span', { class: 'dq-arrow' }, '▶'),
      cap(fig(p10Apply(mid, 0, { from: at(1, 1), to: at(3, 1), cap: at(2, 1) }), 54, { [at(1, 1)]: 'from', [at(2, 1)]: 'to hit', [at(3, 1)]: 'to' }), t('tut.m09.after'))),
  };
  return {
    name: h06 ? '影の対戦者' : '最後の一手',
    pages: h06 ? [
      { title: t('tut.h06.t1'), text: t('tut.h06.p1'), figure: () => fig(h06Start(), 70) },
      capPage,
      { title: t('tut.h06.t3'), text: t('tut.h06.p3'), figure: () => h('div', { class: 'tg-row' }, fig([{ seat: 0, pos: at(2, 0) }, { seat: 0, pos: at(1, 3) }, { seat: 1, pos: at(3, 1) }], 62), facts([['+1', t('tut.h06.f1')], [`+${H06_KEEP}`, t('tut.h06.f2')]])) },
      { title: t('tut.h06.t4'), text: t('tut.h06.p4'), figure: () => facts([[String(H06_ROUNDS), t('tut.p10.g1')], ['1', t('tut.p10.g2')], ['15', t('tut.p10.g3')]]) },
    ] : [
      { title: t('tut.p10.t1'), text: t('tut.p10.p1'), figure: () => fig(p10Start(), 70) },
      capPage,
      { title: t('tut.p10.t3'), text: t('tut.p10.p3'), figure: () => h('div', { class: 'tg-row' }, fig(hold, 62), facts([['+2', t('tut.p10.f1')], ['+1', t('tut.p10.f2')]])) },
      { title: t('tut.p10.t4'), text: t('tut.p10.p4'), figure: () => facts([['20', t('tut.p10.g1')], ['2', t('tut.p10.g2')], ['15', t('tut.p10.g3')]]) },
    ],
    practice: {
      text: t('tut.p10.practice'),
      build: (onDone) => {
        const box = h('div', { class: 'hx7 pz7 prac' });
        let pieces: P10Piece[] = [{ seat: 0, pos: at(1, 2) }, { seat: 0, pos: at(0, 0) }, { seat: 1, pos: at(2, 2) }, { seat: 1, pos: at(4, 4) }];
        let from: number | undefined;
        let to: number | undefined;
        let done = false;
        const draw = () => {
          clear(box);
          const steps = done ? [] : p10Steps(pieces, 0);
          const sel = from !== undefined ? pieces.find((p) => p.pos === from && p.seat === 0) : undefined;
          const mine = steps.filter((s) => s.from === from);
          const chosen = to !== undefined ? mine.find((s) => s.to === to) : undefined;
          const marks: Record<number, string> = {};
          if (!done) {
            if (sel) { marks[sel.pos] = 'sel'; for (const s of mine) marks[s.to] = s.cap !== undefined ? 'can cap' : 'can'; } else for (const p of pieces) if (p.seat === 0) marks[p.pos] = 'movable';
            if (chosen) marks[chosen.to] = `${marks[chosen.to]} chosen`;
          }
          const confirm = () => {
            if (!chosen) return;
            if (chosen.cap === undefined) { from = to = undefined; Sound.se('error'); draw(); return; }
            pieces = p10Apply(pieces, 0, chosen);
            from = to = undefined;
            done = true;
            Sound.se('chipsHit');
            draw();
            onDone();
          };
          const board = pieceBoard({ n: 5, cell: 86, pieces: pieces.map((p) => ({ pos: p.pos, seat: p.seat, kind: duelKind(p.seat) })), colors: P10_COLORS, me: 0, marks: centers(marks), onCell: done ? undefined : (c) => {
            if (pieces.some((p) => p.pos === c && p.seat === 0)) { from = c; to = undefined; Sound.se('select'); draw(); return; }
            if (!sel || !mine.some((s) => s.to === c)) return;
            if (to === c) { confirm(); return; }
            to = c; Sound.se('select'); draw();
          } });
          box.append(h('div', { class: 'hx7-left' }, board), h('div', { class: 'hx7-panel' },
            h('div', { class: `small fb-note${done || chosen?.cap !== undefined ? ' gold' : ''}` }, done ? t('tut.p10.pracDone') : !sel ? t('m09.howPick') : !chosen ? t('p10.howMove') : chosen.cap !== undefined ? t('p10.gainCap', { n: 3 }) : t('tut.p10.practice')),
            h('div', { class: 'hx7-foot' }, done ? null : button(t('m09.doMove'), confirm, { kind: 'primary', disabled: !chosen }))));
        };
        draw();
        return box;
      },
    },
  };
}

// ---- M11 最後の王座 ----

function m11Guide(): Guide {
  const list = (from: number, to: number) => h('div', { class: 'm11-events tg' }, M11_EVENTS.slice(from, to).map((e, i) => h('div', { class: 'm11-ev' }, h('span', { class: 'no' }, String(from + i + 1)), h('span', { class: 'nm' }, e.name), h('span', { class: 'wn small dim' }, t(`tut.m11.ev${from + i + 1}`)))));
  return {
    name: '最後の王座',
    pages: [
      { title: t('tut.m11.t1'), text: t('tut.m11.p1'), figure: () => facts([['5', t('tut.m11.f1')], ['3', t('tut.m11.f2')]]) },
      { title: t('tut.m11.t2'), text: t('tut.m11.p2'), figure: () => list(0, 3) },
      { title: t('tut.m11.t3'), text: t('tut.m11.p3'), figure: () => h('div', { class: 'tg-row' }, list(3, 5), h('div', { class: 'p05-hand tg' }, [3, 5, 6].map((c) => h('div', { class: `p05-card${c === 5 ? ' hit sel' : ''}` }, h('b', null, String(c)), h('small', null, c === 5 ? t('duel.exact') : t('duel.diff', { n: Math.abs(c - 5) })))))) },
      { title: t('tut.m11.t4'), text: t('tut.m11.p4'), figure: () => facts([['0', t('tut.m11.g1')], ['0', t('tut.m11.g2')], ['0', t('tut.m11.g3')]]) },
    ],
    practice: {
      text: t('tut.m11.practice'),
      build: (onDone) => {
        const box = h('div', { class: 'm11-prac' });
        const area = h('div', { class: 'm11-prac-area' });
        const tabs = h('div', { class: 'row m11-prac-tabs' });
        let cur = -1;
        const show = (i: number) => {
          cur = i;
          draw();
          clear(area);
          const e = M11_EVENTS[i];
          if (e.id === 'duel') {
            // カード対決の練習：目標に一番近いカードを出す
            const target = 6;
            const hand = [2, 4, 7, 9];
            let done = false;
            const note = h('div', { class: 'small fb-note' }, t('tut.m11.duelHow'));
            const row = h('div', { class: 'p05-hand' }, hand.map((c) => {
              const el = h('button', { class: 'p05-card', type: 'button', 'data-card': String(c) }, h('b', null, String(c)), h('small', null, t('duel.diff', { n: Math.abs(c - target) })));
              el.addEventListener('click', () => {
                if (done) return;
                if (c !== 7) { Sound.se('error'); note.textContent = t('tut.m11.duelMiss'); return; }
                done = true; el.classList.add('sel', 'hit'); note.textContent = t('tut.m11.duelDone'); note.classList.add('gold'); Sound.se('card'); onDone();
              });
              return el;
            }));
            area.append(h('div', { class: 'p05 dl prac' }, h('div', { class: 'p05-mid' }, h('div', { class: 'p05-total hot' }, h('small', null, t('duel.target')), h('b', null, String(target)))), row, note));
          } else area.append(GUIDES[e.id]().practice.build(onDone));
        };
        const draw = () => {
          clear(tabs);
          tabs.append(h('span', { class: 'small dim' }, t('tut.m11.pick')), ...M11_EVENTS.map((e, i) => button(`${i + 1} ${e.name}`, () => show(i), { small: true, kind: cur === i ? 'primary' : 'secondary' })));
        };
        draw();
        area.append(h('div', { class: 'small dim' }, t('tut.m11.pickNote')));
        box.append(tabs, area);
        return box;
      },
    },
  };
}

/** 市場予測（試作）の説明と練習。練習は、分かっている要因から注文を選ぶ 2 問 */
function mkGuide(): Guide {
  const chip = (v: string, who: string, cls = '') => h('span', { class: `mk-chip ${cls}` }, v, h('small', null, who));
  const row = (name: string, price: number, chips: HTMLElement[]) => h('div', { class: 'mk-row', style: 'grid-template-columns:120px 74px 1fr;min-height:60px' }, h('b', { class: 'mk-name' }, name), h('span', { class: 'mk-price' }, String(price)), h('div', { class: 'mk-chips' }, chips));
  return {
    name: '市場予測（試作）',
    pages: [
      { title: t('tut.mk.t1'), text: t('tut.mk.p1'), figure: () => h('div', { class: 'col', style: 'gap:6px;width:640px' }, row(t('mk.good.tea'), 8, [chip('+2', t('mk.ownCard'), 'own up'), chip('？×1', '', 'unknown')]), row(t('mk.good.watch'), 7, [chip('？×2', '', 'unknown')])) },
      { title: t('tut.mk.t2'), text: t('tut.mk.p2'), figure: () => h('div', { class: 'col', style: 'gap:6px;width:640px' }, row(t('mk.good.tea'), 8, [chip('+2', t('mk.ownCard'), 'own up'), chip('+1', t('tut.mk.shown'), 'shown up')]), row(t('mk.good.wine'), 6, [chip('+2?', t('tut.mk.said'), 'said')])) },
      { title: t('tut.mk.t3'), text: t('tut.mk.p3'), figure: () => facts([['3', t('tut.mk.f1')], ['±2', t('tut.mk.f2')], ['±4', t('tut.mk.f3')]]) },
      { title: t('tut.mk.t4'), text: t('tut.mk.p4'), figure: () => facts([['6', t('tut.mk.f4')], ['30', t('tut.mk.f5')], ['1', t('tut.mk.f6')]]) },
    ],
    practice: {
      text: t('tut.mk.practice'),
      build: (onDone) => {
        const box = h('div', { class: 'col', style: 'gap:10px;align-items:center' });
        const qs = [
          { row: row(t('mk.good.tea'), 8, [chip('+2', t('mk.ownCard'), 'own up'), chip('+1', t('tut.mk.shown'), 'shown up')]), ok: 'buy', note: t('tut.mk.ans1') },
          { row: row(t('mk.good.perfume'), 9, [chip('−2', t('mk.ownCard'), 'own down'), chip('？×1', '', 'unknown')]), ok: 'sell', note: t('tut.mk.ans2'), hold: true },
        ];
        let i = 0;
        const draw = () => {
          clear(box);
          const q = qs[i];
          const fb = h('div', { class: 'small fb-note' }, q.hold ? t('tut.mk.hold2') : t('tut.mk.hold0'));
          const pick = (k: string) => {
            if (k !== q.ok) { fb.textContent = t('tut.mk.retry'); Sound.se('error'); return; }
            Sound.se('confirm');
            fb.textContent = q.note;
            fb.classList.add('gold');
            setTimeout(() => { i += 1; if (i >= qs.length) onDone(); else draw(); }, 1400);
          };
          box.append(q.row, h('div', { class: 'row', style: 'gap:10px' }, button(t('tut.mk.buy'), () => pick('buy'), { kind: 'primary' }), button(t('tut.mk.sell'), () => pick('sell')), button(t('tut.mk.pass'), () => pick('pass'), { kind: 'ghost' })), fb);
        };
        draw();
        return box;
      },
    },
  };
}

/** 監獄版（M02・M03・M05 の派生）の説明：元の説明を使い、人数とラウンドが違う所だけ差し替える */
function qGuide(base: () => Guide, name: string, last: { title: string; text: string; figure: () => Child }, replace: Record<number, string> = {}): () => Guide {
  return () => {
    const g = base();
    const pages = g.pages.map((pg, i) => (replace[i] ? { ...pg, text: replace[i] } : pg));
    pages[pages.length - 1] = last;
    return { ...g, name, pages };
  };
}
const q02Guide = qGuide(m02Guide, 'フラッグ・フラッシュ（監獄版）', {
  title: t('tut.m02.t4'), text: t('tut.q02.p4'),
  figure: () => h('div', { class: 'col', style: 'gap:14px;align-items:center' },
    chips([{ label: t('tut.m02.c1'), value: '10' }, { label: t('tut.m02.c2'), value: '5' }, { label: t('tut.m02.c3'), value: '10' }], ['×', '+']),
    facts([[t('tut.q02.rounds'), t('tut.m02.f1q')], ['5', t('tut.m02.f2')], ['8', t('tut.m02.f3')]])),
}, { 2: t('tut.q02.p3') });
const q03Guide = qGuide(m03Guide, 'ツイン・リンク（監獄版）', {
  title: t('tut.m03.t4'), text: t('tut.q03.p4'),
  figure: () => h('div', { class: 'col', style: 'gap:14px;align-items:center' },
    chips([{ label: t('tut.m03.c1'), value: '20' }, { label: t('tut.m03.c2'), value: '0〜4' }, { label: t('tut.m03.c3'), value: '15' }], ['×', '+']),
    facts([['3', t('tut.m03.f1')], ['4', t('tut.m03.f2')], ['150', t('tut.m03.f3')]])),
});
const q05Guide = qGuide(m05Guide, 'ナンバー・リレー（監獄版）', { title: t('tut.m05.t4'), text: t('tut.q05.p4'), figure: () => facts([['8', t('tut.m05.f3')], ['90', t('tut.m05.f1')], ['3', t('tut.q05.cands')]]) });

const GUIDES: Record<string, () => Guide> = { m04: m04Guide, m01: m01Guide, p01: p01Guide, m02: m02Guide, p02: p02Guide, m03: m03Guide, p03: p03Guide, p04: p04Guide, m05: m05Guide, p05: p05Guide, m06: m06Guide, p06: p06Guide, m07: m07Guide, p07: p07Guide, m08: m08Guide, p08: p08Guide, m09: m09Guide, p09: p09Guide, m10: m10Guide, p10: p10Guide, m11: m11Guide, q02: q02Guide, q03: q03Guide, q05: q05Guide, mk: mkGuide, h06: () => p10Guide(true), ...SUB_GUIDES, ...HIDDEN_GUIDES };

export const hasGuide = (id: string) => id in GUIDES || id in VOICED;
/** 今までの説明の練習（音声付きの説明の最後の段階で使い回す。声は無く字幕だけ） */
export const practiceOf = (id: string): Guide['practice'] | null => GUIDES[id]?.().practice ?? null;

/** 試合中の「ルール」から、音声付きの説明を見直す（無ければ false） */
export function reviewVoiced(matchId: string, scene: TutCtx = {}): Promise<void> | null {
  return VOICED[matchId] ? voicedTutorial(matchId, VOICED[matchId](scene), { review: true }) : null;
}

/** 段階的な説明と練習。終えるか飛ばすと解決する。開いている間、大会の時計は止まる */
export function tutorialScreen(matchId: string, opts: { cutNote?: string; scene?: TutCtx } = {}): Promise<void> {
  if (VOICED[matchId]) return voicedTutorial(matchId, VOICED[matchId](opts.scene), opts);
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
      head.append(...[emblem(matchId, 'vt-emblem')].filter((x): x is HTMLImageElement => !!x), h('span', { class: 'tut-id' }, `${matchId.toUpperCase()}　${g.name}`), h('b', { class: 'tut-title' }, isPractice ? t('tut.practice') : g.pages[page].title),
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
