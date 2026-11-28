import { describe, expect, it } from 'vitest';
import table from '../src/data/voice.json';
import dialogue from '../src/data/dialogue.json';
import { categoryForLine } from '../src/audio/voicemap';
import { NPC_IDS } from '../src/data/characters';

const T = table as unknown as { categories: string[]; lines: Record<string, string>; characters: Record<string, { dir: string; clips: Record<string, { file: string; text: string; gain: number }>; extra?: Record<string, { file: string; text: string; gain: number }> }> };

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
        expect(clip.gain).toBeGreaterThanOrEqual(0.25);
        expect(clip.gain).toBeLessThanOrEqual(4.5);
      }
    }
  });

  it('追加ボイス（自己紹介、勝利、敗北、脱落、裏切り）は、持っている人だけ。ファイル名と分類が一致し、基本の 10 点と重ならない', () => {
    const EXTRA = ['introduction', 'victory', 'defeat', 'elimination', 'betrayal'];
    const withExtra = Object.entries(T.characters).filter(([, c]) => c.extra);
    expect(withExtra.length).toBeGreaterThanOrEqual(2);
    for (const [, c] of withExtra) {
      expect(Object.keys(c.extra!).sort()).toEqual([...EXTRA].sort());
      for (const [cat, clip] of Object.entries(c.extra!)) {
        // 納品物のファイル名のまま収録する（intro、win、lose は別名）
        const ALIAS: Record<string, string> = { introduction: '(introduction|intro)', victory: '(victory|win)', defeat: '(defeat|lose)' };
        expect(clip.file).toMatch(new RegExp(`^1[1-5]_${ALIAS[cat] ?? cat}\\.mp3$`));
        expect(Object.values(c.clips).some((x) => x.file === clip.file)).toBe(false);
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

  it('全員の声の聞こえる大きさが揃っている（倍率を掛けた後の差が 1 LU 以内）', () => {
    const target = (table as unknown as { loudness: { target: number } }).loudness.target;
    for (const c of Object.values(T.characters)) {
      for (const clip of [...Object.values(c.clips), ...Object.values(c.extra ?? {})] as { gain: number; lufs?: number }[]) {
        expect(clip.lufs).toBeTypeOf('number');
        expect(Math.abs(clip.lufs! + 20 * Math.log10(clip.gain) - target)).toBeLessThanOrEqual(1);
      }
    }
  });
});
