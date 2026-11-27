/**
 * 音声付きの競技説明の、競技ごとの段階（図と操作）。声と字幕は data/tutorial_voice.json。
 * 段階の順番と ID は収録の台本に合わせる。ルールは競技のエンジン（src/matches/）が正で、声に合わせて変えない。
 * 新しい競技は VOICED に足す（tutorial.ts の説明より先に使われる）。
 */
import { t } from '../i18n/i18n';
import { BREAK_MS, GROUP_SIZE, HINT_COST, L4, M01_DEMO, M01_PRACTICE, STAGES, STAGE_MS, makeGroups, regroup } from '../matches/m01';
import { solve } from '../matches/poly';
import { ALL_IDS, type CharId } from '../data/characters';
import { face } from './art';
import { button, h } from './dom';
import { PolyBoard } from './polyboard';
import { focus, type TutCtx, type VoicedGuide } from './voicetut';

const mini = (cells: [number, number][], w: number, hh: number, cls: string, size = 34, mark?: 'ng') =>
  h('div', { class: `tg-mini${mark ? ' ' + mark : ''}`, style: `width:${w * size}px;height:${hh * size}px` },
    cells.map(([x, y]) => h('i', { class: `pb-pc ${cls}`, style: `left:${x * size}px;top:${y * size}px;width:${size}px;height:${size}px;position:absolute` })));

/** 「第N競技」の呼び方（決勝は「決勝」）。収録が合わない時の字幕と、共通の部品の声のキー */
const orderLabel = (o: TutCtx['order']) => (o === 'final' ? t('vt.final') : t('vt.order', { n: o ?? 1 }));
const orderKey = (o: TutCtx['order']) => String(o ?? 1);

/**
 * M01。組の数と人数は、その場の参加者から作る（人数や顔ぶれが変わっても合う）。
 * 収録の前提（第 1 競技、3 組、全 6 ステージ）と場面が違う段階は、部品の声と字幕に切り替わる。
 */
function m01Voiced(ctx: TutCtx = {}): VoicedGuide {
  const players = (ctx.players?.length ? ctx.players : ALL_IDS) as CharId[];
  const groups = makeGroups(players);
  const after = regroup(groups);
  const name = 'ピース・アセンブル';
  return {
    name: 'ピース・アセンブル',
    steps: [
      {
        id: 'title', title: t('vt.m01.title'),
        facts: ctx.order === 'final' ? { order: 0 } : ctx.order ? { order: ctx.order } : undefined,
        alt: () => ({ text: `${orderLabel(ctx.order)}、${name}。`, parts: [{ slot: 'order', key: orderKey(ctx.order) }, { slot: 'name', key: 'm01' }] }),
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
        facts: { groups: groups.length, size: GROUP_SIZE, stages: STAGES, sec: STAGE_MS / 1000 },
        alt: () => ({ text: t('vt.m01.formatAlt', { size: GROUP_SIZE, groups: groups.length, stages: STAGES, sec: STAGE_MS / 1000 }) }),
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
        // 収録に無い決まり（字幕と図だけ）：ステージの間の休憩、途中の組替え、盤面が大きくなること
        id: 'between', title: t('vt.m01.between'),
        text: t('vt.m01.betweenText', { sec: BREAK_MS / 1000, half: Math.floor(STAGES / 2), next: Math.floor(STAGES / 2) + 1 }),
        build: () => {
          const row = (gs: CharId[][], label: string, k: string) => h('div', { class: 'vt-regroup', 'data-k': k }, h('small', null, label),
            h('div', { class: 'vt-groups' }, gs.map((g, i) => h('div', { class: 'vt-group' }, h('small', null, t('vt.m01.group', { n: i + 1 })), h('div', { class: 'row' }, g.map((id) => face(id)))))));
          const el = h('div', { class: 'col', style: 'gap:14px;align-items:center' },
            h('div', { class: 'tg-facts vt-facts' },
              h('div', { class: 'tg-fact', 'data-f': 'break' }, h('b', null, String(BREAK_MS / 1000)), h('small', null, t('vt.m01.breakSec'))),
              h('div', { class: 'tg-fact', 'data-f': 'size' }, h('b', null, '4×4 → 6×6'), h('small', null, t('vt.m01.grow')))),
            row(groups, t('vt.m01.firstHalf', { n: Math.floor(STAGES / 2) }), 'a'),
            h('span', { class: 'tg-arrow' }, '↓'),
            row(after, t('vt.m01.secondHalf', { n: Math.floor(STAGES / 2) + 1 }), 'b'));
          return { el, cues: [{ at: 0.02, run: () => focus(el, '[data-f="break"]') }, { at: 0.3, run: () => focus(el, '[data-k="b"]') }, { at: 0.75, run: () => focus(el, '[data-f="size"]') }] };
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

/** 競技 ID → 説明。ctx はその場の順番と参加者（無ければ収録どおりの場面とみなす） */
export const VOICED: Record<string, (ctx?: TutCtx) => VoicedGuide> = { m01: m01Voiced };
