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
import { BOOST_COST, BOOST_MAX, BOOST_MS, BREAK_MS as M02_BREAK_MS, M02_PRACTICE, QUESTIONS } from '../matches/m02';
import { AID_COST, M03_DEMO, M03_PRACTICE, PAIR_BONUS, POINTS, PREP_MS as M03_PREP_MS, PUZZLES, ROUNDS as M03_ROUNDS, ROUND_MS as M03_ROUND_MS, schedule } from '../matches/m03';
import { candCard } from './games/m02';
import { AID_COST as M04_AID_COST, applyAct as applyRail, BREAK_EVERY as M04_BREAK_EVERY, BREAK_MS as M04_BREAK_MS, CITY_NAMES, EDGES, INCOME, ROUNDS as M04_ROUNDS, START_FUNDS, TOLL, practiceTable, routeFor, tableSizes } from '../matches/m04';
import { Sound } from '../audio/audio';
import { RailMap, SEAT_COLORS, type RailMapData } from './railmap';
import { LinkBoard } from './linkboard';
import { boardFigure, MemQuiz } from './memquiz';

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
          // 数字の札は左に縦に並べ、組の図を上下 2 段にする（縦の高さを抑え、狭い画面でも顔を小さくしすぎない）
          const el = h('div', { class: 'row vt-between', style: 'gap:22px;align-items:center' },
            h('div', { class: 'tg-facts vt-facts col' },
              h('div', { class: 'tg-fact', 'data-f': 'break' }, h('b', null, String(BREAK_MS / 1000)), h('small', null, t('vt.m01.breakSec'))),
              h('div', { class: 'tg-fact', 'data-f': 'size' }, h('b', null, '4×4 → 6×6'), h('small', null, t('vt.m01.grow')))),
            h('div', { class: 'col', style: 'gap:2px;align-items:center' },
              row(groups, t('vt.m01.firstHalf', { n: Math.floor(STAGES / 2) }), 'a'),
              h('span', { class: 'tg-arrow' }, '↓'),
              row(after, t('vt.m01.secondHalf', { n: Math.floor(STAGES / 2) + 1 }), 'b')));
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

// ---- 共通の小さな図 ----

const titleCard = (no: string, name: string, en: string) => h('div', { class: 'vt-titlecard' }, h('small', null, `MAIN MATCH ${no}`), h('b', null, name), h('span', null, en));
const fact = (k: string, big: string, small: string) => h('div', { class: 'tg-fact', 'data-f': k }, h('b', null, big), h('small', null, small));
const factRow = (...items: HTMLElement[]) => h('div', { class: 'tg-facts vt-facts' }, items);
const chip = (k: string, label: string, v: string) => h('div', { class: 'm01-chip on', 'data-k': k }, h('small', null, label), h('b', null, v));
const cap = (k: string, text: string) => h('div', { class: 'tg-cap', 'data-k': k }, text);
const col = (...c: (HTMLElement | null)[]) => h('div', { class: 'col', style: 'gap:18px;align-items:center' }, c);
const playersOf = (ctx: TutCtx) => (ctx.players?.length ? ctx.players : ALL_IDS) as CharId[];

/**
 * M02 フラッグ・フラッシュ。ラウンドの数は参加者の数（全員が 1 回ずつ出題担当）。
 * 収録の「全11ラウンド」は 11 人の時だけ使い、人数が違えば字幕だけにする。
 */
function m02Voiced(ctx: TutCtx = {}): VoicedGuide {
  const players = playersOf(ctx);
  const rounds = players.length;
  const b = M02_PRACTICE.board;
  return {
    name: 'フラッグ・フラッシュ',
    steps: [
      { id: 'title', title: t('vt.m02.title'), build: () => ({ el: titleCard('02', 'フラッグ・フラッシュ', 'FLAG FLASH') }) },
      {
        id: 'basic_rules', title: t('vt.m02.rules'),
        build: () => {
          const shown = boardFigure(b, { cell: 92 });
          const hid = boardFigure(b, { cell: 92, hidden: true, marks: { 5: { cls: 'asked', label: '？' } } });
          hid.style.display = 'none';
          const kinds = h('div', { class: 'tg-opts vt-qkinds' }, (['place', 'item', 'present'] as const).map((k) => h('span', { class: 'm01-chip on', 'data-k': k }, h('b', null, t(`vt.m02.q.${k}`)))));
          const el = col(h('div', null, shown, hid), kinds, cap('kinds', t('vt.m02.qtypes')));
          return {
            el, cues: [
              { at: 0.05, run: () => focus(el, '.mq-board') },
              { at: 0.4, run: () => { shown.style.display = 'none'; hid.style.display = ''; focus(el, '.vt-qkinds'); } },
            ],
          };
        },
      },
      {
        id: 'questions', title: t('vt.m02.questions'),
        build: () => {
          const el = factRow(fact('flags', '6〜12', t('vt.m02.flags')), fact('q', String(QUESTIONS), t('vt.m02.perRound')));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-f="flags"]') }, { at: 0.55, run: () => focus(el, '[data-f="q"]') }] };
        },
      },
      {
        id: 'format', title: t('vt.m02.format'),
        facts: { rounds },
        alt: () => ({ text: t('vt.m02.formatAlt', { rounds }) }),
        build: () => {
          const el = col(factRow(fact('rounds', String(rounds), t('vt.m02.rounds'))),
            h('div', { class: 'row vt-order', style: 'gap:6px;flex-wrap:wrap;justify-content:center' }, players.map((id, i) => h('div', { class: 'vt-mate' }, face(id), h('em', { class: 'vt-plus on' }, String(i + 1))))));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-f="rounds"]') }, { at: 0.45, run: () => focus(el, '.vt-order') }] };
        },
      },
      {
        id: 'set_selection', title: t('vt.m02.pick'),
        build: () => {
          const el = col(h('div', { class: 'm02-cands' }, candCard({ mix: 'place', n: 8, showMs: 6300 }, 0), candCard({ mix: 'item', n: 11, showMs: 8100 }, 1), candCard({ mix: 'present', n: 9, showMs: 4500 }, 2)), cap('hidden', t('vt.m02.pickNote')));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '.m02-cands') }, { at: 0.5, run: () => focus(el, '[data-k="hidden"]') }] };
        },
      },
      {
        id: 'host_answers', title: t('vt.m02.host'),
        build: () => {
          const el = col(h('div', { class: 'row vt-big', style: 'gap:18px;align-items:center' }, face(players[0]), boardFigure(b, { cell: 60, hidden: true })), cap('host', t('vt.m02.hostNote')));
          return { el, cues: [{ at: 0.1, run: () => focus(el, '[data-k="host"]') }] };
        },
      },
      {
        id: 'scoring', title: t('vt.m02.scoring'),
        build: () => {
          const el = h('div', { class: 'm01-score' }, chip('per', t('vt.m02.per'), '10'), h('span', { class: 'plus' }, '+'), chip('all', t('vt.m02.all'), '10'));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-k="per"]') }, { at: 0.45, run: () => focus(el, '[data-k="all"]') }] };
        },
      },
      {
        id: 'tie_break', title: t('vt.m02.tie'),
        build: () => {
          const el = h('div', { class: 'col vt-tiers', style: 'gap:8px;align-items:stretch' },
            ['tie1', 'tie2', 'tie3', 'tie4'].map((k, i) => h('div', { class: 'tg-cap', 'data-k': k }, `${i + 1}. ${t(`vt.m02.${k}`)}`)));
          return { el, cues: [{ at: 0.02, run: () => focus(el, '[data-k="tie1"]') }, { at: 0.2, run: () => focus(el, '[data-k="tie2"]') }, { at: 0.55, run: () => focus(el, '[data-k="tie3"]') }] };
        },
      },
      {
        id: 'negotiation', title: t('vt.m02.talk'),
        build: () => {
          const el = col(factRow(fact('break', String(M02_BREAK_MS / 1000), t('vt.m02.breakSec'))),
            h('div', { class: 'row', style: 'gap:10px' }, ['tell1', 'tell2'].map((k, i) => h('div', { class: `m02-tellbtn s${i + 1}`, 'data-k': k }, face(players[i + 1] ?? players[0]), h('b', null, t(`m02.${k}`))))),
            cap('talk', t('vt.m02.talkNote')));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-f="break"]') }, { at: 0.35, run: () => focus(el, '[data-k="talk"]') }] };
        },
      },
      {
        id: 'piece_help', title: t('vt.m02.boost'),
        build: () => {
          const el = col(h('div', { class: 'm01-score' }, chip('cost', t('vt.m02.boostChip'), String(BOOST_COST)), h('span', { class: 'plus' }, '→'), chip('sec', t('vt.m02.boostSec'), `+${BOOST_MS / 1000}`)),
            factRow(fact('max', String(BOOST_MAX), t('vt.m02.boostNote'))));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-k="cost"]') }, { at: 0.3, run: () => focus(el, '[data-k="sec"]') }, { at: 0.6, run: () => focus(el, '[data-f="max"]') }] };
        },
      },
      {
        id: 'practice', title: t('tut.practice'),
        build: () => {
          let done: () => void = () => undefined;
          const task = new Promise<void>((res) => { done = res; });
          // 時計は練習を始めた時から数える（説明の間は大会の時計が止まっている）
          const start = performance.now();
          const q = new MemQuiz(M02_PRACTICE, { elapsed: () => performance.now() - start, onDone: () => done(), cell: 124 });
          return { el: h('div', { class: 'vt-demo' }, q.el), task, prompt: t('vt.m02.practice'), final: true };
        },
      },
    ],
  };
}

/** M03 の説明の盤面の解（M03_DEMO） */
const M03_DEMO_SOL = [[0, 4, 8, 12], [1, 2, 3, 7], [5, 6, 10, 14]];

/**
 * M03 ツイン・リンク。ペアの数とラウンドの数は参加者の数から決める（エンジンと同じ式）。
 * 収録の「五つのペア」「全5ラウンド」は 10 人の時だけ使い、違えば字幕だけにする。練習の段階は収録が無いので字幕だけ。
 */
function m03Voiced(ctx: TutCtx = {}): VoicedGuide {
  const players = playersOf(ctx);
  const n = players.length;
  const rounds = Math.min(M03_ROUNDS, Math.max(1, n % 2 ? n : n - 1));
  const pairs = Math.floor(n / 2);
  const first = schedule(players, rounds)[0] ?? [];
  const board = (paths: (number[] | null)[], cell = 76) => new LinkBoard(M03_DEMO, { readonly: true, cell, paths });
  return {
    name: 'ツイン・リンク',
    steps: [
      { id: 'title', title: t('vt.m03.title'), build: () => ({ el: titleCard('03', 'ツイン・リンク', 'TWIN LINK') }) },
      {
        id: 'basic_rules', title: t('vt.m03.rules'),
        build: () => {
          // 声に合わせて、端点だけの盤面から、結び終えた盤面に替える
          const el = h('div', { class: 'vt-demo' }, board([[], [], []], 84).el);
          return { el, cues: [{ at: 0.05, run: () => focus(el, '.lb') }, { at: 0.3, run: () => { el.replaceChildren(board(M03_DEMO_SOL, 84).el); focus(el, '.lb'); } }] };
        },
      },
      {
        id: 'board_conditions', title: t('vt.m03.board'),
        build: () => {
          const el = col(factRow(fact('size', '5〜7', t('vt.m03.size'))), h('div', { class: 'row', style: 'gap:18px;align-items:center' }, board(M03_DEMO_SOL, 54).el, cap('nofill', t('vt.m03.nofill'))));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-f="size"]') }, { at: 0.4, run: () => focus(el, '[data-k="nofill"]') }] };
        },
      },
      {
        id: 'controls', title: t('vt.m03.controls'),
        build: () => {
          let done: () => void = () => undefined;
          const task = new Promise<void>((res) => { done = res; });
          const lb = new LinkBoard(M03_DEMO, { cell: 96, onComplete: () => done() });
          const el = h('div', { class: 'vt-demo' }, lb.el);
          return { el, task, prompt: t('vt.m03.doLink'), cues: [{ at: 0.05, run: () => focus(el, '.lb') }] };
        },
      },
      {
        id: 'format', title: t('vt.m03.format'),
        facts: { pairs, rounds },
        alt: () => ({ text: t('vt.m03.formatAlt', { pairs, rounds }) }),
        build: () => {
          const el = col(
            h('div', { class: 'vt-groups vt-pairs' }, first.map(([a, bb], i) => h('div', { class: 'vt-group' }, h('small', null, t('vt.m03.pairN', { n: i + 1 })), h('div', { class: 'row' }, face(a), bb ? face(bb) : null)))),
            factRow(fact('rounds', String(rounds), t('vt.m02.rounds'))),
            n % 2 ? cap('odd', t('vt.m03.formatOdd')) : null);
          return { el, cues: [{ at: 0.02, run: () => focus(el, '.vt-group') }, { at: 0.4, run: () => focus(el, '[data-f="rounds"]') }] };
        },
      },
      {
        id: 'questions_time', title: t('vt.m03.qt'),
        build: () => {
          const el = factRow(fact('q', String(PUZZLES), t('vt.m03.puzzles')), fact('time', String(M03_ROUND_MS / 1000), t('vt.m03.sec')));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-f="q"]') }, { at: 0.5, run: () => focus(el, '[data-f="time"]') }] };
        },
      },
      {
        id: 'partner_hint', title: t('vt.m03.hint'),
        build: () => {
          const lb = board([[], [], []], 76);
          lb.setMarks({ color: 2, cells: [10] }, null);
          const el = col(h('div', { class: 'row vt-big', style: 'gap:18px;align-items:center' }, face(players[1] ?? players[0]), lb.el), cap('hint', t('vt.m03.hintNote')));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '.lb') }, { at: 0.5, run: () => focus(el, '[data-k="hint"]') }] };
        },
      },
      {
        id: 'information_sharing', title: t('vt.m03.share'),
        build: () => {
          const el = col(factRow(fact('prep', String(M03_PREP_MS / 1000), t('vt.m03.prepSec'))),
            h('div', { class: 'row', style: 'gap:12px' }, h('span', { class: 'btn', 'data-k': 'give' }, t('m03.share')), h('span', { class: 'btn', 'data-k': 'keep' }, t('m03.keep'))),
            cap('share', t('vt.m03.shareNote')));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-f="prep"]') }, { at: 0.3, run: () => focus(el, '[data-k="give"], [data-k="keep"]') }, { at: 0.75, run: () => focus(el, '[data-k="share"]') }] };
        },
      },
      {
        id: 'scoring', title: t('vt.m03.scoring'),
        build: () => {
          const el = col(h('div', { class: 'm01-score' }, chip('per', t('vt.m03.per'), String(POINTS)), h('span', { class: 'plus' }, '+'), chip('pair', t('vt.m03.pair'), String(PAIR_BONUS))), cap('tie', t('vt.m03.tieNote')));
          return { el, cues: [{ at: 0.02, run: () => focus(el, '[data-k="per"]') }, { at: 0.2, run: () => focus(el, '[data-k="pair"]') }, { at: 0.6, run: () => focus(el, '[data-k="tie"]') }] };
        },
      },
      {
        id: 'piece_help', title: t('vt.m03.aid'),
        build: () => {
          const lb = board([[], [], []], 70);
          lb.setMarks(null, { color: 0, cells: M03_DEMO_SOL[0].slice(0, 3) });
          const el = h('div', { class: 'row', style: 'gap:22px;align-items:center' }, lb.el,
            col(h('div', { class: 'm01-score' }, chip('cost', t('vt.m03.aidChip'), String(AID_COST)), h('span', { class: 'plus' }, '→'), chip('what', t('vt.m03.aidWhat'), '2')), cap('once', t('vt.m03.aidOnce'))));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-k="cost"]') }, { at: 0.3, run: () => focus(el, '.lb') }, { at: 0.7, run: () => focus(el, '[data-k="once"]') }] };
        },
      },
      {
        // 収録に無い段階（字幕と盤面だけ）
        id: 'practice', title: t('tut.practice'), text: t('tut.m03.practice'),
        build: () => {
          let done: () => void = () => undefined;
          const task = new Promise<void>((res) => { done = res; });
          const lb: LinkBoard = new LinkBoard(M03_PRACTICE, { cell: 84, onComplete: () => { lb.lock(); done(); } });
          return { el: h('div', { class: 'vt-demo' }, lb.el), task, prompt: t('tut.m03.practice'), final: true };
        },
      },
    ],
  };
}

/**
 * M04 鉄道王国・改。卓の分け方は参加者の数から決める（エンジンの tableSizes と同じ）。
 * 収録の「三人ずつ、三つの卓」は 9 人の時だけ使い、違えば字幕だけにする。巡数と通行料は、声では「画面の表示」を案内している。
 */
function m04Voiced(ctx: TutCtx = {}): VoicedGuide {
  const players = playersOf(ctx);
  const sizes = tableSizes(players.length);
  const allThree = sizes.every((n) => n === 3);
  const demo = practiceTable();
  const map = (owner: Record<number, number>, extra: Partial<RailMapData> = {}, scale = 0.62): HTMLElement => {
    const m = new RailMap(undefined, scale);
    m.draw({ costs: demo.costs, owner: EDGES.map((_, e) => owner[e] ?? -1), marks: ['自', '他'], ...extra });
    return m.el;
  };
  const mission = (from: number, to: number, pts: number, k?: string) => h('div', { class: 'm01-chip on vt-mission', 'data-k': k ?? '' }, h('small', null, `${CITY_NAMES[from]} → ${CITY_NAMES[to]}`), h('b', null, String(pts)));
  const sw = (c: string, label: string, k: string) => h('div', { class: 'row', 'data-k': k, style: 'gap:8px;align-items:center' }, h('i', { style: `display:inline-block;width:16px;height:16px;border-radius:4px;background:${c}` }), label);
  let start = 0;
  return {
    name: '鉄道王国・改',
    steps: [
      { id: 'title', title: t('vt.m04.title'), build: () => ({ el: titleCard('04', '鉄道王国・改', 'RAILWAY KINGDOM') }) },
      {
        id: 'format', title: t('vt.m04.format'),
        facts: { tables: sizes.length, size: allThree ? 3 : 0 },
        alt: () => ({ text: allThree ? t('vt.m04.formatAlt', { n: sizes.length }) : t('vt.m04.formatAltMix', { n: sizes.length }) }),
        build: () => {
          const el = col(h('div', { class: 'vt-groups vt-pairs' }, sizes.map((n, i) => { const g = players.slice(start, start + n); start += n; return h('div', { class: 'vt-group' }, h('small', null, t('vt.m04.table', { n: i + 1 })), h('div', { class: 'row' }, g.map((id) => face(id)))); })),
            cap('indiv', t('vt.m01.indiv')));
          start = 0;
          return { el, cues: [{ at: 0.05, run: () => focus(el, '.vt-group') }, { at: 0.5, run: () => focus(el, '[data-k="indiv"]') }] };
        },
      },
      {
        id: 'funds_missions', title: t('vt.m04.setup'),
        build: () => {
          const el = h('div', { class: 'row', style: 'gap:26px;align-items:center' }, factRow(fact('funds', String(START_FUNDS), t('vt.m04.funds'))),
            h('div', { class: 'col vt-missions', style: 'gap:8px' }, mission(0, 4, 6), mission(2, 6, 10), mission(3, 8, 8)));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-f="funds"]') }, { at: 0.35, run: () => focus(el, '.vt-missions') }] };
        },
      },
      {
        id: 'actions', title: t('vt.m04.actions'),
        build: () => {
          const el = h('div', { class: 'row', style: 'gap:14px' }, chip('build', t('vt.m04.aBuild'), '1'), chip('fund', t('vt.m04.aFund'), `+${INCOME}`), chip('move', t('vt.m04.aMove'), '3'));
          return { el, cues: [{ at: 0.15, run: () => focus(el, '[data-k="build"]') }, { at: 0.35, run: () => focus(el, '[data-k="fund"]') }, { at: 0.55, run: () => focus(el, '[data-k="move"]') }] };
        },
      },
      {
        id: 'build', title: t('vt.m04.build'),
        build: () => {
          const el = h('div', { class: 'vt-demo' }, map({ 0: 0 }, { sel: 8, cities: [0, 4] }, 0.8));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '.rm') }, { at: 0.55, run: () => el.replaceChildren(map({ 0: 0, 8: 0 }, { cities: [0, 4], fresh: [8] }, 0.8)) }] };
        },
      },
      {
        id: 'transport', title: t('vt.m04.transport'),
        build: () => {
          const el = h('div', { class: 'row', style: 'gap:22px;align-items:center' }, map({ 0: 0, 8: 1 }, { cities: [0, 4] }, 0.72), h('div', { class: 'col', style: 'gap:10px;align-items:center;max-width:300px' }, mission(0, 4, 6, 'ms'), cap('route', t('vt.m04.routeNote'))));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-k="ms"]') }, { at: 0.45, run: () => { el.firstElementChild?.replaceWith(map({ 0: 0, 8: 1 }, { cities: [0, 4], route: [0, 8] }, 0.72)); focus(el, '.rm'); } }] };
        },
      },
      {
        id: 'others_routes', title: t('vt.m04.toll'),
        build: () => {
          const el = h('div', { class: 'row', style: 'gap:22px;align-items:center' }, map({ 0: 0, 8: 1 }, { cities: [0, 4], route: [0, 8] }, 0.72),
            h('div', { class: 'col', style: 'gap:12px' }, sw(SEAT_COLORS[0], t('tut.m04.own'), 'own'), sw(SEAT_COLORS[1], t('vt.m04.tollNote', { n: TOLL }), 'toll'), cap('noref', t('vt.m04.noRefuse'))));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-k="toll"]') }, { at: 0.7, run: () => focus(el, '[data-k="noref"]') }] };
        },
      },
      {
        id: 'scoring', title: t('vt.m04.scoring'),
        build: () => {
          const el = h('div', { class: 'm01-score' }, chip('ms', t('tut.m04.c1'), '6〜12'), h('span', { class: 'plus' }, '+'), chip('rail', t('tut.m04.c2'), '1'), h('span', { class: 'plus' }, '+'), chip('fund', t('vt.m04.fund3'), '1'));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-k="ms"]') }, { at: 0.45, run: () => focus(el, '[data-k="rail"]') }, { at: 0.7, run: () => focus(el, '[data-k="fund"]') }] };
        },
      },
      {
        id: 'tie_break', title: t('vt.m02.tie'),
        build: () => {
          const el = h('div', { class: 'col vt-tiers', style: 'gap:8px;align-items:stretch' },
            ['tie1', 'tie2', 'tie3', 'tie4'].map((k, i) => h('div', { class: 'tg-cap', 'data-k': k }, `${i + 1}. ${t(`vt.m04.${k}`)}`)));
          return { el, cues: [{ at: 0.02, run: () => focus(el, '[data-k="tie1"]') }, { at: 0.15, run: () => focus(el, '[data-k="tie2"]') }, { at: 0.6, run: () => focus(el, '[data-k="tie3"]') }] };
        },
      },
      {
        id: 'negotiation', title: t('vt.m04.talk'),
        build: () => {
          const el = col(factRow(fact('break', String(M04_BREAK_MS / 1000), t('vt.m04.breakSec', { n: M04_BREAK_EVERY }))), cap('talk', t('vt.m04.talkNote')));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-f="break"]') }, { at: 0.4, run: () => focus(el, '[data-k="talk"]') }] };
        },
      },
      {
        id: 'piece_help', title: t('vt.m04.aid'),
        build: () => {
          const el = col(h('div', { class: 'row', style: 'gap:14px;align-items:center' }, mission(2, 6, 10, 'old'), h('span', { class: 'tg-arrow' }, '→'), mission(0, 8, 10, 'c1'), mission(6, 2, 10, 'c2')),
            h('div', { class: 'm01-score' }, chip('cost', t('vt.m04.aidChip'), String(M04_AID_COST))), cap('once', t('vt.m04.aidNote')));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-k="cost"]') }, { at: 0.3, run: () => focus(el, '[data-k="old"]') }, { at: 0.55, run: () => focus(el, '[data-k="c1"], [data-k="c2"]') }, { at: 0.85, run: () => focus(el, '[data-k="once"]') }] };
        },
      },
      {
        id: 'end_condition', title: t('vt.m04.end'),
        build: () => {
          const el = factRow(fact('rounds', String(M04_ROUNDS), t('vt.m04.rounds')));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-f="rounds"]') }] };
        },
      },
      {
        // 収録に無い段階（字幕と盤面だけ）。tutorial.ts の練習と同じ
        id: 'practice', title: t('tut.practice'), text: t('tut.m04.practice'),
        build: () => {
          let done: () => void = () => undefined;
          const task = new Promise<void>((res) => { done = res; });
          const tb = practiceTable();
          let sel: number | undefined;
          const box = h('div', { class: 'm04-play' });
          const rm = new RailMap((e) => { sel = sel === e ? undefined : e; draw(); }, 0.7);
          const draw = (): void => {
            const m = tb.missions[0][0];
            const r = routeFor(tb, 0, m.from, m.to);
            rm.draw({ costs: tb.costs, owner: tb.owner, marks: ['自'], sel, cities: [m.from, m.to], route: r?.edges });
            const cost = sel !== undefined ? tb.costs[sel] : 0;
            box.replaceChildren(rm.el, h('div', { class: 'm04-col', style: 'width:250px' },
              h('div', { class: 'm04-me' }, h('span', { class: 'm04-fund' }, String(tb.funds[0])), h('span', { class: 'small dim' }, `${CITY_NAMES[m.from]} → ${CITY_NAMES[m.to]}`)),
              button(sel !== undefined ? t('m04.build', { e: `${CITY_NAMES[EDGES[sel][0]]}–${CITY_NAMES[EDGES[sel][1]]}`, c: cost }) : t('m04.buildNone'), () => {
                if (sel === undefined) return;
                tb.turn = 0;
                if (applyRail(tb, 0, { t: 'build', edge: sel })) Sound.se('chip');
                sel = undefined;
                draw();
              }, { kind: 'primary', disabled: sel === undefined || cost > tb.funds[0] }),
              button(t('m04.fund', { n: INCOME }), () => { tb.turn = 0; applyRail(tb, 0, { t: 'fund' }); draw(); }, {}),
              button(t('m04.move'), () => { tb.turn = 0; if (applyRail(tb, 0, { t: 'transport', mission: 0 })) { draw(); done(); } }, { kind: 'primary', disabled: !r || m.done })));
          };
          draw();
          return { el: box, task, prompt: t('tut.m04.practice'), final: true };
        },
      },
    ],
  };
}

/** 競技 ID → 説明。ctx はその場の順番と参加者（無ければ収録どおりの場面とみなす） */
export const VOICED: Record<string, (ctx?: TutCtx) => VoicedGuide> = { m01: m01Voiced, m02: m02Voiced, m03: m03Voiced, m04: m04Voiced };
