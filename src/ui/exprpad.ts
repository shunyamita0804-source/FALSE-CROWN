/**
 * 式を組む操作部品（M05 ナンバー・リレーと練習問題で共用）。
 * 数字カードと記号を順にタップして式を作る。次に置けない物は押せないので、書き間違いの式にはならない。
 * 閉じていない括弧は、計算と提出の時に自動で閉じる。
 */
import { Sound } from '../audio/audio';
import { t } from '../i18n/i18n';
import { CARD_MAX, CORRECT, PER_CARD, cardsUsed, evalToks, type Tok } from '../matches/m05';
import { append, clear, h } from './dom';

const SYM: Record<string, string> = { '+': '＋', '-': '−', '*': '×', '/': '÷', '(': '（', ')': '）' };

export interface ExprPadOpts {
  /** 追加カードの番号（色を変えて示す） */
  extraIndex?: number;
  onSubmit: (toks: Tok[]) => void;
  onChange?: () => void;
  /** 残り時間による加点の見込み（表示用） */
  timeBonus?: () => number;
}

/** 式を、数字と記号の並んだ表示にする */
export function exprEl(toks: Tok[], cards: number[], cls = ''): HTMLElement {
  return h('span', { class: `xp-expr ${cls}` }, toks.map((x) => (typeof x === 'number' ? h('b', { class: 'n' }, String(cards[x])) : h('i', { class: 'o' }, SYM[x]))));
}

export class ExprPad {
  readonly el: HTMLElement;
  toks: Tok[] = [];
  private readonly line: HTMLElement;
  private readonly cardsEl: HTMLElement;
  private readonly opsEl: HTMLElement;
  private readonly foot: HTMLElement;
  private sent = false;

  constructor(private readonly cards: number[], private readonly target: number, private readonly opts: ExprPadOpts) {
    this.line = h('div', { class: 'xp-line' });
    this.cardsEl = h('div', { class: 'xp-cards' });
    this.opsEl = h('div', { class: 'xp-ops' });
    this.foot = h('div', { class: 'xp-foot' });
    this.el = h('div', { class: 'xp' },
      h('div', { class: 'xp-top' }, h('div', { class: 'xp-target' }, h('small', null, t('xp.target')), h('b', null, String(target))), this.line),
      this.cardsEl, this.opsEl, this.foot);
    this.el.addEventListener('click', (e) => this.tap(e));
    this.draw();
  }

  /** 閉じていない括弧を閉じた式（提出と計算に使う） */
  closed(): Tok[] {
    let depth = 0;
    for (const x of this.toks) depth += x === '(' ? 1 : x === ')' ? -1 : 0;
    return [...this.toks, ...new Array<Tok>(Math.max(0, depth)).fill(')')];
  }

  get correct(): boolean {
    const v = evalToks(this.closed(), this.cards);
    return !!v && v.d === 1 && v.n === this.target;
  }

  private tap(e: Event): void {
    if (this.sent) return;
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-k]');
    if (!b || b.disabled) return;
    const k = b.dataset.k!;
    if (k === 'ok') {
      if (!this.correct) return;
      this.sent = true;
      Sound.se('result');
      this.opts.onSubmit(this.closed());
      this.draw();
      return;
    }
    if (k === 'back') this.toks.pop();
    else if (k === 'clear') this.toks = [];
    else if (k.startsWith('c')) this.toks.push(Number(k.slice(1)));
    else this.toks.push(k as Tok);
    Sound.se(k === 'back' || k === 'clear' ? 'back' : 'select');
    this.draw();
    this.opts.onChange?.();
  }

  draw(): void {
    const last = this.toks[this.toks.length - 1];
    const operand = last === undefined || (typeof last !== 'number' && last !== ')');
    let depth = 0;
    for (const x of this.toks) depth += x === '(' ? 1 : x === ')' ? -1 : 0;
    const used = new Set(this.toks.filter((x): x is number => typeof x === 'number'));
    const v = evalToks(this.closed(), this.cards);
    const ok = this.correct;
    clear(this.line);
    const ghost = new Array<Tok>(Math.max(0, depth)).fill(')');
    append(this.line, [
      this.toks.length ? exprEl(this.toks, this.cards) : h('span', { class: 'xp-empty' }, t('xp.empty')),
      ghost.length ? h('span', { class: 'xp-expr ghost' }, ghost.map(() => h('i', { class: 'o' }, '）'))) : null,
      h('span', { class: `xp-val${ok ? ' ok' : ''}` }, v ? `＝ ${v.d === 1 ? v.n : `${v.n}/${v.d}`}` : this.toks.length ? '＝ …' : '')]);
    clear(this.cardsEl);
    this.cards.forEach((c, i) => this.cardsEl.append(h('button', { class: `xp-card${used.has(i) ? ' used' : ''}${i === this.opts.extraIndex ? ' extra' : ''}`, type: 'button', 'data-k': `c${i}`, disabled: this.sent || used.has(i) || !operand }, String(c))));
    clear(this.opsEl);
    const op = (k: string, label: string, enabled: boolean, cls = '') => h('button', { class: `xp-op ${cls}`, type: 'button', 'data-k': k, disabled: this.sent || !enabled }, label);
    this.opsEl.append(
      op('+', '＋', !operand), op('-', '−', !operand), op('*', '×', !operand), op('/', '÷', !operand),
      op('(', '（', operand, 'par'), op(')', '）', !operand && depth > 0, 'par'),
      op('back', t('xp.back'), this.toks.length > 0, 'wide'), op('clear', t('xp.clear'), this.toks.length > 0, 'wide'));
    clear(this.foot);
    const n = cardsUsed(this.toks);
    const tb = this.opts.timeBonus?.();
    this.foot.append(
      h('span', { class: 'xp-pts' }, this.sent ? t('xp.sent') : ok ? t(tb === undefined ? 'xp.ptsNoTime' : 'xp.pts', { c: CORRECT, k: Math.min(CARD_MAX, n * PER_CARD), n, tb: tb ?? 0 }) : t('xp.hint')),
      h('button', { class: 'btn primary xp-ok', type: 'button', 'data-k': 'ok', disabled: this.sent || !ok }, t('xp.ok')));
  }
}
