/**
 * 音声付きの競技説明（共通の仕組み）。
 * - 声と字幕は data/tutorial_voice.json（競技 ID と段階 ID で引く）。段階の図と操作は voiceguides.ts に競技ごとに書く。
 * - ゲームマスターの胸から上を出し、字幕は声の再生に合わせて少しずつ出す。声の間は BGM を下げる。声は重ねない。
 * - 操作を求める段階は、操作が済み、声も終わったら自動で次へ進む。操作の無い段階は「次へ」で進む。
 * - 聞き直し、止める／再生、次へ（その段階を飛ばす）。説明全体を飛ばせるのは 2 回目から（見たかどうかは端末に記録）。
 * - 開いている間は大会の時計を止める。閉じると声を止める。
 * 新しい競技を足す時は、tutorial_voice.json に声を、voiceguides.ts の VOICED に段階を足すだけ。
 */
import table from '../data/tutorial_voice.json';
import { availableAssets } from '../assets/registry';
import { Sound } from '../audio/audio';
import { fitsScene } from '../audio/voicefit';
import { t } from '../i18n/i18n';
import { bust, emblem, setBust, v11Url } from './art';
import { append, button, clear, closeLayer, autoFit, h, openLayer, type Child, type Layer } from './dom';

/** fits：この収録が合う場面（競技の順番、組の数、ステージ数など）。合わない時は部品の声と字幕に切り替える */
interface StepVoice { file: string; text: string; gain: number; fits?: Record<string, number> }
interface Clip { file: string; text: string; gain: number }
interface MatchVoice { dir: string; steps: Record<string, StepVoice>; /** この競技だけの部品（name：競技名だけの声） */ slots?: Record<string, Clip> }
/** slots：どの競技でも使う部品の声。order は「第N競技」「決勝」など（キーは番号か final）。dir は置き場所 */
const TV = table as unknown as { speaker: string; slots: { dir: string } & Record<string, Record<string, Clip> | string>; matches: Record<string, MatchVoice> };
const files = new Set(availableAssets());
const BASE = import.meta.env.BASE_URL;

/**
 * 説明を出す場面。順番（第何競技か。決勝は 'final'）と、参加する人。収録の前提（fits）と比べる。
 * 2 周目以降に競技や人が入れ替わっても、合わない収録は使わず、部品の声と字幕で説明する。
 */
export interface TutCtx { order?: number | 'final'; players?: string[]; [k: string]: unknown }

/** 収録が合わない時の代わり：部品の声（slot と key）を順に鳴らし、字幕は text を出す */
export interface AltVoice { text: string; parts?: { slot: string; key: string }[] }

/** 段階の中身。el は図、task は操作が済むと解決する約束、cues は声の進み（0〜1）に合わせて呼ぶ処理 */
export interface StepView {
  el: Child;
  /** 操作をうながす一言（操作が無い段階は省く） */
  prompt?: string;
  task?: Promise<void>;
  cues?: { at: number; run: () => void }[];
  /** 最後の段階：操作が済んだら「本番へ」を出す */
  final?: boolean;
}

export interface VoicedStep {
  /** tutorial_voice.json の段階 ID */
  id: string;
  /** 見出し（画面の上） */
  title: string;
  build: () => StepView;
  /** 収録が無い段階の字幕（声は無く、字幕と図で説明する） */
  text?: string;
  /** 場面の値（fits と同じ名前）。収録の fits と比べる */
  facts?: Record<string, number>;
  /** 収録が場面に合わない時の代わり */
  alt?: () => AltVoice;
}

export interface VoicedGuide {
  name: string;
  steps: VoicedStep[];
}

const SEEN_KEY = 'false-crown/tutorial-seen';

/**
 * 字幕の見せ方。'full'：説明の全文を最初から明るく出す（2026-11-28 本人の指示で既定）。'reveal'：音声に合わせて文字が順に現れる。
 * 他の競技の音声付き説明も同じ作りで使う。
 */
export const SUB_MODE: 'full' | 'reveal' = 'full';
/** 字幕を読むのに取る時間（ミリ秒）。1 文字 0.15 秒と、読み始めの 1.2 秒。声がこれより長ければ声の終わりまで */
export const readMs = (text: string): number => 1200 + text.length * 150;

export function tutorialSeen(id: string): boolean {
  try { return (JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]).includes(id); } catch { return false; }
}

function markSeen(id: string): void {
  try {
    const list = new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]);
    list.add(id);
    localStorage.setItem(SEEN_KEY, JSON.stringify([...list]));
  } catch { /* 記録できなくても説明は動く */ }
}

export interface VoicePart { url: string; gain: number }
export interface StepAudio { parts: VoicePart[]; text: string; /** 収録をそのまま使ったか（false は部品か字幕だけ） */ recorded: boolean }

const urlOf = (path: string) => (files.has(path) ? `${BASE}assets/${path}` : null);

/** 部品の声（無ければ null）。name は競技ごと、それ以外は共通の部品 */
function slotClip(matchId: string, slot: string, key: string): VoicePart | null {
  const m = TV.matches[matchId];
  const c = slot === 'name' ? m?.slots?.name : (TV.slots[slot] as Record<string, Clip> | undefined)?.[key];
  if (!c) return null;
  const url = urlOf(`${slot === 'name' ? m!.dir : TV.slots.dir}/${c.file}`);
  return url ? { url, gain: c.gain } : null;
}


/** 段階の声と字幕を決める。収録が合えばそれ、合わなければ部品の声と代わりの字幕、収録が無ければ字幕だけ */
export function stepAudio(matchId: string, step: VoicedStep): StepAudio {
  const m = TV.matches[matchId];
  const v = m?.steps[step.id];
  if (m && v && fitsScene(v.fits, step.facts)) {
    const url = urlOf(`${m.dir}/${v.file}`);
    return { parts: url ? [{ url, gain: v.gain }] : [], text: v.text, recorded: true };
  }
  if (v && step.alt) {
    const a = step.alt();
    return { parts: (a.parts ?? []).map((p) => slotClip(matchId, p.slot, p.key)).filter((x): x is VoicePart => !!x), text: a.text, recorded: false };
  }
  return { parts: [], text: step.text ?? v?.text ?? '', recorded: false };
}

export const hasVoicedTutorial = (matchId: string, guides: Record<string, () => VoicedGuide>) => matchId in guides && matchId in TV.matches;

/**
 * 音声付きの説明を開く。review は試合中の「ルール」から開いた時（いつでも閉じられ、練習は任意）。
 * cutNote は最後の段階の足もとに出す一言。
 */
export function voicedTutorial(matchId: string, g: VoicedGuide, opts: { review?: boolean; cutNote?: string } = {}): Promise<void> {
  // 初めての時も、説明全体を飛ばせる（2026-11-28 本人の指示）。見たかどうかの記録は残す
  const canSkipAll = true;
  return new Promise((resolve) => {
    let layer: Layer;
    let idx = 0;
    let alive = true;
    let raf = 0;
    let voiceDone = false;
    let taskDone = false;
    let playing = false;
    let view: StepView | null = null;
    let fired = new Set<number>();

    // ゲームマスターは盤面を手で示す姿勢（届いていなければ通常の立ち絵）。得点や終わり方の段階は指を立てる姿勢
    const portrait = bust(TV.speaker, 'present', 'vt-gm');
    const poseOf = (id: string) => (/scor|bonus|point|end|result|win/.test(id) ? 'point' : 'present');
    const head = h('div', { class: 'vt-head' });
    const fig = h('div', { class: 'vt-fig' });
    const prompt = h('div', { class: 'vt-prompt' });
    // 押す所を示す手：光らせた所（.vt-hl）の最初の 1 つへ指先を合わせ、押す・離すをくり返す。操作が済んだら隠す
    const handUrls = [v11Url('tutorial/hand_point'), v11Url('tutorial/hand_press')];
    const hand = handUrls[0] && handUrls[1]
      ? h('div', { class: 'vt-hand', 'aria-hidden': 'true' }, h('img', { class: 'pt', src: handUrls[0], alt: '', draggable: false }), h('img', { class: 'pr', src: handUrls[1], alt: '', draggable: false }))
      : null;
    // 図は本来の大きさで並べ、枠に入りきらない時だけ全体を縮めて出す（ノッチのある iPhone など。2026-11-28 実機の指摘）
    const fitBox = h('div', { class: 'vt-fit' });
    autoFit(fig, fitBox);
    const sub = h('div', { class: 'vt-sub' });
    const subText = h('span', { class: 'vt-subtext' });
    const subRest = h('span', { class: 'vt-subrest' });
    sub.append(h('b', { class: 'vt-who' }, t('vt.gm')), h('div', { class: 'vt-line' }, subText, subRest));
    const foot = h('div', { class: 'vt-foot' });
    const note = h('div', { class: 'vt-note dim small' });
    let handTimer = 0;
    const placeHand = () => {
      if (!hand) return;
      const stage = hand.parentElement;
      const target = !taskDone ? fig.querySelector<HTMLElement>('.vt-hl') : null;
      if (!stage || !target) { hand.classList.remove('on'); return; }
      const sr = stage.getBoundingClientRect();
      const tr = target.getBoundingClientRect();
      const k = sr.width / (stage.offsetWidth || 1) || 1;
      // 指先は手の絵の (64, 64)／256。指先を目標の中央より少し右下に置き、目標そのものは隠さない
      const x = (tr.left + tr.width * 0.62 - sr.left) / k;
      const y = (tr.top + tr.height * 0.62 - sr.top) / k;
      hand.style.transform = `translate(${x}px, ${y}px)`;
      hand.classList.add('on');
    };

    const close = () => {
      if (!alive) return;
      alive = false;
      clearInterval(handTimer);
      clearTimeout(readTimer);
      cancelAnimationFrame(raf);
      Sound.stopVoice();
      markSeen(matchId);
      closeLayer(layer);
      resolve();
    };

    /** 字幕：声の進み（0〜1）まで出す */
    const showSub = (text: string, k: number) => {
      if (SUB_MODE === 'full') {
        // 全文を最初から読みやすい明るさで出す（音声に合わせてなぞらない）
        subText.textContent = text;
        subRest.textContent = '';
        return;
      }
      // 音声に合わせて文字が順に現れる（まだの部分は場所だけ取って見せない）
      const n = Math.round(text.length * Math.max(0, Math.min(1, k)));
      subText.textContent = text.slice(0, n);
      subRest.textContent = text.slice(n);
    };
    /** 字幕を読み終えたか（声の長さとは別に、文字数から読む時間を取る） */
    let readDone = false;
    let readTimer = 0;
    const heard = () => voiceDone && readDone;

    const runCues = (k: number) => {
      view?.cues?.forEach((c, i) => { if (k >= c.at && !fired.has(i)) { fired.add(i); c.run(); } });
    };

    const maybeAdvance = () => {
      if (!alive || !view) return;
      renderFoot();
      if (view.task && taskDone && heard() && !view.final) setTimeout(() => { if (alive && view && taskDone) go(idx + 1); }, 900);
    };

    /** 声を流す（無音の時も、字幕は文字数から見積もった時間で出す）。部品が複数なら順に流し、字幕は全体の長さに合わせる */
    const play = () => {
      const step = g.steps[idx];
      const a = stepAudio(matchId, step);
      const text = a.text;
      cancelAnimationFrame(raf);
      Sound.stopVoice();
      voiceDone = false;
      readDone = false;
      clearTimeout(readTimer);
      readTimer = window.setTimeout(() => { if (!alive || g.steps[idx] !== step) return; readDone = true; maybeAdvance(); }, readMs(text));
      playing = true;
      renderFoot();
      const est = Math.max(2.2, text.length * 0.13);
      const startTick = (sec: number) => {
        const t0 = performance.now();
        const tick = () => {
          if (!alive || !playing) return;
          const k = (performance.now() - t0) / (sec * 1000);
          showSub(text, k);
          runCues(k);
          if (k < 1) raf = requestAnimationFrame(tick);
        };
        tick();
      };
      const finish = () => {
        if (!alive || g.steps[idx] !== step || !playing) return;
        playing = false;
        voiceDone = true;
        showSub(text, 1);
        runCues(1);
        maybeAdvance();
      };
      const single = a.recorded && a.parts.length === 1;
      if (!single) {
        // 字幕だけ、または部品の声：字幕は見積もった時間で出し、声と字幕の両方が終わったら次へ
        let left = 2;
        const one = () => { if (--left === 0) finish(); };
        startTick(est);
        setTimeout(one, est * 1000);
        const chain = (i: number) => {
          if (!alive || g.steps[idx] !== step || !playing) return;
          if (i >= a.parts.length) { one(); return; }
          Sound.voice(a.parts[i].url, a.parts[i].gain, { duck: true, onEnd: () => chain(i + 1) });
        };
        chain(0);
        return;
      }
      let started = false;
      Sound.voice(a.parts[0].url, a.parts[0].gain, {
        duck: true,
        onStart: (sec) => { started = true; startTick(sec); },
        onEnd: () => {
          if (started) finish();
          else { startTick(est); setTimeout(finish, est * 1000); }
        },
      });
    };

    /** 止める：声を止めて字幕を全部出す */
    const stop = () => {
      Sound.stopVoice();
      cancelAnimationFrame(raf);
      playing = false;
      voiceDone = true;
      showSub(stepAudio(matchId, g.steps[idx]).text, 1);
      runCues(1);
      maybeAdvance();
    };

    const renderHead = () => {
      clear(head);
      append(head, [
        emblem(matchId, 'vt-emblem'),
        h('span', { class: 'vt-id' }, `${matchId.toUpperCase()}　${g.name}`),
        h('b', { class: 'vt-title' }, g.steps[idx].title),
        h('span', { class: 'tut-dots' }, g.steps.map((_, i) => h('i', { class: i === idx ? 'on' : i < idx ? 'past' : '' }))),
      ]);
    };

    const renderFoot = () => {
      if (!view) return;
      clear(foot);
      const last = idx === g.steps.length - 1;
      const nextReady = heard() && (!view.task || taskDone);
      append(foot, [
        canSkipAll ? button(t(opts.review ? 'common.close' : 'tut.skip'), close, { kind: 'ghost', small: true, cls: 'vt-skipall' }) : null,
        h('span', { class: 'spacer' }),
        button(t('vt.replay'), () => { fired = new Set(); play(); }, { small: true, cls: 'vt-replay' }),
        button(t(playing ? 'vt.stop' : 'vt.play'), () => (playing ? stop() : play()), { small: true, cls: 'vt-toggle' }),
        idx > 0 ? button(t('common.back'), () => go(idx - 1), { small: true }) : null,
        last
          ? button(t(taskDone || opts.review ? 'tut.start' : 'tut.startSkip'), close, { kind: 'primary', cls: `vt-next${taskDone ? ' ready' : ''}` })
          : button(t('common.next'), () => go(idx + 1), { kind: 'primary', cls: `vt-next${nextReady ? ' ready' : ''}` }),
      ]);
    };

    const go = (i: number) => {
      if (!alive || i < 0 || i >= g.steps.length) return;
      idx = i;
      taskDone = false;
      fired = new Set();
      view = g.steps[idx].build();
      clear(fig);
      const el = view.el;
      fitBox.replaceChildren(...(Array.isArray(el) ? (el as Node[]) : [el as Node]));
      fig.append(fitBox);
      note.textContent = idx === g.steps.length - 1 && !opts.review ? (opts.cutNote ?? '') : '';
      prompt.textContent = view.prompt ?? '';
      prompt.classList.toggle('on', !!view.prompt);
      const mine = view;
      view.task?.then(() => {
        if (!alive || view !== mine) return;
        taskDone = true;
        Sound.se('result');
        prompt.textContent = t('vt.good');
        prompt.classList.add('done');
        maybeAdvance();
      });
      prompt.classList.remove('done');
      setBust(portrait, TV.speaker, poseOf(g.steps[idx].id));
      renderHead();
      play();
    };

    layer = openLayer(
      h('div', { class: 'overlay solid vt-wrap' },
        portrait,
        h('div', { class: 'vt' }, head, h('div', { class: 'vt-stage' }, fig, prompt, note, hand), sub, foot)),
      { pausesClock: true, name: 'tutorial', onCancel: canSkipAll ? close : undefined },
    );
    go(0);
    if (hand) handTimer = window.setInterval(placeHand, 120);
  });
}

/** 説明の中で、目立たせたい所に印を付ける（前の印は外す） */
export function focus(root: ParentNode, sel: string | null, cls = 'vt-hl'): void {
  root.querySelectorAll(`.${cls}`).forEach((e) => e.classList.remove(cls));
  if (sel) root.querySelectorAll(sel).forEach((e) => e.classList.add(cls));
}
