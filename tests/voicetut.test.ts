import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import table from '../src/data/tutorial_voice.json';

const TV = table as unknown as { matches: Record<string, { dir: string; steps: Record<string, { file: string; text: string; gain: number; lufs: number }> }> };

describe('音声付きの競技説明', () => {
  it('M01 は収録の 8 本がそろい、台本の順に並ぶ', () => {
    expect(Object.keys(TV.matches.m01.steps)).toEqual(['title', 'basic_rules', 'controls', 'format', 'scoring', 'team_bonus', 'hint', 'practice']);
  });
  it('音源が置かれ、字幕の文と大きさの倍率がある', () => {
    for (const m of Object.values(TV.matches)) {
      for (const s of Object.values(m.steps)) {
        expect(existsSync(`public/assets/${m.dir}/${s.file}`)).toBe(true);
        expect(s.text.length).toBeGreaterThan(0);
        expect(Math.abs(s.lufs + 20 * Math.log10(s.gain) + 19)).toBeLessThanOrEqual(1);
      }
    }
  });
});
