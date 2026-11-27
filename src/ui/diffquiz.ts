/**
 * 変化を見つける競技の操作部品（P04 消えた図形と練習問題で共用）。
 * 最初の盤面を表示時間だけ見せ、変わった後の盤面に切り替える。変わったと思うマスを直接タップして選び、確定する。
 * 時間は競技の時計（opts.elapsed）で測るので、ルール表示などで時計が止まっている間は進まない。
 */
import { Sound } from '../audio/audio';
import { t } from '../i18n/i18n';
import { changedCells, SIZE, type DiffSet, type Fig } from '../matches/p04';
import { clear, h } from './dom';

const FIG_COLOR: Record<string, string> = { arrow: '#e6b84f', drop: '#5fb8e6', half: '#e67a6a', el: '#7ed48a', tee: '#c59be8' };
export const FIG_NAME: Record<string, string> = { arrow: '矢印', drop: 'しずく', half: '半円', el: 'かぎ', tee: '丁字' };
const DIR_NAME = ['上', '右', '下', '左'];

function figPath(shape: string): string {
  if (shape === 'arrow') return '<polygon points="20,3 35,20 26,20 26,37 14,37 14,20 5,20"/>';
  if (shape === 'drop') return '<path d="M20 3 C27 13 33 19 33 25 A13 13 0 0 1 7 25 C7 19 13 13 20 3 Z"/>';
  if (shape === 'half') return '<path d="M4 24 A16 16 0 0 1 36 24 Z"/>';
  if (shape === 'el') return '<polygon points="8,4 19,4 19,25 33,25 33,36 8,36"/>';
  return '<polygon points="4,6 36,6 36,17 26,17 26,36 14,36 14,17 4,17"/>';
}

/** 図柄の SVG。形ごとに色も変える。向きは時計回りに 90 度ずつ */
export function figSvg(f: string): string {
  const [shape, rot] = f.split(':');
  const c = FIG_COLOR[shape] ?? '#ccc';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" class="dq-svg" aria-label="${FIG_NAME[shape]}（${DIR_NAME[Number(rot)]}向き）"><g transform="rotate(${Number(rot) * 90} 20 20)" fill="${c}" stroke="${c}" stroke-width="1.5" stroke-linejoin="round">${figPath(shape)}</g></svg>`;
}

export function figEl(f: string): HTMLElement {
  const el = h('span', { class: 'dq-fig' });
  el.innerHTML = figSvg(f);
  return el;
}

/** 盤面の図（振り返りと説明用）。marks でマスに印を付ける */
export function diffFigure(cells: Fig[], opts: { cell?: number; marks?: Record<number, string> } = {}): HTMLElement {
  const el = h('div', { class: 'dq-board fig', style: `--dq-cell:${opts.cell ?? 52}px` });
  cells.forEach((c, i) => el.append(h('span', { class: `dq-cell${c == null ? ' empty' : ''} ${opts.marks?.[i] ?? ''}` }, c != null ? figEl(c) : null)));
  return el;
}

export interface DiffQuizOpts {
  elapsed: () => number;
  showMs: number;
  answerMs: number;
  onDone: (cells: number[], ms: number) => void;
  cell?: number;
}

export class DiffQuiz {
  readonly el: HTMLElement;
  private phase: 'show' | 'pick' | 'done' = 'show';
  private readonly picked = new Set<number>();
  private readonly boardEl: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly timer: ReturnType<typeof setInterval>;
  private wasConnected = false;
  private lastSec = -1;

  constructor(private readonly set: DiffSet, private readonly opts: DiffQuizOpts) {
    this.boardEl = h('div', { class: 'dq-board', style: `--dq-cell:${opts.cell ?? 96}px` });
    this.bar = h('div', { class: 'mq-bar' }, h('i'));
    this.panel = h('div', { class: 'mq-panel dq-panel' });
    this.el = h('div', { class: 'mq dq' }, h('div', { class: 'mq-left' }, this.bar, h('div', { class: 'mq-frame' }, this.boardEl)), this.panel);
    this.boardEl.addEventListener('click', (e) => this.tap(e));
    if (opts.elapsed() >= opts.showMs) this.startPick();
    else this.drawShow();
    this.timer = setInterval(() => this.tick(), 100);
  }

  /** いま選んでいるマスと、使った時間（時間切れの時に提出する） */
  current(): { cells: number[]; ms: number } {
    return { cells: [...this.picked], ms: Math.min(this.opts.answerMs, Math.max(0, this.opts.elapsed() - this.opts.showMs)) };
  }

  private setBar(rate: number, low = false): void {
    const i = this.bar.firstElementChild as HTMLElement;
    i.style.width = `${Math.max(0, Math.min(1, rate)) * 100}%`;
    this.bar.classList.toggle('low', low);
  }

  private drawBoard(cells: Fig[], tappable: boolean): void {
    clear(this.boardEl);
    cells.forEach((c, i) => this.boardEl.append(h('button', { class: `dq-cell${c == null ? ' empty' : ''}${tappable ? ' tap' : ''}${this.picked.has(i) ? ' sel' : ''}`, type: 'button', 'data-cell': String(i), disabled: !tappable }, c != null ? figEl(c) : null)));
  }

  private drawShow(): void {
    this.phase = 'show';
    this.drawBoard(this.set.a, false);
    clear(this.panel);
    this.panel.append(h('div', { class: 'mq-prompt' }, t('dq.memorize')), h('div', { class: 'mq-count' }, ''), h('div', { class: 'mq-sub' }, t('dq.memorizeSub', { k: this.set.k })));
  }

  private startPick(): void {
    this.phase = 'pick';
    this.el.classList.add('flash');
    setTimeout(() => this.el.classList.remove('flash'), 260);
    this.drawBoard(this.set.b, true);
    this.drawPanel();
  }

  private drawPanel(): void {
    clear(this.panel);
    const n = this.picked.size;
    const ok = h('button', { class: 'btn primary dq-ok', type: 'button' }, t('dq.confirm', { n, k: this.set.k }));
    ok.addEventListener('click', () => this.finish());
    this.panel.append(
      h('div', { class: 'mq-prompt' }, t('dq.ask', { k: this.set.k })),
      h('div', { class: 'dq-pips' }, Array.from({ length: this.set.k }, (_, i) => h('i', { class: i < n ? 'on' : '' }))),
      h('div', { class: 'mq-sub' }, t(n >= this.set.k ? 'dq.full' : 'dq.tap')),
      h('div', { class: 'mq-sub small' }, t('dq.note')),
      ok);
  }

  private finish(): void {
    if (this.phase !== 'pick') return;
    const cur = this.current();
    this.phase = 'done';
    clearInterval(this.timer);
    this.boardEl.querySelectorAll<HTMLButtonElement>('button').forEach((b) => { b.disabled = true; });
    clear(this.panel);
    this.panel.append(h('div', { class: 'mq-prompt' }, t('mq.sent')));
    this.setBar(0);
    this.opts.onDone(cur.cells, cur.ms);
  }

  private tap(e: Event): void {
    if (this.phase !== 'pick') return;
    const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-cell]');
    if (!cell) return;
    const c = Number(cell.dataset.cell);
    if (this.picked.has(c)) this.picked.delete(c);
    else if (this.picked.size < this.set.k) this.picked.add(c);
    else {
      Sound.se('error');
      return;
    }
    Sound.se('select');
    cell.classList.toggle('sel', this.picked.has(c));
    this.drawPanel();
  }

  private tick(): void {
    if (this.el.isConnected) this.wasConnected = true;
    else if (this.wasConnected) {
      clearInterval(this.timer);
      return;
    }
    const el = this.opts.elapsed();
    if (this.phase === 'show') {
      const left = this.opts.showMs - el;
      if (left <= 0) {
        Sound.se('select');
        this.startPick();
        return;
      }
      this.setBar(left / this.opts.showMs, left < 2000);
      const sec = Math.ceil(left / 1000);
      const cnt = this.panel.querySelector('.mq-count');
      if (cnt) cnt.textContent = String(sec);
      if (sec !== this.lastSec && sec <= 3 && this.lastSec !== -1) Sound.se('tick');
      this.lastSec = sec;
    } else if (this.phase === 'pick') {
      const left = this.opts.answerMs - (el - this.opts.showMs);
      if (left <= 0) this.finish();
      else this.setBar(left / this.opts.answerMs, left < 5000);
    }
  }
}

/** 振り返り：変わる前と後を並べ、変わったマスと自分の選択を示す */
export function diffReview(set: DiffSet, mine: number[] | undefined, cell = 44): HTMLElement {
  const changed = new Set(changedCells(set));
  const marks: Record<number, string> = {};
  for (let i = 0; i < SIZE * SIZE; i++) {
    const picked = mine?.includes(i);
    if (changed.has(i)) marks[i] = mine ? (picked ? 'ok' : 'missed') : 'missed';
    else if (picked) marks[i] = 'ng';
  }
  const before: Record<number, string> = {};
  for (const c of changed) before[c] = 'was';
  return h('div', { class: 'dq-review' },
    h('div', { class: 'dq-rv' }, h('small', { class: 'dim' }, t('dq.before')), diffFigure(set.a, { cell, marks: before })),
    h('span', { class: 'dq-arrow' }, '▶'),
    h('div', { class: 'dq-rv' }, h('small', { class: 'dim' }, t('dq.after')), diffFigure(set.b, { cell, marks })),
    h('div', { class: 'dq-legend small' }, h('span', { class: 'ok' }, t('dq.lgOk')), h('span', { class: 'missed' }, t('dq.lgMissed')), h('span', { class: 'ng' }, t('dq.lgNg'))));
}
