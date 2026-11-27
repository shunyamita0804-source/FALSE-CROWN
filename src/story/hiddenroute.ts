/**
 * 裏ルート（裏ゲーム H01〜H08、資料、保守用の昇降機、自分で選ぶ結末）の決まり。画面にも DOM にも依存しない。
 * 設計は docs/hidden_route.md。仕様は v04（探索）、v05（物語と結末）、v11（競技）。暫定の所は docs/decisions.md の D-HIDROUTE。
 *
 * 入れ物：持ち物は actors.hero.items、1 回だけの報酬は state.claimed、進み具合は state.flags。セーブの形は変えない。
 */
import type { GameState } from '../core/types';
import { transfer } from '../core/state';
import type { CharId } from '../data/characters';
import { EVIDENCE, H01_CLUES, LETTERS } from './hiddendata';

export const HIDDEN_IDS = ['h01', 'h02', 'h03', 'h04', 'h05', 'h06', 'h07', 'h08'] as const;
export type HiddenId = (typeof HIDDEN_IDS)[number];

/** 挑める最初の日 */
export const HIDDEN_MIN_DAY: Record<HiddenId, number> = { h01: 1, h02: 2, h03: 3, h04: 5, h05: 4, h06: 5, h07: 8, h08: 9 };
/** 1 回の挑戦で進む時間（分。暫定。対局中は時計を止め、終わったら決まった分だけ進める） */
export const HIDDEN_MINUTES: Record<HiddenId, number> = { h01: 15, h02: 15, h03: 20, h04: 15, h05: 20, h06: 25, h07: 20, h08: 15 };
export const H06_DOOR_FEE = 2;
export const H06_ENTRY_FEE = 2;
export const H06_WIN = 6;
export const LIFT_MINUTES = 10;
export const VAULT_MINUTES = 10;
/** 地下通路の鉄扉に気づける日（H04 の手紙の 1 通が地下通路にあるため、H04 と同じ日から） */
export const PASSAGE_DAY = 3;
export const LIFT_DAY = 8;
export const NOTICE_DAY = 7;

export const LETTER_IDS = LETTERS.map((l) => l.id);
/** H01 の金庫の条件（書斎の 3 か所で 2 つずつ見つける）。添字は H01_CLUES の順 */
export const H01_NOTE_IDS = H01_CLUES.map((_, i) => `K${i + 1}`);
export const EVIDENCE_IDS = EVIDENCE.map((e) => e.id);
export const ITEM_IDS = ['KEY_MIRROR', 'KEY_SERVICE', 'DOC_CROWN', 'CORE01', 'RELEASE_AUTH'] as const;

/** 調査の event と裏ゲーム */
export const GAME_EVENT: Record<string, HiddenId> = { h01_safe: 'h01', h02_table: 'h02', h03_maze: 'h03', h04_game: 'h04', h05_mech: 'h05', h06_door: 'h06', h07_proofs: 'h07', h08_terminal: 'h08' };

/** 入口の小さな謎（ボタンを順に押す）。答えは追記のメモに書いてある */
export interface EntryPuzzle { id: 'h01' | 'h02' | 'h03' | 'h04'; event: string; minDay: number; nightOnly?: boolean; keys: string[]; answer: string[]; flag: string }
export const ENTRY_PUZZLES: EntryPuzzle[] = [
  { id: 'h01', event: 'h01_shelf', minDay: 1, keys: ['☀', '☾', '★'], answer: ['☾', '★', '☀'], flag: 'h01_open' },
  { id: 'h02', event: 'h02_clock', minDay: 2, nightOnly: true, keys: ['3:00', '6:00', '9:00', '0:00'], answer: ['0:00'], flag: 'h02_open' },
  { id: 'h03', event: 'h03_mirror', minDay: 3, keys: ['1', '2', '3', '4'], answer: ['2', '4', '1'], flag: 'h03_open' },
  { id: 'h04', event: 'h04_wall', minDay: 5, keys: ['1', '2', '3', '4'], answer: ['3', '1', '4', '2'], flag: 'h04_open' },
];
export const ENTRY_BY_EVENT: Record<string, EntryPuzzle> = Object.fromEntries(ENTRY_PUZZLES.map((p) => [p.event, p]));

/** 調べたあとに出す追記（地図の文は変えずに 2 枚目として出す）。gives は手に入る手紙 */
export interface HiddenNote { minDay: number; key: string; gives?: string[]; nightOnly?: boolean; /** 文に差し込む H01 の条件（添字） */ clues?: number[] }
export const HIDDEN_NOTES: Record<string, HiddenNote> = {
  h01_diary: { minDay: 1, key: 'hid.note.h01_diary' },
  h01_note1: { minDay: 1, key: 'hid.note.h01_note1', gives: ['K1', 'K2'], clues: [0, 1] },
  h01_note2: { minDay: 1, key: 'hid.note.h01_note2', gives: ['K3', 'K4'], clues: [2, 3] },
  h01_note3: { minDay: 1, key: 'hid.note.h01_note3', gives: ['K5', 'K6'], clues: [4, 5] },
  obs_scope: { minDay: 2, key: 'hid.note.obs_scope', nightOnly: true },
  h03_sink: { minDay: 3, key: 'hid.note.h03_sink' },
  archive_records: { minDay: PASSAGE_DAY, key: 'hid.note.archive_records' },
  h04_letters: { minDay: 5, key: 'hid.note.h04_letters', gives: ['L02', 'L04'] },
  h04_memo: { minDay: 5, key: 'hid.note.h04_memo', gives: ['L05'] },
};

// ---------------- 小さな道具 ----------------

const items = (s: GameState) => s.actors.hero.items;
export const hasItem = (s: GameState, id: string): boolean => (items(s)[id] ?? 0) > 0;
/** 持ち物を 1 つ足す。既に持っていれば false */
export function giveItem(s: GameState, id: string): boolean {
  if (hasItem(s, id)) return false;
  items(s)[id] = 1;
  return true;
}
/** 1 回だけの処理。まだなら記録して true */
export function claimOnce(s: GameState, key: string): boolean {
  if (s.claimed.includes(key)) return false;
  s.claimed.push(key);
  return true;
}
export const claimedAlready = (s: GameState, key: string) => s.claimed.includes(key);
export const missingCount = (s: GameState, ids: string[]) => ids.filter((x) => !hasItem(s, x)).length;
const pieces = (s: GameState) => s.actors.hero.pieces;
const isNight = (s: GameState) => s.phase === 'night';

// ---------------- 挑めるかどうか ----------------

export type Deny = 'clues' | 'day' | 'night' | 'tomorrow' | 'done' | 'once' | 'letters' | 'evidence' | 'prereq' | 'pieces' | 'time';
export type Can = { ok: true } | { ok: false; why: Deny; n?: number };

/** 成功の報酬を受け取ったあとは挑めない競技 */
const DONE_KEY: Partial<Record<HiddenId, string>> = { h01: 'h01:reward', h02: 'h02:win', h03: 'h03:key', h04: 'h04:reward', h06: 'h06:win', h07: 'h07:doc', h08: 'h08:auth' };

export function canStartH08(s: GameState): boolean {
  return s.day >= HIDDEN_MIN_DAY.h08 && (hasItem(s, 'KEY_MIRROR') || hasItem(s, 'KEY_SERVICE')) && hasItem(s, 'DOC_CROWN') && hasItem(s, 'CORE01') && !!s.flags.ISOLATION_CONFIRMED;
}

/** H06 で、この挑戦に払うピース */
export const h06Fee = (s: GameState) => H06_ENTRY_FEE + (claimedAlready(s, 'h06:doorfee') ? 0 : H06_DOOR_FEE);

export function canStartHidden(s: GameState, id: HiddenId): Can {
  if (s.day < HIDDEN_MIN_DAY[id]) return { ok: false, why: 'day' };
  const dk = DONE_KEY[id];
  if (dk && claimedAlready(s, dk)) return { ok: false, why: 'done' };
  if (id === 'h05' && s.flags.h05_tried) return { ok: false, why: 'once' };
  if (id === 'h02' && !isNight(s)) return { ok: false, why: 'night' };
  if (s.flags[`${id}_day`] === s.day) return { ok: false, why: 'tomorrow' };
  if (id === 'h01') { const n = missingCount(s, H01_NOTE_IDS); if (n) return { ok: false, why: 'clues', n }; }
  if (id === 'h04') { const n = missingCount(s, LETTER_IDS); if (n) return { ok: false, why: 'letters', n }; }
  if (id === 'h07') { const n = missingCount(s, EVIDENCE_IDS); if (n) return { ok: false, why: 'evidence', n }; }
  if (id === 'h08' && !canStartH08(s)) return { ok: false, why: 'prereq' };
  if (id === 'h02' && pieces(s) < 1) return { ok: false, why: 'pieces', n: 1 };
  if (id === 'h06' && pieces(s) < h06Fee(s)) return { ok: false, why: 'pieces', n: h06Fee(s) };
  if (s.phaseLeft < HIDDEN_MINUTES[id] * 1000) return { ok: false, why: 'time' };
  return { ok: true };
}

export const hiddenPlayers = (id: HiddenId): CharId[] => (id === 'h02' ? ['hero', 'dealer' as CharId] : id === 'h06' ? ['hero', 'mask' as CharId] : ['hero']);
export const hiddenOpts = (s: GameState, id: HiddenId): Record<string, unknown> | undefined => (id === 'h08' ? { from: Math.min(4, Number(s.flags.h08_stage ?? 0)) } : undefined);

export interface HiddenRun { id: HiddenId; stake: number; day: number }
export const readRun = (s: GameState): HiddenRun | null => { try { return s.flags.hiddenRun ? JSON.parse(String(s.flags.hiddenRun)) as HiddenRun : null; } catch { return null; } };

/** 挑戦を始める：参加費や賭けを預け、1 回だけの旗を立てる。対局の前に呼んで保存する（読み直しで逃げられないように） */
export function beginHidden(s: GameState, id: HiddenId, stake = 0): void {
  if (id === 'h02') transfer(s, 'hero', 'host', stake, '月下の賭場の賭け');
  if (id === 'h06') {
    if (claimOnce(s, 'h06:doorfee')) transfer(s, 'hero', 'host', H06_DOOR_FEE, '黒い扉の料金');
    transfer(s, 'hero', 'host', H06_ENTRY_FEE, '影の対戦者の参加費');
  }
  if (id === 'h05') s.flags.h05_tried = true;
  s.flags.hiddenRun = JSON.stringify({ id, stake, day: s.day } satisfies HiddenRun);
}

// ---------------- 結果の清算 ----------------

export type Outcome = 'win' | 'lose' | 'draw' | 'pause';
export interface Line { k: string; v?: Record<string, string | number> }
export interface HiddenResult { outcome: Outcome; lines: Line[]; story?: string }

export function outcomeOf(id: HiddenId, scores: Partial<Record<CharId, number>>, ranking: CharId[][]): Outcome {
  const sc = scores.hero ?? 0;
  switch (id) {
    case 'h02': case 'h06': return ranking.length === 1 ? 'draw' : ranking[0].includes('hero') ? 'win' : 'lose';
    case 'h03': case 'h05': return sc >= 3 ? 'win' : 'lose';
    case 'h04': return sc >= 4 ? 'win' : 'lose';
    case 'h08': return sc >= 5 ? 'win' : 'pause';
    default: return sc >= 1 ? 'win' : 'lose';
  }
}

/** 旗、報酬、持ち物を 1 回だけ処理する。hiddenRun も消す */
export function settleHidden(s: GameState, id: HiddenId, scores: Partial<Record<CharId, number>>, ranking: CharId[][]): HiddenResult {
  const run = readRun(s);
  delete s.flags.hiddenRun;
  const outcome = outcomeOf(id, scores, ranking);
  const lines: Line[] = [];
  const pay = (n: number, why: string) => { if (transfer(s, 'host', 'hero', n, why)) lines.push({ k: 'hid.rw.pieces', v: { n } }); };
  const failDay = () => { s.flags[`${id}_day`] = s.day; };
  let story: string | undefined;
  switch (id) {
    case 'h01':
      if (outcome === 'win') { if (claimOnce(s, 'h01:reward')) pay(3, '賢者の金庫'); } else failDay();
      break;
    case 'h02': {
      const stake = run?.id === 'h02' ? run.stake : 0;
      if (outcome === 'win') { claimOnce(s, 'h02:win'); pay(stake * 2, '月下の賭場の勝ち'); } else if (outcome === 'draw') { if (stake && transfer(s, 'host', 'hero', stake, '月下の賭場の引き分け')) lines.push({ k: 'hid.rw.refund', v: { n: stake } }); } else failDay();
      break;
    }
    case 'h03':
      if (outcome === 'win') { if (claimOnce(s, 'h03:key') && giveItem(s, 'KEY_MIRROR')) lines.push({ k: 'hid.rw.item', v: { name: 'KEY_MIRROR' } }); } else failDay();
      break;
    case 'h04':
      if (outcome === 'win') { if (claimOnce(s, 'h04:reward')) { pay(4, '囚人の遺言'); s.flags.h04_cleared = true; } } else failDay();
      break;
    case 'h05':
      if (outcome === 'win' && claimOnce(s, 'h05:reward')) pay(5, '時の牢獄');
      // 成功でも失敗でも、奥の地下迷宮への留め具は外れる（暫定。v04「失敗しても真相に影響させない」）
      s.flags.h05_cleared = true;
      lines.push({ k: outcome === 'win' ? 'hid.rw.door' : 'hid.h05.failDoor' });
      break;
    case 'h06':
      if (outcome === 'win') { if (claimOnce(s, 'h06:win')) pay(H06_WIN, '影の対戦者'); s.flags.h06_open = true; lines.push({ k: 'hid.rw.door' }); } else if (outcome === 'lose') failDay();
      break;
    case 'h07':
      if (outcome === 'win' && claimOnce(s, 'h07:doc')) {
        giveItem(s, 'DOC_CROWN'); giveItem(s, 'CORE01');
        s.flags.h07_cleared = true;
        lines.push({ k: 'hid.rw.item', v: { name: 'DOC_CROWN' } }, { k: 'hid.rw.item', v: { name: 'CORE01' } });
        story = 'I08';
      }
      break;
    case 'h08': {
      const stage = Math.max(Number(s.flags.h08_stage ?? 0), Math.min(5, scores.hero ?? 0));
      s.flags.h08_stage = stage;
      if (stage >= 5) {
        s.flags.h08_cleared = true;
        if (claimOnce(s, 'h08:auth') && giveItem(s, 'RELEASE_AUTH')) { lines.push({ k: 'hid.rw.item', v: { name: 'RELEASE_AUTH' } }); story = 'I10'; }
      } else lines.push({ k: 'hid.h08.saved', v: { n: stage } });
      break;
    }
  }
  return { outcome, lines, story };
}

// ---------------- 手紙、資料、代替経路 ----------------

/** 追記で手に入る手紙。新しく手に入った ID を返す */
export function takeNote(s: GameState, event: string): string[] {
  const n = HIDDEN_NOTES[event];
  if (!n || s.day < n.minDay || (n.nightOnly && !isNight(s))) return [];
  return (n.gives ?? []).filter((x) => giveItem(s, x));
}

/** 第零牢で初めて調べた時に手に入る手紙 */
export const takeZeroLetters = (s: GameState): string[] => ['L01', 'L03'].filter((x) => giveItem(s, x));

/** 記録保管庫の索引（DAY 8 から）。資料 E01〜E12、手紙の写し、保守用の鍵。新しく手に入った ID */
export function collectVault(s: GameState): string[] {
  if (s.day < LIFT_DAY) return [];
  const got: string[] = [];
  if (claimOnce(s, 'vault:index')) for (const x of [...EVIDENCE_IDS, ...LETTER_IDS]) if (giveItem(s, x)) got.push(x);
  if (claimOnce(s, 'vault:key') && giveItem(s, 'KEY_SERVICE')) got.push('KEY_SERVICE');
  return got;
}

/** 案内図で保守の知らせに気づける（DAY 7 から） */
export const canNotice = (s: GameState) => s.day >= NOTICE_DAY;
/** 交換所で閲覧の許可をもらえる（知らせを見たあと） */
export const canPermit = (s: GameState) => s.day >= NOTICE_DAY && !!s.flags.v04_maintenance_notice && !s.flags.svc_permit;

/** 保守用の昇降機が動く：DAY 8 から、許可（または解放権限）があり、棟分けの無い時 */
export function canUseLift(s: GameState): boolean {
  return s.day >= LIFT_DAY && (!!s.flags.svc_permit || hasItem(s, 'RELEASE_AUTH')) && s.actors.hero.house === null;
}

/** 隔離区域の小窓：脱落者が 1 人以上いれば、様子を確かめたことになる。立てたら true */
export function confirmIsolation(s: GameState): boolean {
  if (s.flags.ISOLATION_CONFIRMED) return false;
  if (!Object.values(s.actors).some((a) => !a.alive)) return false;
  s.flags.ISOLATION_CONFIRMED = true;
  return true;
}

export const canPrepareRescue = (s: GameState) => !!s.flags.h08_cleared && hasItem(s, 'RELEASE_AUTH') && !s.flags.RESCUE_READY;

export type ChosenEnding = 'E_ESCAPE' | 'E_REPORT' | 'E_RESCUE';
/** 自分で選べる結末。where は選ぶ場所（昇降機か、隔離区域の端末か） */
export function endingOptions(s: GameState, where: 'lift' | 'terminal' = 'lift'): ChosenEnding[] {
  if (!s.flags.h08_cleared || !hasItem(s, 'RELEASE_AUTH')) return [];
  if (where === 'terminal') return s.flags.RESCUE_READY ? ['E_RESCUE'] : [];
  const out: ChosenEnding[] = ['E_ESCAPE'];
  if (hasItem(s, 'DOC_CROWN') && hasItem(s, 'CORE01') && s.flags.ISOLATION_CONFIRMED) out.push('E_REPORT');
  return out;
}

/** 優勝した時に真の結末になるか */
export const trueEndingReady = (s: GameState) => !!s.flags.h08_cleared && !!s.flags.RESCUE_READY;
