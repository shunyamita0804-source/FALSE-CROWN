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
import { button, clear, h } from './dom';
import { PolyBoard } from './polyboard';
import { focus, type TutCtx, type VoicedGuide, type VoicedStep } from './voicetut';
import { BOOST_COST, BOOST_MAX, BOOST_MS, BREAK_MS as M02_BREAK_MS, M02_PRACTICE, QUESTIONS } from '../matches/m02';
import { AID_COST, M03_DEMO, M03_PRACTICE, PAIR_BONUS, POINTS, PREP_MS as M03_PREP_MS, PUZZLES, ROUNDS as M03_ROUNDS, ROUND_MS as M03_ROUND_MS, schedule } from '../matches/m03';
import { candCard } from './games/m02';
import { AID_COST as M04_AID_COST, applyAct as applyRail, BREAK_EVERY as M04_BREAK_EVERY, BREAK_MS as M04_BREAK_MS, CITY_NAMES, EDGES, INCOME, ROUNDS as M04_ROUNDS, START_FUNDS, TOLL, practiceTable, routeFor, tableSizes } from '../matches/m04';
import { Sound } from '../audio/audio';
import { CARD_MAX, CORRECT, EXTRA_COST, EXTRA_MAX, M05_PRACTICE, PER_CARD, PREP_MS as M05_PREP_MS, ROUNDS as M05_ROUNDS, SOLVE_MS, TEAM_BONUS, TIME_MAX, type Tok } from '../matches/m05';
import { ExprPad, exprEl } from './exprpad';
import { AID_COST as M06_AID_COST, BREAK_MS as M06_BREAK_MS, FLUSH_PTS, MATCH_PTS, ROUNDS as M06_ROUNDS, TOP_PTS, TRIPLE_PTS, matchesIn } from '../matches/m06';
import { cardBack, cardEl } from './cards';
import { AID_COST as M07_AID_COST, BREAK_MS as M07_BREAK_MS, CENTER_PTS, G as HEX7, LINK_PTS, ROUNDS as M07_ROUNDS, START_TILES, beaconCell, isCenter, startCell as hexStart } from '../matches/m07';
import { cellAt as hexAt } from '../matches/hex';
import { TilePlacer, type PlacerSel } from './tileplacer';
import { BREAK_MS as M08_BREAK_MS, EDGES as M08_EDGES, MOVE_MS as M08_MOVE_MS, ROUNDS as M08_ROUNDS, WALLS as M08_WALLS, edgeBetween as m08Edge, movesFor as m08Moves, nodeOf as m08Node, startNode as m08Start, wallsFor as m08Walls } from '../matches/m08';
import { ringBoard } from './ringboard';
import { practiceOf } from './tutorial';
import { ALIVE_PTS, BREAK_MS as M09_BREAK_MS, CENTER as M09_CENTER, CENTER_PTS as M09_CENTER_PTS, KING_PTS, MOVE_MS as M09_MOVE_MS, ROUNDS as M09_ROUNDS, SOLDIER_PTS, startPieces as m09Start, type Piece as M09Piece } from '../matches/m09';
import { M09_COLORS } from './games/m09';
import { pieceBoard } from './pieceboard';
import { BREAK_MS as M10_BREAK_MS, CAP_PTS, DELIVER_PTS, GEM_USES, HOLD_PTS, HOME_PTS, MOVE_MS as M10_MOVE_MS, PEACE, ROUNDS as M10_ROUNDS, startBoard as m10Start, type Board as M10Board } from '../matches/m10';
import { triBoard } from './triboard';
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

/**
 * M05 ナンバー・リレー。組の分け方は参加者（最大 8 人）から決める（エンジンの init と同じ：前半は半分ずつ、後半は両方の組から同じ数ずつ）。
 * 収録の「四人ずつ二つ」「一人につき2回」は 4 人の組の時だけ使い、違えば字幕だけにする。
 */
function m05Voiced(ctx: TutCtx = {}): VoicedGuide {
  const players = playersOf(ctx).slice(0, 8);
  const half = Math.ceil(players.length / 2);
  const a = players.slice(0, half);
  const b = players.slice(half);
  const ha = Math.ceil(a.length / 2);
  const hb = Math.floor(b.length / 2);
  const before = [a, b];
  const after = [[...a.slice(0, ha), ...b.slice(0, hb)], [...a.slice(ha), ...b.slice(hb)]];
  const size = a.length === 4 && b.length === 4 ? 4 : 0;
  const { cards, target } = M05_PRACTICE;
  const ex3: Tok[] = ['(', 2, '-', 0, ')', '*', 3];
  const ex6: Tok[] = [0, '+', 2, '*', '(', 3, '-', 1, ')', '+', 5, '-', 4];
  const nums = (extra?: number) => h('div', { class: 'm05-nums row', style: 'gap:8px' }, cards.map((c) => h('b', { class: 'xp-card mini' }, String(c))), extra !== undefined ? h('b', { class: 'xp-card mini extra', 'data-k': 'extra' }, String(extra)) : null);
  const tgt = () => h('div', { class: 'xp-target' }, h('small', null, t('xp.target')), h('b', null, String(target)));
  const line = (toks: Tok[], k: string) => h('div', { class: 'tg-exline', 'data-k': k }, exprEl(toks, cards, 'small'), h('span', { class: 'xp-val ok' }, `＝ ${target}`));
  const groupsRow = (gs: CharId[][], label: string, k: string) => h('div', { class: 'vt-regroup', 'data-k': k }, h('small', null, label),
    h('div', { class: 'vt-groups' }, gs.map((g, i) => h('div', { class: 'vt-group' }, h('small', null, t('vt.m01.group', { n: i + 1 })), h('div', { class: 'row' }, g.map((id) => face(id)))))));
  const half4 = M05_ROUNDS / 2;
  return {
    name: 'ナンバー・リレー',
    steps: [
      { id: 'title', title: t('vt.m05.title'), build: () => ({ el: titleCard('05', 'ナンバー・リレー', 'NUMBER RELAY') }) },
      {
        id: 'format', title: t('vt.m05.format'),
        facts: { groups: 2, size },
        alt: () => ({ text: t('vt.m05.formatAlt', { rounds: M05_ROUNDS, half: half4 }) }),
        build: () => {
          const el = h('div', { class: 'col vt-between', style: 'gap:2px;align-items:center' },
            groupsRow(before, t('vt.m05.first', { n: half4 }), 'a'), h('span', { class: 'tg-arrow' }, '↓'), groupsRow(after, t('vt.m05.second', { n: half4 + 1 }), 'b'));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-k="a"]') }, { at: 0.55, run: () => focus(el, '[data-k="b"]') }] };
        },
      },
      {
        id: 'setter', title: t('vt.m05.setter'),
        facts: { size },
        alt: () => ({ text: t('vt.m05.setterAlt') }),
        build: () => {
          const el = col(h('div', { class: 'row vt-big', style: 'gap:18px;align-items:center' }, face(players[0]), h('div', { class: 'm05-cands' }, [38, 45, 57].map((c, i) => h('div', { class: `m05-cand${i === 1 ? ' sel' : ''}` }, String(c))))), cap('ans', t('vt.m05.hostAns')));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '.vt-big .face') }, { at: 0.3, run: () => focus(el, '.m05-cands') }, { at: 0.8, run: () => focus(el, '[data-k="ans"]') }] };
        },
      },
      {
        id: 'basic_rules', title: t('vt.m05.rules'),
        build: () => {
          const el = col(nums(), tgt(), line(ex3, 'ex'));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '.m05-nums') }, { at: 0.45, run: () => focus(el, '.xp-target') }, { at: 0.7, run: () => focus(el, '[data-k="ex"]') }] };
        },
      },
      {
        id: 'operations', title: t('vt.m05.ops'),
        build: () => {
          const el = col(h('div', { class: 'row vt-ops', style: 'gap:10px' }, ['＋', '−', '×', '÷', '（ ）'].map((o) => h('b', { class: 'm05-cand' }, o))), line(ex6, 'ex'), cap('once', t('vt.m05.once')));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '.vt-ops') }, { at: 0.35, run: () => focus(el, '[data-k="ex"]') }, { at: 0.7, run: () => focus(el, '[data-k="once"]') }] };
        },
      },
      {
        id: 'division', title: t('vt.m05.div'),
        build: () => {
          const el = col(h('div', { class: 'tg-cap', 'data-k': 'frac' }, t('vt.m05.frac')), h('div', { class: 'tg-cap', 'data-k': 'zero' }, t('vt.m05.zero')));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-k="frac"]') }, { at: 0.75, run: () => focus(el, '[data-k="zero"]') }] };
        },
      },
      {
        id: 'controls_time', title: t('vt.m05.controls'),
        build: () => {
          const pad = new ExprPad(cards, target, { onSubmit: () => undefined });
          const el = h('div', { class: 'row', style: 'gap:22px;align-items:center' }, h('div', { class: 'vt-demo' }, pad.el), factRow(fact('time', String(SOLVE_MS / 1000), t('vt.m05.sec'))));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '.xp-cards') }, { at: 0.25, run: () => focus(el, '.xp-ops') }, { at: 0.65, run: () => focus(el, '[data-f="time"]') }] };
        },
      },
      {
        id: 'scoring', title: t('vt.m05.scoring'),
        build: () => {
          const el = h('div', { class: 'm01-score' }, chip('ok', t('vt.m05.correct'), String(CORRECT)), h('span', { class: 'plus' }, '+'), chip('card', t('vt.m05.perCard', { n: PER_CARD }), `〜${CARD_MAX}`), h('span', { class: 'plus' }, '+'), chip('time', t('vt.m05.timeBonus'), `〜${TIME_MAX}`));
          return { el, cues: [{ at: 0.02, run: () => focus(el, '[data-k="ok"]') }, { at: 0.25, run: () => focus(el, '[data-k="card"]') }, { at: 0.65, run: () => focus(el, '[data-k="time"]') }] };
        },
      },
      {
        id: 'cooperation', title: t('vt.m05.coop'),
        build: () => {
          const g = before[0];
          const el = col(h('div', { class: 'vt-group vt-team' }, h('div', { class: 'row' }, g.map((id) => h('div', { class: 'vt-mate' }, face(id), h('i', { class: 'vt-check on' }, '✓'), h('em', { class: 'vt-plus on' }, `+${TEAM_BONUS}`))))),
            factRow(fact('prep', String(M05_PREP_MS / 1000), t('vt.m05.prepSec'))), cap('share', t('vt.m05.shareNote')));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '.vt-team') }, { at: 0.3, run: () => focus(el, '[data-f="prep"]') }, { at: 0.6, run: () => focus(el, '[data-k="share"]') }] };
        },
      },
      {
        id: 'piece_help', title: t('vt.m05.extra'),
        build: () => {
          const el = col(nums(7), h('div', { class: 'm01-score' }, chip('cost', t('vt.m05.extraChip'), String(EXTRA_COST)), h('span', { class: 'plus' }, '→'), chip('card', t('vt.m05.extraCard'), '+1')), cap('max', t('vt.m05.extraNote', { n: EXTRA_MAX })));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-k="cost"]') }, { at: 0.3, run: () => focus(el, '[data-k="extra"]') }, { at: 0.7, run: () => focus(el, '[data-k="max"]') }] };
        },
      },
      {
        id: 'ranking', title: t('vt.m02.tie'),
        build: () => {
          const el = h('div', { class: 'col vt-tiers', style: 'gap:8px;align-items:stretch' },
            ['tie1', 'tie2', 'tie3', 'tie4'].map((k, i) => h('div', { class: 'tg-cap', 'data-k': k }, `${i + 1}. ${t(`vt.m05.${k}`)}`)));
          return { el, cues: [{ at: 0.02, run: () => focus(el, '[data-k="tie1"]') }, { at: 0.25, run: () => focus(el, '[data-k="tie2"]') }, { at: 0.6, run: () => focus(el, '[data-k="tie3"]') }] };
        },
      },
      {
        // 収録に無い段階（字幕と式の板だけ）
        id: 'practice', title: t('tut.practice'), text: t('tut.m05.practice'),
        build: () => {
          let done: () => void = () => undefined;
          const task = new Promise<void>((res) => { done = res; });
          const pad = new ExprPad(cards, target, { onSubmit: () => done() });
          return { el: h('div', { class: 'vt-demo' }, pad.el), task, prompt: t('tut.m05.practice'), final: true };
        },
      },
    ],
  };
}

/**
 * M06 クロス・カード。個人戦。収録の「参加者7人」は 7 人の時だけ使い、違えば字幕だけにする。
 * 終了時のボーナスの点は、声では「画面のボーナス欄」を案内している（数は図に出す）。
 */
function m06Voiced(ctx: TutCtx = {}): VoicedGuide {
  const players = playersOf(ctx);
  const cd = (rank: number, suit: number) => suit * 13 + rank - 1;
  const hand0 = [cd(4, 0), cd(9, 3), cd(2, 1), cd(12, 2), cd(6, 0)];
  const field0 = [cd(9, 2), cd(3, 3), cd(13, 0), cd(5, 1), cd(7, 2)];
  const row = (cards: number[], mark: number[] = [], k = '') => h('div', { class: 'xc-row mini', 'data-k': k }, cards.map((c) => cardEl(c, { cls: `small${mark.includes(c) ? ' sel' : ''}` })));
  const lbl = (text: string, el: HTMLElement) => h('div', { class: 'row', style: 'gap:10px;align-items:center' }, h('span', { class: 'xc-lbl' }, text), el);
  const tg = (k: string) => h('span', { class: 'xc-target', 'data-k': k }, t(`m06.tg.${k}`));
  return {
    name: 'クロス・カード',
    steps: [
      { id: 'title', title: t('vt.m06.title'), build: () => ({ el: titleCard('06', 'クロス・カード', 'CROSS CARD') }) },
      {
        id: 'format', title: t('vt.m06.format'),
        facts: { players: players.length },
        alt: () => ({ text: t('vt.m06.formatAlt', { n: players.length, rounds: M06_ROUNDS }) }),
        build: () => {
          const el = col(h('div', { class: 'row vt-order', style: 'gap:6px;flex-wrap:wrap;justify-content:center' }, players.map((id) => face(id))), factRow(fact('rounds', String(M06_ROUNDS), t('vt.m02.rounds'))),
            h('div', { class: 'col', style: 'gap:8px' }, lbl(t('m06.field'), row(field0, [], 'field')), lbl(t('m06.hand'), row(hand0, [], 'hand'))));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '.vt-order') }, { at: 0.3, run: () => focus(el, '[data-f="rounds"]') }, { at: 0.6, run: () => focus(el, '[data-k="hand"]') }, { at: 0.8, run: () => focus(el, '[data-k="field"]') }] };
        },
      },
      {
        id: 'cards', title: t('vt.m06.cards'),
        build: () => {
          const el = col(row([cd(1, 0), cd(1, 1), cd(1, 2), cd(1, 3)], [], 'suits'), row([cd(1, 0), cd(7, 0), cd(11, 0), cd(12, 0), cd(13, 0)], [], 'ranks'),
            h('div', { class: 'col', style: 'gap:8px' }, lbl(t('m06.hand'), row(hand0, [], 'hand')), lbl(t('m06.field'), h('div', { class: 'row', style: 'gap:6px' }, row(field0, [], 'field'), cardBack('small')))));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-k="suits"]') }, { at: 0.25, run: () => focus(el, '[data-k="ranks"]') }, { at: 0.6, run: () => focus(el, '[data-k="hand"]') }, { at: 0.8, run: () => focus(el, '[data-k="field"]') }] };
        },
      },
      {
        id: 'exchange', title: t('vt.m06.exchange'),
        build: () => {
          const el = col(lbl(t('m06.field'), row(field0, [cd(9, 2)], 'field')), h('span', { class: 'tg-arrow' }, '⇅'), lbl(t('m06.hand'), row(hand0, [cd(4, 0)], 'hand')), cap('pass', t('vt.m06.passNote')));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-k="hand"]') }, { at: 0.2, run: () => focus(el, '[data-k="field"]') }, { at: 0.45, run: () => focus(el, '[data-k="pass"]') }] };
        },
      },
      {
        id: 'target', title: t('vt.m06.target'),
        build: () => {
          const el = h('div', { class: 'row', style: 'gap:18px;align-items:flex-start' },
            ...[['pair', [cd(9, 3), cd(9, 2)]], ['suit', [cd(4, 0), cd(12, 0)]], ['run', [cd(6, 0), cd(7, 2)]]].map(([k, cs]) => h('div', { class: 'col', style: 'gap:8px;align-items:center' }, tg(k as string), row(cs as number[]))));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '.xc-target') }, { at: 0.35, run: () => focus(el, '[data-k="pair"]') }, { at: 0.5, run: () => focus(el, '[data-k="suit"]') }, { at: 0.65, run: () => focus(el, '[data-k="run"]') }] };
        },
      },
      {
        id: 'submit', title: t('vt.m06.submit'),
        build: () => {
          const el = col(tg('pair'), h('div', { class: 'row', style: 'gap:8px' }, cardBack('small'), cardBack('small')), cap('max', t('vt.m06.upTo2')));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-k="max"]') }, { at: 0.6, run: () => focus(el, '[data-k="pair"]') }] };
        },
      },
      {
        id: 'scoring', title: t('vt.m06.scoring'),
        build: () => {
          const el = col(h('div', { class: 'm01-score' }, chip('ok', t('vt.m06.done'), `+${MATCH_PTS}`), h('span', { class: 'plus' }, '+'), chip('top', t('vt.m06.top'), `+${TOP_PTS}`)), cap('top', t('vt.m06.topNote')));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-k="ok"]') }, { at: 0.6, run: () => focus(el, '.tg-cap[data-k="top"]') }] };
        },
      },
      {
        id: 'refill', title: t('vt.m06.refill'),
        build: () => {
          const el = col(h('div', { class: 'row', style: 'gap:22px;align-items:center' }, h('div', { class: 'col', style: 'gap:6px;align-items:center', 'data-k': 'disc' }, h('small', null, t('vt.m06.discard')), row([cd(9, 3), cd(9, 2)])), h('div', { class: 'col', style: 'gap:6px;align-items:center', 'data-k': 'deck' }, h('small', null, t('vt.m06.deck')), cardBack('small'))),
            cap('last', t('vt.m06.lastNote')));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-k="disc"]') }, { at: 0.3, run: () => focus(el, '[data-k="deck"]') }, { at: 0.85, run: () => focus(el, '[data-k="last"]') }] };
        },
      },
      {
        id: 'final_bonus', title: t('vt.m06.bonus'),
        build: () => {
          const el = h('div', { class: 'col', style: 'gap:12px;align-items:center' },
            h('div', { class: 'row', style: 'gap:14px;align-items:center', 'data-k': 'tri' }, row([cd(8, 0), cd(8, 1), cd(8, 3)]), h('b', { class: 'gold' }, `+${TRIPLE_PTS}`)),
            h('div', { class: 'row', style: 'gap:14px;align-items:center', 'data-k': 'fl' }, row([cd(2, 2), cd(5, 2), cd(10, 2), cd(13, 2)]), h('b', { class: 'gold' }, `+${FLUSH_PTS}`)),
            cap('both', t('vt.m06.both')));
          return { el, cues: [{ at: 0.2, run: () => focus(el, '[data-k="tri"]') }, { at: 0.4, run: () => focus(el, '[data-k="fl"]') }, { at: 0.7, run: () => focus(el, '[data-k="both"]') }] };
        },
      },
      {
        id: 'negotiation', title: t('vt.m06.talk'),
        build: () => {
          const el = col(factRow(fact('break', String(M06_BREAK_MS / 1000), t('vt.m06.breakSec'))), cap('talk', t('vt.m06.talkNote')));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-f="break"]') }, { at: 0.75, run: () => focus(el, '[data-k="talk"]') }] };
        },
      },
      {
        id: 'piece_help', title: t('vt.m06.aid'),
        build: () => {
          const el = col(h('div', { class: 'row', style: 'gap:14px;align-items:center' }, row([cd(2, 1)], [], 'old'), h('span', { class: 'tg-arrow' }, '⇄'), h('div', { 'data-k': 'deck' }, cardBack('small'))),
            h('div', { class: 'm01-score' }, chip('cost', t('vt.m04.aidChip'), String(M06_AID_COST))), cap('once', t('vt.m06.aidNote')));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-k="cost"]') }, { at: 0.25, run: () => focus(el, '[data-k="deck"]') }, { at: 0.6, run: () => focus(el, '[data-k="once"]') }] };
        },
      },
      {
        id: 'ranking', title: t('vt.m02.tie'),
        build: () => {
          const el = h('div', { class: 'col vt-tiers', style: 'gap:8px;align-items:stretch' },
            ['tie1', 'tie2', 'tie3', 'tie4'].map((k, i) => h('div', { class: 'tg-cap', 'data-k': k }, `${i + 1}. ${t(`vt.m06.${k}`)}`)));
          return { el, cues: [{ at: 0.02, run: () => focus(el, '[data-k="tie1"]') }, { at: 0.2, run: () => focus(el, '[data-k="tie2"]') }, { at: 0.55, run: () => focus(el, '[data-k="tie3"]') }] };
        },
      },
      {
        // 収録に無い段階（字幕と札だけ）。tutorial.ts の練習と同じ
        id: 'practice', title: t('tut.practice'), text: t('tut.m06.practice'),
        build: () => {
          let finish: () => void = () => undefined;
          const task = new Promise<void>((res) => { finish = res; });
          const box = h('div', { class: 'xc prac' });
          let hand = [...hand0];
          let field = [...field0];
          let sh: number | undefined;
          let sf: number | undefined;
          let msg = t('m06.swapHow');
          let done = false;
          const draw = (): void => {
            const mk = (c: number, sel: boolean, on: () => void) => { const el = cardEl(c, { button: true, disabled: done, cls: `small${sel ? ' sel' : ''}` }); el.addEventListener('click', on); return el; };
            const swap = button(t('m06.swap'), () => {
              const nh = hand.map((c) => (c === sh ? sf! : c));
              if (!matchesIn('pair', nh).length) { msg = t('tut.m06.pracNg'); sh = sf = undefined; draw(); return; }
              field = field.map((c) => (c === sf ? sh! : c));
              hand = nh;
              sh = sf = undefined;
              done = true;
              msg = t('tut.m06.pracDone');
              draw();
              finish();
            }, { kind: 'primary', disabled: done || sh === undefined || sf === undefined });
            box.replaceChildren(
              h('div', { class: 'xc-head' }, h('span', { class: 'small dim' }, t('m06.targetIs')), h('span', { class: 'xc-target big' }, t('m06.tg.pair'))),
              h('div', { class: 'xc-row' }, h('span', { class: 'xc-lbl' }, t('m06.field')), field.map((c) => mk(c, sf === c, () => { sf = sf === c ? undefined : c; draw(); }))),
              h('div', { class: 'xc-row hand' }, h('span', { class: 'xc-lbl' }, t('m06.hand')), hand.map((c) => mk(c, sh === c, () => { sh = sh === c ? undefined : c; draw(); }))),
              h('div', { class: 'xc-foot' }, h('span', { class: 'small xc-note' }, msg), swap));
          };
          draw();
          return { el: box, task, prompt: t('tut.m06.practice'), final: true };
        },
      },
    ],
  };
}

/** 六角盤の 2 マスを結ぶ直線のマス（説明の図用） */
function hexLine(a: number, b: number): number[] {
  const [q1, r1] = HEX7.cells[a];
  const [q2, r2] = HEX7.cells[b];
  const n = Math.max(Math.abs(q1 - q2), Math.abs(r1 - r2), Math.abs(q1 + r1 - q2 - r2));
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const k = n ? i / n : 0;
    const q = q1 + (q2 - q1) * k + 1e-6;
    const r = r1 + (r2 - r1) * k + 1e-6;
    const x = -q - r;
    let rq = Math.round(q); let rr = Math.round(r); const rx = Math.round(x);
    const dq = Math.abs(rq - q); const dr = Math.abs(rr - r); const dx = Math.abs(rx - x);
    if (dq > dr && dq > dx) rq = -rr - rx; else if (dr > dx) rr = -rq - rx;
    const c = hexAt(HEX7, rq, rr);
    if (c >= 0 && !out.includes(c)) out.push(c);
  }
  return out;
}

/**
 * M07 六角領域。収録の「参加者6人」は 6 人の時だけ使い、違えば字幕だけにする。
 * 収録はまとめ録りではなく 1 本ずつ（本人の対応表と、発話内容で 07・09 を対応づけた）。
 */
function m07Voiced(ctx: TutCtx = {}): VoicedGuide {
  const players = playersOf(ctx);
  const seats = [0, 1, 2, 3, 4, 5];
  const base = () => { const o = new Array<number>(HEX7.cells.length).fill(-1); seats.forEach((x) => { o[hexStart(x)] = x; }); return o; };
  const at = (q: number, r: number) => hexAt(HEX7, q, r);
  const withCells = (list: [number, number, number][]) => { const o = base(); for (const [q, r, x] of list) o[at(q, r)] = x; return o; };
  const placer = (owner: number[], size = 24, fresh: number[] = [], tiles: string[] = []) => new TilePlacer({ owner, seat: 0, seats, tiles, cap: 4, size, active: false, fresh, sel: { rot: 0 }, onChange: () => {} });
  const fig = (owner: number[], size = 24, fresh: number[] = []) => placer(owner, size, fresh).board;
  const mine: [number, number, number][] = [[3, 0, 0], [3, 1, 0]];
  const center = HEX7.cells.map((_, c) => c).filter(isCenter);
  const link = hexLine(hexStart(0), beaconCell(0));
  const linked = () => { const o = base(); link.forEach((c) => { o[c] = 0; }); return o; };
  /** 置く操作の板（操作の段階と練習で使う）。置けたら task が済む */
  const placeBoard = (tilesStart: string[], cap: number): { el: HTMLElement; task: Promise<void> } => {
          let done: () => void = () => undefined;
          const task = new Promise<void>((res) => { done = res; });
          const box = h('div', { class: 'hx7 prac' });
          let owner = withCells(mine);
          const sel: PlacerSel = { rot: 0 };
          let placed = false;
          const draw = (): void => {
            clear(box);
            const foot = h('div', { class: 'hx7-foot' });
            const note = h('div', { class: 'small hx7-note' });
            const upd = (): void => {
              const g = pl.ghost();
              note.textContent = placed ? t('tut.m07.pracDone') : !sel.shape ? t('m07.howPick', { n: cap }) : !g ? t('m07.howPut') : g.ok ? t('m07.howOk', { n: g.cells.length }) : t('m07.howBad');
              clear(foot);
              if (placed) return;
              foot.append(
                button('⟲', () => pl.rotate(-1), { small: true, disabled: !sel.shape }),
                button('⟳', () => pl.rotate(1), { small: true, disabled: !sel.shape }),
                button(t('m07.put'), () => {
                  const gg = pl.ghost();
                  if (!gg?.ok) return;
                  owner = [...owner];
                  for (const c of gg.cells) owner[c] = 0;
                  placed = true;
                  Sound.se('chip');
                  draw();
                  done();
                }, { kind: 'primary', disabled: !g?.ok }));
            };
            const pl = new TilePlacer({ owner, seat: 0, seats, tiles: placed ? [] : tilesStart, cap, size: 24, active: !placed, sel, onChange: upd });
            upd();
            box.append(h('div', { class: 'hx7-left' }, pl.board), h('div', { class: 'hx7-panel' }, pl.tray, note, foot));
          };
          draw();
    return { el: box, task };
  };
  return {
    name: '六角領域',
    steps: [
      { id: 'title', title: t('vt.m07.title'), build: () => ({ el: titleCard('07', '六角領域', 'HEX DOMAIN') }) },
      {
        id: 'board', title: t('vt.m07.board'),
        facts: { players: players.length },
        alt: () => ({ text: t('vt.m07.boardAlt', { n: players.length }) }),
        build: () => {
          const el = h('div', { class: 'row', style: 'gap:22px;align-items:center' }, fig(base(), 26),
            col(factRow(fact('cells', String(HEX7.cells.length), t('vt.m07.cells'))), cap('tower', t('vt.m07.tower'))));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-f="cells"]') }, { at: 0.55, run: () => focus(el, '[data-k="tower"]') }] };
        },
      },
      {
        id: 'start_tiles', title: t('vt.m07.tiles'),
        build: () => {
          const pl = placer(base(), 20, [hexStart(0)], START_TILES);
          const el = h('div', { class: 'row', style: 'gap:22px;align-items:center' }, pl.board, col(h('div', { 'data-k': 'tray' }, pl.tray), cap('size', t('vt.m07.sizes'))));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '.hx7-board, svg') }, { at: 0.35, run: () => focus(el, '[data-k="tray"]') }, { at: 0.8, run: () => focus(el, '[data-k="size"]') }] };
        },
      },
      {
        id: 'placement', title: t('vt.m07.place'),
        build: () => {
          const el = h('div', { class: 'tg-row' },
            h('div', { class: 'tg-fig ok' }, fig(withCells([...mine, [2, 1, 0], [2, 0, 0], [1, 1, 0]]), 20, [at(2, 1), at(2, 0), at(1, 1)]), h('div', { class: 'tg-mark ok' }, '○'), h('div', { class: 'tg-cap' }, t('tut.m07.ok'))),
            h('div', { class: 'tg-fig ng' }, fig(withCells([...mine, [0, 1, 0], [0, 2, 0], [-1, 2, 0]]), 20, [at(0, 1), at(0, 2), at(-1, 2)]), h('div', { class: 'tg-mark ng' }, '✕'), h('div', { class: 'tg-cap' }, t('tut.m07.ng'))));
          return { el, cues: [{ at: 0.3, run: () => focus(el, '.tg-fig.ok') }, { at: 0.65, run: () => focus(el, '.tg-fig.ng') }] };
        },
      },
      {
        id: 'controls', title: t('vt.m07.controls'),
        build: () => {
          const { el: box, task } = placeBoard(['two'], 2);
          return { el: box, task, prompt: t('vt.m07.doPlace'), cues: [{ at: 0.05, run: () => focus(box, '.hx7-panel') }, { at: 0.5, run: () => focus(box, '.hx7-foot') }] };
        },
      },
      {
        id: 'size_limit', title: t('vt.m07.limit'),
        build: () => {
          const el = h('div', { class: 'row', style: 'gap:10px' }, [['1', '1'], ['2', '2'], ['3', '3'], ['4', '1〜4']].map(([r, v]) => chip(`r${r}`, t('vt.m07.round', { n: r }), v)));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-k="r1"]') }, { at: 0.35, run: () => focus(el, '[data-k="r2"]') }, { at: 0.5, run: () => focus(el, '[data-k="r3"]') }, { at: 0.7, run: () => focus(el, '[data-k="r4"]') }] };
        },
      },
      {
        id: 'turns_pass', title: t('vt.m07.turns'),
        build: () => {
          const el = col(h('div', { class: 'col vt-tiers', style: 'gap:8px;align-items:stretch' }, h('div', { class: 'tg-cap', 'data-k': 'low' }, t('vt.m07.lowFirst')), h('div', { class: 'tg-cap', 'data-k': 'lot' }, t('vt.m07.lots'))),
            h('span', { class: 'btn', 'data-k': 'pass' }, t('vt.m07.pass')));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-k="low"]') }, { at: 0.4, run: () => focus(el, '[data-k="lot"]') }, { at: 0.65, run: () => focus(el, '[data-k="pass"]') }] };
        },
      },
      {
        id: 'area_score', title: t('vt.m07.score'),
        build: () => {
          const el = h('div', { class: 'row', style: 'gap:22px;align-items:center' }, fig(base(), 22, center), factRow(fact('one', '+1', t('tut.m07.f1')), fact('center', `+${CENTER_PTS}`, t('tut.m07.f2'))));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-f="one"]') }, { at: 0.5, run: () => focus(el, '[data-f="center"]') }] };
        },
      },
      {
        id: 'link_goal', title: t('vt.m07.link'),
        build: () => {
          const el = h('div', { class: 'row', style: 'gap:22px;align-items:center' }, fig(base(), 22, [hexStart(0), beaconCell(0)]), col(factRow(fact('link', `+${LINK_PTS}`, t('tut.m07.f3'))), cap('lost', t('vt.m07.lost'))));
          return { el, cues: [{ at: 0.05, run: () => focus(el, 'svg') }, { at: 0.4, run: () => { el.firstElementChild?.replaceWith(fig(linked(), 22, link)); focus(el, '[data-f="link"]'); } }, { at: 0.75, run: () => focus(el, '[data-k="lost"]') }] };
        },
      },
      {
        id: 'negotiation', title: t('vt.m07.talk'),
        build: () => {
          const el = col(factRow(fact('break', String(M07_BREAK_MS / 1000), t('vt.m07.breakSec'))), cap('promise', t('vt.m07.promise')));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-f="break"]') }, { at: 0.7, run: () => focus(el, '[data-k="promise"]') }] };
        },
      },
      {
        id: 'piece_help', title: t('vt.m07.aid'),
        build: () => {
          const a = placer(base(), 16, [], ['line3']);
          const b = placer(base(), 16, [], ['bend3', 'tri3']);
          const el = col(h('div', { class: 'row', style: 'gap:14px;align-items:center' }, h('div', { 'data-k': 'old' }, a.tray), h('span', { class: 'tg-arrow' }, '→'), h('div', { 'data-k': 'new' }, b.tray)),
            h('div', { class: 'm01-score' }, chip('cost', t('vt.m04.aidChip'), String(M07_AID_COST))), cap('once', t('vt.m07.once')));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-k="cost"]') }, { at: 0.3, run: () => focus(el, '[data-k="new"]') }, { at: 0.7, run: () => focus(el, '[data-k="once"]') }] };
        },
      },
      {
        id: 'end_ranking', title: t('vt.m07.end'),
        build: () => {
          const el = h('div', { class: 'row', style: 'gap:22px;align-items:center' }, factRow(fact('rounds', String(M07_ROUNDS), t('vt.m07.maxRounds'))),
            h('div', { class: 'col vt-tiers', style: 'gap:8px;align-items:stretch' }, ['tie1', 'tie2', 'tie3', 'tie4'].map((k, i) => h('div', { class: 'tg-cap', 'data-k': k }, `${i + 1}. ${t(`vt.m07.${k}`)}`))));
          return { el, cues: [{ at: 0.02, run: () => focus(el, '[data-f="rounds"]') }, { at: 0.35, run: () => focus(el, '[data-k="tie1"]') }, { at: 0.55, run: () => focus(el, '[data-k="tie2"]') }, { at: 0.8, run: () => focus(el, '[data-k="tie3"]') }] };
        },
      },
      {
        // 収録に無い段階（字幕と盤面だけ）。tutorial.ts の練習と同じ
        id: 'practice', title: t('tut.practice'), text: t('tut.m07.practice'),
        build: () => {
          const { el, task } = placeBoard(['bend3', 'line3'], 3);
          return { el, task, prompt: t('tut.m07.practice'), final: true };
        },
      },
    ],
  };
}

/**
 * M08 バリケード。声は 1 本にまとめて届いたものを、説明ごとに区切って使う（docs/voice/m08_segments.csv）。
 * 収録の「参加者5人」は 5 人の時だけ使い、違えば字幕だけにする。
 */
function m08Voiced(ctx: TutCtx = {}): VoicedGuide {
  const players = playersOf(ctx);
  const seats = [0, 1, 2, 3, 4];
  const noWalls = () => new Array<boolean>(M08_EDGES.length).fill(false);
  const starts = () => seats.map(m08Start);
  const fig = (pos: number[], walls: boolean[], scale = 0.6, canMove: number[] = []) => ringBoard({ seats, pos, walls, me: 0, mode: canMove.length ? 'move' : 'none', canMove, canWall: [], showPath: true, scale });
  const swap = (el: HTMLElement, next: HTMLElement) => { el.firstElementChild?.replaceWith(next); };
  const jumpPos = () => { const p = starts(); p[0] = m08Node(3, 1); p[1] = m08Node(3, 2); return p; };
  const oneWall = () => { const w = noWalls(); w[m08Edge(m08Node(3, 1), m08Node(3, 2))] = true; return w; };
  return {
    name: 'バリケード',
    steps: [
      { id: 'title', title: t('vt.m08.title'), build: () => ({ el: titleCard('08', 'バリケード', 'BARRICADE') }) },
      {
        id: 'board', title: t('vt.m08.board'),
        facts: { players: players.length },
        alt: () => ({ text: t('vt.m08.boardAlt', { n: players.length }) }),
        build: () => {
          const el = h('div', { class: 'vt-demo' }, fig(starts(), noWalls(), 0.72));
          return { el, cues: [{ at: 0.05, run: () => focus(el, 'svg') }] };
        },
      },
      {
        id: 'actions', title: t('vt.m08.actions'),
        build: () => {
          const el = col(h('div', { class: 'row', style: 'gap:14px' }, chip('move', t('vt.m08.aMove'), '1'), chip('wall', t('vt.m08.aWall'), '1')), factRow(fact('walls', String(M08_WALLS), t('vt.m08.walls'))));
          return { el, cues: [{ at: 0.1, run: () => focus(el, '[data-k="move"]') }, { at: 0.3, run: () => focus(el, '[data-k="wall"]') }, { at: 0.75, run: () => focus(el, '[data-f="walls"]') }] };
        },
      },
      {
        id: 'move', title: t('vt.m08.move'),
        build: () => {
          const st = { players: seats.map((x) => `p${x}` as CharId), seats, pos: starts(), walls: noWalls(), wallsLeft: seats.map(() => 3), arrived: seats.map(() => -1) };
          const el = h('div', { class: 'vt-demo' }, fig(starts(), noWalls(), 0.68, m08Moves(st, 0)));
          return { el, cues: [{ at: 0.05, run: () => focus(el, 'svg') }] };
        },
      },
      {
        id: 'jump', title: t('vt.m08.jump'),
        build: () => {
          const el = h('div', { class: 'row', style: 'gap:22px;align-items:center' }, fig(jumpPos(), noWalls(), 0.6), cap('jump', t('tut.m08.jumpCap')));
          return { el, cues: [{ at: 0.05, run: () => focus(el, 'svg') }, { at: 0.5, run: () => focus(el, '[data-k="jump"]') }] };
        },
      },
      {
        id: 'walls', title: t('vt.m08.wallsT'),
        build: () => {
          const el = h('div', { class: 'row', style: 'gap:22px;align-items:center' }, fig(starts(), noWalls(), 0.6), cap('wall', t('tut.m08.wallCap')));
          return { el, cues: [{ at: 0.05, run: () => { swap(el, fig(starts(), oneWall(), 0.6)); focus(el, 'svg'); } }, { at: 0.5, run: () => focus(el, '[data-k="wall"]') }] };
        },
      },
      {
        id: 'no_block', title: t('vt.m08.noBlock'),
        build: () => {
          const el = h('div', { class: 'row', style: 'gap:22px;align-items:center' }, fig(starts(), oneWall(), 0.55), cap('ng', t('vt.m08.noBlockNote')));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-k="ng"]') }] };
        },
      },
      {
        id: 'time', title: t('vt.m08.time'),
        build: () => {
          const el = col(factRow(fact('sec', String(M08_MOVE_MS / 1000), t('vt.m08.sec'))), cap('auto', t('vt.m08.auto')));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-f="sec"]') }, { at: 0.35, run: () => focus(el, '[data-k="auto"]') }] };
        },
      },
      {
        id: 'order', title: t('vt.m08.order'),
        build: () => {
          const el = h('div', { class: 'col vt-tiers', style: 'gap:8px;align-items:stretch' }, h('div', { class: 'tg-cap', 'data-k': 'first' }, t('vt.m08.first')), h('div', { class: 'tg-cap', 'data-k': 'goal' }, t('vt.m08.goalOut')));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-k="first"]') }, { at: 0.45, run: () => focus(el, '[data-k="goal"]') }] };
        },
      },
      {
        id: 'talk', title: t('vt.m08.talk'),
        build: () => {
          const el = col(factRow(fact('break', String(M08_BREAK_MS / 1000), t('vt.m08.breakSec'))), cap('promise', t('vt.m07.promise')));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-f="break"]') }, { at: 0.75, run: () => focus(el, '[data-k="promise"]') }] };
        },
      },
      {
        id: 'end', title: t('vt.m08.end'),
        build: () => {
          const el = col(factRow(fact('rounds', String(M08_ROUNDS), t('vt.m08.maxRounds'))), cap('none', t('vt.m08.noAid')));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-f="rounds"]') }, { at: 0.75, run: () => focus(el, '[data-k="none"]') }] };
        },
      },
      {
        id: 'ranking', title: t('vt.m08.ranking'),
        build: () => {
          const el = h('div', { class: 'col vt-tiers', style: 'gap:8px;align-items:stretch' }, ['r1', 'r2', 'r3', 'r4', 'r5'].map((k, i) => h('div', { class: 'tg-cap', 'data-k': k }, `${i + 1}. ${t(`vt.m08.${k}`)}`)));
          return { el, cues: [{ at: 0.02, run: () => focus(el, '[data-k="r1"]') }, { at: 0.2, run: () => focus(el, '[data-k="r2"]') }, { at: 0.45, run: () => focus(el, '[data-k="r3"]') }, { at: 0.75, run: () => focus(el, '[data-k="r4"]') }] };
        },
      },
      {
        // 収録に無い段階（字幕と盤面だけ）。tutorial.ts の練習と同じ
        id: 'practice', title: t('tut.practice'), text: t('tut.m08.practice'),
        build: () => {
          let finish: () => void = () => undefined;
          const task = new Promise<void>((res) => { finish = res; });
          const box = h('div', { class: 'hx7 rb7 prac' });
          const st = { players: seats.map((x) => `p${x}` as CharId), seats, pos: starts(), walls: noWalls(), wallsLeft: seats.map(() => 3), arrived: seats.map(() => -1) };
          let step = 0;
          let mode: 'move' | 'wall' = 'move';
          let node: number | undefined;
          let edge: number | undefined;
          const draw = (): void => {
            clear(box);
            const canMove = step === 0 ? m08Moves(st, 0) : [];
            const canWall = step === 1 && mode === 'wall' ? m08Walls(st, 0) : [];
            const board = ringBoard({ seats, pos: st.pos, walls: st.walls, me: 0, mode: step === 0 ? 'move' : step === 1 && mode === 'wall' ? 'wall' : 'none', canMove, canWall, selNode: node, selEdge: edge, showPath: true, scale: 0.7 },
              (n) => { if (step !== 0 || !canMove.includes(n)) return; node = n; Sound.se('select'); draw(); },
              (e) => { if (step !== 1) return; edge = e; Sound.se('select'); draw(); });
            const foot = h('div', { class: 'hx7-foot' });
            if (step === 0) foot.append(button(t('m08.doMove'), () => { if (node === undefined) return; st.pos[0] = node; node = undefined; step = 1; Sound.se('chip'); draw(); }, { kind: 'primary', disabled: node === undefined }));
            else if (step === 1) foot.append(
              button(t('m08.modeWall', { n: 3 }), () => { mode = 'wall'; Sound.se('click'); draw(); }, { small: true, kind: mode === 'wall' ? 'primary' : undefined }),
              button(t('m08.doWall'), () => { if (edge === undefined) return; st.walls[edge] = true; edge = undefined; step = 2; Sound.se('chipsHit'); draw(); finish(); }, { kind: 'primary', disabled: edge === undefined }));
            box.append(h('div', { class: 'hx7-left' }, board), h('div', { class: 'hx7-panel' }, h('div', { class: `small fb-note${step === 2 ? ' gold' : ''}` }, t(step === 0 ? 'tut.m08.prac1' : step === 1 ? 'tut.m08.prac2' : 'tut.m08.pracDone')), foot));
          };
          draw();
          return { el: box, task, prompt: t('tut.m08.practice'), final: true };
        },
      },
    ],
  };
}

/** 練習の段階（声は無く字幕だけ）。今までの説明（tutorial.ts）の練習をそのまま使う */
function practiceStep(id: string): VoicedStep {
  const p = practiceOf(id);
  return {
    id: 'practice', title: t('tut.practice'), text: p?.text ?? '',
    build: () => {
      let finish: () => void = () => undefined;
      const task = new Promise<void>((res) => { finish = res; });
      return { el: p ? p.build(() => finish()) : h('div'), task, prompt: p?.text, final: true };
    },
  };
}

/**
 * M09 四王の戦場・改。声は 1 本にまとめて届いたものを区切って使う（docs/voice/m09_segments.csv）。
 * 収録の「参加者4人」は 4 人の時だけ使い、違えば字幕だけにする。
 */
function m09Voiced(ctx: TutCtx = {}): VoicedGuide {
  const players = playersOf(ctx);
  const at = (x: number, y: number) => y * 7 + x;
  const toBoard = (ps: M09Piece[]) => ps.map((p) => ({ pos: p.pos, seat: p.seat, kind: p.king ? 'king' as const : 'soldier' as const }));
  const fig = (ps: M09Piece[], cell: number, marks: Record<number, string> = {}) => pieceBoard({ n: 7, cell, pieces: toBoard(ps), colors: M09_COLORS, me: 0, marks: { [M09_CENTER]: 'center', ...marks } });
  const mid: M09Piece[] = [{ seat: 0, king: true, pos: at(0, 0) }, { seat: 0, king: false, pos: at(2, 3) }, { seat: 1, king: false, pos: at(3, 3) }, { seat: 1, king: true, pos: at(6, 0) }];
  const kingMoves = (c: number) => { const x = c % 7; const y = Math.floor(c / 7); const m: Record<number, string> = { [c]: 'sel' }; for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if ((dx || dy) && x + dx >= 0 && x + dx < 7 && y + dy >= 0 && y + dy < 7) m[at(x + dx, y + dy)] = 'can'; return m; };
  const soldierMoves = (c: number) => { const x = c % 7; const y = Math.floor(c / 7); const m: Record<number, string> = { [c]: 'sel' }; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (x + dx >= 0 && x + dx < 7 && y + dy >= 0 && y + dy < 7) m[at(x + dx, y + dy)] = 'can'; return m; };
  const tiers = (keys: string[], prefix: string) => h('div', { class: 'col vt-tiers', style: 'gap:8px;align-items:stretch' }, keys.map((k, i) => h('div', { class: 'tg-cap', 'data-k': k }, `${i + 1}. ${t(`${prefix}.${k}`)}`)));
  return {
    name: '四王の戦場・改',
    steps: [
      { id: 'title', title: t('vt.m09.title'), build: () => ({ el: titleCard('09', '四王の戦場・改', 'FOUR KINGS') }) },
      {
        id: 'board', title: t('vt.m09.board'),
        facts: { players: players.length },
        alt: () => ({ text: t('vt.m09.boardAlt', { n: players.length }) }),
        build: () => {
          const el = h('div', { class: 'vt-demo' }, fig(m09Start([0, 1, 2, 3]), 50));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '.vt-demo > *') }] };
        },
      },
      {
        id: 'move', title: t('vt.m09.move'),
        build: () => {
          const ps: M09Piece[] = [{ seat: 0, king: true, pos: at(2, 3) }, { seat: 0, king: false, pos: at(5, 3) }];
          const el = h('div', { class: 'vt-demo' }, fig(ps, 50, kingMoves(at(2, 3))));
          return { el, cues: [{ at: 0.45, run: () => { el.replaceChildren(fig(ps, 50, soldierMoves(at(5, 3)))); } }] };
        },
      },
      {
        id: 'capture', title: t('vt.m09.capture'),
        build: () => {
          const el = h('div', { class: 'row', style: 'gap:22px;align-items:center' }, fig(mid, 40, { [at(2, 3)]: 'sel', [at(3, 3)]: 'center can cap' }),
            factRow(fact('king', `+${KING_PTS}`, t('tut.m09.f2')), fact('soldier', `+${SOLDIER_PTS}`, t('tut.m09.f1'))));
          return { el, cues: [{ at: 0.3, run: () => { el.firstElementChild?.replaceWith(fig([mid[0], { seat: 0, king: false, pos: at(3, 3) }, mid[3]], 40, { [at(2, 3)]: 'from', [at(3, 3)]: 'center to hit' })); } }, { at: 0.65, run: () => focus(el, '[data-f="king"]') }, { at: 0.85, run: () => focus(el, '[data-f="soldier"]') }] };
        },
      },
      {
        id: 'king_lost', title: t('vt.m09.kingLost'),
        build: () => {
          const el = col(cap('go', t('vt.m09.kingLostNote')));
          el.prepend(fig([{ seat: 0, king: false, pos: at(1, 5) }, { seat: 0, king: false, pos: at(2, 4) }, { seat: 1, king: true, pos: at(5, 1) }], 36));
          return { el, cues: [{ at: 0.3, run: () => focus(el, '[data-k="go"]') }] };
        },
      },
      {
        id: 'center', title: t('vt.m09.center'),
        build: () => {
          const el = h('div', { class: 'row', style: 'gap:22px;align-items:center' }, fig([{ seat: 0, king: false, pos: M09_CENTER }], 40), factRow(fact('c', `+${M09_CENTER_PTS}`, t('tut.m09.f3'))));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-f="c"]') }] };
        },
      },
      {
        id: 'alive', title: t('vt.m09.alive'),
        build: () => {
          const el = factRow(fact('alive', `+${ALIVE_PTS}`, t('tut.m09.f4')));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-f="alive"]') }] };
        },
      },
      {
        id: 'time', title: t('vt.m08.time'),
        build: () => {
          const el = col(factRow(fact('sec', String(M09_MOVE_MS / 1000), t('vt.m08.sec'))), cap('auto', t('vt.m09.auto')));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-f="sec"]') }, { at: 0.4, run: () => focus(el, '[data-k="auto"]') }] };
        },
      },
      {
        id: 'order', title: t('vt.m09.order'),
        build: () => {
          const el = tiers(['first', 'out'], 'vt.m09');
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-k="first"]') }, { at: 0.35, run: () => focus(el, '[data-k="out"]') }] };
        },
      },
      {
        id: 'talk', title: t('vt.m08.talk'),
        build: () => {
          const el = col(factRow(fact('break', String(M09_BREAK_MS / 1000), t('vt.m09.breakSec'))), cap('promise', t('vt.m07.promise')));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-f="break"]') }, { at: 0.75, run: () => focus(el, '[data-k="promise"]') }] };
        },
      },
      {
        id: 'end', title: t('vt.m08.end'),
        build: () => {
          const el = col(factRow(fact('rounds', String(M09_ROUNDS), t('vt.m09.maxRounds'))), cap('none', t('vt.m08.noAid')));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-f="rounds"]') }, { at: 0.8, run: () => focus(el, '[data-k="none"]') }] };
        },
      },
      {
        id: 'ranking', title: t('vt.m08.ranking'),
        build: () => {
          const el = tiers(['r1', 'r2', 'r3', 'r4', 'r5'], 'vt.m09');
          return { el, cues: [{ at: 0.02, run: () => focus(el, '[data-k="r1"]') }, { at: 0.25, run: () => focus(el, '[data-k="r2"]') }, { at: 0.6, run: () => focus(el, '[data-k="r3"]') }, { at: 0.8, run: () => focus(el, '[data-k="r4"]') }] };
        },
      },
      practiceStep('m09'),
    ],
  };
}

/**
 * M10 トライアングル。声は 1 本にまとめて届いたものを区切って使う（docs/voice/m10_segments.csv）。
 * 収録の「参加者3人」は 3 人の時だけ使い、違えば字幕だけにする。終わりの加点は、声では画面の説明を案内している（図に出す）。
 */
function m10Voiced(ctx: TutCtx = {}): VoicedGuide {
  const players = playersOf(ctx);
  const carry: M10Board = { soldiers: [{ seat: 0, pos: 1, gem: 0 }, { seat: 0, pos: 2, gem: -1 }, { seat: 1, pos: 7, gem: -1 }, { seat: 2, pos: 8, gem: -1 }], ground: [], waiting: [0], delivered: [0, 0, 0] };
  const fight: M10Board = { soldiers: [{ seat: 0, pos: 4, gem: -1 }, { seat: 0, pos: 2, gem: -1 }, { seat: 1, pos: 7, gem: 1 }, { seat: 1, pos: 11, gem: -1 }, { seat: 2, pos: 9, gem: -1 }, { seat: 2, pos: 13, gem: -1 }], ground: [{ node: 8, id: 2 }], waiting: [], delivered: [0, 0, 0] };
  const fig = (b: M10Board, marks: Record<number, string> = {}, flagMarks: Record<number, string> = {}, scale = 0.6) => triBoard({ board: b, seats: [0, 1, 2], me: 0, marks, flagMarks, scale });
  const side = (b: HTMLElement, ...rest: HTMLElement[]) => h('div', { class: 'row', style: 'gap:22px;align-items:center' }, b, col(...rest));
  const tiers = (keys: string[]) => h('div', { class: 'col vt-tiers', style: 'gap:8px;align-items:stretch' }, keys.map((k, i) => h('div', { class: 'tg-cap', 'data-k': k }, `${i + 1}. ${t(`vt.m10.${k}`)}`)));
  return {
    name: 'トライアングル',
    steps: [
      { id: 'title', title: t('vt.m10.title'), build: () => ({ el: titleCard('10', 'トライアングル', 'TRIANGLE') }) },
      {
        id: 'board', title: t('vt.m10.board'),
        facts: { players: players.length },
        alt: () => ({ text: t('vt.m10.boardAlt', { n: players.length }) }),
        build: () => {
          const el = h('div', { class: 'vt-demo' }, fig(m10Start([0, 1, 2]), {}, {}, 0.7));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '.vt-demo > *') }] };
        },
      },
      {
        id: 'move', title: t('vt.m10.move'),
        build: () => {
          const el = side(fig(m10Start([0, 1, 2]), { 1: 'sel', 3: 'can', 4: 'can' }), cap('no', t('vt.m10.noEnter')));
          return { el, cues: [{ at: 0.05, run: () => focus(el, 'svg') }, { at: 0.55, run: () => focus(el, '[data-k="no"]') }] };
        },
      },
      {
        id: 'gems', title: t('vt.m10.gems'),
        build: () => {
          const el = side(fig(m10Start([0, 1, 2]), { 4: 'can' }), cap('one', t('vt.m10.oneGem')));
          return { el, cues: [{ at: 0.05, run: () => focus(el, 'svg') }, { at: 0.75, run: () => focus(el, '[data-k="one"]') }] };
        },
      },
      {
        id: 'deliver', title: t('vt.m10.deliver'),
        build: () => {
          const el = side(fig(carry, { 1: 'sel' }, { 0: 'deliver' }), factRow(fact('d', `+${DELIVER_PTS}`, t('tut.m10.f1'))), cap('act', t('vt.m10.oneAct')));
          return { el, cues: [{ at: 0.05, run: () => focus(el, 'svg') }, { at: 0.45, run: () => focus(el, '[data-f="d"]') }, { at: 0.75, run: () => focus(el, '[data-k="act"]') }] };
        },
      },
      {
        id: 'respawn', title: t('vt.m10.respawn'),
        build: () => {
          const el = col(factRow(fact('uses', String(GEM_USES), t('vt.m10.uses'))), cap('legend', t('m10.legend')));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-k="legend"]') }, { at: 0.55, run: () => focus(el, '[data-f="uses"]') }] };
        },
      },
      {
        id: 'capture', title: t('vt.m10.capture'),
        build: () => {
          const el = side(fig(fight, { 4: 'sel', 7: 'can cap' }), factRow(fact('peace', String(PEACE), t('vt.m10.peace')), fact('cap', `+${CAP_PTS}`, t('tut.m10.f2'))), cap('drop', t('vt.m10.drop')));
          return { el, cues: [{ at: 0.03, run: () => focus(el, '[data-f="peace"]') }, { at: 0.2, run: () => focus(el, 'svg') }, { at: 0.45, run: () => focus(el, '[data-f="cap"]') }, { at: 0.65, run: () => focus(el, '[data-k="drop"]') }] };
        },
      },
      {
        id: 'time', title: t('vt.m08.time'),
        build: () => {
          const el = col(factRow(fact('sec', String(M10_MOVE_MS / 1000), t('vt.m08.sec'))), cap('auto', t('vt.m10.auto')));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-f="sec"]') }, { at: 0.35, run: () => focus(el, '[data-k="auto"]') }] };
        },
      },
      {
        id: 'talk', title: t('vt.m10.talk'),
        build: () => {
          const el = col(cap('first', t('vt.m08.first')), factRow(fact('break', String(M10_BREAK_MS / 1000), t('vt.m08.breakSec'))), cap('coop', t('vt.m10.coop')));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-k="first"]') }, { at: 0.3, run: () => focus(el, '[data-f="break"]') }, { at: 0.65, run: () => focus(el, '[data-k="coop"]') }] };
        },
      },
      {
        id: 'lost', title: t('vt.m10.lost'),
        build: () => {
          const el = col(cap('lost', t('vt.m10.lostNote')));
          el.prepend(fig({ soldiers: [{ seat: 1, pos: 7, gem: -1 }, { seat: 2, pos: 13, gem: -1 }], ground: [{ node: 4, id: 0 }, { node: 7, id: 1 }, { node: 8, id: 2 }], waiting: [], delivered: [0, 0, 0] }, {}, {}, 0.5));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-k="lost"]') }] };
        },
      },
      {
        id: 'end', title: t('vt.m08.end'),
        build: () => {
          const el = col(factRow(fact('rounds', String(M10_ROUNDS), t('vt.m02.rounds'))), factRow(fact('hold', `+${HOLD_PTS}`, t('tut.m10.f3')), fact('home', `+${HOME_PTS}`, t('tut.m10.f4'))));
          return { el, cues: [{ at: 0.05, run: () => focus(el, '[data-f="rounds"]') }, { at: 0.35, run: () => focus(el, '[data-f="hold"]') }, { at: 0.55, run: () => focus(el, '[data-f="home"]') }] };
        },
      },
      {
        id: 'ranking', title: t('vt.m08.ranking'),
        build: () => {
          const el = tiers(['r1', 'r2', 'r3', 'r4']);
          return { el, cues: [{ at: 0.02, run: () => focus(el, '[data-k="r1"]') }, { at: 0.25, run: () => focus(el, '[data-k="r2"]') }, { at: 0.65, run: () => focus(el, '[data-k="r3"]') }] };
        },
      },
      {
        id: 'no_aid', title: t('vt.m10.noAidT'),
        build: () => {
          const el = col(cap('none', t('vt.m08.noAid')));
          el.prepend(titleCard('10', 'トライアングル', 'TRIANGLE'));
          return { el, cues: [{ at: 0.1, run: () => focus(el, '[data-k="none"]') }] };
        },
      },
      practiceStep('m10'),
    ],
  };
}

/** 競技 ID → 説明。ctx はその場の順番と参加者（無ければ収録どおりの場面とみなす） */
export const VOICED: Record<string, (ctx?: TutCtx) => VoicedGuide> = { m01: m01Voiced, m02: m02Voiced, m03: m03Voiced, m04: m04Voiced, m05: m05Voiced, m06: m06Voiced, m07: m07Voiced, m08: m08Voiced, m09: m09Voiced, m10: m10Voiced };
