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
import { t } from '../i18n/i18n';
import { bust } from './art';
import { append, button, clear, closeLayer, h, openLayer, type Child, type Layer } from './dom';

interface StepVoice { file: string; text: string; gain: number }
interface MatchVoice { dir: string; steps: Record<string, StepVoice> }
const TV = table as unknown as { speaker: string; matches: Record<string, MatchVoice> };
const files = new Set(availableAssets());
const BASE = import.meta.env.BASE_URL;

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
}

export interface VoicedGuide {
  name: string;
  steps: VoicedStep[];
}

const SEEN_KEY = 'false-crown/tutorial-seen';

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

/** 声の音源（置かれていなければ null。字幕は台本から出す） */
function voiceOf(matchId: string, stepId: string): { url: string | null; gain: number; text: string } | null {
  const m = TV.matches[matchId];
  const v = m?.steps[stepId];
  if (!m || !v) return null;
  const path = `${m.dir}/${v.file}`;
  return { url: files.has(path) ? `${BASE}assets/${path}` : null, gain: v.gain, text: v.text };
}

export const hasVoicedTutorial = (matchId: string, guides: Record<string, () => VoicedGuide>) => matchId in guides && matchId in TV.matches;

/**
 * 音声付きの説明を開く。review は試合中の「ルール」から開いた時（いつでも閉じられ、練習は任意）。
 * cutNote は最後の段階の足もとに出す一言。
 */
export function voicedTutorial(matchId: string, g: VoicedGuide, opts: { review?: boolean; cutNote?: string } = {}): Promise<void> {
  const canSkipAll = !!opts.review || tutorialSeen(matchId);
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

    const portrait = bust(TV.speaker, 'normal', 'vt-gm');
    const head = h('div', { class: 'vt-head' });
    const fig = h('div', { class: 'vt-fig' });
    const prompt = h('div', { class: 'vt-prompt' });
    const sub = h('div', { class: 'vt-sub' });
    const subText = h('span', { class: 'vt-subtext' });
    const subRest = h('span', { class: 'vt-subrest' });
    sub.append(h('b', { class: 'vt-who' }, t('vt.gm')), h('div', { class: 'vt-line' }, subText, subRest));
    const foot = h('div', { class: 'vt-foot' });
    const note = h('div', { class: 'vt-note dim small' });

    const close = () => {
      if (!alive) return;
      alive = false;
      cancelAnimationFrame(raf);
      Sound.stopVoice();
      markSeen(matchId);
      closeLayer(layer);
      resolve();
    };

    /** 字幕：声の進み（0〜1）まで出す */
    const showSub = (text: string, k: number) => {
      const n = Math.round(text.length * Math.max(0, Math.min(1, k)));
      subText.textContent = text.slice(0, n);
      subRest.textContent = text.slice(n);
    };

    const runCues = (k: number) => {
      view?.cues?.forEach((c, i) => { if (k >= c.at && !fired.has(i)) { fired.add(i); c.run(); } });
    };

    const maybeAdvance = () => {
      if (!alive || !view) return;
      renderFoot();
      if (view.task && taskDone && voiceDone && !view.final) setTimeout(() => { if (alive && view && taskDone) go(idx + 1); }, 900);
    };

    /** 声を流す（無音の時も、字幕は文字数から見積もった時間で出す） */
    const play = () => {
      const step = g.steps[idx];
      const v = voiceOf(matchId, step.id);
      const text = v?.text ?? '';
      cancelAnimationFrame(raf);
      Sound.stopVoice();
      voiceDone = false;
      playing = true;
      renderFoot();
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
        if (!alive || g.steps[idx] !== step) return;
        playing = false;
        voiceDone = true;
        showSub(text, 1);
        runCues(1);
        maybeAdvance();
      };
      const est = Math.max(2.2, text.length * 0.13);
      let started = false;
      if (v?.url) {
        Sound.voice(v.url, v.gain, {
          duck: true,
          onStart: (sec) => { started = true; startTick(sec); },
          onEnd: () => {
            if (started) finish();
            else { startTick(est); setTimeout(finish, est * 1000); }
          },
        });
      } else {
        startTick(est);
        setTimeout(finish, est * 1000);
      }
    };

    /** 止める：声を止めて字幕を全部出す */
    const stop = () => {
      Sound.stopVoice();
      cancelAnimationFrame(raf);
      playing = false;
      voiceDone = true;
      showSub(voiceOf(matchId, g.steps[idx].id)?.text ?? '', 1);
      runCues(1);
      maybeAdvance();
    };

    const renderHead = () => {
      clear(head);
      head.append(
        h('span', { class: 'vt-id' }, `${matchId.toUpperCase()}　${g.name}`),
        h('b', { class: 'vt-title' }, g.steps[idx].title),
        h('span', { class: 'tut-dots' }, g.steps.map((_, i) => h('i', { class: i === idx ? 'on' : i < idx ? 'past' : '' }))),
      );
    };

    const renderFoot = () => {
      if (!view) return;
      clear(foot);
      const last = idx === g.steps.length - 1;
      const nextReady = voiceDone && (!view.task || taskDone);
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
      fig.append(...(Array.isArray(el) ? (el as Node[]) : [el as Node]));
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
      renderHead();
      play();
    };

    layer = openLayer(
      h('div', { class: 'overlay solid vt-wrap' },
        portrait,
        h('div', { class: 'vt' }, head, h('div', { class: 'vt-stage' }, fig, prompt, note), sub, foot)),
      { pausesClock: true, name: 'tutorial', onCancel: canSkipAll ? close : undefined },
    );
    go(0);
  });
}

/** 説明の中で、目立たせたい所に印を付ける（前の印は外す） */
export function focus(root: ParentNode, sel: string | null, cls = 'vt-hl'): void {
  root.querySelectorAll(`.${cls}`).forEach((e) => e.classList.remove(cls));
  if (sel) root.querySelectorAll(sel).forEach((e) => e.classList.add(cls));
}
