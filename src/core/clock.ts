/**
 * ゲーム内時計（仕様 v10）。
 * 自由行動は実時間 1 秒 = ゲーム内 1 分。時刻は「フェーズ」と「フェーズの残り時間」から導く。
 * 残り時間は描画のフレームレートに関係なく経過時間ぶんだけ減るので、時刻は単調に進む。
 * 競技中、強制イベント中、手帳や設定を開いている間は進まない。
 */
import type { GameState, Phase } from './types';

export const CLOCK = {
  /** 実時間 1 秒あたりのゲーム内の分 */
  minutesPerSecond: 1,
  wake: 7 * 60,
  breakfast: 8 * 60,
  free: 9 * 60,
  prep: 11 * 60,
  main: 12 * 60,
  result: 14 * 60,
  houses: 14 * 60 + 30,
  prisonPrep: 17 * 60,
  prison: 18 * 60,
  merge: 19 * 60,
  dinner: 20 * 60,
  bath: 21 * 60,
  curfew: 22 * 60,
} as const;

/** 自由行動のフェーズごとの開始時刻と終了時刻（分） */
export const FREE_WINDOWS: Partial<Record<Phase, { from: number; to: number }>> = {
  morning: { from: CLOCK.wake, to: CLOCK.main },
  house: { from: CLOCK.houses, to: CLOCK.prison },
  night: { from: CLOCK.merge, to: CLOCK.curfew },
};

/** 自由行動でないフェーズの時刻（競技中などは止まっている） */
const FIXED: Partial<Record<Phase, number>> = {
  prologue: CLOCK.wake,
  rules: CLOCK.main,
  strategy: CLOCK.main,
  main: CLOCK.main,
  reward: CLOCK.result,
  prison: CLOCK.prison,
  elimination: CLOCK.merge,
  curfew: CLOCK.curfew,
  final: CLOCK.main,
  ending: CLOCK.main,
};

const msPerMinute = () => 1000 / CLOCK.minutesPerSecond;

/** フェーズの長さ（ミリ秒） */
export function phaseDuration(phase: Phase): number {
  const w = FREE_WINDOWS[phase];
  return w ? (w.to - w.from) * msPerMinute() : 0;
}

/** 現在のゲーム内時刻（その日の 0:00 からの分、端数あり） */
export function clockMinutes(s: Pick<GameState, 'phase' | 'phaseLeft'>): number {
  const w = FREE_WINDOWS[s.phase];
  if (!w) return FIXED[s.phase] ?? CLOCK.wake;
  const left = Math.max(0, Math.min(phaseDuration(s.phase), s.phaseLeft));
  return w.to - left / msPerMinute();
}

export function fmtClock(min: number): string {
  const m = Math.max(0, Math.floor(min + 1e-6));
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export interface ScheduleItem {
  at: number;
  /** 文言キー（sched.*） */
  key: string;
  /** 絶対時刻の締切（全員が強制的に移動する） */
  hard?: boolean;
}

/** 1 日の予定（DAY 11 は決勝まで） */
export function scheduleOf(day: number): ScheduleItem[] {
  if (day >= 11) return [
    { at: CLOCK.wake, key: 'wake' },
    { at: CLOCK.breakfast, key: 'breakfast' },
    { at: CLOCK.prep, key: 'prep' },
    { at: CLOCK.main, key: 'final', hard: true },
  ];
  return [
    { at: CLOCK.wake, key: 'wake' },
    { at: CLOCK.breakfast, key: 'breakfast' },
    { at: CLOCK.free, key: 'free' },
    { at: CLOCK.prep, key: 'prep' },
    { at: CLOCK.main, key: 'main', hard: true },
    { at: CLOCK.result, key: 'result' },
    { at: CLOCK.houses, key: 'houses' },
    { at: CLOCK.prisonPrep, key: 'prisonPrep' },
    { at: CLOCK.prison, key: 'prison', hard: true },
    { at: CLOCK.merge, key: 'merge' },
    { at: CLOCK.dinner, key: 'dinner' },
    { at: CLOCK.bath, key: 'bath' },
    { at: CLOCK.curfew, key: 'curfew', hard: true },
  ];
}

/** 次の予定と、それまでのゲーム内時間（分） */
export function nextSchedule(s: Pick<GameState, 'phase' | 'phaseLeft' | 'day'>): { item: ScheduleItem; inMin: number } | null {
  const now = clockMinutes(s);
  const item = scheduleOf(s.day).find((x) => x.at > now + 1e-6);
  return item ? { item, inMin: Math.ceil(item.at - now - 1e-6) } : null;
}

/** 締切の事前通知（ゲーム内 30 分前と 10 分前） */
export const NOTICE_BEFORE = [30, 10] as const;

/**
 * before から after の間にまたいだ予定と事前通知を返す。
 * 同じものを 2 度返さないための記録は呼び出し側が持つ（fired に入っているキーは返さない）。
 */
export function crossed(day: number, before: number, after: number, fired: Record<string, unknown>): { key: string; item: ScheduleItem; notice?: number }[] {
  const out: { key: string; item: ScheduleItem; notice?: number }[] = [];
  for (const item of scheduleOf(day)) {
    const k = `clk:${day}:${item.key}`;
    if (before < item.at && after >= item.at && !fired[k]) out.push({ key: k, item });
    if (item.hard) {
      for (const n of NOTICE_BEFORE) {
        const kk = `${k}:-${n}`;
        const at = item.at - n;
        if (before < at && after >= at && after < item.at && !fired[kk]) out.push({ key: kk, item, notice: n });
      }
    }
  }
  return out;
}

/** 朝食、夕食、入浴の時間帯か（NPC の生活行動用） */
export function lifeSlot(min: number): 'breakfast' | 'dinner' | 'bath' | null {
  if (min >= CLOCK.breakfast && min < CLOCK.free) return 'breakfast';
  if (min >= CLOCK.dinner && min < CLOCK.bath) return 'dinner';
  if (min >= CLOCK.bath && min < CLOCK.curfew) return 'bath';
  return null;
}

/** 古いセーブや設定変更で残り時間がフェーズの長さを超えていた場合に丸める */
export function clampPhaseLeft(s: Pick<GameState, 'phase' | 'phaseLeft'>): void {
  const d = phaseDuration(s.phase);
  if (d > 0 && s.phaseLeft > d) s.phaseLeft = d;
}
