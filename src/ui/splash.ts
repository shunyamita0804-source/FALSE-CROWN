/**
 * 起動時のメーカーロゴ（スリーライス）。タイトルの前に一度だけ出す（2026-11-28 本人指示）。
 * 黒い画面 → ロゴが浮かぶ（後光がふくらんでしずまる）→ 消えてタイトルへ。どこでもタップ・キーで飛ばせる。
 * ロゴは本人の自作ゲーム「ミストラルBCオンライン」の正式素材を流用（design-parts/maker-logo/、加工なし）。
 * 絵が無い時は文字のロゴで出す。
 * 音はブラウザの決まりで最初の操作まで鳴らせない。タイトル曲は消え始めに頼み、タイトル画面と一緒に入る。
 */
import { Sound } from '../audio/audio';
import { assetUrl } from '../assets/registry';
import { closeLayer, h, openLayer, type Layer } from './dom';

/** 表示の間（ms） */
export const SPLASH_TIMING = { lead: 250, in: 900, hold: 1500, out: 600 } as const;

/** 確かめ用：?nosplash で飛ばす。自動操作（Playwright など）でも飛ばすが、?splash を付ければ出す */
function disabled(): boolean {
  const q = new URLSearchParams(location.search);
  if (q.has('splash')) return false;
  return q.has('nosplash') || navigator.webdriver === true;
}

let shown = false;

/** メーカーロゴを出す。起動して最初の 1 回だけ（タイトルへ戻った時は出さない） */
export function makerSplash(): Promise<void> {
  if (shown || disabled()) {
    shown = true;
    return Promise.resolve();
  }
  shown = true;
  const T = SPLASH_TIMING;
  const logo = assetUrl('ui/logo/maker_logo');
  const glow = assetUrl('ui/logo/maker_glow');
  const mark = logo
    ? h('div', { class: 'splash-logo' }, glow ? h('img', { class: 'splash-glow', src: glow, alt: '', draggable: false }) : null, h('img', { class: 'splash-img', src: logo, alt: 'スリーライス', draggable: false }))
    : h('div', { class: 'splash-word' }, h('div', { class: 'splash-name' }, 'スリーライス'), h('div', { class: 'splash-en' }, 'THREE RICE'));
  const inner = h('div', { class: 'splash-inner' }, mark);
  const root = h('div', { class: 'splash-screen' }, inner);
  root.style.setProperty('--splash-in', `${T.in}ms`);
  root.style.setProperty('--splash-out', `${T.out}ms`);

  return new Promise((resolve) => {
    let layer: Layer;
    let leaving = false;
    const timers: number[] = [];
    const leave = (): void => {
      if (leaving) return;
      leaving = true;
      timers.forEach((id) => clearTimeout(id));
      inner.classList.add('is-out');
      // タイトル曲はロゴの消え始めに頼む（曲の頭のフェードとタイトル画面の出をそろえる）
      Sound.bgm('title');
      setTimeout(() => {
        closeLayer(layer);
        resolve();
      }, T.out);
    };
    // 出だしの一瞬は誤タップで飛ばないよう受け付けない
    let armed = false;
    root.addEventListener('pointerdown', () => armed && leave());
    layer = openLayer(root, {
      name: 'splash',
      onCancel: () => armed && leave(),
      onKey: () => {
        if (armed) leave();
        return true;
      },
    });
    timers.push(window.setTimeout(() => inner.classList.add('is-in'), T.lead));
    timers.push(window.setTimeout(() => (armed = true), T.lead + 250));
    timers.push(window.setTimeout(leave, T.lead + T.in + T.hold));
  });
}
