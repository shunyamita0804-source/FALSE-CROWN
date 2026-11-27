/**
 * ピースを盤面に置く操作部品（M01 と練習問題で共用）。
 * 操作は 2 通り：ピースを指で引きずって置く／ピースを選んでから置きたいマスをタップする。
 * 置き場のピースをタップすると 90 度回り、盤面のピースをタップすると置き場へ戻る。
 * 画面は文字ではなく盤面と図形で構成し、置ける時は金色、置けない時は赤で示す（色だけでなく枠線の形も変える）。
 */
import { Sound } from '../audio/audio';
import { t } from '../i18n/i18n';
import { canPlace, isComplete, rotated, type Cell, type Placement, type Puzzle } from '../matches/poly';
import { button, clear, h } from './dom';

const LETTERS = 'ABCDEFGH';

export interface PolyBoardOpts {
  /** 盤面 1 マスの大きさ（論理ピクセル） */
  cell?: number;
  /** 置き場のピースの 1 マスの大きさ（省略時は盤面から決める） */
  trayCell?: number;
  /** ピースを回した時（説明で、操作を見届けるため） */
  onRotate?: (piece: number) => void;
  onChange?: (placed: Placement[]) => void;
  onComplete?: (placed: Placement[]) => void;
  /** 操作できない表示（説明用の図） */
  readonly?: boolean;
  /** 最初から置いてあるピース */
  placed?: Placement[];
}

export class PolyBoard {
  readonly el: HTMLElement;
  placed: Placement[] = [];
  private rot: number[];
  private selected = -1;
  private hint: Placement | null = null;
  private locked = false;
  private readonly boardEl: HTMLElement;
  private readonly trayEl: HTMLElement;
  private readonly ctlEl: HTMLElement;
  private readonly S: number;
  private drag: { piece: number; sx: number; sy: number; moved: boolean; from: 'tray' | 'board'; ghost?: HTMLElement; gx?: number; gy?: number; grab: Cell } | null = null;

  constructor(private readonly puzzle: Puzzle, private readonly opts: PolyBoardOpts = {}) {
    this.S = opts.cell ?? Math.floor(Math.min(92, 540 / puzzle.h, 560 / puzzle.w));
    this.rot = puzzle.pieces.map(() => 0);
    this.placed = (opts.placed ?? []).map((p) => ({ ...p }));
    for (const p of this.placed) this.rot[p.piece] = p.rot;
    this.locked = !!opts.readonly;
    this.boardEl = h('div', { class: 'pb-board', style: `width:${puzzle.w * this.S}px;height:${puzzle.h * this.S}px;--pb:${this.S}px` });
    this.trayEl = h('div', { class: 'pb-tray' });
    this.ctlEl = h('div', { class: 'pb-ctl' });
    this.el = h('div', { class: `pb${opts.readonly ? ' readonly' : ''}` }, this.boardEl, h('div', { class: 'pb-right' }, this.trayEl, this.ctlEl));
    if (!opts.readonly) {
      this.el.addEventListener('pointerdown', (e) => this.down(e));
      this.el.addEventListener('pointermove', (e) => this.move(e));
      this.el.addEventListener('pointerup', (e) => this.up(e));
      this.el.addEventListener('pointercancel', () => this.cancel());
    }
    this.draw();
  }

  setHint(hint: Placement | null): void {
    if (JSON.stringify(hint) === JSON.stringify(this.hint)) return;
    this.hint = hint;
    this.draw();
  }

  lock(): void {
    this.locked = true;
    this.cancel();
    this.el.classList.add('locked');
  }

  private isPlaced(i: number): Placement | undefined {
    return this.placed.find((p) => p.piece === i);
  }

  private cellsOf(i: number): Cell[] {
    return rotated(this.puzzle.pieces[i], this.rot[i]);
  }

  private changed(): void {
    this.draw();
    this.opts.onChange?.(this.placed);
    if (isComplete(this.puzzle, this.placed)) {
      Sound.se('confirm');
      this.el.classList.add('complete');
      this.opts.onComplete?.(this.placed);
    }
  }

  private tryPlace(i: number, x: number, y: number): boolean {
    const pl: Placement = { piece: i, rot: this.rot[i], x, y };
    if (!canPlace(this.puzzle, this.placed, pl)) return false;
    this.placed = [...this.placed.filter((p) => p.piece !== i), pl];
    this.selected = -1;
    Sound.se('chip');
    this.changed();
    return true;
  }

  private lift(i: number): void {
    this.placed = this.placed.filter((p) => p.piece !== i);
    this.selected = i;
    Sound.se('select');
    this.changed();
  }

  rotate(i = this.selected): void {
    if (this.locked || i < 0 || this.isPlaced(i)) return;
    this.rot[i] = (this.rot[i] + 1) % 4;
    Sound.se('select');
    this.draw();
    this.opts.onRotate?.(i);
  }

  undo(): void {
    if (this.locked || !this.placed.length) return;
    this.lift(this.placed[this.placed.length - 1].piece);
  }

  reset(): void {
    if (this.locked || !this.placed.length) return;
    this.placed = [];
    this.selected = -1;
    Sound.se('back');
    this.changed();
  }

  private pieceEl(i: number, size: number, cls = ''): HTMLElement {
    const cells = this.cellsOf(i);
    const w = Math.max(...cells.map((c) => c[0])) + 1;
    const hh = Math.max(...cells.map((c) => c[1])) + 1;
    return h('div', { class: `pb-piece pc${i % 8} ${cls}`, 'data-piece': String(i), style: `width:${w * size}px;height:${hh * size}px` },
      cells.map(([x, y], k) => h('span', { class: 'pb-pc', style: `left:${x * size}px;top:${y * size}px;width:${size}px;height:${size}px` }, k === 0 ? LETTERS[i] : '')));
  }

  private draw(): void {
    const { w, holes } = this.puzzle;
    const S = this.S;
    clear(this.boardEl);
    holes.forEach((hole, i) => {
      this.boardEl.append(h('span', { class: `pb-cell${hole ? ' hole' : ''}`, style: `left:${(i % w) * S}px;top:${Math.floor(i / w) * S}px;width:${S}px;height:${S}px` }));
    });
    if (this.hint && !this.isPlaced(this.hint.piece)) {
      for (const [x, y] of rotated(this.puzzle.pieces[this.hint.piece], this.hint.rot)) {
        this.boardEl.append(h('span', { class: 'pb-hint', style: `left:${(this.hint.x + x) * S}px;top:${(this.hint.y + y) * S}px;width:${S}px;height:${S}px` }, LETTERS[this.hint.piece]));
      }
    }
    for (const p of this.placed) {
      const el = this.pieceEl(p.piece, S, 'on-board');
      el.style.left = `${p.x * S}px`;
      el.style.top = `${p.y * S}px`;
      this.boardEl.append(el);
    }
    clear(this.trayEl);
    const ts = this.opts.trayCell ?? (this.opts.readonly ? Math.min(34, Math.floor(S * 0.5)) : Math.min(38, Math.floor(S * 0.46)));
    this.puzzle.pieces.forEach((_, i) => {
      const used = !!this.isPlaced(i);
      this.trayEl.append(h('div', { class: `pb-slot${used ? ' used' : ''}${this.selected === i ? ' sel' : ''}`, 'data-piece': String(i) }, used ? null : this.pieceEl(i, ts)));
    });
    clear(this.ctlEl);
    if (!this.opts.readonly) {
      const rot = button(t('pb.rotate'), () => this.rotate(), { small: true, disabled: this.selected < 0 });
      const undo = button(t('pb.undo'), () => this.undo(), { small: true, disabled: !this.placed.length });
      const reset = button(t('pb.reset'), () => this.reset(), { small: true, kind: 'ghost', disabled: !this.placed.length });
      this.ctlEl.append(rot, undo, reset);
    }
  }

  // ---- 指とマウスの操作 ----

  private boardPos(e: PointerEvent): { x: number; y: number; px: number } {
    const r = this.boardEl.getBoundingClientRect();
    const px = r.width / this.puzzle.w;
    return { x: (e.clientX - r.left) / px, y: (e.clientY - r.top) / px, px };
  }

  private down(e: PointerEvent): void {
    if (this.locked || this.drag) return;
    const target = e.target as HTMLElement;
    if (target.closest('button')) return;
    const holder = target.closest<HTMLElement>('[data-piece]');
    if (!holder) {
      // 盤面の空きマスをタップ：選んでいるピースをそこへ置く
      if (this.selected >= 0 && target.closest('.pb-board')) {
        const p = this.boardPos(e);
        const tx = Math.floor(p.x);
        const ty = Math.floor(p.y);
        const cells = this.cellsOf(this.selected);
        const sel = this.selected;
        if (!cells.some(([cx, cy]) => this.tryPlace(sel, tx - cx, ty - cy))) Sound.se('error');
      }
      return;
    }
    const i = Number(holder.dataset.piece);
    if (holder.classList.contains('used')) return;
    const onBoard = !!this.isPlaced(i);
    // つかんだ位置（ピースのどのマスか）を覚える
    let grab: Cell = [0, 0];
    if (onBoard) {
      const pl = this.isPlaced(i)!;
      const p = this.boardPos(e);
      grab = [Math.floor(p.x) - pl.x, Math.floor(p.y) - pl.y];
    } else {
      const cells = this.cellsOf(i);
      const w = Math.max(...cells.map((c) => c[0])) + 1;
      const hh = Math.max(...cells.map((c) => c[1])) + 1;
      grab = [Math.floor(w / 2), Math.floor(hh / 2)];
      if (!cells.some((c) => c[0] === grab[0] && c[1] === grab[1])) grab = cells[0];
    }
    this.drag = { piece: i, sx: e.clientX, sy: e.clientY, moved: false, from: onBoard ? 'board' : 'tray', grab };
    try { this.el.setPointerCapture(e.pointerId); } catch { /* 取れなくても続ける */ }
    e.preventDefault();
  }

  private move(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 10) return;
      d.moved = true;
      if (d.from === 'board') this.placed = this.placed.filter((p) => p.piece !== d.piece);
      this.selected = d.piece;
      this.draw();
      d.ghost = this.pieceEl(d.piece, this.S, 'ghost');
      this.boardEl.append(d.ghost);
    }
    const p = this.boardPos(e);
    // 指で隠れないよう、タッチの時はピースを少し上に浮かせる
    const liftY = e.pointerType === 'touch' ? 1.1 : 0;
    const fx = p.x - d.grab[0] - 0.5;
    const fy = p.y - d.grab[1] - 0.5 - liftY;
    const gx = Math.round(fx);
    const gy = Math.round(fy);
    const near = Math.abs(fx - gx) < 0.5 && Math.abs(fy - gy) < 0.5;
    const ok = near && canPlace(this.puzzle, this.placed, { piece: d.piece, rot: this.rot[d.piece], x: gx, y: gy });
    d.gx = ok ? gx : undefined;
    d.gy = ok ? gy : undefined;
    if (d.ghost) {
      // 置ける位置ではマスに吸い付く
      d.ghost.style.left = `${(ok ? gx : fx) * this.S}px`;
      d.ghost.style.top = `${(ok ? gy : fy) * this.S}px`;
      d.ghost.classList.toggle('ok', ok);
      d.ghost.classList.toggle('ng', !ok);
    }
  }

  private up(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    try { this.el.releasePointerCapture(e.pointerId); } catch { /* 無視 */ }
    d.ghost?.remove();
    if (!d.moved) {
      // タップ：盤面のピースは置き場へ戻す。置き場のピースは選ぶ、選んであれば回す
      if (d.from === 'board') this.lift(d.piece);
      else if (this.selected === d.piece) this.rotate(d.piece);
      else {
        this.selected = d.piece;
        Sound.se('select');
        this.draw();
      }
      return;
    }
    if (d.gx !== undefined && d.gy !== undefined && this.tryPlace(d.piece, d.gx, d.gy)) return;
    // 置けない場所で離した：置き場へ戻る
    Sound.se('back');
    this.changed();
  }

  private cancel(): void {
    if (!this.drag) return;
    this.drag.ghost?.remove();
    this.drag = null;
    this.draw();
  }
}
