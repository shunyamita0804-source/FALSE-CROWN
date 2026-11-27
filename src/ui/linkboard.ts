/**
 * 経路を指でなぞって引く操作部品（M03 と練習問題で共用）。
 * 端点に触れてそのままなぞると経路が伸びる。引いた経路の途中に触れると、そこから引き直せる。来た道を戻ると 1 マスずつ消える。
 * 記号は色と文字の両方で区別する。結び終えた記号は、端点に輪が付く。
 */
import { assetUrl } from '../assets/registry';
import { Sound } from '../audio/audio';
import { linkComplete, linked, neighbours, type LinkPuzzle } from '../matches/link';
import { h } from './dom';

export const LINK_COLORS = ['#e6b84f', '#5fb8e6', '#e67a6a', '#7ed48a', '#c59be8', '#f0a05a', '#6fd6c8', '#e88ab8'];
const LETTERS = 'ABCDEFGH';
/** 端点の素材（中立の銀色。色はプログラムで下に敷き、乗算で重ねる。画像そのものは変えない） */
const TOKEN = assetUrl('ui/v11/m03/endpoint_token');

export interface LinkMark { color: number; cells: number[] }

export interface LinkBoardOpts {
  /** 1 マスの大きさ（論理ピクセル） */
  cell?: number;
  readonly?: boolean;
  /** 最初から引いてある経路 */
  paths?: (number[] | null)[];
  onChange?: (connected: number) => void;
  onComplete?: (paths: number[][]) => void;
}

export class LinkBoard {
  readonly el: HTMLElement;
  paths: number[][];
  private readonly S: number;
  private readonly svg: HTMLElement;
  private readonly endOf = new Map<number, number>();
  private active = -1;
  private locked = false;
  /** 教わった手掛かり（その記号の経路が通るマス） */
  private clue: LinkMark | null = null;
  /** 補助で表示された経路の出だし */
  private aid: LinkMark | null = null;

  constructor(readonly puzzle: LinkPuzzle, private readonly opts: LinkBoardOpts = {}) {
    const n = puzzle.size;
    this.S = opts.cell ?? Math.floor(Math.min(96, 520 / n));
    this.paths = puzzle.ends.map((_, i) => [...(opts.paths?.[i] ?? [])]);
    puzzle.ends.forEach((e, i) => { this.endOf.set(e[0], i); this.endOf.set(e[1], i); });
    this.locked = !!opts.readonly;
    this.svg = h('div', { class: 'lb-board', style: `width:${n * this.S}px;height:${n * this.S}px` });
    this.el = h('div', { class: `lb${opts.readonly ? ' readonly' : ''}` }, this.svg);
    if (!opts.readonly) {
      this.el.addEventListener('pointerdown', (e) => this.down(e));
      this.el.addEventListener('pointermove', (e) => this.move(e));
      this.el.addEventListener('pointerup', () => this.up());
      this.el.addEventListener('pointercancel', () => this.up());
    }
    this.draw();
  }

  setMarks(clue: LinkMark | null, aid: LinkMark | null): void {
    if (JSON.stringify([clue, aid]) === JSON.stringify([this.clue, this.aid])) return;
    this.clue = clue;
    this.aid = aid;
    this.draw();
  }

  lock(): void {
    this.locked = true;
    this.active = -1;
    this.el.classList.add('locked');
  }

  get connected(): number {
    return Math.max(0, linked(this.puzzle, this.paths));
  }

  get complete(): boolean {
    return linkComplete(this.puzzle, this.paths);
  }

  /** すべての経路を消す */
  reset(): void {
    if (this.locked) return;
    this.paths = this.puzzle.ends.map(() => []);
    this.draw();
    this.opts.onChange?.(0);
  }

  private isDone(i: number): boolean {
    const p = this.paths[i];
    const [a, b] = this.puzzle.ends[i];
    return p.length >= 2 && ((p[0] === a && p[p.length - 1] === b) || (p[0] === b && p[p.length - 1] === a));
  }

  private cellAt(e: PointerEvent): number {
    const r = this.svg.getBoundingClientRect();
    const n = this.puzzle.size;
    const x = Math.floor(((e.clientX - r.left) / r.width) * n);
    const y = Math.floor(((e.clientY - r.top) / r.height) * n);
    return x < 0 || y < 0 || x >= n || y >= n ? -1 : y * n + x;
  }

  private down(e: PointerEvent): void {
    if (this.locked) return;
    const c = this.cellAt(e);
    if (c < 0) return;
    const owner = this.endOf.get(c);
    if (owner !== undefined) {
      // 端点から引き始める（引いてあった経路は消える）。結び終えた経路の終点に触れた時は、そのまま持つ
      const p = this.paths[owner];
      if (!(p.length >= 2 && p[p.length - 1] === c)) this.paths[owner] = [c];
      this.active = owner;
    } else {
      const i = this.paths.findIndex((p) => p.includes(c));
      if (i < 0) return;
      this.paths[i].length = this.paths[i].indexOf(c) + 1;
      this.active = i;
    }
    e.preventDefault();
    try { this.el.setPointerCapture(e.pointerId); } catch { /* 合成イベントでは捕捉できないことがある */ }
    this.draw();
  }

  private dist(a: number, b: number): number {
    const n = this.puzzle.size;
    return Math.abs((a % n) - (b % n)) + Math.abs(Math.floor(a / n) - Math.floor(b / n));
  }

  /** 経路を 1 マス動かす。動けなければ false */
  private step(to: number): boolean {
    const i = this.active;
    const p = this.paths[i];
    if (p.length >= 2 && to === p[p.length - 2]) {
      p.pop();
      return true;
    }
    const at = p.indexOf(to);
    if (at >= 0) {
      p.length = at + 1;
      return true;
    }
    // 結び終えた経路は、戻る以外には伸ばせない
    if (this.isDone(i)) return false;
    const owner = this.endOf.get(to);
    if (owner !== undefined && owner !== i) return false;
    if (this.paths.some((q, k) => k !== i && q.includes(to))) return false;
    p.push(to);
    if (this.isDone(i)) Sound.se('chip');
    return true;
  }

  private move(e: PointerEvent): void {
    if (this.locked || this.active < 0) return;
    const c = this.cellAt(e);
    if (c < 0) return;
    let moved = false;
    // 指が速くてマスを飛ばした時は、近づく向きへ 1 マスずつ進める
    for (let guard = 0; guard < this.puzzle.size * 2; guard++) {
      const p = this.paths[this.active];
      const last = p[p.length - 1];
      if (last === c) break;
      const d = this.dist(last, c);
      const cand = neighbours(this.puzzle.size, last).filter((nb) => this.dist(nb, c) < d);
      let ok = false;
      for (const nb of cand) {
        if (this.step(nb)) { ok = true; break; }
      }
      if (!ok) break;
      moved = true;
    }
    if (moved) {
      e.preventDefault();
      this.draw();
    }
  }

  private up(): void {
    if (this.active < 0) return;
    this.active = -1;
    this.draw();
    this.opts.onChange?.(this.connected);
    if (!this.locked && this.complete) {
      this.el.classList.add('complete');
      this.opts.onComplete?.(this.paths.map((p) => [...p]));
    }
  }

  private draw(): void {
    const n = this.puzzle.size;
    const S = this.S;
    const cx = (c: number) => ((c % n) + 0.5) * S;
    const cy = (c: number) => (Math.floor(c / n) + 0.5) * S;
    const pts = (cells: number[]) => cells.map((c) => `${cx(c)},${cy(c)}`).join(' ');
    const out: string[] = [];
    for (let c = 0; c < n * n; c++) out.push(`<rect class="lb-cell" x="${(c % n) * S + 1}" y="${Math.floor(c / n) * S + 1}" width="${S - 2}" height="${S - 2}" rx="5"/>`);
    this.paths.forEach((p, i) => {
      const col = LINK_COLORS[i % LINK_COLORS.length];
      for (const c of p) out.push(`<rect x="${(c % n) * S + 1}" y="${Math.floor(c / n) * S + 1}" width="${S - 2}" height="${S - 2}" rx="5" fill="${col}" opacity="0.2"/>`);
    });
    if (this.aid && this.aid.cells.length >= 2) {
      out.push(`<polyline class="lb-aid" points="${pts(this.aid.cells)}" stroke="${LINK_COLORS[this.aid.color % LINK_COLORS.length]}" stroke-width="${S * 0.16}" stroke-dasharray="${S * 0.14} ${S * 0.2}"/>`);
    }
    this.paths.forEach((p, i) => {
      if (p.length < 2) return;
      out.push(`<polyline class="lb-path${this.isDone(i) ? ' done' : ''}${i === this.active ? ' active' : ''}" data-color="${i}" points="${pts(p)}" stroke="${LINK_COLORS[i % LINK_COLORS.length]}" stroke-width="${S * 0.34}"/>`);
    });
    if (this.clue) {
      const col = LINK_COLORS[this.clue.color % LINK_COLORS.length];
      for (const c of this.clue.cells) {
        out.push(`<g class="lb-clue"><rect x="${cx(c) - S * 0.3}" y="${cy(c) - S * 0.3}" width="${S * 0.6}" height="${S * 0.6}" rx="4" transform="rotate(45 ${cx(c)} ${cy(c)})" fill="none" stroke="${col}" stroke-width="3"/><text x="${cx(c)}" y="${cy(c)}" font-size="${S * 0.3}" fill="${col}">${LETTERS[this.clue.color]}</text></g>`);
      }
    }
    this.puzzle.ends.forEach((e, i) => {
      const col = LINK_COLORS[i % LINK_COLORS.length];
      for (const c of e) {
        if (this.isDone(i)) out.push(`<circle cx="${cx(c)}" cy="${cy(c)}" r="${S * 0.42}" fill="none" stroke="${col}" stroke-width="2.5" opacity="0.9"/>`);
        out.push(`<circle class="lb-end" data-end="${c}" cx="${cx(c)}" cy="${cy(c)}" r="${S * 0.33}" fill="${col}"/>${TOKEN ? `<image class="lb-token" href="${TOKEN}" x="${cx(c) - S * 0.36}" y="${cy(c) - S * 0.36}" width="${S * 0.72}" height="${S * 0.72}"/>` : ''}<text class="lb-letter" x="${cx(c)}" y="${cy(c)}" font-size="${S * 0.36}">${LETTERS[i]}</text>`);
      }
    });
    this.svg.innerHTML = `<svg viewBox="0 0 ${n * S} ${n * S}" width="${n * S}" height="${n * S}">${out.join('')}</svg>`;
  }
}
