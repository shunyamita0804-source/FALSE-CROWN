/**
 * スピードカードの卓（P03 と練習で共用）。
 * 手札のカードをタップすると、出せる場札へ重なる。両方の場札に出せる時は、カードを選んでから場札をタップする。
 * どちらにも出せない時だけ、場札の下に「置き換える」が出る。出せるカードは金色の枠で示す（色だけでなく、札が少し持ち上がる）。
 */
import { Sound } from '../audio/audio';
import { t } from '../i18n/i18n';
import { applyAct, canPlayAny, canRefresh, fits, MAX_REFRESH, startTable, stuck, type P03Act, type P03Layout, type P03Table } from '../matches/p03';
import { clear, h } from './dom';

export interface SpeedTableOpts {
  readonly?: boolean;
  /** 説明用：最初から進めておく手順 */
  acts?: P03Act[];
  onAct?: (act: P03Act) => void;
  /** これ以上できることが無くなった時（出し切った時を含む） */
  onEnd?: (acts: P03Act[], cleared: boolean) => void;
}

export class SpeedTable {
  readonly el: HTMLElement;
  readonly acts: P03Act[] = [];
  table: P03Table;
  private sel = -1;
  private locked = false;
  private ended = false;

  constructor(readonly layout: P03Layout, private readonly opts: SpeedTableOpts = {}) {
    this.table = startTable(layout);
    for (const a of opts.acts ?? []) if (applyAct(layout, this.table, a)) this.acts.push(a);
    this.locked = !!opts.readonly;
    this.el = h('div', { class: `sc${opts.readonly ? ' readonly' : ''}` });
    this.draw();
  }

  lock(): void {
    this.locked = true;
    this.el.classList.add('locked');
  }

  private card(v: number, cls = ''): HTMLElement {
    return h('div', { class: `sc-card ${cls}`, 'data-v': String(v) }, h('b', null, String(v)), h('i', null, String(v)));
  }

  private act(a: P03Act): void {
    if (this.locked || !applyAct(this.layout, this.table, a)) return;
    this.acts.push(a);
    this.sel = -1;
    Sound.se(a.k === 'p' ? 'chip' : 'page');
    this.opts.onAct?.(a);
    this.draw();
    if (!this.ended && stuck(this.layout, this.table)) {
      this.ended = true;
      this.lock();
      this.opts.onEnd?.([...this.acts], this.table.hand.length === 0);
    }
  }

  private tapHand(i: number): void {
    if (this.locked) return;
    const v = this.table.hand[i];
    const a = fits(v, this.table.piles[0]);
    const b = fits(v, this.table.piles[1]);
    if (!a && !b) {
      Sound.se('error');
      const el = this.el.querySelectorAll<HTMLElement>('.sc-hand .sc-card')[i];
      el?.classList.remove('shake');
      void el?.offsetWidth;
      el?.classList.add('shake');
      return;
    }
    if (a && b) {
      // 両方に出せる時は、どちらへ置くかを選ぶ
      this.sel = this.sel === i ? -1 : i;
      Sound.se('select');
      this.draw();
      return;
    }
    this.act({ k: 'p', v, pile: a ? 0 : 1 });
  }

  private tapPile(pile: 0 | 1): void {
    if (this.locked) return;
    if (this.sel >= 0) {
      const v = this.table.hand[this.sel];
      if (fits(v, this.table.piles[pile])) this.act({ k: 'p', v, pile });
      return;
    }
    if (canRefresh(this.layout, this.table)) this.act({ k: 'r', pile });
  }

  private draw(): void {
    const l = this.layout;
    const tb = this.table;
    const left = l.deck.length - tb.at;
    const maxRef = Math.min(MAX_REFRESH, l.reserve.length);
    const refLeft = maxRef - tb.refreshes;
    const refresh = canRefresh(l, tb);
    const next = tb.refreshes < maxRef ? l.reserve[tb.refreshes] : null;
    const pile = (i: 0 | 1) => {
      const target = this.sel >= 0 && fits(tb.hand[this.sel], tb.piles[i]);
      const el = h('div', { class: `sc-pile${target ? ' target' : ''}${refresh ? ' refresh' : ''}`, 'data-pile': String(i) }, this.card(tb.piles[i], 'pile'),
        refresh && !this.locked ? h('span', { class: 'sc-swap' }, t('sc.swap')) : target ? h('span', { class: 'sc-swap' }, t('sc.here')) : null);
      el.addEventListener('click', () => this.tapPile(i));
      return el;
    };
    const hand = h('div', { class: 'sc-hand' }, tb.hand.map((v, i) => {
      const ok = fits(v, tb.piles[0]) || fits(v, tb.piles[1]);
      const el = this.card(v, `${ok ? 'ok' : ''}${i === this.sel ? ' sel' : ''}`);
      el.addEventListener('click', () => this.tapHand(i));
      return el;
    }));
    const note = this.locked && !this.opts.readonly
      ? (tb.hand.length === 0 ? t('sc.cleared') : t('sc.stuck'))
      : this.sel >= 0 ? t('sc.choose') : refresh ? t('sc.needSwap') : canPlayAny(tb) ? '' : '';
    clear(this.el);
    this.el.append(
      h('div', { class: 'sc-top' },
        h('div', { class: 'sc-stack' }, h('div', { class: `sc-card back${left ? '' : ' empty'}` }, h('b', null, String(left))), h('small', null, t('sc.deck'))),
        h('div', { class: 'sc-piles' }, pile(0), pile(1)),
        h('div', { class: 'sc-stack' }, next !== null ? this.card(next, 'reserve') : h('div', { class: 'sc-card back empty' }, h('b', null, '0')), h('small', null, t('sc.reserve', { n: refLeft })))),
      h('div', { class: 'sc-note' }, note),
      hand,
    );
    if (!this.opts.readonly && !this.locked) this.el.append(h('div', { class: 'sc-count' }, t('sc.played', { n: tb.played, max: l.deck.length })));
  }
}

