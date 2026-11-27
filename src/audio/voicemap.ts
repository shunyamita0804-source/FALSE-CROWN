/** 台詞の場面と汎用ボイスの分類の対応（画面や音声の再生に依存しない部分） */
import table from '../data/voice.json';

export type VoiceCategory = 'greeting' | 'hello' | 'understand' | 'accept' | 'refuse' | 'thinking' | 'surprise' | 'happy' | 'disappointed' | 'thanks';
const LINES = (table as unknown as { lines: Record<string, VoiceCategory> }).lines;

/** 台詞の場面キーから分類を引く。挨拶は時間帯と、どちらが話しかけたかで決める */
export function categoryForLine(key: string, ctx: { hour?: number; heroStarted?: boolean } = {}): VoiceCategory | null {
  if (key === 'greeting') {
    if (!ctx.heroStarted) return null;
    return ctx.hour !== undefined && ctx.hour < 10 ? 'greeting' : 'hello';
  }
  return LINES[key] ?? null;
}

