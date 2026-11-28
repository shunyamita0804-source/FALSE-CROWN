/**
 * 参加者の表示名の表（src/data/npc_names.json）。
 * 内部ID と表示名を分けたこと、文中の名前の差し込み、改名で古い自己紹介の声を止めることを確かめる。
 * あわせて、名前を文に直接書いている所が増えていないかを見る（改名の時の漏れを防ぐ）。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import names from '../src/data/npc_names.json';
import voice from '../src/data/voice.json';
import { NPC_BY_ID, NPC_IDS, NAMED_IDS, displayName, fillNames, saysCurrentName } from '../src/data/characters';
import { EVIDENCE, H07_QUESTIONS } from '../src/story/hiddendata';

type Entry = { status: string; ja: { name: string; short: string; kana: string } };
const TABLE = (names as unknown as { characters: Record<string, Entry> }).characters;

describe('表示名の表', () => {
  it('参加者全員の表示名があり、表に余分な人がいない', () => {
    expect([...NAMED_IDS].sort()).toEqual([...NPC_IDS].sort());
    for (const id of NPC_IDS) {
      const e = TABLE[id];
      expect(e.ja.name, id).toBeTruthy();
      expect(e.ja.short, id).toBeTruthy();
      expect(['original', 'renamed']).toContain(e.status);
    }
  });

  it('参加者の定義の名前は表から引く（内部ID は変わらない）', () => {
    for (const id of NPC_IDS) {
      expect(NPC_BY_ID[id].id).toBe(id);
      expect(NPC_BY_ID[id].name).toBe(TABLE[id].ja.name);
      expect(NPC_BY_ID[id].short).toBe(TABLE[id].ja.short);
      expect(NPC_BY_ID[id].kana).toBe(TABLE[id].ja.kana);
    }
  });

  it('英語の名前が無い時は日本語の名前を使う', () => {
    expect(displayName('npc_02_kanzaki', 'en').name).toBe(TABLE.npc_02_kanzaki.ja.name);
    expect(displayName('npc_02_kanzaki', 'en').kana).toBe('');
  });

  it('文中の差し込み：姓名は空白を詰め、呼び名はそのまま', () => {
    const full = TABLE.npc_03_kurose.ja.name.replace(/\s+/g, '');
    expect(fillNames('{name:npc_03_kurose}の委任状', 'ja')).toBe(`${full}の委任状`);
    expect(fillNames('{short:npc_03_kurose}', 'ja')).toBe(TABLE.npc_03_kurose.ja.short);
    expect(fillNames('{name:unknown_id}', 'ja')).toBe('{name:unknown_id}');
  });

  it('裏ゲームの資料と問題に、置き換え前の書き方が残らない', () => {
    for (const e of EVIDENCE) expect(e.subject + e.text).not.toMatch(/\{(name|short|kana):/);
    for (const q of H07_QUESTIONS) expect(q.prompt).not.toMatch(/\{(name|short|kana):/);
    const kanzaki = EVIDENCE.find((e) => e.person === 'npc_02_kanzaki')!;
    expect(kanzaki.subject).toBe(TABLE.npc_02_kanzaki.ja.short);
    expect(kanzaki.text).toContain(TABLE.npc_02_kanzaki.ja.name.replace(/\s+/g, ''));
  });

  it('自己紹介の声は名乗る名前を持ち、いまの名前と一致する時だけ鳴る', () => {
    const chars = (voice as unknown as { characters: Record<string, { extra?: Record<string, { spokenName?: string }> }> }).characters;
    for (const id of NPC_IDS) {
      const spoken = chars[id]?.extra?.introduction?.spokenName;
      expect(spoken, id).toBeTruthy();
      // 表が旧名のままなら一致する。改名したのに声が古いままなら一致しない（鳴らさない）
      expect(saysCurrentName(id, spoken!)).toBe(TABLE[id].status === 'original' || TABLE[id].ja.name.replace(/[\s・]+/g, '') === spoken!.replace(/[\s・]+/g, ''));
    }
    expect(saysCurrentName('npc_02_kanzaki', 'ほかの名前')).toBe(false);
  });
});

/**
 * 名前を文に直接書いてよい所。
 * - npc_names.json：表そのもの
 * - voice.json：音声と字幕を一致させる台詞（録り直しと一緒に書き換える。spokenName で古い声は止まる）
 * - npc_profiles.json、puzzle_data.json：仕様書の写し（画面には出ない）
 */
const ALLOWED = new Set(['src/data/npc_names.json', 'src/data/voice.json', 'src/data/npc_profiles.json', 'src/data/puzzle_data.json']);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|json)$/.test(f) ? [p] : [];
  });
}

describe('名前の直書き', () => {
  it('src の文章に参加者の名前を直接書いていない（コメントは除く）', () => {
    const words = NPC_IDS.flatMap((id) => [TABLE[id].ja.name.replace(/\s+/g, ''), TABLE[id].ja.name, TABLE[id].ja.short]);
    const hits: string[] = [];
    for (const file of walk('src')) {
      const rel = file.replace(/\\/g, '/');
      if (ALLOWED.has(rel) || rel === 'src/data/characters.ts') continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const tl = line.trim();
          if (tl.startsWith('//') || tl.startsWith('*') || tl.startsWith('/*')) return;
          const w = words.find((x) => line.includes(x));
          if (w) hits.push(`${rel}:${i + 1} ${w}`);
        });
    }
    expect(hits).toEqual([]);
  });
});
