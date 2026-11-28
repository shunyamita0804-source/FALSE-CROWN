/**
 * DOM ベースの UI レイヤー。フィールド（Phaser キャンバス）とは完全に分離し、
 * 文字・数値・盤面はすべてここでプログラム描画する（高解像度のまま表示される）。
 *
 * 論理画面は高さ 720 を基準とし、横幅は端末の縦横比に合わせて伸縮する（1280×720 が基準）。
 */
import { fitPageToScreen } from '../display/viewport';

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
    const box = fitPageToScreen();
    const vw = box.width;
    const vh = box.height;
    // 縦長の画面では幅基準にして、基準比率（16:9）より狭くならないようにする
    scale = Math.min(vh / REF_H, vw / 960);
    logicalW = vw / scale;
    const logicalH = vh / scale;
    stage.style.width = `${logicalW}px`;
    stage.style.height = `${logicalH}px`;
    stage.style.transform = `scale(${scale})`;
    // セーフエリアを論理座標へ換算
    for (const side of ['top', 'right', 'bottom', 'left'] as const) stage.style.setProperty(`--safe-${side}`, `${box.safe[side] / scale}px`);
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

/**
 * いちばん手前のウィンドウだけを操作できるようにする。
 * 背後のウィンドウには layer-covered を付けて操作を受け付けなくし（入力の貫通を防ぐ）、会話コマンドなどは CSS で隠す。
 */
function refreshCover(): void {
  const top = topLayer();
  for (const l of layers) {
    const covered = l.modal && !!top && l !== top;
    l.el.classList.toggle('layer-covered', covered);
    if (covered) l.el.setAttribute('inert', '');
    else l.el.removeAttribute('inert');
  }
  stage.classList.toggle('has-modal', !!top);
}

export function openLayer(el: HTMLElement, opts: Partial<Omit<Layer, 'el'>> = {}): Layer {
  const layer: Layer = { el, pausesClock: opts.pausesClock ?? false, modal: opts.modal ?? true, onCancel: opts.onCancel, onKey: opts.onKey, name: opts.name ?? 'layer' };
  el.classList.add('layer');
  if (!layer.modal) el.classList.add('layer-passive');
  // 暗転したまま画面を開くと、真っ暗で何も押せなくなる。操作を求める画面を開く時は、必ず暗転を解く
  if (layer.modal && document.getElementById('fade')?.classList.contains('on')) void fade(false, 200);
  stage.appendChild(el);
  layers.push(layer);
  requestAnimationFrame(() => el.classList.add('open'));
  refreshCover();
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
  refreshCover();
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
  // 同じ文言が出ている間は重ねて出さない
  if ([...box.children].some((c) => c.textContent === text)) return;
  const t = h('div', { class: `toast toast-${kind}` }, text);
  box.appendChild(t);
  while (box.children.length > 3) box.firstChild?.remove();
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
    const el = h('div', { class: 'overlay' }, panel(title, [h('div', { class: 'text' }, text), h('div', { class: `choices${options.length >= 4 ? ' many' : ''}` }, options.map((o, i) => h('div', { class: 'choice-row' }, button(o.label, () => done(o.value), { kind: o.kind ?? 'secondary', autofocus: i === 0, disabled: o.disabled }), o.hint ? h('span', { class: 'hint' }, o.hint) : null)))], { cls: 'dialog' }));
    layer = openLayer(el, { onCancel: opts.cancel !== undefined ? () => done(opts.cancel as T) : undefined, pausesClock: opts.pauses ?? true, name: 'choose' });
  });
}

export function fmtTime(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 画面遷移のフェード */
export function fade(toBlack: boolean, ms = 350, label?: string): Promise<void> {
  let el = document.getElementById('fade');
  if (!el) {
    el = h('div', { id: 'fade' });
    document.body.appendChild(el);
  }
  if (toBlack) el.textContent = label ?? '';
  el.style.transitionDuration = `${ms}ms`;
  void el.offsetWidth;
  el.classList.toggle('on', toBlack);
  return new Promise((r) => setTimeout(r, ms + 20));
}

/**
 * 想定外のエラーで画面が止まった時に、原因と戻り方を必ず表示する（真っ暗なまま操作不能にしない）。
 * セーブデータには触れない。再読み込みすれば、最後に保存された所から続けられる。
 */
export function installErrorScreen(version: string): void {
  let shown = false;
  const show = (msg: string) => {
    if (shown) return;
    shown = true;
    document.getElementById('fade')?.classList.remove('on');
    const box = document.createElement('div');
    box.id = 'fatal';
    box.innerHTML = '<div class="fatal-box"><h2>問題が発生しました</h2><p>画面の処理でエラーが起きました。下のボタンで読み込み直すと、最後に保存された所から続けられます。</p><pre></pre><div class="fatal-btns"><button type="button" data-a="reload">読み込み直す</button><button type="button" data-a="close">このまま続ける</button></div></div>';
    (box.querySelector('pre') as HTMLElement).textContent = `${msg}\n${version}`;
    box.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).dataset.a;
      if (a === 'reload') location.reload();
      else if (a === 'close') { box.remove(); shown = false; }
    });
    document.body.appendChild(box);
  };
  window.addEventListener('error', (e) => {
    // 画像や音声の読み込み失敗（target が要素）は、代わりの表示で続けられるので対象外
    if (e.error || (e.message && !(e.target instanceof HTMLElement))) show(String(e.error?.stack ?? e.message).slice(0, 600));
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    const msg = String(r?.stack ?? r?.message ?? r);
    // 音声の自動再生の拒否などは無害なので出さない
    if (/NotAllowedError|AbortError|play\(\)/.test(msg)) return;
    show(msg.slice(0, 600));
  });
}

/**
 * box の中に content を本来の大きさで置き、入りきらない時だけ content 全体を縮めて見せる（大きくはしない）。
 * ノッチのある iPhone など、使える幅・高さが足りない画面で、盤面や図が見切れたり他と重なったりしないようにする。
 * 縮めても座標は getBoundingClientRect で取り直すので、タップの位置はずれない。
 */
export function autoFit(box: HTMLElement, content: HTMLElement): void {
  content.classList.add('fit-in');
  const fit = () => {
    if (!box.isConnected) { obs?.disconnect(); return; }
    content.style.transform = '';
    const w = content.offsetWidth, hh = content.offsetHeight;
    const fw = box.clientWidth, fh = box.clientHeight;
    if (!w || !hh || !fw || !fh) return;
    const k = Math.min(1, fw / w, fh / hh);
    content.style.transform = k < 0.995 ? `scale(${k})` : '';
  };
  const obs = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => fit()) : null;
  obs?.observe(box);
  obs?.observe(content);
  requestAnimationFrame(fit);
}

/**
 * 競技の画面のように「全体で 1 枚」の画面を、使える幅が minW（論理 px）より狭い時だけ、minW の幅で組んでから全体を縮めて見せる。
 * ノッチのある iPhone では左右の余白のぶん幅が足りず、盤面や数字の札が端で切れていた（2026-11-28 実機の指摘）。
 * 余白（--safe-*）は縮める前の値に直して渡すので、縮めた後もノッチの内側に収まる。
 */
export function fitMinWidth(el: HTMLElement, minW: number): void {
  const host = el.parentElement;
  if (!host) return;
  const safe = (side: string) => parseFloat(getComputedStyle(stage).getPropertyValue(`--safe-${side}`)) || 0;
  const apply = () => {
    if (!el.isConnected) { obs?.disconnect(); return; }
    const W = host.clientWidth, H = host.clientHeight;
    const s = { top: safe('top'), right: safe('right'), bottom: safe('bottom'), left: safe('left') };
    // minW は余白（ノッチ）を除いた幅。競技の画面の左右の内側の余白 14px ずつも含めて比べる
    const k = Math.min(1, (W - s.left - s.right) / (minW + 28));
    if (k >= 0.999) {
      for (const p of ['width', 'height', 'transform', 'transform-origin', 'right', 'bottom']) el.style.removeProperty(p);
      for (const side of Object.keys(s)) el.style.removeProperty(`--safe-${side}`);
      return;
    }
    for (const [side, v] of Object.entries(s)) el.style.setProperty(`--safe-${side}`, `${v / k}px`);
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.width = `${W / k}px`;
    el.style.height = `${H / k}px`;
    el.style.transformOrigin = '0 0';
    el.style.transform = `scale(${k})`;
  };
  const obs = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => apply()) : null;
  obs?.observe(host);
  apply();
}
