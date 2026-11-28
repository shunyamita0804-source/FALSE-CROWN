/**
 * 入力の抽象化レイヤー。
 * キーボード（PC）とタッチボタン（スマホ）を同じ「論理ボタン」に集約する。
 * UI のモーダルが開いている間はキー入力を UI に渡し、フィールドには伝えない。
 */
import { anyModal, uiKey, type NavKey } from '../ui/dom';
import { TouchTracker } from './TouchTracker';
import { StickTracker, type Vec } from './stick';

export type ButtonName = 'up' | 'down' | 'left' | 'right' | 'a' | 'b' | 'start';

const KEYMAP: Record<ButtonName, string[]> = {
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  a: ['KeyZ', 'Enter', 'Space'],
  b: ['KeyX', 'Escape', 'Backspace'],
  start: ['KeyC', 'Tab'],
};

function nameOf(code: string): ButtonName | null {
  for (const [name, list] of Object.entries(KEYMAP)) if (list.includes(code)) return name as ButtonName;
  return null;
}

function isTyping(): boolean {
  const el = document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
}

class InputStateImpl {
  private readonly keys = new Set<string>();
  private readonly touch = new TouchTracker<ButtonName>();
  /** 指ごとの、押し始めたボタン要素。要素が画面から消えたら解除する */
  private readonly touchEl = new Map<number, HTMLElement>();
  /** 画面左下のアナログスティック（床の移動だけに使う） */
  private readonly stick = new StickTracker();
  private stickEl: HTMLElement | null = null;
  private stickVec: Vec | null = null;
  private shown = new Set<ButtonName>();
  private prev = new Set<ButtonName>();
  private curr = new Set<ButtonName>();
  /** UI を閉じた直後に、押しっぱなしの決定キーがフィールドへ漏れないようにする */
  private swallow = new Set<ButtonName>();

  constructor() {
    window.addEventListener('keydown', (e) => {
      const name = nameOf(e.code);
      if (isTyping()) {
        if (e.code === 'Escape') (document.activeElement as HTMLElement).blur();
        if (e.code === 'Enter') {
          (document.activeElement as HTMLElement).blur();
          e.preventDefault();
        }
        return;
      }
      if (!name) return;
      e.preventDefault();
      if (anyModal()) {
        if (!e.repeat || ['up', 'down', 'left', 'right'].includes(name)) uiKey(name as NavKey);
        this.swallow.add(name);
        return;
      }
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      const name = nameOf(e.code);
      if (name) this.swallow.delete(name);
    });
    window.addEventListener('blur', () => this.reset());
    window.addEventListener('pagehide', () => this.reset());
    document.addEventListener('visibilitychange', () => this.reset());
    this.listenTouch();
  }

  reset(): void {
    this.keys.clear();
    this.releaseTouch();
    this.swallow.clear();
  }

  /** 画面上のボタンをすべて離した状態にする */
  releaseTouch(): void {
    this.touch.clear();
    this.touchEl.clear();
    this.releaseStick();
    this.paint();
  }

  /** スティックを離した状態にする（画面の切り替えや会話の開始で呼ぶ。もう一度触れ直すまで動かない） */
  releaseStick(): void {
    this.stick.clear();
    this.stickEl = null;
    this.stickVec = null;
    this.paintStick();
  }

  /** スティックの土台（円）の中心と半径（画面上の px） */
  private stickGeom(el: HTMLElement): { cx: number; cy: number; r: number } {
    const base = el.querySelector<HTMLElement>('.stick-base') ?? el;
    const b = base.getBoundingClientRect();
    return { cx: b.left + b.width / 2, cy: b.top + b.height / 2, r: b.width / 2 };
  }

  private paintStick(): void {
    document.querySelectorAll<HTMLElement>('[data-stick]').forEach((el) => {
      const on = this.stick.active && el === this.stickEl;
      el.classList.toggle('pressed', on);
      el.classList.toggle('moving', on && !!this.stick.vector);
      const knob = el.querySelector<HTMLElement>('.stick-knob');
      if (!knob) return;
      if (!on) {
        knob.style.transform = '';
        return;
      }
      // 画面は縮小して表示されるので、画面上の px を設計寸法へ戻してから動かす
      const rect = el.getBoundingClientRect();
      const k = rect.width > 0 ? el.offsetWidth / rect.width : 1;
      const o = this.stick.knob;
      knob.style.transform = `translate(${(o.x * k).toFixed(1)}px, ${(o.y * k).toFixed(1)}px)`;
    });
  }

  private outside(e: PointerEvent): boolean {
    return e.clientX < 0 || e.clientY < 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight;
  }

  private keyAt(x: number, y: number): { el: HTMLElement; name: ButtonName } | null {
    const hit = document.elementFromPoint(x, y);
    const el = hit instanceof Element ? hit.closest<HTMLElement>('[data-key]') : null;
    return el ? { el, name: el.dataset.key as ButtonName } : null;
  }

  private paint(): void {
    const held = this.touch.held();
    if (held.size === this.shown.size && [...held].every((k) => this.shown.has(k))) return;
    this.shown = held;
    document.querySelectorAll<HTMLElement>('[data-key]').forEach((el) => el.classList.toggle('pressed', held.has(el.dataset.key as ButtonName)));
  }

  /**
   * 画面上のボタンは document で一括して受ける。
   * ボタンごとに「押した」「離した」を受ける方式は、離した通知が届かないと歩き続けるため使わない。
   */
  private listenTouch(): void {
    const opt = { capture: true, passive: false } as const;
    document.addEventListener('pointerdown', (e) => {
      const st = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-stick]') : null;
      if (st) {
        e.preventDefault();
        if (anyModal()) return;
        const g = this.stickGeom(st);
        if (this.stick.down(e.pointerId, e.clientX - g.cx, e.clientY - g.cy, g.r)) {
          this.stickEl = st;
          this.paintStick();
        }
        return;
      }
      const el = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-key]') : null;
      if (!el) return;
      e.preventDefault();
      // 指を別のボタンへ滑らせたときも move を受け取れるよう、暗黙の捕捉を外す
      try {
        if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      } catch {
        // 捕捉を扱えない環境では無視する
      }
      this.touch.down(e.pointerId, el.dataset.key as ButtonName);
      this.touchEl.set(e.pointerId, el);
      this.paint();
    }, opt);
    document.addEventListener('pointermove', (e) => {
      if (this.stick.tracking(e.pointerId)) {
        // 画面の外まで指が出たら解除する（戻ってきても、触れ直すまで動かない）
        if ((e.pointerType === 'mouse' && e.buttons === 0) || this.outside(e) || !this.stickEl) return this.releaseStick();
        const g = this.stickGeom(this.stickEl);
        this.stick.move(e.pointerId, e.clientX - g.cx, e.clientY - g.cy, g.r);
        this.paintStick();
        return;
      }
      if (!this.touch.tracking(e.pointerId)) return;
      // マウスはボタンを離した状態で動いたら解除する
      if (e.pointerType === 'mouse' && e.buttons === 0) return this.endTouch(e.pointerId);
      this.touch.move(e.pointerId, this.keyAt(e.clientX, e.clientY)?.name ?? null);
      this.paint();
    }, opt);
    const end = (e: PointerEvent) => this.endTouch(e.pointerId);
    for (const type of ['pointerup', 'pointercancel'] as const) {
      document.addEventListener(type, end, opt);
      window.addEventListener(type, end);
    }
    // 画面に指が1本も残っていなければ、何も押されていない
    const sync = (e: TouchEvent) => {
      if (e.touches.length === 0) this.releaseTouch();
    };
    for (const type of ['touchend', 'touchcancel'] as const) {
      document.addEventListener(type, sync, opt);
      window.addEventListener(type, sync);
    }
    document.addEventListener('contextmenu', (e) => {
      if (e.target instanceof Element && e.target.closest('[data-key],[data-stick]')) e.preventDefault();
    });
  }

  private endTouch(id: number): void {
    if (this.stick.tracking(id)) this.releaseStick();
    this.touch.up(id);
    this.touchEl.delete(id);
    this.paint();
  }

  /** 押し始めたボタンが画面から消えた指を解除する */
  private pruneTouch(): void {
    if (this.stickEl && (!this.stickEl.isConnected || this.stickEl.getClientRects().length === 0 || getComputedStyle(this.stickEl).visibility === 'hidden')) this.releaseStick();
    if (this.touchEl.size === 0) return;
    for (const [id, el] of [...this.touchEl]) {
      if (!el.isConnected || el.getClientRects().length === 0) this.endTouch(id);
    }
  }

  /** 毎フレーム、シーンの update 冒頭で呼ぶ */
  update(): void {
    this.prev = this.curr;
    this.curr = new Set<ButtonName>();
    // 会話やメニューが開いたら、画面上のボタンは離したものとして扱う
    if (anyModal()) {
      if (this.touch.size > 0 || this.stick.active) this.releaseTouch();
      this.stickVec = null;
      return;
    }
    this.pruneTouch();
    this.stickVec = this.stick.vector;
    const held = this.touch.held();
    for (const name of Object.keys(KEYMAP) as ButtonName[]) {
      if (this.swallow.has(name)) continue;
      if (held.has(name) || KEYMAP[name].some((k) => this.keys.has(k))) this.curr.add(name);
    }
  }

  isDown(name: ButtonName): boolean {
    return this.curr.has(name);
  }

  justPressed(name: ButtonName): boolean {
    return this.curr.has(name) && !this.prev.has(name);
  }

  /** スティックの入力（無反応領域の内側、触れていない、会話やメニューの間は null） */
  stickVector(): Vec | null {
    return this.stickVec;
  }

  /** スティックに指が触れている（検証用） */
  stickActive(): boolean {
    return this.stick.active;
  }

  /** いま押されている画面上のボタン（検証用） */
  touchHeld(): ButtonName[] {
    return [...this.touch.held()];
  }
}

export const Input = new InputStateImpl();
