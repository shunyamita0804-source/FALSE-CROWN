/**
 * 記憶の競技の操作部品（M02 フラッグ・フラッシュ、P02 瞬間記憶、練習問題で共用）。
 * 盤面を表示時間だけ見せて隠し、問題を 1 問ずつ出す。位置の問題は盤面のマスを、図柄の問題は候補を直接タップして答える。
 * 時間は競技の時計（opts.elapsed）で測るので、ルール表示などで時計が止まっている間は進まない。
 */
import { Sound } from '../audio/audio';
import { FLAG_BY_ID, flagSvg } from '../data/flags';
import { t } from '../i18n/i18n';
import { answerOf, type Item, type MemAnswer, type MemBoard, type MemQ, type MemSet } from '../matches/memory';
import { clear, h } from './dom';

const SYM_COLOR: Record<string, string> = { red: '#e5484d', blue: '#4c9aff', green: '#3fbf6f', yellow: '#f2c230' };
export const SHAPE_NAME: Record<string, string> = { circle: '丸', triangle: '三角', square: '四角', star: '星', diamond: 'ひし形' };
export const COLOR_NAME: Record<string, string> = { red: '赤', blue: '青', green: '緑', yellow: '黄' };

function shapePath(shape: string): string {
  if (shape === 'circle') return '<circle cx="20" cy="20" r="15"/>';
  if (shape === 'triangle') return '<polygon points="20,4 37,34 3,34"/>';
  if (shape === 'square') return '<rect x="6" y="6" width="28" height="28" rx="2"/>';
  if (shape === 'diamond') return '<polygon points="20,2 36,20 20,38 4,20"/>';
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? 18 : 7.6;
    pts.push(`${(20 + Math.cos(a) * r).toFixed(1)},${(21.5 + Math.sin(a) * r).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(' ')}"/>`;
}

/**
 * 図柄の SVG。色ごとに塗り方も変える（赤＝塗りつぶし、青＝輪郭だけ、緑＝横じま、黄＝中央に点）。
 * 色の見分けが難しくても、形と塗り方で区別できる。
 */
export function symbolSvg(item: Item): string {
  const [shape, color] = item.split(':');
  const c = SYM_COLOR[color] ?? '#ccc';
  const body = shapePath(shape);
  let inner = '';
  if (color === 'red') inner = `<g fill="${c}" stroke="${c}" stroke-width="1.5" stroke-linejoin="round">${body}</g>`;
  else if (color === 'blue') inner = `<g fill="rgba(76,154,255,0.12)" stroke="${c}" stroke-width="4" stroke-linejoin="round">${body}</g>`;
  else if (color === 'green') inner = `<defs><pattern id="mq-st" width="40" height="7" patternUnits="userSpaceOnUse"><rect width="40" height="3.6" fill="${c}"/></pattern></defs><g fill="url(#mq-st)" stroke="${c}" stroke-width="2.2" stroke-linejoin="round">${body}</g>`;
  else inner = `<g fill="${c}" stroke="${c}" stroke-width="1.5" stroke-linejoin="round">${body}</g><circle cx="20" cy="${shape === 'triangle' ? 24 : shape === 'star' ? 21.5 : 20}" r="4.6" fill="#1a1f33"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" class="sym-svg" aria-label="${COLOR_NAME[color]}の${SHAPE_NAME[shape]}">${inner}</svg>`;
}

export const isFlag = (item: Item) => !item.includes(':');

/** 図柄 1 つ（国旗は国名付き） */
export function itemEl(item: Item, cls = ''): HTMLElement {
  const el = h('span', { class: `mq-item ${isFlag(item) ? 'flag' : 'sym'} ${cls}` });
  if (isFlag(item)) {
    const pic = h('span', { class: 'mq-pic' });
    pic.innerHTML = flagSvg(item);
    el.append(pic, h('span', { class: `mq-name${(FLAG_BY_ID[item]?.name.length ?? 0) >= 7 ? ' long' : ''}` }, FLAG_BY_ID[item]?.name ?? item));
  } else el.innerHTML = symbolSvg(item);
  return el;
}

/** 盤面の図（結果の振り返りと説明用）。marks でマスに印を付ける */
export function boardFigure(board: MemBoard, opts: { cell?: number; hidden?: boolean; marks?: Record<number, { cls: string; label?: string }> } = {}): HTMLElement {
  const flag = board.cells.some((c) => c != null && isFlag(c));
  const el = h('div', { class: `mq-board fig ${flag ? 'flag' : 'sym'}`, style: `grid-template-columns:repeat(${board.w},1fr);--mq-cell:${opts.cell ?? (flag ? 96 : 64)}px` });
  board.cells.forEach((c, i) => {
    el.append(h('span', { class: `mq-cell${c == null ? ' empty' : ''}${opts.hidden ? ' back' : ''} ${opts.marks?.[i]?.cls ?? ''}` }, c != null && !opts.hidden ? itemEl(c) : null, opts.marks?.[i]?.label ? h('b', { class: 'mq-no' }, opts.marks[i].label) : null));
  });
  return el;
}

export interface MemQuizOpts {
  /** 競技の時計での経過時間（ミリ秒） */
  elapsed: () => number;
  onDone: (a: MemAnswer) => void;
  /** 盤面 1 マスの大きさ（論理ピクセル） */
  cell?: number;
}

export class MemQuiz {
  readonly el: HTMLElement;
  private phase: 'show' | 'ask' | 'fb' | 'done' = 'show';
  private q = -1;
  private qStart = 0;
  private readonly picks: number[];
  private readonly ms: number[];
  private readonly boardEl: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly timer: ReturnType<typeof setInterval>;
  private wasConnected = false;
  private lastSec = -1;

  constructor(private readonly set: MemSet, private readonly opts: MemQuizOpts) {
    this.picks = set.questions.map(() => -1);
    this.ms = set.questions.map(() => set.qMs);
    const flag = set.board.cells.some((c) => c != null && isFlag(c));
    const cell = opts.cell ?? (flag ? 150 : set.board.w >= 5 ? 96 : 112);
    this.boardEl = h('div', { class: `mq-board ${flag ? 'flag' : 'sym'}`, style: `grid-template-columns:repeat(${set.board.w},1fr);--mq-cell:${cell}px` });
    this.bar = h('div', { class: 'mq-bar' }, h('i'));
    this.panel = h('div', { class: 'mq-panel' });
    this.el = h('div', { class: `mq ${flag ? 'flag' : 'sym'}` }, h('div', { class: 'mq-left' }, this.bar, h('div', { class: 'mq-frame' }, this.boardEl)), this.panel);
    this.el.addEventListener('pointerdown', (e) => this.tap(e));
    if (opts.elapsed() >= set.showMs) this.next();
    else this.drawShow();
    this.timer = setInterval(() => this.tick(), 100);
  }

  /** 途中までの回答（時間切れの時に提出する） */
  current(): MemAnswer {
    return { picks: [...this.picks], ms: [...this.ms] };
  }

  get finished(): boolean {
    return this.phase === 'done';
  }

  private setBar(rate: number, low = false): void {
    const i = this.bar.firstElementChild as HTMLElement;
    i.style.width = `${Math.max(0, Math.min(1, rate)) * 100}%`;
    this.bar.classList.toggle('low', low);
  }

  private drawBoard(mode: 'open' | 'back', ask?: MemQ): void {
    clear(this.boardEl);
    this.set.board.cells.forEach((c, i) => {
      const asked = ask?.kind === 'item' && ask.cell === i;
      const tappable = mode === 'back' && ask?.kind === 'place';
      this.boardEl.append(h('span', { class: `mq-cell${mode === 'back' ? ' back' : c == null ? ' empty' : ''}${asked ? ' asked' : ''}${tappable ? ' tap' : ''}`, 'data-cell': String(i) },
        mode === 'open' && c != null ? itemEl(c) : asked ? h('b', { class: 'mq-q' }, '？') : null));
    });
    this.boardEl.classList.toggle('dim', mode === 'back' && ask?.kind === 'present');
  }

  private drawShow(): void {
    this.phase = 'show';
    this.drawBoard('open');
    clear(this.panel);
    this.panel.append(h('div', { class: 'mq-prompt' }, t('mq.memorize')), h('div', { class: 'mq-count' }, ''), h('div', { class: 'mq-sub' }, t('mq.memorizeSub', { n: this.set.questions.length })));
  }

  private next(): void {
    this.q += 1;
    if (this.q >= this.set.questions.length) {
      this.phase = 'done';
      clearInterval(this.timer);
      this.drawBoard('back');
      clear(this.panel);
      this.panel.append(h('div', { class: 'mq-prompt' }, t('mq.sent')));
      this.setBar(0);
      this.opts.onDone(this.current());
      return;
    }
    this.phase = 'ask';
    this.qStart = this.opts.elapsed();
    const q = this.set.questions[this.q];
    this.drawBoard('back', q);
    clear(this.panel);
    const dots = h('div', { class: 'mq-dots' }, this.set.questions.map((_, i) => h('i', { class: i < this.q ? (this.picks[i] >= 0 && this.picks[i] === answerOf(this.set.board, this.set.questions[i]) ? 'ok' : 'ng') : i === this.q ? 'on' : '' })));
    if (q.kind === 'place') this.panel.append(dots, h('div', { class: 'mq-prompt' }, t(isFlag(q.item) ? 'mq.askPlaceFlag' : 'mq.askPlace')), h('div', { class: 'mq-target' }, itemEl(q.item, 'big')), h('div', { class: 'mq-sub' }, t('mq.tapCell')));
    else {
      const flag = isFlag(q.options[0]);
      this.panel.append(dots, h('div', { class: 'mq-prompt' }, t(q.kind === 'item' ? (flag ? 'mq.askItemFlag' : 'mq.askItem') : 'mq.askPresent')),
        h('div', { class: 'mq-opts' }, q.options.map((o, i) => h('button', { class: 'mq-opt', type: 'button', 'data-opt': String(i) }, itemEl(o)))));
    }
    this.setBar(1);
  }

  private answer(pick: number, target?: HTMLElement): void {
    if (this.phase !== 'ask') return;
    const q = this.set.questions[this.q];
    const used = Math.min(this.set.qMs, Math.max(0, this.opts.elapsed() - this.qStart));
    this.picks[this.q] = pick;
    this.ms[this.q] = used;
    const ok = pick >= 0 && pick === answerOf(this.set.board, q);
    this.phase = 'fb';
    Sound.se(ok ? 'chip' : 'error');
    target?.classList.add(ok ? 'ok' : 'ng');
    this.panel.append(h('div', { class: `mq-fb ${ok ? 'ok' : 'ng'}` }, pick < 0 ? t('mq.timeout') : ok ? '○' : '✕'));
    setTimeout(() => this.next(), pick < 0 ? 700 : 480);
  }

  private tap(e: PointerEvent): void {
    if (this.phase !== 'ask') return;
    const q = this.set.questions[this.q];
    const target = e.target as HTMLElement;
    if (q.kind === 'place') {
      const cell = target.closest<HTMLElement>('[data-cell]');
      if (cell) this.answer(Number(cell.dataset.cell), cell);
    } else {
      const opt = target.closest<HTMLElement>('[data-opt]');
      if (opt) this.answer(Number(opt.dataset.opt), opt);
    }
  }

  private tick(): void {
    if (this.el.isConnected) this.wasConnected = true;
    else if (this.wasConnected) {
      clearInterval(this.timer);
      return;
    }
    const el = this.opts.elapsed();
    if (this.phase === 'show') {
      const left = this.set.showMs - el;
      if (left <= 0) {
        Sound.se('select');
        this.next();
        return;
      }
      this.setBar(left / this.set.showMs, left < 2000);
      const sec = Math.ceil(left / 1000);
      const cnt = this.panel.querySelector('.mq-count');
      if (cnt) cnt.textContent = String(sec);
      if (sec !== this.lastSec && sec <= 3 && this.lastSec !== -1) Sound.se('tick');
      this.lastSec = sec;
    } else if (this.phase === 'ask') {
      const left = this.set.qMs - (el - this.qStart);
      if (left <= 0) this.answer(-1);
      else this.setBar(left / this.set.qMs, left < 2500);
    }
  }
}
