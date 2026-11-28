/**
 * 六角盤にタイルを置く操作部品（M07 六角領域と練習で共用）。
 * 手持ちのタイルをタップして選び、盤面のマスをタップ（または指でなぞる）と、その位置に置いた時の形が出る。
 * 回すボタンで 60 度ずつ回せる。置ける時は自分の色、置けない時は赤で示す。確定は呼び出し側のボタンで行う。
 */
import { Sound } from '../audio/audio';
import { cellAt, rot60 } from '../matches/hex';
import { G, SHAPES, TOWER, areaOf, beaconCell, canPlace, cellsOf, isCenter, startCell } from '../matches/m07';
import { h } from './dom';
import { HEX_COLORS, beaconInner, cellFromPoint, hexBoard, markerInner, shapeSvg } from './hexboard';

export interface PlacerSel { shape?: string; rot: number; at?: number }
export interface PlacerOpts {
  owner: number[];
  seat: number;
  seats: number[];
  tiles: string[];
  cap: number;
  size: number;
  active: boolean;
  /** 直前に置かれたマス（光らせる） */
  fresh?: number[];
  sel: PlacerSel;
  onChange: () => void;
}

export interface Ghost { at: number; cells: number[]; ok: boolean }

/** 選んだ形を、tapped のマスを含むように置く。置ける位置があればそれを、無ければ置けない形（赤）を返す */
export function resolveGhost(owner: number[], seat: number, sel: PlacerSel): Ghost | null {
  if (!sel.shape || sel.at === undefined) return null;
  const [q0, r0] = G.cells[sel.at];
  for (const [q, r] of SHAPES[sel.shape]) {
    const [a, b] = rot60(q, r, sel.rot);
    const at = cellAt(G, q0 - a, r0 - b);
    if (at < 0) continue;
    const cells = cellsOf(sel.shape, sel.rot, at);
    if (canPlace(owner, seat, cells)) return { at, cells: cells!, ok: true };
  }
  const cells: number[] = [];
  for (const [q, r] of SHAPES[sel.shape]) { const [a, b] = rot60(q, r, sel.rot); const c = cellAt(G, q0 + a, r0 + b); if (c >= 0) cells.push(c); }
  return { at: sel.at, cells, ok: false };
}

export class TilePlacer {
  readonly board: HTMLElement;
  readonly tray: HTMLElement;
  private readonly frontier = new Set<number>();

  constructor(private readonly o: PlacerOpts) {
    const { owner, seat, size } = o;
    owner.forEach((own, c) => { if (own === seat) for (const n of G.adj[c]) if (owner[n] < 0 && n !== TOWER) this.frontier.add(n); });
    const starts = new Map(o.seats.map((s) => [startCell(s), s]));
    const beacons = new Map(o.seats.map((s) => [beaconCell(s), s]));
    this.board = hexBoard(G, size, (c) => {
      if (c === TOWER) return { cls: 'tower', inner: markerInner(size) };
      const own = owner[c];
      let inner = '';
      const b = beacons.get(c);
      if (b !== undefined) inner += beaconInner(size, HEX_COLORS[b], b === seat);
      if (starts.has(c)) inner += `<circle class="hx-start" r="${size * 0.28}"/>`;
      return { cls: `${own >= 0 ? 'own' : 'empty'}${own === seat ? ' mine' : ''}${isCenter(c) ? ' ctr' : ''}${o.fresh?.includes(c) ? ' new' : ''}`, fill: own >= 0 ? HEX_COLORS[own] : undefined, inner };
    }, { cls: o.active ? 'active' : '' });
    this.tray = h('div', { class: 'hx-tray' });
    this.drawTray();
    if (o.active) {
      let down = false;
      const at = (e: PointerEvent) => {
        const c = cellFromPoint(this.board, e.clientX, e.clientY);
        if (c < 0 || c === o.sel.at || !o.sel.shape) return;
        o.sel.at = c;
        this.paint();
        o.onChange();
      };
      this.board.addEventListener('pointerdown', (e) => { down = true; if (!o.sel.shape) { Sound.se('error'); this.tray.classList.remove('nudge'); void this.tray.offsetWidth; this.tray.classList.add('nudge'); return; } at(e); Sound.se('select'); });
      this.board.addEventListener('pointermove', (e) => { if (down) at(e); });
      const up = () => { down = false; };
      this.board.addEventListener('pointerup', up);
      this.board.addEventListener('pointercancel', up);
      this.board.addEventListener('pointerleave', up);
    }
    this.paint();
  }

  ghost(): Ghost | null {
    return resolveGhost(this.o.owner, this.o.seat, this.o.sel);
  }

  rotate(d: number): void {
    this.o.sel.rot = (this.o.sel.rot + d + 6) % 6;
    Sound.se('click');
    this.drawTray();
    this.paint();
    this.o.onChange();
  }

  private drawTray(): void {
    const { o } = this;
    this.tray.replaceChildren();
    const kinds = [...new Set(o.tiles)].sort((a, b) => areaOf(a) - areaOf(b));
    for (const shape of kinds) {
      const n = o.tiles.filter((x) => x === shape).length;
      const locked = areaOf(shape) > o.cap;
      const sel = o.sel.shape === shape;
      const el = h('button', { class: `hx-tile${sel ? ' sel' : ''}${locked ? ' locked' : ''}`, type: 'button', disabled: !o.active || locked, 'data-shape': shape });
      el.innerHTML = `${shapeSvg(SHAPES[shape], sel ? o.sel.rot : 0, HEX_COLORS[o.seat], 12)}${n > 1 ? `<small>×${n}</small>` : ''}`;
      el.addEventListener('click', () => {
        o.sel.shape = sel ? undefined : shape;
        Sound.se('select');
        this.drawTray();
        this.paint();
        o.onChange();
      });
      this.tray.append(el);
    }
  }

  /** 置く形と、置ける場所の目安を盤面に反映する */
  private paint(): void {
    const g = this.ghost();
    const showFr = this.o.active && !!this.o.sel.shape;
    this.board.querySelectorAll<SVGGElement>('.hx').forEach((el) => {
      const c = Number(el.getAttribute('data-cell'));
      const inGhost = !!g && g.cells.includes(c);
      el.classList.toggle('gh', inGhost && g!.ok);
      el.classList.toggle('bad', inGhost && !g!.ok);
      el.classList.toggle('fr', showFr && this.frontier.has(c) && !inGhost);
      if (inGhost && g!.ok) el.style.setProperty('--g', HEX_COLORS[this.o.seat]);
    });
  }
}
