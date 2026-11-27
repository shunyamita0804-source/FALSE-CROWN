/**
 * 1 本の線を指でなぞって引く操作部品（P06 一筆の迷宮と練習問題で共用）。
 * 始点か、線の先からなぞると線が伸びる。来た道を戻ると 1 マスずつ消える。線の途中をタップすると、そこまで戻る。
 * 壁、通ったマス、順番の違うチェック点へは進めない。終点に着くと完成。
 */
import { Sound } from '../audio/audio';
import { neighbours } from '../matches/link';
import { openNeighbours, trace, type Maze } from '../matches/p06';
import { h } from './dom';

export interface PathBoardOpts {
  cell?: number;
  readonly?: boolean;
  path?: number[];
  onChange?: () => void;
  onComplete?: (path: number[]) => void;
}

export class PathBoard {
  readonly el: HTMLElement;
  path: number[];
  private readonly S: number;
  private readonly box: HTMLElement;
  private readonly walls: Set<number>;
  private drawing = false;
  private locked = false;
  /** 補助の表示：次に進むマス、または戻す位置（線の長さ） */
  private hint: { next?: number; cutTo?: number } | null = null;

  constructor(readonly maze: Maze, private readonly opts: PathBoardOpts = {}) {
    const n = maze.size;
    this.S = opts.cell ?? Math.floor(Math.min(96, 500 / n));
    this.walls = new Set(maze.walls);
    this.path = opts.path?.length ? [...opts.path] : [maze.start];
    this.locked = !!opts.readonly;
    this.box = h('div', { class: 'lb-board pb2-board', style: `width:${n * this.S}px;height:${n * this.S}px` });
    this.el = h('div', { class: `lb pb2${opts.readonly ? ' readonly' : ''}` }, this.box);
    if (!opts.readonly) {
      this.el.addEventListener('pointerdown', (e) => this.down(e));
      this.el.addEventListener('pointermove', (e) => this.move(e));
      this.el.addEventListener('pointerup', () => this.up());
      this.el.addEventListener('pointercancel', () => this.up());
    }
    this.draw();
  }

  get checks(): number {
    return trace(this.maze, this.path).checks;
  }

  get complete(): boolean {
    return trace(this.maze, this.path).done;
  }

  lock(): void {
    this.locked = true;
    this.drawing = false;
    this.el.classList.add('locked');
  }

  reset(): void {
    if (this.locked) return;
    this.path = [this.maze.start];
    this.hint = null;
    this.draw();
    this.opts.onChange?.();
  }

  /** 1 マス戻す */
  undo(): void {
    if (this.locked || this.path.length <= 1) return;
    this.path.pop();
    this.hint = null;
    this.draw();
    this.opts.onChange?.();
  }

  setHint(hint: { next?: number; cutTo?: number } | null): void {
    this.hint = hint;
    this.draw();
  }

  private cellAt(e: PointerEvent): number {
    const r = this.box.getBoundingClientRect();
    const n = this.maze.size;
    const x = Math.floor(((e.clientX - r.left) / r.width) * n);
    const y = Math.floor(((e.clientY - r.top) / r.height) * n);
    return x < 0 || y < 0 || x >= n || y >= n ? -1 : y * n + x;
  }

  private down(e: PointerEvent): void {
    if (this.locked) return;
    const c = this.cellAt(e);
    if (c < 0) return;
    const at = this.path.indexOf(c);
    if (at >= 0) {
      // 線の上に触れた：そこまで戻して、そこから引き直す
      if (at < this.path.length - 1) { this.path.length = at + 1; this.hint = null; }
      this.drawing = true;
    } else if (this.step(c)) this.drawing = true;
    else return;
    e.preventDefault();
    try { this.el.setPointerCapture(e.pointerId); } catch { /* 合成イベントでは捕捉できないことがある */ }
    this.draw();
    this.opts.onChange?.();
  }

  /** 線を 1 マス動かす。動けなければ false */
  private step(to: number): boolean {
    const p = this.path;
    if (p.length >= 2 && to === p[p.length - 2]) {
      p.pop();
      this.hint = null;
      return true;
    }
    const at = p.indexOf(to);
    if (at >= 0) {
      p.length = at + 1;
      this.hint = null;
      return true;
    }
    const last = p[p.length - 1];
    if (!openNeighbours(this.maze, last, this.walls).includes(to)) return false;
    const next = [...p, to];
    if (trace(this.maze, next).valid !== next.length) return false;
    p.push(to);
    if (this.hint?.next === to) this.hint = null;
    if (this.maze.checks.includes(to)) Sound.se('chip');
    return true;
  }

  private dist(a: number, b: number): number {
    const n = this.maze.size;
    return Math.abs((a % n) - (b % n)) + Math.abs(Math.floor(a / n) - Math.floor(b / n));
  }

  private move(e: PointerEvent): void {
    if (this.locked || !this.drawing) return;
    const c = this.cellAt(e);
    if (c < 0) return;
    let moved = false;
    for (let guard = 0; guard < this.maze.size * 2; guard++) {
      const last = this.path[this.path.length - 1];
      if (last === c) break;
      const d = this.dist(last, c);
      const cand = neighbours(this.maze.size, last).filter((nb) => this.dist(nb, c) < d);
      let ok = false;
      for (const nb of cand) if (this.step(nb)) { ok = true; break; }
      if (!ok) break;
      moved = true;
      if (this.complete) break;
    }
    if (moved) {
      e.preventDefault();
      this.draw();
      this.opts.onChange?.();
      if (this.complete) this.finish();
    }
  }

  private up(): void {
    if (!this.drawing) return;
    this.drawing = false;
    this.draw();
    if (this.complete) this.finish();
  }

  private finish(): void {
    if (this.locked) return;
    this.lock();
    this.el.classList.add('complete');
    this.draw();
    this.opts.onComplete?.([...this.path]);
  }

  private draw(): void {
    const m = this.maze;
    const n = m.size;
    const S = this.S;
    const cx = (c: number) => ((c % n) + 0.5) * S;
    const cy = (c: number) => (Math.floor(c / n) + 0.5) * S;
    const out: string[] = [];
    const onPath = new Set(this.path);
    const passed = trace(m, this.path).checks;
    for (let c = 0; c < n * n; c++) out.push(`<rect class="lb-cell${onPath.has(c) ? ' on' : ''}" x="${(c % n) * S + 1}" y="${Math.floor(c / n) * S + 1}" width="${S - 2}" height="${S - 2}" rx="5"/>`);
    if (this.hint?.cutTo !== undefined) {
      const bad = this.path.slice(this.hint.cutTo);
      for (const c of bad) out.push(`<rect class="pb2-bad" x="${(c % n) * S + 3}" y="${Math.floor(c / n) * S + 3}" width="${S - 6}" height="${S - 6}" rx="5"/>`);
    }
    if (this.path.length >= 2) out.push(`<polyline class="pb2-line${this.complete ? ' done' : ''}" points="${this.path.map((c) => `${cx(c)},${cy(c)}`).join(' ')}" stroke-width="${S * 0.3}"/>`);
    const head = this.path[this.path.length - 1];
    if (!this.complete) out.push(`<circle class="pb2-head" cx="${cx(head)}" cy="${cy(head)}" r="${S * 0.2}"/>`);
    if (this.hint?.next !== undefined) out.push(`<circle class="pb2-hint" cx="${cx(this.hint.next)}" cy="${cy(this.hint.next)}" r="${S * 0.24}"/><line class="pb2-hintline" x1="${cx(head)}" y1="${cy(head)}" x2="${cx(this.hint.next)}" y2="${cy(this.hint.next)}" stroke-width="${S * 0.12}"/>`);
    // 壁
    for (const w of m.walls) {
      const a = Math.floor(w / 100);
      const b = w % 100;
      if (b - a === 1) out.push(`<line class="pb2-wall" x1="${((a % n) + 1) * S}" y1="${Math.floor(a / n) * S + 2}" x2="${((a % n) + 1) * S}" y2="${(Math.floor(a / n) + 1) * S - 2}"/>`);
      else out.push(`<line class="pb2-wall" x1="${(a % n) * S + 2}" y1="${(Math.floor(a / n) + 1) * S}" x2="${((a % n) + 1) * S - 2}" y2="${(Math.floor(a / n) + 1) * S}"/>`);
    }
    const mark = (c: number, label: string, cls: string) => out.push(`<g class="pb2-mark ${cls}"><circle cx="${cx(c)}" cy="${cy(c)}" r="${S * 0.33}"/><text x="${cx(c)}" y="${cy(c)}" font-size="${S * 0.36}">${label}</text></g>`);
    mark(m.start, 'S', 'start');
    mark(m.goal, 'G', `goal${passed === m.checks.length ? ' open' : ''}`);
    m.checks.forEach((c, i) => mark(c, String(i + 1), `check${i < passed ? ' passed' : i === passed ? ' next' : ''}`));
    this.box.innerHTML = `<svg viewBox="0 0 ${n * S} ${n * S}" width="${n * S}" height="${n * S}">${out.join('')}</svg>`;
  }
}
