/**
 * サブゲーム S01〜S06 の画面。盤面、石、カード、サイコロはプログラムで描く。
 * 置く、選ぶといった戻せない操作は「タップで選ぶ、もう一度タップか確定ボタンで決める」。記憶カードだけは、タップですぐめくる。
 */
import { assetUrl } from '../../assets/registry';
import { Sound } from '../../audio/audio';
import type { CharId } from '../../data/characters';
import { t } from '../../i18n/i18n';
import { S01_MAX, type S01Guess, type S01Move, type S01View } from '../../matches/s01';
import { S02_N, type S02Move, type S02View } from '../../matches/s02';
import { S03_N, type S03Move, type S03View } from '../../matches/s03';
import { type S04Move, type S04View } from '../../matches/s04';
import { S05_ROUNDS, holds, type S05Move, type S05View } from '../../matches/s05';
import { adjacent, solved, type S06Move, type S06View } from '../../matches/s06';
import { face } from '../art';
import { button, h, toast, type Child } from '../dom';
import type { MatchUi } from '../matchui';

type Out = { main: Child; side: Child };

/** 2 人の名前と点の枠（横に置く） */
function scoreBox(ui: MatchUi, players: CharId[], me: number, vals: (string | number)[], title: string, now = -1, marks?: Child[]): HTMLElement {
  return h('div', { class: 'box' }, h('h4', null, title), players.map((p, i) => h('div', { class: `m01-rankrow${i === me ? ' me' : ''}${i === now ? ' now' : ''}` },
    marks ? marks[i] : null, face(p), h('span', { class: 'nm' }, ui.name(p)), h('b', null, String(vals[i])))));
}

const resultKey = (rank: number[][], me: number) => (rank.length === 1 ? 'draw' : rank[0].includes(me) ? 'win' : 'lose');
function endBanner(key: string, extra?: Child): HTMLElement {
  return h('div', { class: `sg-end ${key}` }, h('b', null, t(`sub.end.${key}`)), extra ?? null);
}

// ---------------- S01 数字当て ----------------

interface L1 { code?: string }

/** 3 桁の入力盤。同じ数字は 2 回押せない */
export function codePad(code: string, onChange: (c: string) => void, onOk: (() => void) | null, okLabel: string): HTMLElement {
  return h('div', { class: 'sg-pad' },
    h('div', { class: 'sg-slots' }, [0, 1, 2].map((i) => h('span', { class: `sg-slot${code[i] ? ' on' : ''}` }, code[i] ?? ''))),
    h('div', { class: 'sg-keys' }, '1234567890'.split('').map((d) => {
      const b = h('button', { class: 'sg-key', type: 'button', 'data-key': d, disabled: code.includes(d) || code.length >= 3 }, d);
      b.addEventListener('click', () => { Sound.se('select'); onChange(code + d); });
      return b;
    }), (() => { const b = h('button', { class: 'sg-key del', type: 'button', 'data-key': 'del', disabled: !code.length }, t('sub.s01.del')); b.addEventListener('click', () => { Sound.se('back'); onChange(code.slice(0, -1)); }); return b; })()),
    button(okLabel, () => onOk?.(), { kind: 'primary', disabled: code.length !== 3 || !onOk, cls: 'sg-ok' }));
}

export function guessList(gs: S01Guess[], empty: string): HTMLElement {
  return h('div', { class: 'sg-glist' }, gs.length ? gs.map((g, i) => h('div', { class: `sg-g${g.hit === 3 ? ' hit' : ''}` }, h('span', { class: 'no' }, String(i + 1)), h('b', null, g.code),
    h('span', { class: 'hb h' }, t('sub.s01.hit', { n: g.hit })), h('span', { class: 'hb b' }, t('sub.s01.blow', { n: g.blow })))) : h('div', { class: 'dim small' }, empty));
}

export function renderS01(v: S01View, ui: MatchUi): Out {
  const L = ui.local as L1;
  const me = v.me < 0 ? 0 : v.me;
  const op = 1 - me;
  const watching = v.me < 0;
  const code = L.code ?? '';
  const set = (c: string) => { L.code = c; ui.rerender(); };
  const side = [h('div', { class: 'box scroll grow' }, h('h4', null, t('sub.s01.oppTitle', { name: ui.name(v.players[op]) })),
    v.mySecret ? h('div', { class: 'sg-secret' }, t('sub.s01.mySecret'), h('b', null, v.mySecret)) : null,
    guessList(v.guesses[op], t('sub.s01.none')))];
  if (v.phase === 'done') {
    const rank = v.solved[me] === v.solved[op] ? [[0, 1]] : v.solved[me] !== null && (v.solved[op] === null || v.solved[me]! < v.solved[op]!) ? [[me], [op]] : [[op], [me]];
    return { main: h('div', { class: 'sg sg-s01' }, h('div', { class: 'col', style: 'gap:8px;flex:1' }, h('h4', { class: 'gold' }, t('sub.s01.myTitle')), guessList(v.guesses[me], t('sub.s01.none'))),
      endBanner(resultKey(rank, me), h('div', { class: 'col', style: 'gap:4px;align-items:center' }, v.players.map((p, i) => h('div', null, t('sub.s01.reveal', { name: ui.name(p), code: v.secrets?.[i] ?? '' }))),
        h('div', { class: 'dim small' }, v.solved[me] !== null ? t('sub.s01.solvedIn', { n: v.solved[me]! }) : t('sub.s01.unsolved'))))), side };
  }
  if (v.phase === 'secret') {
    return { main: h('div', { class: 'sg sg-s01 center' }, h('div', { class: 'col', style: 'gap:10px;align-items:center' },
      h('div', { class: 'sg-lead' }, watching ? '' : v.submitted ? t('sub.s01.waitSecret') : t('sub.s01.pickSecret')),
      v.submitted || watching ? null : codePad(code, set, () => { L.code = ''; Sound.se('confirm'); ui.submit({ t: 'secret', code } satisfies S01Move); }, t('sub.s01.okSecret')))), side };
  }
  const used = v.guesses[me].some((g) => g.code === code);
  return { main: h('div', { class: 'sg sg-s01' },
    h('div', { class: 'col', style: 'gap:8px;flex:1;min-width:0' }, h('h4', { class: 'gold' }, t('sub.s01.myTitle')), guessList(v.guesses[me], t('sub.s01.noneMine')),
      h('div', { class: 'dim small' }, t('sub.s01.left', { n: S01_MAX - v.guesses[me].length }))),
    h('div', { class: 'col', style: 'gap:8px;align-items:center' },
      h('div', { class: 'sg-lead' }, watching ? '' : v.submitted ? t('sub.s01.waitGuess') : used ? t('sub.s01.usedCode') : t('sub.s01.guessLead')),
      v.submitted || watching ? null : codePad(code, set, used ? null : () => { L.code = ''; Sound.se('confirm'); ui.submit({ t: 'guess', code } satisfies S01Move); }, t('sub.s01.okGuess')))), side };
}

// ---------------- S02 五目並べ、S03 ミニリバーシ ----------------

interface L2 { sel?: number; key?: string }

/** 石（先手は濃い色、後手は明るい色に点。色だけで見分けない） */
export const stone = (who: number, cls = '') => h('i', { class: `sg-stone s${who} ${cls}` });

export function renderS02(v: S02View, ui: MatchUi): Out {
  const L = ui.local as L2;
  const me = v.me < 0 ? 0 : v.me;
  const myTurn = v.me >= 0 && v.phase === 'play' && v.turn === v.me;
  if (L.key !== String(v.count) || !myTurn) { L.key = String(v.count); L.sel = undefined; }
  const put = (c: number) => { L.sel = undefined; Sound.se('chip'); ui.submit({ t: 'put', cell: c } satisfies S02Move); };
  const grid = h('div', { class: 'sg-go', style: `--sg-n:${S02_N}` }, v.board.map((c, i) => {
    const el = h('button', { class: `sg-pt${i === v.last ? ' last' : ''}${v.line.includes(i) ? ' line' : ''}${L.sel === i ? ' sel' : ''}`, type: 'button', 'data-cell': String(i), disabled: !myTurn || c !== -1 },
      c !== -1 ? stone(c) : L.sel === i ? stone(me, 'ghost') : null);
    el.addEventListener('click', () => {
      if (!myTurn || c !== -1) return;
      if (L.sel === i) put(i);
      else { L.sel = i; Sound.se('select'); ui.rerender(); }
    });
    return el;
  }));
  const done = v.phase === 'done';
  const info = h('div', { class: 'sg-info' },
    done ? endBanner(v.winner < 0 ? 'draw' : v.winner === me ? 'win' : 'lose', v.winner < 0 ? h('div', { class: 'dim small' }, t('sub.s02.full')) : null)
      : h('div', { class: 'sg-lead' }, myTurn ? (L.sel === undefined ? t('sub.s02.your') : t('sub.s02.confirm')) : t('sub.turnOf', { name: ui.name(v.players[v.turn]) })),
    done ? null : h('div', { class: 'row', style: 'gap:8px;align-items:center' }, stone(me), h('span', null, t('sub.yourStone', { o: t(me === 0 ? 'sub.first' : 'sub.second') }))),
    done || v.me < 0 ? null : button(t('sub.put'), () => { if (L.sel !== undefined) put(L.sel); }, { kind: 'primary', disabled: !myTurn || L.sel === undefined, cls: 'sg-ok' }),
    h('div', { class: 'dim small' }, t('sub.s02.goal')));
  return { main: h('div', { class: 'sg sg-board' }, grid, info), side: scoreBox(ui, v.players, v.me, v.players.map((_, i) => t(i === 0 ? 'sub.first' : 'sub.second')), t('sub.s02.sideTitle', { n: v.count }), done ? -1 : v.turn, [stone(0), stone(1)]) };
}

export function renderS03(v: S03View, ui: MatchUi): Out {
  const L = ui.local as L2;
  const me = v.me < 0 ? 0 : v.me;
  const myTurn = v.me >= 0 && v.phase === 'play' && v.turn === v.me;
  const key = `${v.stones[0]}-${v.stones[1]}-${v.turn}`;
  if (L.key !== key || !myTurn) { L.key = key; L.sel = undefined; }
  const put = (c: number) => { L.sel = undefined; Sound.se('chip'); ui.submit({ t: 'put', cell: c } satisfies S03Move); };
  const grid = h('div', { class: 'sg-rv', style: `--sg-n:${S03_N}` }, v.board.map((c, i) => {
    const can = myTurn && v.legal.includes(i);
    const el = h('button', { class: `sg-sq${i === v.last ? ' last' : ''}${can ? ' can' : ''}${L.sel === i ? ' sel' : ''}`, type: 'button', 'data-cell': String(i), disabled: !can },
      c !== -1 ? stone(c, v.flipped.includes(i) ? 'flip' : '') : L.sel === i ? stone(me, 'ghost') : null);
    el.addEventListener('click', () => {
      if (!can) return;
      if (L.sel === i) put(i);
      else { L.sel = i; Sound.se('select'); ui.rerender(); }
    });
    return el;
  }));
  const done = v.phase === 'done';
  const mustPass = myTurn && !v.legal.length;
  const info = h('div', { class: 'sg-info' },
    done ? endBanner(v.stones[me] === v.stones[1 - me] ? 'draw' : v.stones[me] > v.stones[1 - me] ? 'win' : 'lose', h('div', null, `${v.stones[me]} － ${v.stones[1 - me]}`))
      : h('div', { class: 'sg-lead' }, mustPass ? t('sub.s03.noMove') : myTurn ? (L.sel === undefined ? t('sub.s03.your') : t('sub.s02.confirm')) : t('sub.turnOf', { name: ui.name(v.players[v.turn]) })),
    !done && v.passed ? h('div', { class: 'sg-note' }, t(myTurn ? 'sub.s03.oppPassed' : 'sub.s03.youPassed')) : null,
    done ? null : h('div', { class: 'row', style: 'gap:8px;align-items:center' }, stone(me), h('span', null, t('sub.yourStone', { o: t(me === 0 ? 'sub.first' : 'sub.second') }))),
    done || v.me < 0 ? null : mustPass ? button(t('sub.s03.pass'), () => { Sound.se('click'); ui.submit({ t: 'pass' } satisfies S03Move); }, { kind: 'primary', cls: 'sg-ok' })
      : button(t('sub.put'), () => { if (L.sel !== undefined) put(L.sel); }, { kind: 'primary', disabled: !myTurn || L.sel === undefined, cls: 'sg-ok' }),
    h('div', { class: 'dim small' }, t('sub.s03.goal')));
  return { main: h('div', { class: 'sg sg-board' }, grid, info), side: scoreBox(ui, v.players, v.me, v.stones, t('sub.s03.sideTitle'), done ? -1 : v.turn, [stone(0), stone(1)]) };
}

// ---------------- S04 記憶カード ----------------

const SHAPES = [
  '<circle cx="30" cy="30" r="20"/>',
  '<path d="M30 8 L52 50 H8 Z"/>',
  '<rect x="11" y="11" width="38" height="38" rx="3"/>',
  '<path d="M30 6 L52 30 L30 54 L8 30 Z"/>',
  '<path d="M30 6 L36.5 22.5 L54 23.5 L40.5 35 L45 52 L30 42.5 L15 52 L19.5 35 L6 23.5 L23.5 22.5 Z"/>',
  '<path d="M30 7 L50 18.5 V41.5 L30 53 L10 41.5 V18.5 Z"/>',
];
const SHAPE_COL = ['#e06a5c', '#5cb6e0', '#e0c15c', '#7fd08a', '#c58be8', '#f0a060'];
const SHAPE_CH = ['A', 'B', 'C', 'D', 'E', 'F'];

/** カードの絵（形、色、記号の 3 つで見分けられる） */
export function memFace(f: number): HTMLElement {
  const el = h('span', { class: 'sg-face' });
  el.innerHTML = `<svg viewBox="0 0 60 60" fill="${SHAPE_COL[f]}">${SHAPES[f]}</svg><b>${SHAPE_CH[f]}</b>`;
  return el;
}

export function renderS04(v: S04View, ui: MatchUi): Out {
  const me = v.me < 0 ? 0 : v.me;
  const myTurn = v.me >= 0 && v.phase === 'flip' && v.turn === v.me;
  const open = new Map(v.open.map((o) => [o.cell, o.face]));
  const grid = h('div', { class: 'sg-mem' }, v.owner.map((o, i) => {
    const f = open.get(i);
    const taken = o !== -1 && f === undefined;
    const el = h('button', { class: `sg-card${f !== undefined ? ' up' : ''}${taken ? ' taken' : ''}${v.show && f !== undefined ? (v.show.hit ? ' hit' : ' miss') : ''}`, type: 'button', 'data-cell': String(i), disabled: !myTurn || o !== -1 || f !== undefined },
      f !== undefined ? memFace(f) : taken ? h('small', null, t(o === me ? 'sub.s04.mine' : 'sub.s04.theirs')) : h('i', { class: 'sg-back' }));
    el.addEventListener('click', () => {
      if (!myTurn || o !== -1 || f !== undefined) return;
      Sound.se('card');
      ui.submit({ t: 'flip', cell: i } satisfies S04Move);
    });
    return el;
  }));
  const done = v.phase === 'done';
  const sh = v.show;
  const info = h('div', { class: 'sg-info' },
    done ? endBanner(v.pairs[me] === v.pairs[1 - me] ? 'draw' : v.pairs[me] > v.pairs[1 - me] ? 'win' : 'lose', h('div', null, `${v.pairs[me]} － ${v.pairs[1 - me]}`))
      : sh ? h('div', { class: `sg-lead ${sh.hit ? 'good' : ''}` }, t(sh.hit ? 'sub.s04.hit' : 'sub.s04.miss', { name: sh.who === v.me ? t('sub.you') : ui.name(v.players[sh.who]) }))
        : h('div', { class: 'sg-lead' }, myTurn ? t(v.open.length ? 'sub.s04.second' : 'sub.s04.first') : t('sub.turnOf', { name: ui.name(v.players[v.turn]) })),
    sh && !done && v.me >= 0 ? button(t('common.next'), () => { Sound.se('click'); ui.submit({ t: 'ok' } satisfies S04Move); }, { kind: 'primary', disabled: v.acked, cls: 'sg-ok' }) : null,
    h('div', { class: 'dim small' }, t('sub.s04.goal')));
  return { main: h('div', { class: 'sg sg-board' }, grid, info), side: scoreBox(ui, v.players, v.me, v.pairs.map((n) => t('sub.s04.pairs', { n })), t('sub.s04.sideTitle'), done ? -1 : v.turn) };
}

// ---------------- S05 ダイスパズル ----------------

interface L5 { re?: number[]; cond?: number; key?: string }
const PIPS: number[][] = [[], [4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8]];

export function die(n: number, cls = ''): HTMLElement {
  return h('span', { class: `sg-die ${cls}`, 'data-n': String(n) }, Array.from({ length: 9 }, (_, i) => h('i', { class: PIPS[n].includes(i) ? 'on' : '' })));
}

export function renderS05(v: S05View, ui: MatchUi): Out {
  const L = ui.local as L5;
  const me = v.me < 0 ? 0 : v.me;
  const op = 1 - me;
  if (L.key !== `${v.round}-${v.phase}`) { L.key = `${v.round}-${v.phase}`; L.re = []; L.cond = undefined; }
  const re = L.re ?? [];
  const side = [scoreBox(ui, v.players, v.me, v.points, t('sub.s05.sideTitle')),
    h('div', { class: 'box scroll grow' }, h('h4', null, t('sub.s05.logTitle')), v.log.length ? v.log.map((r, i) => h('div', { class: 'sg-dlog' }, h('span', { class: 'no' }, String(i + 1)),
      [me, op].map((k) => h('span', { class: `pk ${r.picks[k].ok ? 'ok' : 'ng'}` }, t(`sub.s05.c${r.picks[k].cond}s`), r.picks[k].ok ? ' ○' : ' ×')))) : h('div', { class: 'dim small' }, t('sub.s05.logNone')))];
  if (v.phase === 'done') {
    return { main: h('div', { class: 'sg center' }, endBanner(v.points[me] === v.points[op] ? 'draw' : v.points[me] > v.points[op] ? 'win' : 'lose', h('div', null, `${v.points[me]} － ${v.points[op]}`))), side };
  }
  if (v.phase === 'show') {
    const r = v.log[v.log.length - 1];
    const row = (k: number) => h('div', { class: `sg-res ${r.picks[k].ok ? 'ok' : 'ng'}` },
      h('div', { class: 'who' }, face(v.players[k]), h('span', null, k === v.me ? t('sub.you') : ui.name(v.players[k]))),
      h('div', { class: 'sg-dice sm' }, r.picks[k].dice.map((d, j) => die(d, r.picks[k].re.includes(j) ? 're' : ''))),
      h('div', { class: 'verdict' }, t(`sub.s05.c${r.picks[k].cond}`), h('b', null, t(r.picks[k].ok ? 'sub.s05.ok' : 'sub.s05.ng'))));
    return { main: h('div', { class: 'sg sg-s05' }, h('div', { class: 'sg-lead' }, t('sub.s05.resultLead', { n: v.round + 1 })), row(me), row(op),
      h('div', { class: 'dim small' }, t('sub.s05.reNote')),
      v.me >= 0 ? button(v.round + 1 >= S05_ROUNDS ? t('sub.s05.toEnd') : t('sub.s05.next'), () => { Sound.se('click'); ui.submit({ t: 'ok' } satisfies S05Move); }, { kind: 'primary', disabled: v.acked, cls: 'sg-ok' }) : null), side };
  }
  const can = v.me >= 0 && !v.submitted;
  const dice = h('div', { class: 'sg-dice' }, v.base.map((d, j) => {
    const el = h('button', { class: `sg-dbtn${re.includes(j) ? ' re' : ''}`, type: 'button', 'data-die': String(j), disabled: !can }, die(d), h('small', null, re.includes(j) ? t('sub.s05.reroll') : t('sub.s05.keep')));
    el.addEventListener('click', () => {
      if (!can) return;
      L.re = re.includes(j) ? re.filter((x) => x !== j) : [...re, j];
      Sound.se('select');
      ui.rerender();
    });
    return el;
  }));
  const conds = h('div', { class: 'sg-conds' }, [0, 1, 2].map((c) => {
    const used = v.used[me][c];
    const el = h('button', { class: `sg-cond${L.cond === c ? ' sel' : ''}${used ? ' used' : ''}`, type: 'button', 'data-cond': String(c), disabled: !can || used },
      h('b', null, t(`sub.s05.c${c}`)), h('small', null, used ? t('sub.s05.used') : holds(c, v.base) && !re.length ? t('sub.s05.already') : t(`sub.s05.c${c}ex`)));
    el.addEventListener('click', () => {
      if (!can || used) return;
      L.cond = c;
      Sound.se('select');
      ui.rerender();
    });
    return el;
  }));
  return { main: h('div', { class: 'sg sg-s05' },
    h('div', { class: 'sg-lead' }, !can ? (v.me < 0 ? '' : t('sub.s05.wait')) : L.cond === undefined ? t('sub.s05.lead1') : t('sub.s05.lead2', { n: re.length })),
    dice, conds,
    can ? button(re.length ? t('sub.s05.go', { n: re.length }) : t('sub.s05.goKeep'), () => { if (L.cond === undefined) return; Sound.se('confirm'); ui.submit({ t: 'roll', re, cond: L.cond } satisfies S05Move); }, { kind: 'primary', disabled: L.cond === undefined, cls: 'sg-ok' }) : null), side };
}

// ---------------- S06 ミニジグソー ----------------

/** 絵に使う施設の画像（表示の時に正方形に切り出して、等倍率で縮める。画像そのものは加工しない） */
export const S06_ART: { path: string; w: number; h: number }[] = [
  { path: 'maps/3f/library', w: 1664, h: 1152 },
  { path: 'maps/3f/game_room', w: 1536, h: 1024 },
  { path: 'maps/3f/observatory', w: 1536, h: 1024 },
  { path: 'maps/3f/living_lounge', w: 1792, h: 1152 },
  { path: 'maps/2f/garden', w: 1792, h: 1280 },
  { path: 'maps/2f/dining', w: 1920, h: 1280 },
];

/** タイル 1 枚の背景（絵の中央の正方形を n×n に分けた、tile 番目の部分） */
export function tileStyle(image: number, n: number, tile: number, size: number): string {
  const art = S06_ART[image % S06_ART.length];
  const url = assetUrl(art.path);
  const full = size * n;
  const iw = (full * art.w) / art.h;
  const x0 = (iw - full) / 2;
  const cx = tile % n;
  const cy = Math.floor(tile / n);
  return `width:${size}px;height:${size}px;${url ? `background-image:url(${url});` : `background:hsl(${(tile * 360) / (n * n)} 45% 45%);`}background-size:${iw}px ${full}px;background-position:${-(x0 + cx * size)}px ${-(cy * size)}px;`;
}

interface L6 { perm?: number[]; swaps?: [number, number][]; sel?: number; sent?: boolean }
const S06_SIZE = 546;

export function renderS06(v: S06View, ui: MatchUi): Out {
  const L = ui.local as L6;
  const me = v.me < 0 ? 0 : v.me;
  if (!L.perm) { L.perm = [...v.perm]; L.swaps = []; L.sel = undefined; L.sent = false; }
  const perm = L.perm;
  const swaps = L.swaps!;
  const can = v.me >= 0 && !v.submitted && !L.sent && v.phase === 'play';
  const size = Math.floor(S06_SIZE / v.n);
  const mine = v.results[me];
  const fmt = (ms: number) => t('sub.s06.sec', { n: (ms / 1000).toFixed(1) });
  ui.timeoutMove = can ? () => ({ t: 'giveup' } satisfies S06Move) : undefined;
  const grid = h('div', { class: `sg-jig${v.submitted && typeof mine === 'number' ? ' done' : ''}`, style: `grid-template-columns:repeat(${v.n}, ${size}px)` }, (v.submitted && typeof mine === 'number' ? perm.map((_, i) => i) : perm).map((tile, pos) => {
    const el = h('button', { class: `sg-tile${L.sel === pos ? ' sel' : ''}${can && L.sel !== undefined && L.sel !== pos && (v.mode === 'any' || adjacent(v.n, L.sel, pos)) ? ' can' : ''}`, type: 'button', 'data-pos': String(pos), 'data-tile': String(tile), disabled: !can, style: tileStyle(v.image, v.n, tile, size) });
    el.addEventListener('click', () => {
      if (!can) return;
      if (L.sel === undefined) { L.sel = pos; Sound.se('select'); ui.rerender(); return; }
      if (L.sel === pos) { L.sel = undefined; Sound.se('back'); ui.rerender(); return; }
      if (v.mode === 'adj' && !adjacent(v.n, L.sel, pos)) { L.sel = pos; Sound.se('select'); toast(t('sub.s06.notAdj'), 'info'); ui.rerender(); return; }
      const a = L.sel;
      [perm[a], perm[pos]] = [perm[pos], perm[a]];
      swaps.push([a, pos]);
      L.sel = undefined;
      Sound.se('chip');
      if (solved(perm)) {
        L.sent = true;
        ui.timeoutMove = undefined;
        Sound.se('result');
        ui.submit({ t: 'solve', swaps, ms: ui.elapsed() } satisfies S06Move);
        return;
      }
      ui.rerender();
    });
    return el;
  }));
  const refSize = Math.floor(210 / v.n);
  const ref = h('div', { class: 'sg-ref', style: `grid-template-columns:repeat(${v.n}, ${refSize}px)` }, perm.map((_, i) => h('i', { style: tileStyle(v.image, v.n, i, refSize) })));
  const done = v.phase === 'done';
  const solo = v.players.length === 1;
  const other = solo ? undefined : v.results[1 - me];
  const rankKey = solo ? (typeof mine === 'number' ? 'clear' : 'fail') : typeof mine === 'number' && (typeof other !== 'number' || mine < other) ? 'win' : typeof other === 'number' && (typeof mine !== 'number' || other < mine) ? 'lose' : 'draw';
  const info = h('div', { class: 'sg-info' },
    done ? endBanner(rankKey, h('div', { class: 'col', style: 'gap:2px;align-items:center' }, h('div', null, typeof mine === 'number' ? t('sub.s06.myTime', { t: fmt(mine) }) : t('sub.s06.myFail')),
      solo ? null : h('div', { class: 'dim' }, typeof other === 'number' ? t('sub.s06.oppTime', { name: ui.name(v.players[1 - me]), t: fmt(other) }) : t('sub.s06.oppFail', { name: ui.name(v.players[1 - me]) }))))
      : h('div', { class: 'sg-lead' }, v.submitted ? t('sub.s06.waitOpp') : L.sel === undefined ? t('sub.s06.lead1') : t('sub.s06.lead2')),
    h('div', { class: 'sg-mode' }, t(v.mode === 'adj' ? 'sub.s06.modeAdj' : 'sub.s06.modeAny')),
    h('div', { class: 'col', style: 'gap:4px;align-items:center' }, h('small', { class: 'dim' }, t('sub.s06.ref')), ref),
    done ? null : h('div', { class: 'dim small' }, t('sub.s06.count', { n: swaps.length })),
    can ? button(t('sub.s06.giveup'), () => { L.sent = true; Sound.se('back'); ui.submit({ t: 'giveup' } satisfies S06Move); }, { small: true, cls: 'sg-giveup' }) : null);
  return { main: h('div', { class: 'sg sg-board' }, grid, info), side: null };
}
