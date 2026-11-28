/**
 * 大会の進行ルール（描画から独立）。
 * 棟分けは当日メインマッチの順位だけで決まり、監獄マッチの最下位 1 人だけが脱落する。
 * ピース 0 でも脱落しない。ピースで得点・免除は買えない。
 */
import { homeOf } from '../world/rooms';
import { type CharId } from '../data/characters';
import { CONFIG, FINAL_DAY, scheduleFor } from '../data/config';
import { expireDeals } from '../npc/negotiation';
import { dailyDecay } from '../npc/brain';
import { ROOMS } from '../world/maps';
import { placeHome, placeIn } from '../world/sim';
import { releaseSeat, seatPlayers } from '../world/seats';
import { mainOf, prisonOf } from './lineup';
import { aliveIds, fact, log, nameOf, publish, rel, transfer } from './state';
import type { DayRecord, GameState } from './types';

/** その日のメインマッチ（大会の始めに決めた割り当て。古いセーブは日程表のまま） */
export function mainMatchId(state: GameState, day: number): string {
  return mainOf(state, day);
}

/** その日の監獄マッチ（決勝の日は null） */
export function prisonMatchId(state: GameState, day: number): string | null {
  return prisonOf(state, day);
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
  // 棟分けに合わせて個室を割り当て直す（監獄棟は順位の良い順に空き部屋へ。生活棟へ戻った人は元の部屋）
  for (const id of [...living, ...prison]) homeOf(state, id);
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
  state.board.push({ day: state.day, text: nPrison ? `DAY${state.day} メインマッチ「${mainOf(state, state.day).toUpperCase()}」　監獄棟：${prison.map((id) => nameOf(state, id)).join('、')}` : `DAY${state.day} 決勝「${mainOf(state, state.day).toUpperCase()}」　優勝：${nameOf(state, ranking[0])}` });
  fact(state, 'main_result', ranking, `DAY${state.day} メイン結果`, { ranking, scores });
  return { living, prison, rewards };
}

/** 棟別の初期位置へ移動 */
export function moveToHouses(state: GameState): void {
  for (const id of aliveIds(state)) {
    const a = state.actors[id];
    // 監獄棟へ送られた人は、割り当てられた房の前から始める
    if (a.house === 'prison') placeHome(state, id);
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
  // 座っていた席、取っていた席を空ける（椅子は空席として残る）
  releaseSeat(state, id);
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
  const rec: DayRecord = {
    day: state.day,
    main: mainOf(state, state.day),
    mainRanking: state.today.mainRanking ?? [],
    mainScores: state.today.mainScores ?? {},
    prisonGame: prisonOf(state, state.day),
    prisonRanking: state.today.prisonRanking ?? [],
    prisonScores: state.today.prisonScores ?? {},
    eliminated: Object.values(state.actors).filter((a) => a.eliminatedDay === state.day).map((a) => a.id),
    rewards: {},
    rescue: state.today.rescue,
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
    if (id === 'hero') placeHome(state, id);
    else placeIn(state, id, 'dining');
  }
  log(state, `DAY${state.day} の朝を迎えた。`, 'day');
  return notes;
}

/** 朝：全員を共用部へ配置 */
export function startMorning(state: GameState): void {
  for (const id of aliveIds(state)) {
    const a = state.actors[id];
    a.house = null;
    // 07:00 起床：全員が自分の個室から 1 日を始める（v10）
    a.goal = undefined;
    a.path = [];
    a.route = [];
    a.step = undefined;
    placeHome(state, id);
  }
}

/**
 * 全員を 1 つの部屋へ集める。競技の参加者席がある部屋（大会会場）では、参加者を席へ着かせる。
 * 席は表の参加者席だけを使い、人数より多い席は空席のまま残す。部屋を出る時（placeIn）に全員が立つ。
 */
export function gatherAt(state: GameState, room: string, ids: CharId[] = aliveIds(state)): void {
  const spots = ROOMS[room].spots;
  ids.forEach((id, i) => placeIn(state, id, room, spots[i % spots.length]));
  seatPlayers(state, room, ids);
}

/** 決勝の日か（最後の 2 人が M11 で戦う日。監獄マッチも夜もなく、その場で大会が終わる） */
export const isFinalDay = (day: number) => day >= FINAL_DAY;

/** 優勝後の結末を決める数値（すべて暫定。仕様 v05/01） */
export const ENDING_RULE = { loneBetrayals: 4, bondDeals: 4, bondPeople: 3, bondTrust: 70 };

/**
 * 通常の優勝の結末。主人公が自分から破り、相手に知られた約束が 4 つ以上なら「孤独な王」。
 * そうでなく、果たした約束が 4 つ以上で、3 人以上から信頼 70 以上を得ていれば「信頼の証」。それ以外は「王者」。
 * 脱落した人との関係は、脱落したときの値をそのまま使う。
 */
export function championEnding(state: GameState): 'E_TRUE' | 'E_WIN' | 'E_LONE' | 'E_BOND' {
  // 裏ルートで解放の準備まで済ませていれば、どの優勝の結末よりも「偽りの王冠」が先（v05）
  if (state.flags.h08_cleared && state.flags.RESCUE_READY) return 'E_TRUE';
  const broken = Number(state.flags.betrayals_hero ?? 0);
  if (broken >= ENDING_RULE.loneBetrayals) return 'E_LONE';
  const kept = state.deals.filter((d) => d.status === 'fulfilled' && (d.from === 'hero' || d.to === 'hero')).length;
  const trusting = Object.values(state.actors).filter((a) => a.id !== 'hero' && rel(state, a.id, 'hero').trust >= ENDING_RULE.bondTrust).length;
  if (kept >= ENDING_RULE.bondDeals && trusting >= ENDING_RULE.bondPeople) return 'E_BOND';
  return 'E_WIN';
}
