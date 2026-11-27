import { describe, expect, it } from 'vitest';
import table from '../src/data/voice.json';
import dialogue from '../src/data/dialogue.json';
import { categoryForLine } from '../src/audio/voicemap';
import { NPC_IDS } from '../src/data/characters';

const T = table as unknown as { categories: string[]; lines: Record<string, string>; characters: Record<string, { dir: string; clips: Record<string, { file: string; text: string; gain: number }> }> };

describe('汎用ボイスの対応表', () => {
  it('登録済みのキャラクターは 10 分類すべてを持ち、ファイル名と分類が一致する', () => {
    expect(Object.keys(T.characters).length).toBeGreaterThanOrEqual(4);
    for (const [id, c] of Object.entries(T.characters)) {
      expect(NPC_IDS).toContain(id);
      expect(c.dir).toBe(`audio/voice/${id}`);
      expect(Object.keys(c.clips).sort()).toEqual([...T.categories].sort());
      for (const [cat, clip] of Object.entries(c.clips)) {
        expect(clip.file).toMatch(new RegExp(`^\\d\\d_${cat}\\.mp3$`));
        expect(clip.text.length).toBeGreaterThan(0);
        expect(clip.gain).toBeGreaterThanOrEqual(0.7);
        expect(clip.gain).toBeLessThanOrEqual(1.4);
      }
    }
  });

  it('台詞の場面キーは実在する場面だけを指し、分類も実在する', () => {
    const events = new Set((dialogue as { entries: { event: string }[] }).entries.map((e) => e.event));
    for (const extra of ['refuse', 'accuseBelieve']) events.add(extra);
    for (const [key, cat] of Object.entries(T.lines)) {
      expect(events.has(key)).toBe(true);
      expect(T.categories).toContain(cat);
    }
  });

  it('挨拶は、主人公から話しかけた時だけ。朝は「おはよう」、それ以外は呼びかけへの返事', () => {
    expect(categoryForLine('greeting', { hour: 7, heroStarted: true })).toBe('greeting');
    expect(categoryForLine('greeting', { hour: 15, heroStarted: true })).toBe('hello');
    expect(categoryForLine('greeting', { hour: 7, heroStarted: false })).toBeNull();
    expect(categoryForLine('accept')).toBe('accept');
    expect(categoryForLine('reject_principle')).toBe('refuse');
    // 内容が毎回変わる雑談や情報の提示には、汎用ボイスを当てない
    expect(categoryForLine('smalltalk')).toBeNull();
    expect(categoryForLine('info_offer')).toBeNull();
  });
});
