/**
 * 裏ゲーム 2 系統（生活棟の 1 人用パズル、監獄棟の対戦）の決まり。画面にも DOM にも依存しない。
 * 案と本人の決定は docs/back_games.md。今までの地下探索・真相ルート（hiddenroute.ts）は、開発メニューで「旧裏ルート」を選んだ時だけ動く。
 *
 * 系統ごとに、手掛かり取得・解放済み（挑戦権）・錠を開けた・報酬受領済みを別々に持つ（state.backGames）。
 * 生活棟と監獄棟は互いを見ない。どちらにも触れなくても、大会の進行と結末には何も影響しない。
 */
import type { GameState } from '../core/types';
import { transfer } from '../core/state';
import type { CharId } from '../data/characters';
import { claimOnce, type HiddenRun } from './hiddenroute';

export type BgWing = 'living' | 'prison';
export const BG_WINGS: BgWing[] = ['living', 'prison'];
export type ClueKey = 'A' | 'B' | 'C';
export const CLUE_KEYS: ClueKey[] = ['A', 'B', 'C'];

export interface BgDef {
  wing: BgWing;
  /** 挑戦する競技（engine の id） */
  game: 'h01' | 'h06';
  /** 手掛かりの情報 ID（clues.ts の CLUES。調べた時、NPC から聞いた時に hero.knows に入る） */
  clues: Record<ClueKey, string>;
  /** 錠の情報 ID（錠を見つけた記録。パズルの手掛かりには数えない） */
  lockInfo: string;
  /** 錠の調べる所の event（生活棟はここから挑戦画面へ進む） */
  lockEvent: string;
  /** 挑戦を始める調べる所の event（監獄棟は第零牢の卓。生活棟は錠と同じ） */
  playEvent: string;
  /** 並べる札 */
  tiles: string[];
  answer: string[];
  /** 札 → 数字（監獄棟。手掛かり A を知っている時だけ見える） */
  digits?: Record<string, string>;
  /** 手掛かりごとの確かめ方（並びが、その手掛かりと食い違わないか） */
  fits: Record<ClueKey, (order: string[]) => boolean>;
  /** 錠を開けた時に立てる扉の鍵（地図の扉。生活棟は部屋へ移らないので無し） */
  doorFlag?: string;
  /** 1 回の挑戦で進む時間（分） */
  minutes: number;
  /** 成功の報酬（ピース。1 大会 1 回） */
  reward: number;
}

const idx = (o: string[], x: string) => o.indexOf(x);

export const BG_DEFS: Record<BgWing, BgDef> = {
  living: {
    wing: 'living', game: 'h01',
    clues: { A: 'bg_live_a', B: 'bg_live_b', C: 'bg_live_c' }, lockInfo: 'bg_live_lock',
    lockEvent: 'bg_live_lock', playEvent: 'bg_live_lock',
    tiles: ['☾', '★', '♛', '☀'], answer: ['☾', '★', '♛', '☀'],
    fits: {
      // 遊戯室の王冠の空箱：王冠は、いちばん前にも、いちばん後ろにも並ばない
      A: (o) => idx(o, '♛') !== 0 && idx(o, '♛') !== o.length - 1,
      // リビングの楽譜：月が鳴ったら、すぐ星が続く
      B: (o) => idx(o, '★') === idx(o, '☾') + 1,
      // 浴室の鏡：太陽は、いちばん最後に昇る
      C: (o) => o[o.length - 1] === '☀',
    },
    minutes: 15, reward: 3,
  },
  prison: {
    wing: 'prison', game: 'h06',
    clues: { A: 'bg_prison_a', B: 'bg_prison_b', C: 'bg_prison_c' }, lockInfo: 'bg_prison_lock',
    lockEvent: 'bg_prison_lock', playEvent: 'bg_prison_play',
    tiles: ['■', '▲', '●', '◆'], answer: ['●', '◆', '■', '▲'],
    digits: { '■': '3', '▲': '1', '●': '4', '◆': '2' },
    fits: {
      // 共同牢の石壁：図形と数字の組（並びの決まりは無い）
      A: () => true,
      // 監獄マッチ会場の柵：● から始めて、▲ で終える
      B: (o) => o[0] === '●' && o[o.length - 1] === '▲',
      // 監獄の衛生設備の鏡：◆ は ■ より先に
      C: (o) => idx(o, '◆') >= 0 && idx(o, '◆') < idx(o, '■'),
    },
    doorFlag: 'h04_open', minutes: 25, reward: 3,
  },
};

/** event → 系統と手掛かり */
export const BG_CLUE_EVENTS: Record<string, { wing: BgWing; key: ClueKey }> = {
  game_box: { wing: 'living', key: 'A' },
  bg_live_b: { wing: 'living', key: 'B' },
  h03_mirror: { wing: 'living', key: 'C' },
  h04_wall: { wing: 'prison', key: 'A' },
  prison_table: { wing: 'prison', key: 'B' },
  bg_prison_c: { wing: 'prison', key: 'C' },
};
export const BG_INFO_IDS = new Set(BG_WINGS.flatMap((w) => [...Object.values(BG_DEFS[w].clues), BG_DEFS[w].lockInfo]));

/** 監獄棟の答え（数字） */
export const prisonCode = (): string => BG_DEFS.prison.answer.map((x) => BG_DEFS.prison.digits![x]).join('');

// ---------------- どちらの構成か ----------------

/** 旧裏ルート（H01〜H08、地下探索、真相ルート）で遊ぶか。通常は 2 系統。開発メニューからだけ切り替える */
export const isLegacyLayout = (s: GameState): boolean => s.flags.hiddenLayout === 'legacy';

// ---------------- 記録 ----------------

export interface BgClueRec { day: number; via: 'self' | CharId }
export interface BgRecord {
  /** 手掛かり取得 */
  clues: Partial<Record<ClueKey, BgClueRec>>;
  /** 解放済み（手帳のパズルを解いた日 = 挑戦権） */
  unlockedDay: number | null;
  /** 錠を現地で開けた日 */
  openedDay: number | null;
  /** 報酬受領済み（受け取った日） */
  rewardDay: number | null;
  /** 最後に負けた自由時間（次の自由時間まで挑めない） */
  failSlot: string | null;
  /** 挑戦した回数（腕試しを含む） */
  plays: number;
}
export interface BackGames { v: 1; living: BgRecord; prison: BgRecord }

const emptyRec = (): BgRecord => ({ clues: {}, unlockedDay: null, openedDay: null, rewardDay: null, failSlot: null, plays: 0 });
type WithBg = GameState & { backGames?: BackGames };

/**
 * 記録を取り出す。無ければ作る。fromLegacy は旧セーブ（版 3 より前）の読み込みの時だけ：今までの旗から作る（何度呼んでも同じ結果）。
 * - 旧の賢者の金庫の報酬（h01:reward）→ 生活棟は報酬受領済み、解放済み
 * - 旧の影の対戦者の勝ち（h06:win）→ 監獄棟は報酬受領済み（同じ対局の報酬を 2 度もらわない）
 * - 旧の書棚の謎（h01_open）→ 生活棟は解放済み、錠も開いた
 * - 旧の共同牢の壁（h04_open）→ 監獄棟の扉は開いたまま（錠を開けた扱い）。答えが別の謎なので、挑戦権は付けない
 */
export function backGames(s: GameState, fromLegacy = false): BackGames {
  const w = s as WithBg;
  if (w.backGames?.v === 1) return w.backGames;
  const bg: BackGames = { v: 1, living: emptyRec(), prison: emptyRec() };
  w.backGames = bg;
  if (!fromLegacy) return bg;
  const claimed = s.claimed ?? [];
  if (claimed.includes('h01:reward')) { bg.living.rewardDay = s.day; bg.living.unlockedDay ??= s.day; }
  if (claimed.includes('h06:win')) bg.prison.rewardDay = s.day;
  if (s.flags.h01_open) { bg.living.unlockedDay = s.day; bg.living.openedDay = s.day; }
  if (s.flags.h04_open) bg.prison.openedDay = s.day;
  // 解放済みなのに手掛かりが空にならないように埋める
  for (const wing of BG_WINGS) {
    if (bg[wing].unlockedDay === null) continue;
    for (const k of CLUE_KEYS) bg[wing].clues[k] ??= { day: s.day, via: 'self' };
  }
  return bg;
}
export const recOf = (s: GameState, wing: BgWing): BgRecord => backGames(s)[wing];

/**
 * 主人公が知っている手掛かり（hero.knows）を、系統の記録へ写す。新しく記録した手掛かりを返す。
 * 数えるのは、調べて確かめた手掛かりと、NPC が実際に調べて知っていた手掛かりを聞いた時だけ（同じ情報 ID。中身は調べた物そのまま）。
 * NPC の噂やうそは別の情報 ID なので、ここには入らない。
 */
export function syncClues(s: GameState): { wing: BgWing; key: ClueKey }[] {
  const got: { wing: BgWing; key: ClueKey }[] = [];
  const knows = s.actors.hero.knows;
  for (const wing of BG_WINGS) {
    const rec = recOf(s, wing);
    for (const k of CLUE_KEYS) {
      if (rec.clues[k]) continue;
      const kn = knows[BG_DEFS[wing].clues[k]];
      if (!kn) continue;
      rec.clues[k] = { day: kn.day, via: kn.from === 'public' ? 'self' : kn.from };
      got.push({ wing, key: k });
    }
  }
  return got;
}

/**
 * 雑談のついでに NPC が話す手掛かり。その NPC が自分で調べて知っている（from が self）手掛かりで、主人公がまだ知らないもの。
 * 話す人を決めない（その場所を調べた人なら誰でも）。同じ NPC が話すのは 1 日 1 件まで。解放の答えや並べた結果は話さない（NPC は知らない）。
 */
export function bgClueToTell(s: GameState, npc: CharId): string | null {
  if (isLegacyLayout(s)) return null;
  const key = `bgTell:${s.day}:${npc}`;
  if (s.flags[key]) return null;
  const mine = s.actors[npc]?.knows ?? {};
  const hero = s.actors.hero.knows;
  for (const wing of BG_WINGS) {
    if (recOf(s, wing).unlockedDay !== null) continue;
    for (const k of CLUE_KEYS) {
      const id = BG_DEFS[wing].clues[k];
      if (mine[id]?.from === 'self' && !hero[id] && s.infos[id]?.truth) { s.flags[key] = true; return id; }
    }
  }
  return null;
}

/** 聞いた話だった手掛かりを、自分で調べて確かめた（手帳の表示を「自分で確かめた」に替える） */
export function confirmClue(s: GameState, wing: BgWing, key: ClueKey): void {
  syncClues(s);
  const c = recOf(s, wing).clues[key];
  if (c && c.via !== 'self') c.via = 'self';
}

export const clueCount = (s: GameState, wing: BgWing): number => CLUE_KEYS.filter((k) => recOf(s, wing).clues[k]).length;
/** 手帳に「気になること」の題を出すか（手掛かりか錠を 1 つでも知っている） */
export const noticed = (s: GameState, wing: BgWing): boolean =>
  clueCount(s, wing) > 0 || recOf(s, wing).unlockedDay !== null || !!s.actors.hero.knows[BG_DEFS[wing].lockInfo];

// ---------------- 手帳のパズル ----------------

export type CheckResult = { ok: true } | { ok: false; why: 'clues'; n: number } | { ok: false; why: 'shape' } | { ok: false; why: 'wrong'; miss: ClueKey[] };

/** 並べた札を確かめる。3 つの手掛かりがそろうまでは確かめられない（2 つで総当たりして当てられないように） */
export function checkOrder(s: GameState, wing: BgWing, order: string[]): CheckResult {
  const def = BG_DEFS[wing];
  const n = CLUE_KEYS.length - clueCount(s, wing);
  if (n > 0) return { ok: false, why: 'clues', n };
  if (order.length !== def.tiles.length || new Set(order).size !== def.tiles.length || order.some((x) => !def.tiles.includes(x))) return { ok: false, why: 'shape' };
  if (order.join('|') === def.answer.join('|')) return { ok: true };
  const miss = CLUE_KEYS.filter((k) => !def.fits[k](order));
  return { ok: false, why: 'wrong', miss };
}

/** パズルを解いた：挑戦権を記録する。新しく解いた時だけ true（2 度目は何もしない） */
export function unlock(s: GameState, wing: BgWing, order: string[]): boolean {
  const rec = recOf(s, wing);
  if (rec.unlockedDay !== null) return false;
  if (!checkOrder(s, wing, order).ok) return false;
  rec.unlockedDay = s.day;
  return true;
}

/** 錠を現地で開ける（解放済みの時だけ）。扉の鍵も立てる。新しく開けた時だけ true */
export function openLock(s: GameState, wing: BgWing): boolean {
  const rec = recOf(s, wing);
  if (rec.unlockedDay === null || rec.openedDay !== null) return false;
  rec.openedDay = s.day;
  const f = BG_DEFS[wing].doorFlag;
  if (f) s.flags[f] = true;
  return true;
}

// ---------------- 挑戦 ----------------

/** 自由時間の区切り（同じ日の同じ時間帯なら同じ） */
export const freeSlot = (s: GameState): string => `${s.day}:${s.phase}`;

export type BgDeny = 'locked' | 'closed' | 'wing' | 'tomorrow' | 'time';
export type BgCan = { ok: true; practice: boolean } | { ok: false; why: BgDeny };

/**
 * 挑めるか。呼ぶのは自由時間の中だけ（消灯、集合のあと、競技の最中は画面側で弾く）。
 * 監獄棟は、主人公が監獄棟に入れる時だけ（生活棟に所属している棟分けの間は不可）。
 * 報酬を受け取ったあとは「腕試し」（practice）として挑める。
 */
export function canChallenge(s: GameState, wing: BgWing): BgCan {
  const rec = recOf(s, wing);
  if (rec.unlockedDay === null) return { ok: false, why: 'locked' };
  if (BG_DEFS[wing].doorFlag && rec.openedDay === null) return { ok: false, why: 'closed' };
  if (wing === 'prison' && s.actors.hero.house === 'living') return { ok: false, why: 'wing' };
  if (rec.failSlot === freeSlot(s)) return { ok: false, why: 'tomorrow' };
  if (s.phaseLeft < BG_DEFS[wing].minutes * 1000) return { ok: false, why: 'time' };
  return { ok: true, practice: rec.rewardDay !== null };
}

export const bgPlayers = (wing: BgWing): CharId[] => (wing === 'prison' ? ['hero', 'mask' as CharId] : ['hero']);

export interface BgRun extends HiddenRun { bg: BgWing; practice: boolean }
export const readBgRun = (s: GameState): BgRun | null => {
  try {
    const r = s.flags.hiddenRun ? (JSON.parse(String(s.flags.hiddenRun)) as Partial<BgRun>) : null;
    return r && r.bg ? (r as BgRun) : null;
  } catch { return null; }
};

/** 挑戦を始める：挑戦中の記録を書く（対局の前に保存する。読み直しで報酬を 2 度もらえないように）。参加費は無い */
export function beginBg(s: GameState, wing: BgWing, practice: boolean): void {
  recOf(s, wing).plays += 1;
  s.flags.hiddenRun = JSON.stringify({ id: BG_DEFS[wing].game, stake: 0, day: s.day, bg: wing, practice } satisfies BgRun);
}

export type BgOutcome = 'win' | 'lose' | 'draw';
export interface BgResult { outcome: BgOutcome; reward: number; practice: boolean; already: boolean }

export function bgOutcome(wing: BgWing, scores: Partial<Record<CharId, number>>, ranking: CharId[][]): BgOutcome {
  if (wing === 'living') return (scores.hero ?? 0) >= 1 ? 'win' : 'lose';
  return ranking.length === 1 ? 'draw' : ranking[0].includes('hero') ? 'win' : 'lose';
}

/**
 * 結果の清算。報酬は 1 大会 1 回（rewardDay と claimed の両方で防ぐ）。腕試しでは報酬も解放も動かさない。
 * 同点（監獄棟）は何も記録しない（その場でもう一度。挑戦中の記録は残す）。
 */
export function settleBg(s: GameState, wing: BgWing, scores: Partial<Record<CharId, number>>, ranking: CharId[][]): BgResult {
  const run = readBgRun(s);
  const practice = run?.bg === wing ? run.practice : recOf(s, wing).rewardDay !== null;
  const outcome = bgOutcome(wing, scores, ranking);
  if (outcome === 'draw') return { outcome, reward: 0, practice, already: false };
  delete s.flags.hiddenRun;
  const rec = recOf(s, wing);
  let reward = 0;
  if (outcome === 'win') {
    if (!practice && rec.rewardDay === null && claimOnce(s, `bg:${wing}:reward`)) {
      rec.rewardDay = s.day;
      if (transfer(s, 'host', 'hero', BG_DEFS[wing].reward, wing === 'living' ? '賢者の金庫' : '影の対戦者')) reward = BG_DEFS[wing].reward;
    }
    rec.failSlot = null;
  } else rec.failSlot = freeSlot(s);
  return { outcome, reward, practice, already: outcome === 'win' && reward === 0 };
}

/**
 * 旧セーブで、旧裏ルートの挑戦の途中だった時の後始末（2 系統の構成で開いた時）。
 * 賢者の金庫・影の対戦者以外の旧裏ゲームなら、その回に預けた賭けや参加費を返して、挑戦の記録を消す（報酬は無し）。
 * 返したピースの数を返す。
 */
export function retireLegacyRun(s: GameState): number {
  if (isLegacyLayout(s) || readBgRun(s)) return 0;
  let run: HiddenRun | null = null;
  try { run = s.flags.hiddenRun ? (JSON.parse(String(s.flags.hiddenRun)) as HiddenRun) : null; } catch { run = null; }
  if (!run) { if (s.match?.kind === 'hidden' && !['h01', 'h06'].includes(s.match.id)) s.match = null; return 0; }
  let back = 0;
  if (run.id === 'h02' && run.stake > 0) back = run.stake;
  // 影の対戦者の参加費（この回の分だけ。扉の料金は一度きりの通行料なので返さない）
  if (run.id === 'h06') back = 2;
  if (back && !transfer(s, 'host', 'hero', back, '旧裏ゲームの中断の返金')) back = 0;
  delete s.flags.hiddenRun;
  if (s.match?.kind === 'hidden') s.match = null;
  return back;
}
