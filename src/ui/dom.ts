/**
 * DOM ベースの UI レイヤー。フィールド（Phaser キャンバス）とは完全に分離し、
 * 文字・数値・盤面はすべてここでプログラム描画する（高解像度のまま表示される）。
 *
 * 論理画面は高さ 720 を基準とし、横幅は端末の縦横比に合わせて伸縮する（1280×720 が基準）。
 */
export type Child = Node | string | number | null | undefined | false | Child[];

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: (Partial<Record<string, unknown>> & { class?: string; onclick?: (e: MouseEvent) => void; style?: string }) | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'style') el.setAttribute('style', String(v));
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k in el && k !== 'list') (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el: Node, children: Child): void {
  if (children === null || children === undefined || children === false) return;
  if (Array.isArray(children)) {
    for (const c of children) append(el, c);
    return;
  }
  // 文字列は必ずテキストノードとして挿入する（プレイヤー名などのエスケープ）
  el.appendChild(children instanceof Node ? children : document.createTextNode(String(children)));
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export const REF_H = 720;
let stage: HTMLElement;
let scale = 1;
let logicalW = 1280;

export function initStage(): HTMLElement {
  stage = document.getElementById('ui') as HTMLElement;
  const apply = () => {
    const vw = window.visualViewport?.width ?? window.innerWidth;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    // 縦長の画面では幅基準にして、基準比率（16:9）より狭くならないようにする
    scale = Math.min(vh / REF_H, vw / 960);
    logicalW = vw / scale;
    const logicalH = vh / scale;
    stage.style.width = `${logicalW}px`;
    stage.style.height = `${logicalH}px`;
    stage.style.transform = `scale(${scale})`;
    // セーフエリアを論理座標へ換算
    const probe = document.getElementById('safe-probe');
    if (probe) {
      const cs = getComputedStyle(probe);
      for (const side of ['top', 'right', 'bottom', 'left'] as const) {
        const px = parseFloat(cs.getPropertyValue(`padding-${side}`)) || 0;
        stage.style.setProperty(`--safe-${side}`, `${px / scale}px`);
      }
    }
    document.documentElement.style.setProperty('--ui-scale', String(scale));
  };
  window.addEventListener('resize', apply);
  window.visualViewport?.addEventListener('resize', apply);
  window.addEventListener('orientationchange', () => setTimeout(apply, 250));
  apply();
  return stage;
}

export const uiScale = () => scale;
export const uiWidth = () => logicalW;

// ---------------- レイヤー管理 ----------------

export interface Layer {
  el: HTMLElement;
  /** B（キャンセル）で呼ばれる */
  onCancel?: () => void;
  /** このレイヤーが開いている間、大会の時計と NPC を止める（手帳・ポーズ・強制説明など） */
  pausesClock: boolean;
  /** フィールド操作を奪う */
  modal: boolean;
  /** 追加のキー処理（true を返すと既定の処理をしない） */
  onKey?: (key: NavKey) => boolean;
  name: string;
}

export type NavKey = 'up' | 'down' | 'left' | 'right' | 'a' | 'b' | 'start';
const layers: Layer[] = [];
const listeners = new Set<() => void>();

export function onLayersChanged(fn: () => void): void {
  listeners.add(fn);
}

export function openLayer(el: HTMLElement, opts: Partial<Omit<Layer, 'el'>> = {}): Layer {
  const layer: Layer = { el, pausesClock: opts.pausesClock ?? false, modal: opts.modal ?? true, onCancel: opts.onCancel, onKey: opts.onKey, name: opts.name ?? 'layer' };
  el.classList.add('layer');
  if (!layer.modal) el.classList.add('layer-passive');
  stage.appendChild(el);
  layers.push(layer);
  requestAnimationFrame(() => el.classList.add('open'));
  listeners.forEach((f) => f());
  focusFirst(layer);
  return layer;
}

export function closeLayer(layer: Layer): void {
  const i = layers.indexOf(layer);
  if (i < 0) return;
  layers.splice(i, 1);
  layer.el.classList.remove('open');
  layer.el.remove();
  listeners.forEach((f) => f());
  const top = topLayer();
  if (top) focusFirst(top, true);
}

export function topLayer(): Layer | undefined {
  for (let i = layers.length - 1; i >= 0; i--) if (layers[i].modal) return layers[i];
  return undefined;
}

export function anyModal(): boolean {
  return layers.some((l) => l.modal);
}

export function clockPaused(): boolean {
  return layers.some((l) => l.pausesClock);
}

export function layerNames(): string[] {
  return layers.map((l) => l.name);
}

function focusables(layer: Layer): HTMLElement[] {
  return [...layer.el.querySelectorAll<HTMLElement>('button:not([disabled]), [data-focus]:not([disabled]), input, select, textarea')].filter((e) => e.offsetParent !== null);
}

export function focusFirst(layer: Layer, keep = false): void {
  if (keep && document.activeElement && layer.el.contains(document.activeElement)) return;
  const list = focusables(layer);
  const pref = list.find((e) => e.dataset.autofocus !== undefined) ?? list[0];
  // タッチ端末ではフォーカス枠を出さない
  if (pref && !document.body.classList.contains('touch')) pref.focus({ preventScroll: true });
}

/** キーボード・ゲームパッド風の操作を UI に伝える */
export function uiKey(key: NavKey): boolean {
  const layer = topLayer();
  if (!layer) return false;
  if (layer.onKey?.(key)) return true;
  if (key === 'b') {
    if (layer.onCancel) layer.onCancel();
    return true;
  }
  const list = focusables(layer);
  const cur = document.activeElement as HTMLElement | null;
  const active = cur && layer.el.contains(cur) ? cur : null;
  if (key === 'a') {
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) return true;
    if (active) active.click();
    else list[0]?.focus();
    return true;
  }
  if (key === 'start') return true;
  if (!list.length) return true;
  if (!active) {
    list[0].focus();
    return true;
  }
  // 空間的に最も近い要素へ移動
  const r = active.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  let best: HTMLElement | null = null;
  let bd = Infinity;
  for (const el of list) {
    if (el === active) continue;
    const q = el.getBoundingClientRect();
    const dx = q.left + q.width / 2 - cx;
    const dy = q.top + q.height / 2 - cy;
    let main = 0;
    let cross = 0;
    if (key === 'up') { main = -dy; cross = Math.abs(dx); }
    if (key === 'down') { main = dy; cross = Math.abs(dx); }
    if (key === 'left') { main = -dx; cross = Math.abs(dy); }
    if (key === 'right') { main = dx; cross = Math.abs(dy); }
    if (main <= 2) continue;
    const d = main + cross * 2.2;
    if (d < bd) { bd = d; best = el; }
  }
  if (best) {
    best.focus({ preventScroll: true });
    best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  return true;
}

// ---------------- 部品 ----------------

export function button(label: Child, onclick: () => void, opts: { kind?: 'primary' | 'secondary' | 'danger' | 'ghost'; disabled?: boolean; small?: boolean; autofocus?: boolean; title?: string; cls?: string } = {}): HTMLButtonElement {
  const b = h('button', { class: `btn btn-${opts.kind ?? 'secondary'}${opts.small ? ' btn-s' : ''}${opts.cls ? ' ' + opts.cls : ''}`, type: 'button', disabled: opts.disabled, title: opts.title }, h('span', null, label));
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!b.disabled) onclick();
  });
  if (opts.autofocus) b.dataset.autofocus = '';
  return b;
}

export function panel(title: Child | null, body: Child, opts: { cls?: string; footer?: Child; wide?: boolean } = {}): HTMLElement {
  return h('div', { class: `panel${opts.wide ? ' panel-wide' : ''}${opts.cls ? ' ' + opts.cls : ''}` }, title ? h('div', { class: 'panel-title' }, title) : null, h('div', { class: 'panel-body' }, body), opts.footer ? h('div', { class: 'panel-footer' }, opts.footer) : null);
}

export function toast(text: string, kind: 'info' | 'good' | 'bad' = 'info', ms = 3200): void {
  let box = document.getElementById('toasts');
  if (!box) {
    box = h('div', { id: 'toasts' });
    stage.appendChild(box);
  }
  const t = h('div', { class: `toast toast-${kind}` }, text);
  box.appendChild(t);
  while (box.children.length > 4) box.firstChild?.remove();
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, ms);
}

/** 確認ダイアログ */
export function confirmDialog(title: string, text: Child, opts: { ok?: string; cancel?: string; danger?: boolean; pauses?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    let layer: Layer;
    const done = (v: boolean) => {
      closeLayer(layer);
      resolve(v);
    };
    const el = h('div', { class: 'overlay' }, panel(title, h('div', { class: 'text' }, text), {
      cls: 'dialog',
      footer: [button(opts.cancel ?? 'やめる', () => done(false)), button(opts.ok ?? '決定', () => done(true), { kind: opts.danger ? 'danger' : 'primary', autofocus: true })],
    }));
    layer = openLayer(el, { onCancel: () => done(false), pausesClock: opts.pauses ?? true, name: 'confirm' });
  });
}

/** メッセージ（OK のみ） */
export function alertDialog(title: string, text: Child, ok = '閉じる', pauses = true): Promise<void> {
  return new Promise((resolve) => {
    let layer: Layer;
    const done = () => {
      closeLayer(layer);
      resolve();
    };
    const el = h('div', { class: 'overlay' }, panel(title, h('div', { class: 'text' }, text), { cls: 'dialog', footer: button(ok, done, { kind: 'primary', autofocus: true }) }));
    layer = openLayer(el, { onCancel: done, pausesClock: pauses, name: 'alert' });
  });
}

/** 選択肢 */
export function choose<T>(title: string, text: Child, options: { label: string; value: T; kind?: 'primary' | 'secondary' | 'danger'; hint?: string; disabled?: boolean }[], opts: { pauses?: boolean; cancel?: T } = {}): Promise<T> {
  return new Promise((resolve) => {
    let layer: Layer;
    const done = (v: T) => {
      closeLayer(layer);
      resolve(v);
    };
    const el = h('div', { class: 'overlay' }, panel(title, [h('div', { class: 'text' }, text), h('div', { class: 'choices' }, options.map((o, i) => h('div', { class: 'choice-row' }, button(o.label, () => done(o.value), { kind: o.kind ?? 'secondary', autofocus: i === 0, disabled: o.disabled }), o.hint ? h('span', { class: 'hint' }, o.hint) : null)))], { cls: 'dialog' }));
    layer = openLayer(el, { onCancel: opts.cancel !== undefined ? () => done(opts.cancel as T) : undefined, pausesClock: opts.pauses ?? true, name: 'choose' });
  });
}

export function fmtTime(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 画面遷移のフェード */
export function fade(toBlack: boolean, ms = 350): Promise<void> {
  let el = document.getElementById('fade');
  if (!el) {
    el = h('div', { id: 'fade' });
    document.body.appendChild(el);
  }
  el.style.transitionDuration = `${ms}ms`;
  void el.offsetWidth;
  el.classList.toggle('on', toBlack);
  return new Promise((r) => setTimeout(r, ms + 20));
}
