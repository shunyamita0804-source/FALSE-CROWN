/**
 * 鏡映しの盤面の操作部品（P09 鏡の決闘と練習で共用）。
 * 軸（金色の線）と札はプログラムで描く。札を選んでから、作る側のマスをタップして置く。置いた矢印をタップすると向きが回る。消しゴムで消す。
 */
import { Sound } from '../audio/audio';
import { t } from '../i18n/i18n';
import { expected, sideOf, type Mirror, type Tile } from '../matches/p09';
import { clear, h } from './dom';

export type MirrorTool = 'b' | 'a' | 'x';
const NEXT: Record<string, Tile> = { u: 'r', r: 'd', d: 'l', l: 'u' };
const DEG: Record<string, number> = { u: 0, r: 90, d: 180, l: 270 };

/** 札 1 枚の絵（四角、または向きのある矢印） */
export function tileEl(tile: Tile, cls = ''): HTMLElement {
  if (tile === 'b') return h('span', { class: `mb-tile blk ${cls}` });
  const el = h('span', { class: `mb-tile arw ${cls}`, 'data-dir': tile });
  el.innerHTML = `<svg viewBox="0 0 40 40" style="transform:rotate(${DEG[tile]}deg)"><path d="M20 5 L33 20 H25 V35 H15 V20 H7 Z"/></svg>`;
  return el;
}

export interface MirrorBoardOpts {
  cell: number;
  readonly?: boolean;
  grid?: Record<number, Tile>;
  /** 採点の表示（振り返り用）：合っているマス、違うマス、足りないマスに印を付ける */
  marked?: boolean;
  onChange?: () => void;
}

export class MirrorBoard {
  readonly el: HTMLElement;
  grid: Record<number, Tile>;
  tool: MirrorTool = 'b';
  private hint: { cell: number; tile: Tile | null } | null = null;

  constructor(readonly m: Mirror, private readonly o: MirrorBoardOpts) {
    this.grid = { ...(o.grid ?? {}) };
    this.el = h('div', { class: `mb${o.readonly ? ' ro' : ''} ax-${m.axis}`, style: `--mb-cell:${o.cell}px;--mb-n:${m.n}` });
    if (!o.readonly) {
      this.el.addEventListener('click', (e) => {
        const c = (e.target as Element).closest<HTMLElement>('[data-cell]');
        if (c && !c.hasAttribute('disabled')) this.tap(Number(c.dataset.cell));
      });
    }
    this.draw();
  }

  get count(): number { return Object.keys(this.grid).length; }

  setTool(tool: MirrorTool): void {
    this.tool = tool;
    this.o.onChange?.();
  }

  setHint(hint: { cell: number; tile: Tile | null } | null): void {
    this.hint = hint;
    this.draw();
  }

  reset(): void {
    this.grid = {};
    this.changed();
  }

  private tap(c: number): void {
    if (sideOf(this.m.n, this.m.axis, c) !== 'dst') return;
    const cur = this.grid[c];
    if (this.tool === 'x') {
      if (!cur) return;
      delete this.grid[c];
    } else if (this.tool === 'b') {
      if (cur === 'b') delete this.grid[c]; else this.grid[c] = 'b';
    } else {
      // 矢印：空のマス、四角のマスには上向きを置く。矢印のマスは右回りに回す
      this.grid[c] = cur && cur !== 'b' ? NEXT[cur] : 'u';
    }
    Sound.se('select');
    if (this.hint?.cell === c) this.hint = null;
    this.changed();
  }

  private changed(): void {
    this.draw();
    this.o.onChange?.();
  }

  private draw(): void {
    const { n, axis } = this.m;
    clear(this.el);
    const exp = this.o.marked ? expected(this.m) : null;
    const gridEl = h('div', { class: 'mb-grid', style: `grid-template-columns:repeat(${n}, ${this.o.cell}px)` });
    for (let c = 0; c < n * n; c++) {
      const side = sideOf(n, axis, c);
      const src = this.m.src[c];
      const mine = this.grid[c];
      let mark = '';
      let inner: HTMLElement | null = null;
      if (side === 'src' && src) inner = tileEl(src, 'src');
      else if (side === 'dst') {
        if (mine) inner = tileEl(mine, 'mine');
        if (exp) {
          if (mine && exp[c] === mine) mark = ' ok';
          else if (mine) mark = ' ng';
          else if (exp[c]) { mark = ' miss'; inner = tileEl(exp[c], 'ghost'); }
        }
        if (this.hint?.cell === c) {
          mark += ' hint';
          if (this.hint.tile && !mine) inner = tileEl(this.hint.tile, 'ghost');
        }
      }
      gridEl.append(h('button', { class: `mb-cell ${side}${mark}`, type: 'button', 'data-cell': String(c), 'data-tile': mine ?? '', disabled: this.o.readonly || side !== 'dst' }, inner));
    }
    // 軸：縦と横は盤面の中央、斜めは角から角へ
    const size = n * this.o.cell;
    const line = h('div', { class: 'mb-axis' });
    line.innerHTML = `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><line ${axis === 'v' ? `x1="${size / 2}" y1="-6" x2="${size / 2}" y2="${size + 6}"` : axis === 'h' ? `x1="-6" y1="${size / 2}" x2="${size + 6}" y2="${size / 2}"` : axis === 'd' ? `x1="0" y1="0" x2="${size}" y2="${size}"` : `x1="${size}" y1="0" x2="0" y2="${size}"`}/></svg>`;
    this.el.append(gridEl, line,
      h('span', { class: 'mb-lab src' }, t('p09.labSrc')), h('span', { class: 'mb-lab dst' }, t('p09.labDst')));
  }
}
