/**
 * 汎用ボイス（データ駆動）。全文の読み上げではなく、会話の内容や感情が一致する時だけ、短い音声を 1 つ鳴らす。
 * 対応表は data/voice.json。音源が置かれていないキャラクター、対応する分類が無い台詞は無音。
 * 同じ音声の連続は間引き、次の会話や画面の切り替えで止める。音量は設定の「ボイス」に従う。
 */
import { availableAssets } from '../assets/registry';
import table from '../data/voice.json';
import { Sound } from './audio';
import type { VoiceCategory } from './voicemap';

export { categoryForLine, type VoiceCategory } from './voicemap';

interface Clip { file: string; text: string; gain: number }
interface CharVoice { dir: string; clips: Partial<Record<VoiceCategory, Clip>> }

const CHARS = (table as unknown as { characters: Record<string, CharVoice> }).characters;
const files = new Set(availableAssets());
const BASE = import.meta.env.BASE_URL;

/** 同じキャラクターの同じ音声を続けて鳴らさない間隔（ミリ秒） */
const REPEAT_GAP = 9000;
/** どの音声でも、直前の音声からこれだけ空ける */
const MIN_GAP = 700;
const last = new Map<string, number>();
let lastAny = -1e9;

/** そのキャラクターのその分類の音源（置かれていなければ null） */
export function voiceClip(charId: string, cat: VoiceCategory): { url: string; gain: number; text: string } | null {
  const c = CHARS[charId];
  const clip = c?.clips[cat];
  if (!c || !clip) return null;
  const path = `${c.dir}/${clip.file}`;
  if (!files.has(path)) return null;
  return { url: `${BASE}assets/${path}`, gain: clip.gain, text: clip.text };
}

export const hasVoice = (charId: string) => !!CHARS[charId] && Object.keys(CHARS[charId].clips).some((k) => voiceClip(charId, k as VoiceCategory));

/** 分類を指定して鳴らす。鳴らしたら true */
export function playVoice(charId: string, cat: VoiceCategory | null, now = performance.now()): boolean {
  if (!cat) return false;
  const clip = voiceClip(charId, cat);
  if (!clip) return false;
  const k = `${charId}:${cat}`;
  if (now - (last.get(k) ?? -1e9) < REPEAT_GAP || now - lastAny < MIN_GAP) return false;
  last.set(k, now);
  lastAny = now;
  Sound.voice(clip.url, clip.gain);
  return true;
}

export const stopVoice = () => Sound.stopVoice();

/** 検証用：間引きの記録を消す */
export function resetVoiceHistory(): void {
  last.clear();
  lastAny = -1e9;
}
