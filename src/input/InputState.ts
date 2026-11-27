/**
 * 入力の抽象化レイヤー。
 * キーボード（PC）とタッチボタン（スマホ）を同じ「論理ボタン」に集約する。
 * UI のモーダルが開いている間はキー入力を UI に渡し、フィールドには伝えない。
 */
import { anyModal, uiKey, type NavKey } from '../ui/dom';

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
  private readonly touch = new Set<ButtonName>();
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
    document.addEventListener('visibilitychange', () => this.reset());
  }

  reset(): void {
    this.keys.clear();
    this.touch.clear();
    this.swallow.clear();
  }

  /** 毎フレーム、シーンの update 冒頭で呼ぶ */
  update(): void {
    this.prev = this.curr;
    this.curr = new Set<ButtonName>();
    if (anyModal()) return;
    for (const name of Object.keys(KEYMAP) as ButtonName[]) {
      if (this.swallow.has(name)) continue;
      if (this.touch.has(name) || KEYMAP[name].some((k) => this.keys.has(k))) this.curr.add(name);
    }
  }

  isDown(name: ButtonName): boolean {
    return this.curr.has(name);
  }

  justPressed(name: ButtonName): boolean {
    return this.curr.has(name) && !this.prev.has(name);
  }

  /** data-key を持つ要素をタッチボタンとして登録する */
  bindTouch(root: HTMLElement): void {
    root.querySelectorAll<HTMLElement>('[data-key]').forEach((el) => {
      const name = el.dataset.key as ButtonName;
      const on = (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          // ポインターを捕捉できない環境では無視する
        }
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
