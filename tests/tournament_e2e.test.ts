/**
 * 大会の通し検証（画面なし・自動）。新しい大会を始めてから決勝・主人公の脱落まで、日ごとに次を確かめる。
 * - 各日の人数が日程表どおり（メイン・監獄の人数、1 日 1 人だけ脱落）
 * - 競技の割り当て（lineup）が大会の始めに決まり、その日の人数で遊べる競技で、保存・再開しても変わらない
 * - 保存（セーブの包み → 検証 → 移し替え）して再開しても、その後の大会の進み方が変わらない
 * - ピースは負にならず、脱落者は 0。救いのメダルは各日のメインの 1 位に渡る
 * - 主人公が脱落したら、そこで大会が終わる（次の日へ進まない）
 * 画面の操作（集合移動・会話・作戦時間）は含まない。それは scripts/check-*.cjs で別に確かめる。
 */
import { describe, expect, it } from 'vitest';
import { autoAdvance } from '../src/core/autoplay';
import { PRISON_POOL, MAIN_POOL } from '../src/core/lineup';
import { aliveIds } from '../src/core/state';
import { mainMatchId, prisonMatchId } from '../src/core/tournament';
import type { GameState } from '../src/core/types';
import { CONFIG, scheduleFor } from '../src/data/config';
import { loadGame, saveGame, setStorage } from '../src/save/save';
import { freshState } from './helpers';

const mem = new Map<string, string>();
setStorage({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) });

/** 実際のセーブと同じ道筋（包む → 検証 → 移し替え）で保存して読み直す */
function saveAndLoad(s: GameState): GameState {
  expect(saveGame(s)).toBe(true);
  const r = loadGame();
  expect(r).not.toBeNull();
  return r!.state;
}

const LAST = CONFIG.schedule[CONFIG.schedule.length - 1].day;
const poolPlayers = (id: string) => [...MAIN_POOL.pool, ...PRISON_POOL.pool].find((e) => e.id === id)?.players;

/** その日の結果の要約（再開しても同じ進み方かを比べる） */
const digest = (s: GameState) => JSON.stringify({
  day: s.day,
  phase: s.phase,
  alive: aliveIds(s),
  pieces: Object.values(s.actors).map((a) => a.pieces),
  hist: s.history.map((h) => [h.mainRanking, h.prisonRanking, h.rescue?.status]),
  today: [s.today.mainRanking, s.today.prisonRanking],
});

interface Run { endDay: number; heroOut: boolean; champion?: string }

async function runTournament(seed: number, opts: { free?: boolean; resumeAt?: number } = {}): Promise<Run> {
  let s = freshState(seed);
  s.phase = 'morning';
  const lineup = JSON.stringify(s.lineup);
  expect(s.lineup, '新しい大会には割り当てが残る').toBeTruthy();
  for (let d = 1; d <= LAST; d++) {
    const sch = scheduleFor(d);
    // 朝：人数が日程表どおり
    expect(s.day).toBe(d);
    expect(aliveIds(s).length, `DAY${d} の朝の人数`).toBe(sch.players);
    // その日の競技は割り当てどおりで、その人数で遊べる
    const main = mainMatchId(s, d);
    expect(poolPlayers(main) ?? [sch.players], `DAY${d} ${main}`).toContain(sch.players);
    const pr = prisonMatchId(s, d);
    if (sch.prison > 0) {
      expect(pr).toBeTruthy();
      expect(poolPlayers(pr!), `DAY${d} 監獄 ${pr}`).toContain(sch.prison);
    } else expect(pr).toBeNull();
    // 保存して再開（指定の日）。割り当ても、その後の進み方も変わらない
    if (opts.resumeAt === d) {
      const before = digest(s);
      s = saveAndLoad(s);
      expect(JSON.stringify(s.lineup)).toBe(lineup);
      expect(digest(s)).toBe(before);
    }
    const ok = await autoAdvance(s, d + 1, 'morning', { free: opts.free });
    // 割り当ては大会の途中で変わらない
    expect(JSON.stringify(s.lineup)).toBe(lineup);
    for (const a of Object.values(s.actors)) {
      expect(a.pieces).toBeGreaterThanOrEqual(0);
      if (!a.alive) expect(a.pieces).toBe(0);
    }
    const rec = s.history[d - 1] ?? s.today;
    expect(rec.mainRanking!.length, `DAY${d} メインの順位の人数`).toBe(sch.players);
    if (d === LAST) {
      // 決勝：順位発表で終わる。2 人のまま優勝者が決まっている
      expect(ok).toBe(false);
      expect(s.phase).toBe('reward');
      expect(aliveIds(s).length).toBe(2);
      return { endDay: d, heroOut: false, champion: s.today.mainRanking![0] };
    }
    expect(rec.prisonRanking!.length, `DAY${d} 監獄マッチの人数`).toBe(sch.prison);
    // 救いのメダルはメインの 1 位に
    if (rec.rescue) expect(rec.rescue.holder).toBe(rec.mainRanking![0]);
    // 1 日に脱落するのは 1 人だけで、監獄マッチの最下位
    const out = Object.values(s.actors).filter((a) => a.eliminatedDay === d);
    expect(out.length, `DAY${d} の脱落者`).toBe(1);
    expect(rec.prisonRanking!.at(-1)).toBe(out[0].id);
    if (!s.actors.hero.alive) {
      // 主人公の脱落：そこで終わり、次の日へ進まない
      expect(ok).toBe(false);
      expect(s.actors.hero.eliminatedDay).toBe(d);
      expect(s.day).toBe(d);
      return { endDay: d, heroOut: true };
    }
    expect(ok).toBe(true);
  }
  throw new Error('unreachable');
}

describe('大会の通し検証（自動）', () => {
  it('新しい大会 120 回：毎日の人数・競技・脱落・ピース・メダルが日程どおりで、主人公の脱落か決勝で正しく終わる', async () => {
    const ends: Record<string, number> = {};
    const champs: Record<string, number> = {};
    for (let seed = 1; seed <= 120; seed++) {
      const r = await runTournament(seed * 31 + 5);
      const k = r.heroOut ? `主人公 DAY${r.endDay} 脱落` : '決勝まで';
      ends[k] = (ends[k] ?? 0) + 1;
      if (r.champion) champs[r.champion] = (champs[r.champion] ?? 0) + 1;
    }
    console.log('終わり方', ends, '優勝', champs);
    expect(ends['決勝まで'] ?? 0).toBeGreaterThan(0);
    expect(Object.keys(ends).some((k) => k.startsWith('主人公'))).toBe(true);
  }, 600_000);

  it('保存・再開：途中の日の朝に保存して読み直しても、割り当てとその後の結果が保存しない時と同じ', async () => {
    for (let seed = 1; seed <= 12; seed++) {
      const sd = seed * 97 + 1;
      const resumeAt = 1 + (seed % 6);
      // 保存しない時と、保存・再開した時の結果を比べる
      const a = freshState(sd); a.phase = 'morning';
      const b = freshState(sd); b.phase = 'morning';
      await autoAdvance(a, resumeAt, 'morning');
      await autoAdvance(b, resumeAt, 'morning');
      if (!a.actors.hero.alive) continue;
      const b2 = saveAndLoad(b);
      expect(JSON.stringify(b2.lineup)).toBe(JSON.stringify(a.lineup));
      await autoAdvance(a, LAST + 1, 'morning');
      await autoAdvance(b2, LAST + 1, 'morning');
      expect(digest(b2)).toBe(digest(a));
    }
  }, 300_000);

  it('自由時間の NPC 行動を入れた大会 4 回も、同じ決まりで最後まで進む（保存・再開を挟む）', async () => {
    for (let seed = 1; seed <= 4; seed++) await runTournament(seed * 7 + 3, { free: true, resumeAt: 2 + seed });
  }, 600_000);

  it('古いセーブ（割り当てなし）は日程表の並びのまま最後まで進む', async () => {
    for (let seed = 1; seed <= 10; seed++) {
      const s = freshState(seed * 13 + 2);
      s.phase = 'morning';
      delete (s as Partial<GameState>).lineup;
      const t = saveAndLoad(s);
      for (let d = 1; d <= LAST; d++) {
        expect(mainMatchId(t, d)).toBe(scheduleFor(d).main);
        expect(prisonMatchId(t, d)).toBe(scheduleFor(d).prisonGame);
      }
      await autoAdvance(t, LAST + 1, 'morning');
      if (t.actors.hero.alive) expect(aliveIds(t).length).toBe(2);
    }
  }, 300_000);
});
