/**
 * 音声付きの競技説明の、競技ごとの段階（図と操作）。声と字幕は data/tutorial_voice.json。
 * 段階の順番と ID は収録の台本に合わせる。ルールは競技のエンジン（src/matches/）が正で、声に合わせて変えない。
 * 新しい競技は VOICED に足す（tutorial.ts の説明より先に使われる）。
 */
import { t } from '../i18n/i18n';
import { HINT_COST, L4, M01_DEMO, M01_PRACTICE, STAGES, STAGE_MS } from '../matches/m01';
import { solve } from '../matches/poly';
import { ALL_IDS } from '../data/characters';
import { face } from './art';
import { button, h } from './dom';
import { PolyBoard } from './polyboard';
import { focus, type VoicedGuide } from './voicetut';

const mini = (cells: [number, number][], w: number, hh: number, cls: string, size = 34, mark?: 'ng') =>
  h('div', { class: `tg-mini${mark ? ' ' + mark : ''}`, style: `width:${w * size}px;height:${hh * size}px` },
    cells.map(([x, y]) => h('i', { class: `pb-pc ${cls}`, style: `left:${x * size}px;top:${y * size}px;width:${size}px;height:${size}px;position:absolute` })));

function m01Voiced(): VoicedGuide {
  const groups = [ALL_IDS.slice(0, 4), ALL_IDS.slice(4, 8), ALL_IDS.slice(8, 12)];
  return {
    name: 'ピース・アセンブル',
    steps: [
      {
        id: 'title', title: t('vt.m01.title'),
        build: () => ({ el: h('div', { class: 'vt-titlecard' }, h('small', null, 'MAIN MATCH 01'), h('b', null, 'ピース・アセンブル'), h('span', null, 'PIECE ASSEMBLE')) }),
      },
      {
        id: 'basic_rules', title: t('vt.m01.rules'),
        build: () => {
          const b = new PolyBoard(M01_DEMO, { readonly: true, cell: 84 });
          const el = h('div', { class: 'vt-demo' }, b.el);
          return { el, cues: [{ at: 0.05, run: () => focus(el, '.pb-tray') }, { at: 0.45, run: () => focus(el, '.pb-board') }] };
        },
      },
      {
        id: 'controls', title: t('vt.m01.controls'),
        build: () => {
          let rotated1: () => void = () => undefined;
          let placed1: () => void = () => undefined;
          const r = new Promise<void>((res) => { rotated1 = res; });
          const p = new Promise<void>((res) => { placed1 = res; });
          const b = new PolyBoard(M01_DEMO, { cell: 84, onRotate: () => rotated1(), onChange: (pl) => { if (pl.length) placed1(); } });
          const flip = h('div', { class: 'vt-flip' }, mini(L4, 2, 3, 'pc0'), h('span', { class: 'tg-arrow' }, '⇄'), mini(L4.map(([x, y]) => [1 - x, y] as [number, number]), 2, 3, 'pc0', 34, 'ng'), h('small', null, t('vt.m01.noflip')));
          const el = h('div', { class: 'vt-demo' }, b.el, flip);
          const task = r.then(() => { focus(el, '.pb-board'); promptEl()?.replaceChildren(t('vt.m01.doPlace')); return p; });
          const promptEl = () => el.closest('.vt')?.querySelector('.vt-prompt') ?? null;
          return {
            el, task, prompt: t('vt.m01.doRotate'),
            cues: [{ at: 0.02, run: () => focus(el, '.pb-slot, .pb-ctl .btn:first-child') }, { at: 0.7, run: () => focus(el, '.vt-flip', 'vt-hl2') }],
          };
        },
      },
      {
        id: 'format', title: t('vt.m01.format'),
        build: () => {
          const el = h('div', { class: 'col', style: 'gap:22px;align-items:center' },
            h('div', { class: 'vt-groups' }, groups.map((g, i) => h('div', { class: 'vt-group', 'data-g': String(i) }, h('small', null, t('vt.m01.group', { n: i + 1 })), h('div', { class: 'row' }, g.map((id) => face(id)))))),
            h('div', { class: 'tg-facts vt-facts' },
              h('div', { class: 'tg-fact', 'data-f': 'stages' }, h('b', null, String(STAGES)), h('small', null, t('tut.m01.f1'))),
              h('div', { class: 'tg-fact', 'data-f': 'time' }, h('b', null, String(STAGE_MS / 1000)), h('small', null, t('tut.m01.f2')))));
          return { el, cues: [{ at: 0.02, run: () => focus(el, '.vt-group') }, { at: 0.5, run: () => focus(el, '[data-f="stages"]') }, { at: 0.75, run: () => focus(el, '[data-f="time"]') }] };
        },
      },
      {
        id: 'scoring', title: t('vt.m01.scoring'),
        build: () => {
          const chip = (k: string, label: string, v: string) => h('div', { class: 'm01-chip on', 'data-k': k }, h('small', null, label), h('b', null, v));
          const el = h('div', { class: 'col', style: 'gap:18px;align-items:center' },
            h('div', { class: 'm01-score' }, chip('done', t('m01.done'), '100'), h('span', { class: 'plus' }, '+'), chip('speed', t('m01.speed'), '0〜20')),
            h('div', { class: 'tg-cap vt-partial' }, t('tut.m01.partial')));
          return { el, cues: [{ at: 0.02, run: () => focus(el, '[data-k="done"]') }, { at: 0.3, run: () => focus(el, '[data-k="speed"]') }, { at: 0.62, run: () => focus(el, '.vt-partial') }] };
        },
      },
      {
        id: 'team_bonus', title: t('vt.m01.team'),
        build: () => {
          const g = groups[0];
          const el = h('div', { class: 'col', style: 'gap:18px;align-items:center' },
            h('div', { class: 'vt-group vt-team' }, h('div', { class: 'row' }, g.map((id) => h('div', { class: 'vt-mate' }, face(id), h('i', { class: 'vt-check' }, '✓'), h('em', { class: 'vt-plus' }, '+10'))))),
            h('div', { class: 'tg-cap vt-indiv' }, t('vt.m01.indiv')));
          return { el, cues: [{ at: 0.05, run: () => el.querySelectorAll('.vt-check').forEach((c) => c.classList.add('on')) }, { at: 0.3, run: () => { el.querySelectorAll('.vt-plus').forEach((c) => c.classList.add('on')); focus(el, '.vt-team'); } }, { at: 0.6, run: () => focus(el, '.vt-indiv') }] };
        },
      },
      {
        id: 'hint', title: t('vt.m01.hint'),
        build: () => {
          const b = new PolyBoard(M01_DEMO, { cell: 84 });
          const sol = solve(M01_DEMO, 200_000).placed;
          let used: () => void = () => undefined;
          const task = new Promise<void>((res) => { used = res; });
          const btn = button(t('m01.hint', { n: HINT_COST }), () => { b.setHint(sol[0] ?? null); btn.disabled = true; used(); }, { cls: 'vt-hintbtn' });
          const el = h('div', { class: 'vt-demo' }, b.el, h('div', { class: 'col', style: 'gap:8px;align-items:center' }, btn, h('small', { class: 'dim' }, t('vt.m01.hintOnce'))));
          return { el, task, prompt: t('vt.m01.doHint'), cues: [{ at: 0.05, run: () => focus(el, '.vt-hintbtn') }] };
        },
      },
      {
        id: 'practice', title: t('tut.practice'),
        build: () => {
          let solved: () => void = () => undefined;
          const task = new Promise<void>((res) => { solved = res; });
          const b = new PolyBoard(M01_PRACTICE, { cell: 84, onComplete: () => solved() });
          return { el: h('div', { class: 'vt-demo' }, b.el), task, prompt: t('tut.m01.practice'), final: true };
        },
      },
    ],
  };
}

export const VOICED: Record<string, () => VoicedGuide> = { m01: m01Voiced };
