/**
 * 遊戯室の練習卓。メインから移した競技（監獄版）や、大会で見た競技を、CPU 相手に練習する。
 * - 大会の写し（sandbox）で遊ぶので、ピース、関係、評判、日程、セーブに一切影響しない。報酬もない。
 * - 自由時間は進む（サブゲームと同じく、1 回で決まった分）。
 * - 問題は毎回その場で作るので、本番の問題を先に知ることはできない。
 */
import { G } from '../app/game';
import { Sound } from '../audio/audio';
import { engineOf, newSlot } from '../core/runner';
import { log, shortName } from '../core/state';
import type { GameState } from '../core/types';
import { NPC_IDS, type CharId } from '../data/characters';
import { t } from '../i18n/i18n';
import { CATALOG, isImplemented } from '../matches/registry';
import { saveMeta } from '../save/save';
import { mainOf, prisonOf } from '../core/lineup';
import { alertDialog, button, closeLayer, h, openLayer, panel, type Layer } from './dom';
import { face } from './art';
import { playMatch } from './matchui';
import { tutorialScreen } from './tutorial';

/** 1 回の練習で進む時間（分） */
export const PRACTICE_MINUTES = 30;

/** いつでも練習できる競技（メインから移した監獄版と、試作中の競技） */
const ALWAYS = ['q02', 'q03', 'q05', 'mk'];

/** 練習の人数：監獄版は 4 人（Q05 は 4 人、Q03 も 4 人）、ほかは大会と同じ人数 */
export function practicePlayers(id: string): number {
  if (/^q\d/.test(id)) return 4;
  const c = CATALOG.find((x) => x.id === id);
  const n = Number(/(\d+)/.exec(c?.players ?? '')?.[1] ?? 4);
  const e = engineOf(id);
  return Math.max(e.minPlayers, Math.min(e.maxPlayers, n));
}

/** 練習できる競技：いつでもの物と、この大会で今日までに出た競技（決勝・裏・サブは除く） */
export function practiceIds(s: GameState): string[] {
  const seen: string[] = [];
  for (let d = 1; d <= s.day; d++) seen.push(mainOf(s, d), prisonOf(s, d) ?? '');
  return [...new Set([...ALWAYS, ...seen])].filter((id) => id && id !== 'm11' && isImplemented(id));
}

/** 大会の写し。練習の中で何をしても元の状態は変わらない */
function sandbox(real: GameState): GameState {
  const sb = structuredClone(real) as GameState;
  sb.flags.practiceSandbox = true;
  sb.match = null;
  delete sb.strategy;
  return sb;
}

async function playPractice(id: string): Promise<void> {
  const real = G.state!;
  const eng = engineOf(id);
  const n = practicePlayers(id);
  if (!G.meta.matchesPlayed.includes(id)) {
    await tutorialScreen(id);
    G.meta.matchesPlayed.push(id);
    saveMeta(G.meta);
  }
  const sb = sandbox(real);
  // 相手は CPU（参加者の考え方を借りるだけ。練習の結果は誰の記録にも残らない）
  const cpus = sb.seed % 2 ? [...NPC_IDS] : [...NPC_IDS].reverse();
  const players: CharId[] = ['hero', ...cpus.slice(0, n - 1)];
  G.state = sb;
  try {
    const slot = newSlot(sb, id, players, eng.kind === 'prison' ? 'prison' : 'main');
    slot.practice = true;
    sb.match = slot;
    await playMatch(slot);
    const groups = eng.ranking(slot.state);
    const scores = eng.scores(slot.state);
    let rank = 1;
    const rows = groups.flatMap((g) => { const r = rank; rank += g.length; return g.map((p) => ({ p, r })); });
    G.state = real;
    real.phaseLeft = Math.max(5000, real.phaseLeft - PRACTICE_MINUTES * 1000);
    log(real, t('practice.log', { game: eng.name }));
    await alertDialog(t('practice.resultTitle', { game: eng.name }), h('div', { class: 'col', style: 'gap:6px' },
      h('div', { class: 'small dim' }, t('practice.noEffect')),
      ...rows.map(({ p, r }) => h('div', { class: `row${p === 'hero' ? ' gold' : ''}`, style: 'gap:8px;align-items:center' }, h('b', null, `${r}.`), face(p), h('span', { class: 'grow' }, p === 'hero' ? t('practice.you') : shortName(real, p)), h('span', null, String(scores[p] ?? 0))))), t('common.next'));
  } finally {
    G.state = real;
  }
}

/** 練習卓の画面（遊戯室の卓から開く） */
export function practiceScreen(): Promise<void> {
  const s = G.state!;
  return new Promise((resolve) => {
    let layer: Layer;
    const close = () => { closeLayer(layer); resolve(); };
    const ids = practiceIds(s);
    const body = h('div', { class: 'col subhub', style: 'gap:10px' },
      h('div', { class: 'small dim' }, t('practice.lead', { n: PRACTICE_MINUTES })),
      h('div', { class: 'subhub-grid' }, ids.map((id) => {
        const eng = engineOf(id);
        const b = h('button', { class: 'subhub-game', type: 'button', 'data-practice': id }, h('b', null, eng.name), h('small', null, eng.summary), h('span', { class: 'tag got' }, t('practice.players', { n: practicePlayers(id) })));
        b.addEventListener('click', () => { Sound.se('confirm'); closeLayer(layer); void playPractice(id).then(resolve); });
        return b;
      })));
    layer = openLayer(h('div', { class: 'overlay' }, panel(t('practice.title'), body, { wide: true, footer: button(t('common.close'), close, { autofocus: true }) })), { pausesClock: true, onCancel: close, name: 'practice' });
  });
}
