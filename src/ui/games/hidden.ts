/**
 * 裏ゲーム H01、H03、H04、H05、H07、H08 の画面（H02 はカード対決、H06 は駒の盤面の画面を使う）。
 * 入力はタップだけ。答えを出す、開ける、といった戻せない操作は、入力してから確定ボタンで決める。
 */
import { assetUrl } from '../../assets/registry';
import { Sound } from '../../audio/audio';
import { t } from '../../i18n/i18n';
import { H01_MAX, type H01Move, type H01View } from '../../matches/h01';
import { type Dir, type H03Move, type H03View } from '../../matches/h03';
import { type H04Move, type H04View } from '../../matches/h04';
import { H05_PUZZLES, slidable, type H05Move, type H05View } from '../../matches/h05';
import { type H07Answer, type H07Move, type H07View } from '../../matches/h07';
import { type H08Move, type H08View } from '../../matches/h08';
import { CORE01 } from '../../story/hiddendata';
import { face } from '../art';
import { button, h, type Child } from '../dom';
import type { MatchUi } from '../matchui';
import { PathBoard } from '../pathboard';

type Out = { main: Child; side: Child };

/** 結果の枠 */
function endBox(ok: boolean, title: string, extra?: Child): HTMLElement {
  return h('div', { class: `sg-end ${ok ? 'win' : 'lose'}` }, h('b', null, title), extra ?? null);
}

/** 文字や数字の入力盤。unique は、同じ鍵を 2 回押せない */
export function keyPad(o: { value: string; keys: string[]; max: number; cols: number; unique?: boolean; onChange: (v: string) => void; onOk: (() => void) | null; ok: string; slots?: boolean }): HTMLElement {
  return h('div', { class: 'hd-pad' },
    o.slots === false ? null : h('div', { class: 'sg-slots' }, Array.from({ length: o.max }, (_, i) => h('span', { class: `sg-slot${o.value[i] ? ' on' : ''}` }, o.value[i] ?? ''))),
    h('div', { class: 'hd-keys', style: `grid-template-columns:repeat(${o.cols}, auto)` }, o.keys.map((k) => {
      const b = h('button', { class: 'sg-key', type: 'button', 'data-key': k, disabled: o.value.length >= o.max || (o.unique && o.value.includes(k)) }, k);
      b.addEventListener('click', () => { Sound.se('select'); o.onChange(o.value + k); });
      return b;
    })),
    h('div', { class: 'row', style: 'gap:10px' },
      (() => { const b = h('button', { class: 'sg-key del', type: 'button', 'data-key': 'del', disabled: !o.value.length }, t('sub.s01.del')); b.addEventListener('click', () => { Sound.se('back'); o.onChange(o.value.slice(0, -1)); }); return b; })(),
      button(o.ok, () => o.onOk?.(), { kind: 'primary', disabled: !o.onOk, cls: 'sg-ok' })));
}

// ---------------- H01 賢者の金庫 ----------------

interface L1 { code?: string; marks?: boolean[] }

export function renderH01(v: H01View, ui: MatchUi): Out {
  const L = ui.local as L1;
  const code = L.code ?? '';
  const marks = (L.marks ??= v.clues.map(() => false));
  const done = v.phase === 'done';
  const can = v.self !== 'spectator' && !done;
  const safe = assetUrl(v.solved ? 'props/safe_open' : 'props/safe_closed') ?? assetUrl('props/safe_closed');
  const clues = h('div', { class: 'hd-clues' }, v.clues.map((c, i) => {
    const el = h('button', { class: `hd-clue${marks[i] ? ' on' : ''}`, type: 'button', 'data-clue': String(i) }, h('span', { class: 'no' }, String(i + 1)), h('span', { class: 'tx' }, c), h('i', null, marks[i] ? '✓' : ''));
    el.addEventListener('click', () => { marks[i] = !marks[i]; Sound.se('select'); ui.rerender(); });
    return el;
  }));
  const tried = v.tries.includes(code);
  const right = done
    ? endBox(v.solved, t(v.solved ? 'h01.open' : 'h01.fail'), h('div', { class: 'dim small' }, t(v.solved ? 'h01.openNote' : 'h01.failNote')))
    : h('div', { class: 'col', style: 'gap:8px;align-items:center' },
      h('div', { class: 'sg-lead' }, tried ? t('h01.tried') : t('h01.lead', { n: v.left })),
      can ? keyPad({ value: code, keys: ['1', '2', '3', '4', '5', '6'], max: 6, cols: 6, unique: true, onChange: (c) => { L.code = c; ui.rerender(); }, onOk: code.length === 6 && !tried ? () => { L.code = ''; Sound.se('latch'); ui.submit({ t: 'try', code } satisfies H01Move); } : null, ok: t('h01.ok') }) : null);
  const side = h('div', { class: 'box scroll grow' }, h('h4', null, t('h01.triesTitle', { n: v.tries.length, m: H01_MAX })),
    safe ? h('img', { class: 'hd-safe', src: safe, alt: '', draggable: false }) : null,
    v.tries.length ? v.tries.map((c, i) => h('div', { class: `hd-try${v.solved && i === v.tries.length - 1 ? ' ok' : ''}` }, h('span', { class: 'no' }, String(i + 1)), h('b', null, c), h('span', null, v.solved && i === v.tries.length - 1 ? '○' : '×'))) : h('div', { class: 'dim small' }, t('h01.noTry')));
  return { main: h('div', { class: 'sg hd-h01' }, h('div', { class: 'col', style: 'gap:6px' }, h('div', { class: 'dim small' }, t('h01.clueNote')), clues), right), side };
}

// ---------------- H03 鏡の迷宮 ----------------

export function mazeBoard(rows: string[], pos: [number, number], goal: [number, number], cls: string, cell: number): HTMLElement {
  const el = h('div', { class: `hd-maze ${cls}`, style: `grid-template-columns:repeat(${rows[0].length}, ${cell}px)` });
  rows.forEach((r, y) => r.split('').forEach((c, x) => {
    const here = pos[0] === x && pos[1] === y;
    const g = goal[0] === x && goal[1] === y;
    el.append(h('span', { class: `hd-mc${c === '#' ? ' wall' : ''}${g ? ' goal' : ''}`, style: `width:${cell}px;height:${cell}px`, 'data-x': String(x), 'data-y': String(y) }, g ? h('i', { class: 'g' }, '★') : null, here ? h('i', { class: 'p' }) : null));
  }));
  return el;
}

/** 上下左右の 4 つのボタン */
export function dpad(onDir: (d: Dir) => void, can: boolean): HTMLElement {
  const key = (dir: Dir, label: string) => { const b = h('button', { class: `hd-dir d${dir}`, type: 'button', 'data-dir': dir, disabled: !can }, label); b.addEventListener('click', () => { if (can) onDir(dir); }); return b; };
  return h('div', { class: 'hd-dpad' }, key('U', '▲'), key('L', '◀'), key('R', '▶'), key('D', '▼'));
}

export function renderH03(v: H03View, ui: MatchUi): Out {
  const done = v.phase === 'done';
  const can = v.self !== 'spectator' && !done;
  const pad = dpad((dir) => { Sound.se('step'); ui.submit({ t: 'go', dir } satisfies H03Move); }, can);
  const ctrl = done
    ? endBox(v.cleared >= v.total, t(v.cleared >= v.total ? 'h03.clear' : 'h03.fail'), h('div', { class: 'dim small' }, t('h03.cleared', { n: v.cleared, m: v.total })))
    : h('div', { class: 'col', style: 'gap:10px;align-items:center' },
      h('div', { class: `hd-moves${v.maxMoves - v.moves <= 5 ? ' low' : ''}` }, t('h03.moves', { n: v.moves, m: v.maxMoves })), pad,
      can ? button(t('h03.reset'), () => { Sound.se('back'); ui.submit({ t: 'reset' } satisfies H03Move); }, { small: true, cls: 'hd-reset' }) : null);
  const main = h('div', { class: 'sg hd-h03' },
    h('div', { class: 'col', style: 'gap:4px;align-items:center' }, h('small', { class: 'dim' }, t('h03.left')), mazeBoard(v.boards[0], v.pos[0], v.goal[0], 'a', 62)),
    ctrl,
    h('div', { class: 'col', style: 'gap:4px;align-items:center' }, h('small', { class: 'dim' }, t('h03.right')), mazeBoard(v.boards[1], v.pos[1], v.goal[1], 'b', 62)));
  return { main, side: null };
}

// ---------------- H04 囚人の遺言 ----------------

interface L4 { a?: (number | undefined)[]; read?: number }

export function renderH04(v: H04View, ui: MatchUi): Out {
  const L = ui.local as L4;
  const a = (L.a ??= v.questions.map(() => undefined));
  const done = v.phase === 'done';
  const can = v.self !== 'spectator' && !done;
  const read = L.read ?? 0;
  const letters = h('div', { class: 'hd-letters' },
    h('div', { class: 'hd-ltabs' }, v.letters.map((l, i) => { const b = h('button', { class: `hd-ltab${read === i ? ' on' : ''}`, type: 'button', 'data-letter': l.id }, String(i + 1)); b.addEventListener('click', () => { L.read = i; Sound.se('page'); ui.rerender(); }); return b; })),
    h('div', { class: 'hd-letter' }, h('b', null, v.letters[read].title), h('p', null, v.letters[read].text)));
  const shown = done && v.answers ? v.answers : a;
  const qs = h('div', { class: 'hd-qs' }, v.questions.map((q, i) => h('div', { class: `hd-q${v.marks ? (v.marks[i] ? ' ok' : ' ng') : ''}`, 'data-q': String(i) },
    h('div', { class: 'pr' }, h('span', { class: 'no' }, String(i + 1)), q.prompt, v.marks ? h('b', null, v.marks[i] ? '○' : '×') : null),
    h('div', { class: 'ops' }, q.options.map((o, k) => {
      const b = h('button', { class: `hd-op${shown[i] === k ? ' on' : ''}`, type: 'button', 'data-opt': String(k), disabled: !can }, o);
      b.addEventListener('click', () => { if (!can) return; a[i] = k; Sound.se('select'); ui.rerender(); });
      return b;
    })))));
  const all = a.every((x) => x !== undefined);
  const foot = done
    ? endBox(v.correct >= v.pass, t(v.correct >= v.pass ? 'h04.pass' : 'h04.fail'), h('div', null, t('h04.score', { n: v.correct, m: v.questions.length })))
    : can ? button(all ? t('h04.submit') : t('h04.remain', { n: a.filter((x) => x === undefined).length }), () => { Sound.se('confirm'); ui.submit({ t: 'answer', a: a as number[] } satisfies H04Move); }, { kind: 'primary', disabled: !all, cls: 'sg-ok' }) : null;
  return { main: h('div', { class: 'sg hd-h04' }, h('div', { class: 'col', style: 'gap:8px;width:400px' }, h('small', { class: 'dim' }, t('h04.lettersNote')), letters, foot), qs), side: null };
}

// ---------------- H05 時の牢獄 ----------------

interface L5 { num?: string; seq?: string[] }
const DIGITS = '1234567890'.split('');

function steps(idx: number, total: number, name: (i: number) => string): HTMLElement {
  return h('div', { class: 'hd-steps' }, Array.from({ length: total }, (_, i) => h('span', { class: i < idx ? 'past' : i === idx ? 'on' : '' }, h('i', null, i < idx ? '✓' : String(i + 1)), name(i))));
}

export function renderH05(v: H05View, ui: MatchUi): Out {
  const L = ui.local as L5;
  const done = v.phase === 'done';
  const can = v.self !== 'spectator' && !done;
  const head = steps(Math.min(v.idx, H05_PUZZLES), H05_PUZZLES, (i) => t(`h05.p${i}`));
  let body: Child;
  if (done) body = endBox(v.idx >= H05_PUZZLES, t(v.idx >= H05_PUZZLES ? 'h05.clear' : 'h05.fail'), h('div', { class: 'dim small' }, t('h05.solved', { n: Math.min(v.idx, H05_PUZZLES), m: H05_PUZZLES })));
  else if (v.idx === 0) {
    const num = L.num ?? '';
    body = h('div', { class: 'hd-row' },
      h('div', { class: 'col', style: 'gap:10px;align-items:center' }, h('div', null, v.seq.prompt), h('div', { class: 'hd-seq' }, v.seq.seq.map((n) => h('b', null, String(n))), h('b', { class: 'q' }, num || '？')), v.misses ? h('div', { class: 'hd-miss' }, t('h05.miss')) : null),
      can ? keyPad({ value: num, keys: DIGITS, max: 3, cols: 5, slots: false, onChange: (x) => { L.num = x; ui.rerender(); }, onOk: num.length ? () => { L.num = ''; Sound.se('confirm'); ui.submit({ t: 'num', v: Number(num) } satisfies H05Move); } : null, ok: t('h05.enter') }) : null);
  } else if (v.idx === 1) {
    const ok = slidable(v.slide);
    body = h('div', { class: 'hd-row' },
      h('div', { class: 'hd-slide' }, v.slide.map((n, i) => {
        const b = h('button', { class: `hd-st${n === 0 ? ' blank' : ''}${ok.includes(i) ? ' can' : ''}`, type: 'button', 'data-pos': String(i), 'data-n': String(n), disabled: !can || !ok.includes(i) }, n ? String(n) : '');
        b.addEventListener('click', () => { if (!can || !ok.includes(i)) return; Sound.se('chip'); ui.submit({ t: 'slide', pos: i } satisfies H05Move); });
        return b;
      })),
      h('div', { class: 'col', style: 'gap:8px;width:330px' }, h('div', null, t('h05.slideLead')), h('div', { class: 'hd-goal' }, [1, 2, 3, 4, 5, 6, 7, 8, 0].map((n) => h('i', null, n ? String(n) : ''))), h('small', { class: 'dim' }, t('h05.slideGoal')), h('small', { class: 'dim' }, t('h05.slideMoves', { n: v.slideMoves }))));
  } else {
    const seq = (L.seq ??= []);
    body = h('div', { class: 'hd-row' },
      h('div', { class: 'col', style: 'gap:6px;width:330px' }, h('div', null, t('h05.orderLead')), v.order.clues.map((c) => h('div', { class: 'hd-oclue' }, c)), v.misses && !seq.length ? h('div', { class: 'hd-miss' }, t('h05.miss')) : null),
      h('div', { class: 'col', style: 'gap:10px;align-items:center' },
        h('div', { class: 'sg-slots' }, [0, 1, 2, 3].map((i) => h('span', { class: `sg-slot${seq[i] ? ' on' : ''}` }, seq[i] ?? ''))),
        h('div', { class: 'row', style: 'gap:8px' }, v.order.glyphs.map((g) => { const b = h('button', { class: 'sg-key', type: 'button', 'data-key': g, disabled: !can || seq.includes(g) }, g); b.addEventListener('click', () => { seq.push(g); Sound.se('select'); ui.rerender(); }); return b; })),
        h('div', { class: 'row', style: 'gap:10px' }, (() => { const b = h('button', { class: 'sg-key del', type: 'button', 'data-key': 'del', disabled: !seq.length }, t('sub.s01.del')); b.addEventListener('click', () => { seq.pop(); Sound.se('back'); ui.rerender(); }); return b; })(),
          button(t('h05.enter'), () => { const s = [...seq]; L.seq = []; Sound.se('confirm'); ui.submit({ t: 'order', seq: s } satisfies H05Move); }, { kind: 'primary', disabled: seq.length !== 4, cls: 'sg-ok' }))));
  }
  return { main: h('div', { class: 'sg hd-col' }, head, body), side: null };
}

// ---------------- H07 十二の証明 ----------------

interface L7 { a?: Partial<H07Answer>[]; sel?: number; from?: number }

export function renderH07(v: H07View, ui: MatchUi): Out {
  const L = ui.local as L7;
  // 直前に出した答えを引き継ぐ（出し直すたびに入れ直さなくてよいように）
  if (!L.a || L.from !== v.tries) { L.a = v.last ? v.last.map((x) => ({ ...x })) : v.people.map(() => ({})); L.from = v.tries; L.sel = v.wrong?.[0] ?? L.sel ?? 0; }
  const a = L.a;
  const sel = L.sel ?? 0;
  const done = v.phase === 'done';
  const can = v.self !== 'spectator' && !done;
  const cur = a[sel];
  const list = h('div', { class: 'hd-people' }, v.people.map((p, i) => {
    const full = a[i].opt !== undefined && a[i].ev !== undefined;
    const bad = !!v.wrong?.includes(i) && a[i].opt === v.last?.[i]?.opt && a[i].ev === v.last?.[i]?.ev;
    const b = h('button', { class: `hd-person${sel === i ? ' sel' : ''}${full ? ' full' : ''}${bad ? ' bad' : ''}`, type: 'button', 'data-person': String(i) }, face(p.id), h('span', { class: 'nm' }, p.name), h('i', null, bad ? '×' : full ? '✓' : ''));
    b.addEventListener('click', () => { L.sel = i; Sound.se('select'); ui.rerender(); });
    return b;
  }));
  const evText = cur.ev ? v.evidence.find((e) => e.id === cur.ev)?.text : null;
  const detail = h('div', { class: 'hd-detail' },
    h('div', { class: 'row', style: 'gap:8px;align-items:center' }, face(v.people[sel].id), h('b', { class: 'gold' }, t('h07.about', { name: v.people[sel].name }))),
    h('div', { class: 'hd-ops3' }, v.people[sel].options.map((o, k) => { const b = h('button', { class: `hd-op${cur.opt === k ? ' on' : ''}`, type: 'button', 'data-opt': String(k), disabled: !can }, o); b.addEventListener('click', () => { if (!can) return; cur.opt = k; Sound.se('select'); ui.rerender(); }); return b; })),
    h('small', { class: 'dim' }, t('h07.pickEv')),
    h('div', { class: 'hd-evs' }, v.evidence.map((e, i) => { const b = h('button', { class: `hd-ev${cur.ev === e.id ? ' on' : ''}`, type: 'button', 'data-ev': e.id, disabled: !can }, String(i + 1)); b.addEventListener('click', () => { if (!can) return; cur.ev = e.id; Sound.se('page'); ui.rerender(); }); return b; })),
    h('div', { class: 'hd-evtext' }, evText ?? t('h07.evNone')));
  const left = a.filter((x) => x.opt === undefined || x.ev === undefined).length;
  const foot = done
    ? endBox(v.solved, t(v.solved ? 'h07.clear' : 'h07.stop'), v.solved ? h('div', { class: 'dim small' }, t('h07.clearNote')) : null)
    : h('div', { class: 'row', style: 'gap:12px;align-items:center' },
      can ? button(left ? t('h07.remain', { n: left }) : t('h07.submit'), () => { Sound.se('confirm'); ui.submit({ t: 'answer', a: a as H07Answer[] } satisfies H07Move); }, { kind: 'primary', disabled: left > 0, cls: 'sg-ok' }) : null,
      v.wrong?.length ? h('span', { class: 'hd-miss' }, t('h07.wrong', { n: v.wrong.length })) : null);
  return { main: h('div', { class: 'sg hd-h07' }, list, h('div', { class: 'col', style: 'gap:8px;flex:1;min-width:0' }, detail, foot)), side: null };
}

// ---------------- H08 神の方程式 ----------------

interface L8 { text?: string; num?: string; pick?: number; board?: PathBoard }
const LETTERS_AZ = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export function renderH08(v: H08View, ui: MatchUi): Out {
  const L = ui.local as L8;
  const done = v.phase === 'done';
  const can = v.self !== 'spectator' && !done;
  const head = steps(Math.min(v.idx, v.total), v.total, (i) => t(`h08.p${i}`));
  const missEl = v.misses ? h('div', { class: 'hd-miss' }, t('h08.miss', { n: v.misses })) : null;
  let body: Child;
  if (done) body = endBox(v.idx >= v.total, t(v.idx >= v.total ? 'h08.clear' : 'h08.pause'), h('div', { class: 'dim small' }, t(v.idx >= v.total ? 'h08.clearNote' : 'h08.pauseNote', { n: Math.min(v.idx, v.total), m: v.total })));
  else if (v.idx === 0) {
    const text = L.text ?? '';
    body = h('div', { class: 'hd-row' },
      h('div', { class: 'col', style: 'gap:8px;align-items:center;width:360px' }, h('div', null, t('h08.cipherLead')), h('div', { class: 'hd-seq' }, v.cipher.map((n) => h('b', null, String(n)))), h('div', { class: 'hd-table' }, t('h08.cipherTable')),
        h('div', { class: 'sg-slots sm' }, [0, 1, 2, 3, 4].map((i) => h('span', { class: `sg-slot${text[i] ? ' on' : ''}` }, text[i] ?? ''))), missEl),
      can ? keyPad({ value: text, keys: LETTERS_AZ, max: 5, cols: 9, slots: false, onChange: (x) => { L.text = x; ui.rerender(); }, onOk: text.length === 5 ? () => { L.text = ''; Sound.se('confirm'); ui.submit({ t: 'text', v: text } satisfies H08Move); } : null, ok: t('h05.enter') }) : null);
  } else if (v.idx === 1) {
    const num = L.num ?? '';
    body = h('div', { class: 'hd-row' },
      h('div', { class: 'col', style: 'gap:10px;align-items:center' }, h('div', null, v.seq.prompt), h('div', { class: 'hd-seq' }, v.seq.seq.map((n) => h('b', null, String(n))), h('b', { class: 'q' }, num || '？')), missEl),
      can ? keyPad({ value: num, keys: DIGITS, max: 3, cols: 5, slots: false, onChange: (x) => { L.num = x; ui.rerender(); }, onOk: num.length ? () => { L.num = ''; Sound.se('confirm'); ui.submit({ t: 'num', v: Number(num) } satisfies H08Move); } : null, ok: t('h05.enter') }) : null);
  } else if (v.idx === 2 || v.idx === 4) {
    const q = v.idx === 2 ? v.logic : v.final;
    body = h('div', { class: 'hd-row' },
      h('div', { class: 'col', style: 'gap:8px;width:560px' }, h('div', null, q.prompt), v.idx === 2 ? v.logic.lines.map((l) => h('div', { class: 'hd-oclue' }, l)) : h('div', { class: 'hd-letter' }, h('b', null, t('h08.coreTitle')), h('p', null, CORE01)), missEl),
      h('div', { class: 'col', style: 'gap:8px;width:380px' }, q.options.map((o, k) => { const b = h('button', { class: `hd-op big${L.pick === k ? ' on' : ''}`, type: 'button', 'data-opt': String(k), disabled: !can }, o); b.addEventListener('click', () => { if (!can) return; L.pick = k; Sound.se('select'); ui.rerender(); }); return b; }),
        can ? button(t('h08.answer'), () => { const i = L.pick!; L.pick = undefined; Sound.se('confirm'); ui.submit({ t: 'pick', i } satisfies H08Move); }, { kind: 'primary', disabled: L.pick === undefined, cls: 'sg-ok' }) : null));
  } else {
    if (!L.board) {
      const board: PathBoard = new PathBoard(v.maze, { cell: 92, onChange: () => ui.rerender(), onComplete: (path) => { Sound.se('result'); setTimeout(() => ui.submit({ t: 'path', path } satisfies H08Move), 450); } });
      L.board = board;
    }
    const b = L.board;
    body = h('div', { class: 'hd-row' }, b.el,
      h('div', { class: 'col', style: 'gap:8px;width:340px' }, h('div', null, t('h08.pathLead')), h('small', { class: 'dim' }, t('h08.pathNote', { n: b.checks, m: v.maze.checks.length })),
        can ? h('div', { class: 'row', style: 'gap:8px' }, button(t('p06.undo'), () => { b.undo(); ui.rerender(); }, { small: true }), button(t('p06.reset'), () => { b.reset(); ui.rerender(); }, { small: true })) : null));
  }
  return { main: h('div', { class: 'sg hd-col' }, head, body, can ? h('div', { class: 'row', style: 'justify-content:flex-end;width:100%' }, button(t('h08.pauseBtn'), () => { Sound.se('back'); ui.submit({ t: 'pause' } satisfies H08Move); }, { small: true, cls: 'hd-pause' })) : null), side: null };
}
