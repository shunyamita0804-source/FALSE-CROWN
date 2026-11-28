/**
 * 参加者の自己紹介イベントの決まりごと（画面を持たない部分）。
 * 集合場所、輪の位置、順番、字幕と声の対応を、data/introductions.json と大会の名簿から組み立てる。
 * 顔ぶれや人数が変わっても（2 周目以降の入れ替え）、この関数群がそのまま合わせる。
 */
import table from '../data/introductions.json';
import { NPC_BY_ID, fillNames, type CharId, type NpcId } from '../data/characters';
import type { GameState } from './types';
import { aliveIds } from './state';
import { Rng } from './rng';
import { nearestFree } from '../world/path';

export interface IntroTable {
  venue: { room: string; center: [number, number]; radius: [number, number]; heroAngle: number; slots: [number, number][]; camera?: [number, number] };
  order: { mode: 'ring' | 'roster' | 'random'; hero: 'first' | 'last' | 'inline'; first?: string[] };
  bgm: string;
  timing: { gatherTimeoutMs: number; settleMs: number; afterVoiceMs: number; textMsPerChar: number; minTextMs: number; maxTextMs: number; departStaggerMs: number; departShowMs: number };
  entries: Record<string, { text: string }>;
}
export const INTRO = table as unknown as IntroTable;

export interface Seat { id: CharId; x: number; y: number }

/** その周の参加者（脱落者を除く名簿の順） */
export const introParticipants = (s: GameState): CharId[] => aliveIds(s);

/**
 * 輪の座席。主人公を heroAngle に置き、残りを等間隔に時計回りで並べる。
 * slots が指定されていればそれを使う。床でない所や重なりは、近くの空いた床へずらす。
 */
export function ringSeats(ids: CharId[], grid: boolean[][], t: IntroTable = INTRO): Seat[] {
  const v = t.venue;
  const n = ids.length;
  const heroFirst = ids.includes('hero') ? ['hero' as CharId, ...ids.filter((x) => x !== 'hero')] : ids;
  const taken = new Set<string>();
  const out: Seat[] = [];
  heroFirst.forEach((id, i) => {
    let p: { x: number; y: number };
    if (v.slots.length >= n) p = { x: v.slots[i][0], y: v.slots[i][1] };
    else {
      // 画面の座標は y が下向きなので、角度が増えると時計回りに進む
      const a = ((v.heroAngle + (360 * i) / n) * Math.PI) / 180;
      p = { x: Math.round(v.center[0] + v.radius[0] * Math.cos(a)), y: Math.round(v.center[1] + v.radius[1] * Math.sin(a)) };
    }
    const k = `${p.x},${p.y}`;
    if (grid[p.y]?.[p.x] !== false || taken.has(k)) p = nearestFree(grid, p, taken);
    taken.add(`${p.x},${p.y}`);
    out.push({ id, x: p.x, y: p.y });
  });
  return out;
}

/** 話す順番。seats は ringSeats の結果（主人公が先頭、そこから時計回り） */
export function introOrder(seats: Seat[], seed: number, t: IntroTable = INTRO): CharId[] {
  const ring = seats.map((s) => s.id);
  let order: CharId[];
  if (t.order.mode === 'random') {
    const rng = Rng.derive(seed, 'introduction');
    order = ring.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [order[i], order[j]] = [order[j], order[i]];
    }
  } else if (t.order.mode === 'roster') {
    order = ring.slice().sort((a, b) => (a === 'hero' ? -1 : b === 'hero' ? 1 : a.localeCompare(b)));
  } else {
    // 主人公の隣（時計回りの次）から一周する
    order = [...ring.slice(1), ring[0]];
  }
  // 先頭に固定する人（その周に参加している人だけ。いなければ飛ばす）
  const lead = (t.order.first ?? []).filter((x): x is CharId => ring.includes(x as CharId) && x !== 'hero');
  order = [...lead, ...order.filter((x) => !lead.includes(x))];
  if (!ring.includes('hero') || t.order.hero === 'inline') return order;
  const rest = order.filter((x) => x !== 'hero');
  return t.order.hero === 'first' ? ['hero', ...rest] : [...rest, 'hero'];
}

export interface IntroLine {
  id: CharId;
  name: string;
  kana: string;
  /** 公開してよい情報だけ（能力値や人格値は持たない） */
  age: number | null;
  job: string | null;
  text: string;
  voice: { url: string; gain: number } | null;
}

/**
 * 1 人分の紹介。声が置かれている人は、管理表の台詞をそのまま字幕にする（声と字幕を一致させる）。
 * voiceOf は音源の有無を調べる関数（audio/voice.ts の voiceClip。検査では差し替える）。
 */
export function introLine(s: GameState, id: CharId, voiceOf: (id: string) => { url: string; gain: number; text: string } | null, t: IntroTable = INTRO): IntroLine {
  if (id === 'hero') {
    const text = (t.entries.hero?.text ?? '{name}です。よろしくお願いします。').replace('{name}', s.hero.name);
    return { id, name: s.hero.name, kana: '', age: null, job: null, text, voice: null };
  }
  const def = NPC_BY_ID[id as NpcId];
  const v = voiceOf(id);
  // 声が無い時（改名して古い声を止めた時も）は表の文に、いまの表示名を差し込む
  const text = v?.text ?? fillNames(t.entries[id]?.text ?? `{name:${id}}です。よろしくお願いします。`);
  return { id, name: def.name, kana: def.kana, age: def.age, job: def.job, text, voice: v ? { url: v.url, gain: v.gain } : null };
}

/** 声が無い時に字幕を出しておく長さ（ミリ秒） */
export function textHoldMs(text: string, t: IntroTable = INTRO): number {
  return Math.max(t.timing.minTextMs, Math.min(t.timing.maxTextMs, text.length * t.timing.textMsPerChar));
}

/** 自己紹介を聞き終えた（または飛ばした）印。手帳の公開プロフィールが開く */
export function markIntroduced(s: GameState, ids: CharId[]): void {
  for (const id of ids) {
    if (id === 'hero') continue;
    s.flags[`heroMet_${id}`] = true;
    s.flags[`introHeard_${id}`] = true;
    // 自己紹介の声はこのイベントで聞いたので、最初の会話の挨拶はふつうの声にする
    s.flags[`voice_intro_${id}`] = true;
  }
  s.flags.introDone = true;
}

/** 自己紹介が済んだ後に向かう施設（その人の好きな場所のうち、集合場所でない最初の所） */
export function departRoom(id: NpcId, venue = INTRO.venue.room, canGo: (room: string) => boolean = () => true): string | null {
  return NPC_BY_ID[id].favoriteRooms.find((r) => r !== venue && canGo(r)) ?? null;
}
