/**
 * 数字をなぞって鎖を作る操作部品（P01 と練習問題で共用）。
 * 指でなぞる／1 マスずつタップする、のどちらでも操作できる。直前のマスへ戻ると 1 つ取り消す。
 * 合計が目標値と一致し、長さが 3〜6 の時だけ確定できる（規則に合う手だけを出せる）。
 */
import { Sound } from '../audio/audio';
import { t } from '../i18n/i18n';
import { adjacent, MAX_LEN, MIN_LEN, SIZE, sumOf } from '../matches/p01';
import { button, clear, h } from './dom';

export interface ChainBoardOpts {
  onSubmit?: (path: number[]) => void;
  readonly?: boolean;
  path?: number[];
  cell?: number;
}

export class ChainBoard {
  readonly el: HTMLElement;
  path: number[] = [];
  private locked = false;
  private dragging = false;
  private readonly gridEl: HTMLElement;
  private readonly sumEl: HTMLElement;
  private readonly ctlEl: HTMLElement;
  private readonly S: number;

  constructor(private readonly board: number[], private readonly target: number, private readonly opts: ChainBoardOpts = {}) {
    this.S = opts.cell ?? 92;
    this.path = [...(opts.path ?? [])];
    this.locked = !!opts.readonly;
    this.gridEl = h('div', { class: 'cb-grid', style: `width:${SIZE * this.S}px;height:${SIZE * this.S}px;font-size:${Math.round(this.S * 0.26)}px` });
    this.sumEl = h('div', { class: 'cb-sum' });
    this.ctlEl = h('div', { class: 'cb-ctl' });
    this.el = h('div', { class: `cb${opts.readonly ? ' readonly' : ''}` }, this.gridEl, h('div', { class: 'cb-right' }, this.sumEl, this.ctlEl));
    if (!opts.readonly) {
      this.gridEl.addEventListener('pointerdown', (e) => {
        if (this.locked) return;
        const i = this.cellAt(e);
        if (i < 0) return;
        this.dragging = true;
        try { this.gridEl.setPointerCapture(e.pointerId); } catch { /* 無視 */ }
        this.touch(i, true);
        e.preventDefault();
      });
      this.gridEl.addEventListener('pointermove', (e) => {
        if (!this.dragging || this.locked) return;
        const i = this.cellAt(e, 0.34);
        if (i >= 0) this.touch(i, false);
      });
      const end = () => { this.dragging = false; };
      this.gridEl.addEventListener('pointerup', end);
      this.gridEl.addEventListener('pointercancel', end);
    }
    this.draw();
  }

  lock(): void {
    this.locked = true;
    this.dragging = false;
    this.el.classList.add('locked');
    this.draw();
  }

  /** 指の位置のマス。なぞっている間は、マスの中心に近い時だけ反応する（斜めに滑った時の誤入力を防ぐ） */
  private cellAt(e: PointerEvent, radius = 0.5): number {
    const r = this.gridEl.getBoundingClientRect();
    const px = r.width / SIZE;
    const fx = (e.clientX - r.left) / px;
    const fy = (e.clientY - r.top) / px;
    const x = Math.floor(fx);
    const y = Math.floor(fy);
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return -1;
    if (Math.abs(fx - x - 0.5) > radius || Math.abs(fy - y - 0.5) > radius) return -1;
    return y * SIZE + x;
  }

  private touch(i: number, tap: boolean): void {
    const p = this.path;
    const last = p[p.length - 1];
    if (i === last) {
      // 最後のマスをもう一度タップ：1 つ取り消す
      if (tap) { p.pop(); Sound.se('select'); this.draw(); }
      return;
    }
    if (p.length >= 2 && i === p[p.length - 2]) {
      p.pop();
      Sound.se('select');
      this.draw();
      return;
    }
    if (p.includes(i)) return;
    if (!p.length || (tap && !adjacent(last, i))) {
      // 離れたマスをタップ：そこから始め直す
      this.path = [i];
      Sound.se('chip');
      this.draw();
      return;
    }
    if (!adjacent(last, i) || p.length >= MAX_LEN) return;
    p.push(i);
    Sound.se('chip');
    this.draw();
  }

  private draw(): void {
    const S = this.S;
    const p = this.path;
    const sum = sumOf(this.board, p);
    const ok = sum === this.target && p.length >= MIN_LEN && p.length <= MAX_LEN;
    clear(this.gridEl);
    // 鎖の線
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${SIZE * S} ${SIZE * S}`);
    svg.setAttribute('class', 'cb-line');
    if (p.length >= 2) {
      const pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      pl.setAttribute('points', p.map((c) => `${((c % SIZE) + 0.5) * S},${(Math.floor(c / SIZE) + 0.5) * S}`).join(' '));
      svg.append(pl);
    }
    this.board.forEach((n, i) => {
      const at = p.indexOf(i);
      this.gridEl.append(h('span', { class: `cb-cell${at >= 0 ? ' on' : ''}${at === p.length - 1 && at >= 0 ? ' head' : ''}${ok && at >= 0 ? ' ok' : ''}`, style: `left:${(i % SIZE) * S}px;top:${Math.floor(i / SIZE) * S}px;width:${S}px;height:${S}px` },
        h('b', null, String(n)), at >= 0 ? h('small', null, String(at + 1)) : null));
    });
    this.gridEl.append(svg);
    clear(this.sumEl);
    this.sumEl.append(
      h('div', { class: 'cb-target' }, h('small', null, t('cb.target')), h('b', null, String(this.target))),
      h('div', { class: `cb-now${ok ? ' ok' : sum > this.target ? ' over' : ''}` }, h('small', null, t('cb.sum')), h('b', null, String(sum)), h('span', { class: 'cb-eq' }, p.length ? p.map((c) => this.board[c]).join(' + ') : '')),
      h('div', { class: 'cb-len' }, Array.from({ length: MAX_LEN }, (_, k) => h('span', { class: `cb-pip${k < p.length ? ' on' : ''}${k < MIN_LEN ? ' need' : ''}` })), h('small', null, t('cb.len', { n: p.length }))),
    );
    clear(this.ctlEl);
    if (!this.opts.readonly) {
      this.ctlEl.append(
        button(t('cb.submit'), () => { if (!this.locked && ok) this.opts.onSubmit?.([...this.path]); }, { kind: 'primary', disabled: !ok || this.locked }),
        button(t('cb.clear'), () => { if (this.locked) return; this.path = []; Sound.se('back'); this.draw(); }, { small: true, kind: 'ghost', disabled: !p.length || this.locked }),
      );
    }
  }
}
