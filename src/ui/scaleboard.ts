/**
 * 天秤の操作部品（P08 数字の天秤と練習で共用）。
 * タイルをタップして選び、左右の皿をタップすると載る。タイルを皿まで引きずっても載せられる。載っているタイルをタップすると下に戻る。
 * 天秤の絵は正式素材をそのまま置き、重さの違いは数字と矢印で示す（絵は傾けない）。
 */
import { assetUrl } from '../assets/registry';
import { Sound } from '../audio/audio';
import { t } from '../i18n/i18n';
import { PAN_MAX, judge, type Judge, type Scale } from '../matches/p08';
import { clear, h } from './dom';

const ART = assetUrl('ui/v11/prison/balance_scale');

export interface ScaleBoardOpts {
  place?: number[];
  readonly?: boolean;
  scale?: number;
  onChange?: () => void;
}

export class ScaleBoard {
  readonly el: HTMLElement;
  place: number[];
  private selected = -1;
  private drag: { i: number; sx: number; sy: number; moved: boolean; el: HTMLElement } | null = null;

  constructor(private readonly sc: Scale, private readonly o: ScaleBoardOpts = {}) {
    this.place = o.place ? [...o.place] : sc.tiles.map(() => 0);
    this.el = h('div', { class: `sb${o.readonly ? ' ro' : ''}`, style: o.scale ? `zoom:${o.scale}` : '' });
    if (!o.readonly) {
      this.el.addEventListener('pointerdown', (e) => this.down(e));
      this.el.addEventListener('pointermove', (e) => this.move(e));
      this.el.addEventListener('pointerup', (e) => this.up(e));
      this.el.addEventListener('pointercancel', () => { this.drag = null; this.draw(); });
    }
    this.draw();
  }

  judge(): Judge {
    return judge(this.sc, this.place);
  }

  reset(): void {
    this.place = this.sc.tiles.map(() => 0);
    this.selected = -1;
    this.draw();
    this.o.onChange?.();
  }

  private tile(i: number): HTMLElement {
    const must = this.sc.mustL.includes(i) ? 'L' : this.sc.mustR.includes(i) ? 'R' : '';
    return h('button', { class: `sb-tile${this.selected === i ? ' sel' : ''}${must ? ' must' : ''}`, type: 'button', 'data-tile': String(i), disabled: !!this.o.readonly },
      h('b', null, String(this.sc.tiles[i])), must ? h('i', null, t(must === 'L' ? 'p08.left' : 'p08.right')) : null);
  }

  private pan(side: 1 | 2, j: Judge): HTMLElement {
    const fix = side === 1 ? this.sc.fixL : this.sc.fixR;
    const n = side === 1 ? j.nL : j.nR;
    const tiles = this.sc.tiles.map((_, i) => i).filter((i) => this.place[i] === side);
    const wantHere = this.selected >= 0 && this.place[this.selected] !== side && n < PAN_MAX;
    return h('div', { class: `sb-pan ${side === 1 ? 'l' : 'r'}${wantHere ? ' want' : ''}${n >= PAN_MAX ? ' full' : ''}`, 'data-pan': String(side) },
      h('div', { class: 'sb-sum' }, h('small', null, t(side === 1 ? 'p08.left' : 'p08.right')), h('b', null, String(side === 1 ? j.left : j.right))),
      h('div', { class: 'sb-load' },
        fix ? h('span', { class: 'sb-fix', title: t('p08.fixed') }, h('b', null, String(fix)), h('small', null, t('p08.fixedTag'))) : null,
        h('div', { class: 'sb-slots' }, Array.from({ length: PAN_MAX }, (_, k) => (tiles[k] !== undefined ? this.tile(tiles[k]) : h('span', { class: 'sb-slot' }))))));
  }

  draw(): void {
    const j = this.judge();
    clear(this.el);
    const diff = j.left - j.right;
    const mid = h('div', { class: `sb-mid${j.balanced ? ' ok' : ''}` }, j.balanced ? t('p08.balanced') : j.used === 0 && diff === 0 ? '' : diff > 0 ? t('p08.heavyL', { n: diff }) : diff < 0 ? t('p08.heavyR', { n: -diff }) : '');
    const art = h('div', { class: 'sb-art' });
    if (ART) art.style.backgroundImage = `url(${ART})`;
    const tray = h('div', { class: 'sb-tray', 'data-pan': '0' }, this.sc.tiles.map((_, i) => (this.place[i] === 0 ? this.tile(i) : h('span', { class: 'sb-slot' }))));
    this.el.append(art, this.pan(1, j), mid, this.pan(2, j), tray);
  }

  private put(i: number, side: number): boolean {
    if (this.place[i] === side) return false;
    if (side !== 0 && this.place.filter((p) => p === side).length >= PAN_MAX) { Sound.se('error'); return false; }
    this.place[i] = side;
    this.selected = -1;
    Sound.se(side ? 'chip' : 'click');
    this.draw();
    this.o.onChange?.();
    return true;
  }

  private down(e: PointerEvent): void {
    const target = e.target as HTMLElement;
    const tl = target.closest<HTMLElement>('[data-tile]');
    if (tl) {
      this.drag = { i: Number(tl.dataset.tile), sx: e.clientX, sy: e.clientY, moved: false, el: tl };
      try { this.el.setPointerCapture(e.pointerId); } catch { /* 取れなくても続ける */ }
      return;
    }
    const pan = target.closest<HTMLElement>('[data-pan]');
    if (pan && this.selected >= 0) this.put(this.selected, Number(pan.dataset.pan));
  }

  private move(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < 10) return;
    d.moved = true;
    // 画面の拡大率を考えて、指に付いて動かす
    const r = d.el.getBoundingClientRect();
    const k = r.width / (d.el.offsetWidth || 1) || 1;
    d.el.classList.add('drag');
    d.el.style.transform = `translate(${dx / k}px, ${dy / k}px)`;
  }

  private up(e: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.moved) {
      d.el.style.pointerEvents = 'none';
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const pan = under && this.el.contains(under) ? (under as Element).closest<HTMLElement>('[data-pan]') : null;
      if (!pan || !this.put(d.i, Number(pan.dataset.pan))) this.draw();
      return;
    }
    // タップ：載っているタイルは下に戻す。下のタイルは選ぶ（もう一度タップで選択を外す）
    if (this.place[d.i] !== 0) { this.put(d.i, 0); return; }
    this.selected = this.selected === d.i ? -1 : d.i;
    Sound.se('select');
    this.draw();
    this.o.onChange?.();
  }
}
