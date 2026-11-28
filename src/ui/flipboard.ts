/**
 * 駒を置いて挟んだ駒を返す盤面の操作部品（P07 ブラック＆ホワイトと練習で共用）。
 * 置ける場所に印を出す。マスをタップすると、置く駒と返る駒を先に見せる。同じマスをもう一度タップするか、呼び出し側のボタンで確定する。
 */
import { Sound } from '../audio/audio';
import { G, HOLE_V, flipsFor, isCenter } from '../matches/p07';
import { assetUrl } from '../assets/registry';
import { hexBoard } from './hexboard';

export const PIECE_COLORS = ['#191b24', '#f2ecdc', '#c8423b'];
export const PIECE_EDGE = ['#8a8fa8', '#8f8769', '#5e1512'];

export interface FlipSel { cell?: number }
export interface FlipBoardOpts {
  board: number[];
  seat: number;
  legal: number[];
  active: boolean;
  size: number;
  /** 直前の手（置いた駒と返った駒を光らせる） */
  last?: { cell: number | null; flipped: number[] };
  sel: FlipSel;
  onChange: () => void;
  onConfirm?: () => void;
  onBad?: () => void;
}

/** 駒の正式素材：黒と白はミニリバーシの円盤（旧素材の再利用）、紅は v11 追加。円盤は絵の幅の約 90% */
export const PIECE_ART = [assetUrl('ui/games/s03/asset_01'), assetUrl('ui/games/s03/asset_01_01'), assetUrl('ui/v11/p07/piece_red')];
const ART_FILL = 0.9;

export const pieceSvg = (seat: number, r: number, cls = '') => PIECE_ART[seat]
  ? `<g class="pc art ${cls}"><image href="${PIECE_ART[seat]}" x="${(-r / ART_FILL).toFixed(1)}" y="${(-r / ART_FILL).toFixed(1)}" width="${((2 * r) / ART_FILL).toFixed(1)}" height="${((2 * r) / ART_FILL).toFixed(1)}"/></g>`
  : pieceSvgPlain(seat, r, cls);
const pieceSvgPlain = (seat: number, r: number, cls = '') => `<circle class="pc ${cls}" r="${r.toFixed(1)}" fill="${PIECE_COLORS[seat]}" stroke="${PIECE_EDGE[seat]}" stroke-width="${(r * 0.12).toFixed(1)}"/><circle class="pc-hi" r="${(r * 0.62).toFixed(1)}" cx="${(-r * 0.12).toFixed(1)}" cy="${(-r * 0.14).toFixed(1)}" fill="rgba(255,255,255,0.10)"/>`;

export class FlipBoard {
  readonly el: HTMLElement;

  constructor(private readonly o: FlipBoardOpts) {
    const { board, size } = o;
    const r = size * 0.62;
    this.el = hexBoard(G, size, (c) => {
      const v = board[c];
      if (v === HOLE_V) return { cls: 'hole', bare: true };
      const legal = o.active && o.legal.includes(c);
      let inner = '';
      if (v >= 0) inner = pieceSvg(v, r, `${o.last?.cell === c ? 'new' : ''}${o.last?.flipped.includes(c) ? ' flipped' : ''}`);
      else if (legal) inner = `<circle class="fb-dot" r="${(size * 0.2).toFixed(1)}"/>`;
      return { cls: `fb${v >= 0 ? ' has' : ' empty'}${legal ? ' lg' : ''}${isCenter(c) ? ' ctr' : ''}`, inner };
    }, { cls: `fbb${o.active ? ' active' : ''}` });
    if (o.active) {
      this.el.addEventListener('click', (e) => {
        const g = (e.target as Element).closest('[data-cell]');
        if (!g) return;
        const c = Number(g.getAttribute('data-cell'));
        if (!o.legal.includes(c)) { if (board[c] === -1) { Sound.se('error'); o.onBad?.(); } return; }
        if (o.sel.cell === c) { o.onConfirm?.(); return; }
        o.sel.cell = c;
        Sound.se('select');
        this.paint();
        o.onChange();
      });
    }
    this.paint();
  }

  /** 選んだマスに置いた時に返る駒 */
  flips(): number[] {
    return this.o.sel.cell === undefined ? [] : flipsFor(this.o.board, this.o.seat, this.o.sel.cell);
  }

  private paint(): void {
    const { o } = this;
    const fl = this.flips();
    const r = o.size * 0.62;
    this.el.querySelectorAll<SVGGElement>('.hx').forEach((el) => {
      const c = Number(el.getAttribute('data-cell'));
      el.classList.toggle('will', fl.includes(c));
      el.querySelector('.fb-ghost')?.remove();
      const isSel = o.sel.cell === c;
      el.classList.toggle('sel', isSel);
      if (isSel) el.insertAdjacentHTML('beforeend', `<g class="fb-ghost">${pieceSvg(o.seat, r)}</g>`);
    });
  }
}
