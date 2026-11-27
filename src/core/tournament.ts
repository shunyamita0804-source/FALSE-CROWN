/**
 * 大会の進行ルール（描画から独立）。
 * 棟分けは当日メインマッチの順位だけで決まり、監獄マッチの最下位 1 人だけが脱落する。
 * ピース 0 でも脱落しない。ピースで得点・免除は買えない。
 */
import { type CharId } from '../data/characters';
import { CONFIG, scheduleFor } from '../data/config';
import { expireDeals } from '../npc/negotiation';
import { dailyDecay } from '../npc/brain';
import { placeIn } from '../world/sim';
import { aliveIds, fact, log, nameOf, publish, transfer } from './state';
import type { DayRecord, GameState } from './types';

export function mainMatchId(day: number): string {
  return scheduleFor(day).main;
}

export function prisonMatchId(day: number): string | null {
  return scheduleFor(day).prisonGame;
}

/** メインマッチの確定順位から棟分けと報酬を適用する */
export function applyMainResult(state: GameState, ranking: CharId[], scores: Partial<Record<CharId, number>>): { living: CharId[]; prison: CharId[]; rewards: Partial<Record<CharId, number>> } {
  const sch = scheduleFor(state.day);
  if (ranking.length !== aliveIds(state).length) throw new Error('順位の人数が生存者数と一致しません');
  const nPrison = sch.prison;
  const living = ranking.slice(0, ranking.length - nPrison);
  const prison = ranking.slice(ranking.length - nPrison);
  const table = state.day === 1 ? CONFIG.economy.m01Rewards : CONFIG.economy.laterRewards;
  const rewards: Partial<Record<CharId, number>> = {};
  const claimKey = `reward_main_${state.day}`;
  if (!state.claimed.includes(claimKey)) {
    state.claimed.push(claimKey);
    living.forEach((id, i) => {
      const r = table[i] ?? 0;
      rewards[id] = r;
      if (r > 0) transfer(state, 'host', id, r, `DAY${state.day} メインマッチ報酬`);
    });
  }
  for (const id of living) state.actors[id].house = 'living';
  for (const id of prison) state.actors[id].house = 'prison';
  state.today.mainRanking = ranking;
  state.today.mainScores = scores;
  publish(state, {
    kind: 'result',
    text: `DAY${state.day} メインマッチ順位：${ranking.map((id, i) => `${i + 1}.${nameOf(state, id)}`).join(' ')}`,
    truth: true,
    about: ranking,
    value: 0,
    tags: ['result', 'main'],
  });
  state.board.push({ day: state.day, text: `DAY${state.day} メインマッチ「${sch.main.toUpperCase()}」　監獄棟：${prison.map((id) => nameOf(state, id)).join('、')}` });
  fact(state, 'main_result', ranking, `DAY${state.day} メイン結果`, { ranking, scores });
  return { living, prison, rewards };
}

/** 棟別の初期位置へ移動 */
export function moveToHouses(state: GameState): void {
  for (const id of aliveIds(state)) {
    const a = state.actors[id];
    if (a.house === 'prison') placeIn(state, id, 'prison_cells');
    else placeIn(state, id, id === 'hero' ? 'living_lounge' : 'living_lounge');
    a.goal = undefined;
  }
}

/** 監獄マッチの結果から脱落者（最下位 1 人）を確定する */
export function applyPrisonResult(state: GameState, ranking: CharId[], scores: Partial<Record<CharId, number>>): CharId {
  const out = ranking[ranking.length - 1];
  state.today.prisonRanking = ranking;
  state.today.prisonScores = scores;
  eliminate(state, out);
  return out;
}

export function eliminate(state: GameState, id: CharId): void {
  const a = state.actors[id];
  if (!a.alive) return;
  a.alive = false;
  a.eliminatedDay = state.day;
  a.goal = undefined;
  a.path = [];
  a.route = [];
  // 脱落者のピースは主催者が回収
  const p = a.pieces;
  a.pieces = 0;
  fact(state, 'eliminated', [id], `${nameOf(state, id)}が脱落（ピース${p}は主催者が回収）`, { pieces: p });
  // 脱落者との約束は無効
  for (const d of state.deals) if (d.status === 'active' && (d.from === id || d.to === id)) d.status = 'expired';
  publish(state, { kind: 'result', text: `DAY${state.day}：${nameOf(state, id)}が脱落した。`, truth: true, about: [id], value: 0, tags: ['result', 'eliminated'] });
  state.board.push({ day: state.day, text: `DAY${state.day} 脱落：${nameOf(state, id)}` });
  // 残された記録：脱落者が知っていた手掛かりは旧書庫の記録棚から回収できる
  state.flags[`records_${id}`] = true;
  if (id === 'hero') state.flags.heroEliminated = true;
}

/** 1 日の終わり：履歴を残し、翌朝へ */
export function endDay(state: GameState): string[] {
  const sch = scheduleFor(state.day);
  const rec: DayRecord = {
    day: state.day,
    main: sch.main,
    mainRanking: state.today.mainRanking ?? [],
    mainScores: state.today.mainScores ?? {},
    prisonGame: sch.prisonGame,
    prisonRanking: state.today.prisonRanking ?? [],
    prisonScores: state.today.prisonScores ?? {},
    eliminated: Object.values(state.actors).filter((a) => a.eliminatedDay === state.day).map((a) => a.id),
    rewards: {},
  };
  state.history.push(rec);
  const notes = expireDeals(state).map((n) => n.text);
  dailyDecay(state);
  state.day += 1;
  state.today = {};
  for (const id of aliveIds(state)) {
    const a = state.actors[id];
    a.house = null;
    a.goal = undefined;
    a.talkCd = {};
    placeIn(state, id, id === 'hero' ? 'bedroom_hero' : 'dining');
  }
  log(state, `DAY${state.day} の朝を迎えた。`, 'day');
  return notes;
}

/** 朝：全員を共用部へ配置 */
export function startMorning(state: GameState): void {
  for (const id of aliveIds(state)) {
    const a = state.actors[id];
    a.house = null;
    if (id === 'hero') placeIn(state, id, 'bedroom_hero');
    else placeIn(state, id, ['dining', 'main_hall', 'common_lounge', 'garden', 'living_lounge'][Math.abs(id.length * 7 + state.day * 3 + id.charCodeAt(5)) % 5]);
  }
}

export function gatherAt(state: GameState, room: string, ids: CharId[] = aliveIds(state)): void {
  for (const id of ids) placeIn(state, id, room, { x: 6 + ((ids.indexOf(id) * 3) % 20), y: 12 + (ids.indexOf(id) % 3) * 2 });
}
