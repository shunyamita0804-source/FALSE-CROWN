/**
 * セーブ／ロード。バージョン付き、主セーブ＋直前バックアップ、検証付きのエクスポート／インポート。
 * 保存先はプラットフォーム境界（Storage）として分離し、将来 iOS（Capacitor）で差し替えられるようにする。
 * 周回をまたぐ記録（図鑑・エンド・実績・設定）は別データ（meta）。
 */
import { hashString } from '../core/rng';
import { SAVE_VERSION } from '../core/state';
import type { GameState } from '../core/types';
import { relocateStranded } from '../world/sim';
import { sweepSeats } from '../world/seats';
import { backGames } from '../story/backgames';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const memory = new Map<string, string>();
const memoryStorage: StorageLike = {
  getItem: (k) => memory.get(k) ?? null,
  setItem: (k, v) => void memory.set(k, v),
  removeItem: (k) => void memory.delete(k),
};

let storage: StorageLike = memoryStorage;
try {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('fc.probe', '1');
    localStorage.removeItem('fc.probe');
    storage = localStorage;
  }
} catch {
  storage = memoryStorage;
}

export function setStorage(s: StorageLike): void {
  storage = s;
}

const KEY_MAIN = 'fc.save.main';
const KEY_BACKUP = 'fc.save.backup';
const KEY_META = 'fc.meta';

interface Envelope {
  app: 'false-crown';
  version: number;
  savedAt: number;
  sum: number;
  data: string;
}

function wrap(state: GameState): string {
  const data = JSON.stringify(state);
  const env: Envelope = { app: 'false-crown', version: SAVE_VERSION, savedAt: Date.now(), sum: hashString(data), data };
  return JSON.stringify(env);
}

export function validate(raw: string | null): { ok: true; state: GameState; savedAt: number } | { ok: false; error: string } {
  if (!raw) return { ok: false, error: 'データがありません' };
  try {
    const env = JSON.parse(raw) as Envelope;
    if (env.app !== 'false-crown') return { ok: false, error: 'FALSE CROWN のセーブデータではありません' };
    if (typeof env.data !== 'string' || hashString(env.data) !== env.sum) return { ok: false, error: 'データが破損しています' };
    if (env.version > SAVE_VERSION) return { ok: false, error: '新しいバージョンのセーブデータです' };
    const state = migrate(JSON.parse(env.data) as GameState, env.version);
    if (!state.actors?.hero || typeof state.day !== 'number' || !state.rng) return { ok: false, error: 'データの形式が不正です' };
    return { ok: true, state, savedAt: env.savedAt };
  } catch {
    return { ok: false, error: 'データを読み込めません' };
  }
}

function migrate(state: GameState, from: number): GameState {
  // 将来の形式変更はここで吸収する
  state.lineHist ??= {};
  state.relEvents ??= [];
  // 以前の房の部屋（cell_p01〜）にいた人は、共同牢の中の自分の房へ移す。席の表も点検する
  if (state.actors?.hero) {
    relocateStranded(state);
    sweepSeats(state);
    // 裏ゲーム 2 系統の記録（手掛かり・解放・報酬）。版 3 より前のセーブは、今までの旗から作る（旧の報酬を 2 度もらわない）
    backGames(state, from < 3);
  }
  state.version = SAVE_VERSION;
  return state;
}

/** 保存。直前の主セーブをバックアップへ回す */
export function saveGame(state: GameState): boolean {
  try {
    const prev = storage.getItem(KEY_MAIN);
    const next = wrap(state);
    if (prev && validate(prev).ok) storage.setItem(KEY_BACKUP, prev);
    storage.setItem(KEY_MAIN, next);
    return true;
  } catch {
    return false;
  }
}

/** 読み込み。主セーブが壊れていればバックアップを使う */
export function loadGame(): { state: GameState; fromBackup: boolean; savedAt: number } | null {
  const main = validate(storage.getItem(KEY_MAIN));
  if (main.ok) return { state: main.state, fromBackup: false, savedAt: main.savedAt };
  const backup = validate(storage.getItem(KEY_BACKUP));
  if (backup.ok) return { state: backup.state, fromBackup: true, savedAt: backup.savedAt };
  return null;
}

export function hasSave(): boolean {
  return loadGame() !== null;
}

export function deleteSave(): void {
  storage.removeItem(KEY_MAIN);
  storage.removeItem(KEY_BACKUP);
}

export function exportSave(): string | null {
  const raw = storage.getItem(KEY_MAIN);
  if (!raw || !validate(raw).ok) return null;
  return btoa(unescape(encodeURIComponent(raw)));
}

export function importSave(text: string): { ok: boolean; error?: string } {
  let raw: string;
  try {
    raw = decodeURIComponent(escape(atob(text.trim())));
  } catch {
    return { ok: false, error: '文字列を解読できません' };
  }
  const v = validate(raw);
  if (!v.ok) return { ok: false, error: v.error };
  const prev = storage.getItem(KEY_MAIN);
  if (prev) storage.setItem(KEY_BACKUP, prev);
  storage.setItem(KEY_MAIN, raw);
  return { ok: true };
}

// ---------------- 周回をまたぐ記録・設定 ----------------

export interface Meta {
  endings: string[];
  clears: number;
  matchesPlayed: string[];
  achievements: string[];
  /** 開会式を最後まで見たことがある（2 周目以降は飛ばせる） */
  ceremonySeen?: boolean;
  settings: { bgm: number; se: number; voice: number; textScale: number; timeScale: number; difficulty: 'easy' | 'normal' | 'hard' | 'expert'; lang?: 'ja' | 'en' };
}

const defaultMeta = (): Meta => ({
  endings: [],
  clears: 0,
  matchesPlayed: [],
  achievements: [],
  settings: { bgm: 0.6, se: 0.8, voice: 0.8, textScale: 1, timeScale: 1, difficulty: 'normal' },
});

export function loadMeta(): Meta {
  try {
    const raw = storage.getItem(KEY_META);
    if (!raw) return defaultMeta();
    const m = JSON.parse(raw) as Meta;
    const d = defaultMeta();
    return { ...d, ...m, settings: { ...d.settings, ...m.settings } };
  } catch {
    return defaultMeta();
  }
}

export function saveMeta(m: Meta): void {
  try {
    storage.setItem(KEY_META, JSON.stringify(m));
  } catch {
    // 保存できない環境でもゲームは続行する
  }
}
