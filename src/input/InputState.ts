/**
 * 入力の抽象化レイヤー。
 * キーボード（PC）とタッチボタン（スマホ）を同じ「論理ボタン」に集約する。
 * ゲーム側はこのクラスだけを参照し、デバイスの違いを意識しない。
 */
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

class InputStateImpl {
  private readonly keys = new Set<string>();
  private readonly touch = new Set<ButtonName>();
  private prev = new Set<ButtonName>();
  private curr = new Set<ButtonName>();

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (this.isMapped(e.code)) e.preventDefault();
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.touch.clear();
    });
    this.bindTouchControls();
  }

  /** 毎フレーム、シーンの update 冒頭で呼ぶ */
  update(): void {
    this.prev = this.curr;
    this.curr = new Set<ButtonName>();
    for (const name of Object.keys(KEYMAP) as ButtonName[]) {
      if (this.touch.has(name) || KEYMAP[name].some((k) => this.keys.has(k))) this.curr.add(name);
    }
  }

  isDown(name: ButtonName): boolean {
    return this.curr.has(name);
  }

  justPressed(name: ButtonName): boolean {
    return this.curr.has(name) && !this.prev.has(name);
  }

  private isMapped(code: string): boolean {
    return Object.values(KEYMAP).some((list) => list.includes(code));
  }

  private bindTouchControls(): void {
    const root = document.getElementById('touch-controls');
    if (!root) return;
    root.querySelectorAll<HTMLElement>('[data-key]').forEach((el) => {
      const name = el.dataset.key as ButtonName;
      const on = (e: PointerEvent) => {
        e.preventDefault();
        el.setPointerCapture?.(e.pointerId);
        this.touch.add(name);
        el.classList.add('pressed');
      };
      const off = () => {
        this.touch.delete(name);
        el.classList.remove('pressed');
      };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('lostpointercapture', off);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    });
  }
}

export const Input = new InputStateImpl();
