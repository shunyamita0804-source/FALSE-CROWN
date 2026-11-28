/**
 * 遊戯室の卓（サブゲームの入口）。遊ぶゲームと相手を選び、対局し、終わったら結果と報酬を出す。
 * 相手は、いま同じ部屋にいる参加者だけ。報酬は、ゲームごとに 1 日 1 回（仕様 v11/04）。対局そのものは、自由時間のあいだ何度でも遊べる。
 * 勝った時の報酬（ピース）は、主人公が勝っても NPC が勝っても同じ。
 */
import { G } from '../app/game';
import { Sound } from '../audio/audio';
import { engineOf, newSlot } from '../core/runner';
import { addInfo, adjustRel, aliveIds, knows, learn, log, shortName, transfer } from '../core/state';
import type { CharId, NpcId } from '../data/characters';
import { t } from '../i18n/i18n';
import { saveMeta } from '../save/save';
import { CLUES, activeClue } from '../story/clues';
import { ROOMS, ROOM_IDS } from '../world/maps';
import { assetUrl } from '../assets/registry';
import { face } from './art';
import { alertDialog, append, button, clear, closeLayer, h, openLayer, panel, type Layer } from './dom';
import { playMatch } from './matchui';
import { tutorialScreen } from './tutorial';
import { practiceScreen } from './practice';

export const SUB_IDS = ['s01', 's02', 's03', 's04', 's05', 's06'] as const;
/** 1 局で進む時間（分） */
export const SUB_MINUTES = 20;
/** 勝った時にピースが出るゲーム */
const PIECE_GAMES = new Set(['s02', 's03', 's05']);

const rewardKey = (id: string, day: number) => `sub:${id}:${day}`;

/** まだ見つけていない手掛かりの場所を 1 つ（ミニジグソーの報酬） */
function nextHint(): string | null {
  const s = G.state!;
  for (const c of CLUES) {
    if (activeClue(s.flags, c.event) !== c || knows(s, 'hero', c.id) || (c.fromDay && s.day < c.fromDay)) continue;
    const room = ROOM_IDS.find((r) => ROOMS[r].inspects?.some((i) => i.event === c.event));
    if (!room || s.flags[`hint:${c.id}`]) continue;
    s.flags[`hint:${c.id}`] = true;
    return t(c.nightOnly ? 'subhub.hintNight' : 'subhub.hint', { room: ROOMS[room].name });
  }
  return null;
}

/** 対局のあとの報酬。戻り値は、画面に出す行 */
function settle(id: string, opp: NpcId | null, heroRank: 'win' | 'lose' | 'draw'): string[] {
  const s = G.state!;
  const lines: string[] = [];
  const key = rewardKey(id, s.day);
  if (s.flags[key]) return [t('subhub.noMore')];
  s.flags[key] = true;
  if (opp) {
    // いっしょに遊ぶと、少し打ち解ける
    const bonus = heroRank === 'win' && (id === 's01' || id === 's04') ? 2 : 0;
    adjustRel(s, opp, 'hero', { like: 2, trust: 2 + bonus });
    adjustRel(s, 'hero', opp, { like: 2, trust: 2 });
    lines.push(t('subhub.rwTrust', { name: shortName(s, opp) }));
  }
  if (PIECE_GAMES.has(id) && heroRank !== 'draw') {
    const winner: CharId = heroRank === 'win' ? 'hero' : opp!;
    if (transfer(s, 'host', winner, 1, `サブゲーム ${id.toUpperCase()} の勝利`)) {
      lines.push(heroRank === 'win' ? t('subhub.rwPiece') : t('subhub.rwPieceOpp', { name: shortName(s, opp!) }));
      if (heroRank === 'win') Sound.se('coins');
    }
  }
  if (id === 's01' && heroRank === 'win' && opp) {
    // 数字当てに勝つと、相手が知っている話を 1 つ聞ける
    const info = Object.keys(s.actors[opp].knows).map((k) => s.infos[k]).find((i) => i && i.truth && !knows(s, 'hero', i.id) && i.kind !== 'profile');
    if (info) { learn(s, 'hero', info.id, opp, 0.9); lines.push(t('subhub.rwInfo', { name: shortName(s, opp), text: info.text })); }
  }
  if (id === 's06' && (heroRank === 'win' || (opp === null && heroRank !== 'lose'))) {
    const hint = nextHint();
    if (hint) {
      const info = addInfo(s, { kind: 'rumor', text: hint, truth: true, about: [], source: 'world', value: 1, tags: ['hint'] });
      learn(s, 'hero', info.id, 'self', 1);
      lines.push(t('subhub.rwHint', { text: hint }));
    }
  }
  return lines;
}

async function playOne(id: string, opp: NpcId | null): Promise<void> {
  const s = G.state!;
  const eng = engineOf(id);
  if (!G.meta.matchesPlayed.includes(id)) {
    await tutorialScreen(id);
    G.meta.matchesPlayed.push(id);
    saveMeta(G.meta);
  }
  // 先手と後手は、日ごとに入れ替える
  const players: CharId[] = opp === null ? ['hero'] : s.day % 2 === 1 ? ['hero', opp] : [opp, 'hero'];
  const slot = newSlot(s, id, players, 'sub');
  s.match = slot;
  await playMatch(slot);
  s.match = null;
  const rank = eng.ranking(slot.state);
  const scores = eng.scores(slot.state);
  const heroRank: 'win' | 'lose' | 'draw' = opp === null ? ((scores.hero ?? 0) > 0 ? 'win' : 'lose') : rank.length === 1 ? 'draw' : rank[0].includes('hero') ? 'win' : 'lose';
  const lines = settle(id, opp, heroRank);
  s.phaseLeft = Math.max(5000, s.phaseLeft - SUB_MINUTES * 1000);
  log(s, t('subhub.log', { game: eng.name, opp: opp ? shortName(s, opp) : t('subhub.solo'), res: t(`subhub.res.${opp === null ? (heroRank === 'win' ? 'clear' : 'fail') : heroRank}`) }));
  await alertDialog(t('subhub.resultTitle', { game: eng.name }), h('div', { class: 'col', style: 'gap:6px' },
    h('b', { class: 'gold' }, t(`subhub.res.${opp === null ? (heroRank === 'win' ? 'clear' : 'fail') : heroRank}`)), ...lines.map((l) => h('div', null, l))), t('common.next'));
}

/** 遊戯室の卓を調べた時の画面 */
export function subGamesScreen(): Promise<void> {
  const s = G.state!;
  return new Promise((resolve) => {
    let layer: Layer;
    let game: string | null = null;
    const body = h('div', { class: 'col subhub', style: 'gap:10px' });
    const close = () => { closeLayer(layer); resolve(); };
    const render = () => {
      clear(body);
      const here = aliveIds(s).filter((x): x is NpcId => x !== 'hero' && s.actors[x].pos.room === s.actors.hero.pos.room);
      if (!game) {
        append(body, [h('div', { class: 'small dim' }, t('subhub.lead', { n: SUB_MINUTES })),
          // 練習卓：メインから移した競技や、大会で見た競技を CPU と練習する（記録に残らない）
          h('div', { class: 'row' }, button(t('practice.open'), () => { closeLayer(layer); void practiceScreen().then(resolve); }, { small: true, cls: 'practice-open' })),
          // 相手がいない時の案内は、一覧の下に隠れないよう先に出す
          here.length ? null : h('div', { class: 'note-box' }, t('subhub.nobody')),
          h('div', { class: 'subhub-grid' }, SUB_IDS.map((id) => {
            const eng = engineOf(id);
            const got = !!s.flags[rewardKey(id, s.day)];
            const shot = assetUrl(`ui/sub_preview/${id}`);
            const b = h('button', { class: 'subhub-game', type: 'button', 'data-game': id }, shot ? h('img', { class: 'subhub-shot', src: shot, alt: '', draggable: false }) : null, h('b', null, eng.name), h('span', { class: 'subhub-sum' }, eng.summary), h('span', { class: `tag${got ? ' got' : ''}` }, t(got ? 'subhub.got' : 'subhub.notYet')));
            b.addEventListener('click', () => { Sound.se('select'); game = id; render(); });
            return b;
          }))]);
        return;
      }
      const eng = engineOf(game);
      const id = game;
      const start = (opp: NpcId | null) => {
        closeLayer(layer);
        void playOne(id, opp).then(resolve);
      };
      const shot = assetUrl(`ui/sub_preview/${game}`);
      append(body, [h('div', { class: 'subhub-pick' }, shot ? h('img', { class: 'subhub-shot', src: shot, alt: '', draggable: false }) : null, h('div', { class: 'col', style: 'gap:6px' }, h('b', { class: 'gold' }, eng.name), h('div', { class: 'subhub-sum' }, eng.summary))),
        h('div', null, t('subhub.pickOpp')),
        h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
          here.map((x) => { const b = h('button', { class: 'subhub-opp', type: 'button', 'data-opp': x }, face(x), h('span', null, shortName(s, x))); b.addEventListener('click', () => { Sound.se('confirm'); start(x); }); return b; }),
          eng.minPlayers === 1 ? (() => { const b = h('button', { class: 'subhub-opp solo', type: 'button', 'data-opp': 'solo' }, h('span', null, t('subhub.soloPlay'))); b.addEventListener('click', () => { Sound.se('confirm'); start(null); }); return b; })() : null),
        !here.length && eng.minPlayers > 1 ? h('div', { class: 'note-box' }, t('subhub.nobody')) : null,
        h('div', { class: 'row' }, button(t('subhub.back'), () => { game = null; render(); }, { small: true }))]);
    };
    render();
    layer = openLayer(h('div', { class: 'overlay' }, panel(t('subhub.title'), body, { wide: true, footer: button(t('common.close'), close, { autofocus: true }) })), { pausesClock: true, onCancel: close, name: 'subhub' });
  });
}
