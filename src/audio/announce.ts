/**
 * 大会の進行の声（オブザーバー）。データ駆動：出来事の名前（data/announcer.json の lines のキー）で鳴らす。
 * 音源が置かれていない出来事は無音。声は重ねない（鳴らすと前の声は止まる）。音量は設定の「ボイス」に従う。
 * 新しい出来事は announcer.json に足し、呼ぶ所で announce('名前') とするだけ。
 */
import { availableAssets } from '../assets/registry';
import table from '../data/announcer.json';
import { Sound } from './audio';

interface Clip { file: string; text: string; gain: number }
const AN = table as unknown as { speaker: string; dir: string; lines: Record<string, Clip> };
const files = new Set(availableAssets());
const BASE = import.meta.env.BASE_URL;

/** 同じ出来事の声を続けて鳴らさない間隔（ミリ秒） */
const REPEAT_GAP = 4000;
const last = new Map<string, number>();

export const announceText = (event: string): string | null => AN.lines[event]?.text ?? null;

export function hasAnnounce(event: string): boolean {
  const c = AN.lines[event];
  return !!c && files.has(`${AN.dir}/${c.file}`);
}

/** 進行の声を鳴らす。鳴らし終えたら（鳴らせない時はすぐ）解決する */
export function announce(event: string, now = performance.now()): Promise<boolean> {
  const c = AN.lines[event];
  if (!c || !hasAnnounce(event) || now - (last.get(event) ?? -1e9) < REPEAT_GAP) return Promise.resolve(false);
  last.set(event, now);
  return new Promise((resolve) => Sound.voice(`${BASE}assets/${AN.dir}/${c.file}`, c.gain, { duck: true, onEnd: () => resolve(true) }));
}

/** 検証用：間引きの記録を消す */
export const resetAnnounce = () => last.clear();
