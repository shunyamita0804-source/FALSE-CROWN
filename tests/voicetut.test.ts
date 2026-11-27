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

import { fitsScene } from '../src/audio/voicefit';
import announcer from '../src/data/announcer.json';

describe('説明の声を、場面に合わせて使い分ける', () => {
  it('収録の前提と場面が同じなら収録を使い、違えば使わない', () => {
    const fits = (TV.matches.m01.steps as Record<string, { fits?: Record<string, number> }>).title.fits;
    expect(fits).toEqual({ order: 1 });
    expect(fitsScene(fits, { order: 1 })).toBe(true);
    expect(fitsScene(fits, undefined)).toBe(true);
    // 2 周目で M01 が 3 番目の競技になった時、決勝で使う時
    expect(fitsScene(fits, { order: 3 })).toBe(false);
    expect(fitsScene(fits, { order: 0 })).toBe(false);
    const f2 = (TV.matches.m01.steps as Record<string, { fits?: Record<string, number> }>).format.fits;
    expect(fitsScene(f2, { groups: 3, size: 4, stages: 6, sec: 120 })).toBe(true);
    // 参加者が 8 人なら 2 組になり、「3 つのグループ」の収録は使わない
    expect(fitsScene(f2, { groups: 2, size: 4, stages: 6, sec: 120 })).toBe(false);
  });
});

describe('大会の進行の声（オブザーバー）', () => {
  const AN = announcer as unknown as { speaker: string; dir: string; lines: Record<string, { file: string; text: string; gain: number; lufs: number }> };
  it('15 の出来事に、音源と台詞と大きさの倍率がある', () => {
    expect(AN.speaker).toBe('host_observer');
    expect(Object.keys(AN.lines)).toEqual(['opening', 'tournament_open', 'rules', 'game_start', 'game_end', 'time_up', 'results', 'victory', 'prison_transfer', 'prison_start', 'elimination', 'rescue_medal', 'curfew', 'final', 'champion']);
    for (const [k, c] of Object.entries(AN.lines)) {
      expect(c.file).toMatch(new RegExp(`^\\d\\d_${k}\\.mp3$`));
      expect(existsSync(`public/assets/${AN.dir}/${c.file}`)).toBe(true);
      expect(c.text.length).toBeGreaterThan(0);
      expect(Math.abs(c.lufs + 20 * Math.log10(c.gain) + 19)).toBeLessThanOrEqual(1);
    }
  });
});
