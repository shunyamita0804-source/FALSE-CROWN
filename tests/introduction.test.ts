import { describe, expect, it } from 'vitest';
import voiceTable from '../src/data/voice.json';
import { INTRO, departRoom, introLine, introOrder, introParticipants, markIntroduced, ringSeats, textHoldMs } from '../src/core/introduction';
import { newGame } from '../src/core/state';
import { NPC_IDS, type CharId, type NpcId } from '../src/data/characters';
import { ROOMS } from '../src/world/maps';
import { collisionOf } from '../src/world/sim';

const V = voiceTable as unknown as { characters: Record<string, { extra?: Record<string, { file: string; text: string; gain: number }> }> };
/** 検査用：管理表に自己紹介の声がある人は、その台詞と音源を返す */
const voiceOf = (id: string) => {
  const c = V.characters[id]?.extra?.introduction;
  return c ? { url: `x/${c.file}`, gain: c.gain, text: c.text } : null;
};

describe('参加者の自己紹介', () => {
  const s = newGame({ gender: 'm', name: '天城 湊', seed: 7 });
  const grid = collisionOf(s, INTRO.venue.room);

  it('集合場所は実在する部屋で、12 人の席はすべて歩ける床の上にあり、重ならない', () => {
    expect(ROOMS[INTRO.venue.room]).toBeTruthy();
    const ids = introParticipants(s);
    expect(ids.length).toBe(12);
    const seats = ringSeats(ids, grid);
    expect(seats.length).toBe(12);
    expect(new Set(seats.map((p) => `${p.x},${p.y}`)).size).toBe(12);
    for (const p of seats) expect(grid[p.y][p.x]).toBe(false);
    expect(seats[0].id).toBe('hero');
  });

  it('人数が変わっても（2 周目の入れ替えや 8 人の時）、席は人数分そろう', () => {
    const ids = ['hero', ...NPC_IDS.slice(3, 10)] as CharId[];
    const seats = ringSeats(ids, grid);
    expect(seats.map((x) => x.id).sort()).toEqual(ids.slice().sort());
    expect(new Set(seats.map((p) => `${p.x},${p.y}`)).size).toBe(ids.length);
  });

  it('座席をデータで指定すると、その位置を使う', () => {
    const ids = ['hero', 'npc_02_kanzaki', 'npc_03_kurose'] as CharId[];
    const t = { ...INTRO, venue: { ...INTRO.venue, slots: [[16, 15], [12, 10], [20, 10]] as [number, number][] } };
    expect(ringSeats(ids, grid, t).map((p) => [p.x, p.y])).toEqual([[16, 15], [12, 10], [20, 10]]);
  });

  it('全員がちょうど 1 回ずつ話し、主人公は最後（設定で変えられる）', () => {
    const seats = ringSeats(introParticipants(s), grid);
    const order = introOrder(seats, s.seed);
    expect(order.slice().sort()).toEqual(introParticipants(s).slice().sort());
    expect(order[order.length - 1]).toBe('hero');
    expect(introOrder(seats, s.seed, { ...INTRO, order: { mode: 'ring', hero: 'first' } })[0]).toBe('hero');
    const r1 = introOrder(seats, 1, { ...INTRO, order: { mode: 'random', hero: 'inline' } });
    expect(r1.slice().sort()).toEqual(order.slice().sort());
  });

  it('声がある人の字幕は、収録された台詞と同じ。声が無い人は字幕だけ', () => {
    for (const id of NPC_IDS) {
      const l = introLine(s, id, voiceOf);
      const v = voiceOf(id);
      if (v) { expect(l.text).toBe(v.text); expect(l.voice).not.toBeNull(); }
      else { expect(l.voice).toBeNull(); expect(l.text).toBe(INTRO.entries[id].text); }
      expect(l.age).toBeGreaterThan(0);
      expect(l.job).toBeTruthy();
      // 非公開の数値は持たない
      expect(Object.keys(l).sort()).toEqual(['age', 'id', 'job', 'kana', 'name', 'text', 'voice']);
    }
    const hero = introLine(s, 'hero', voiceOf);
    expect(hero.voice).toBeNull();
    expect(hero.text).toContain('天城 湊');
    // データの台詞（声が届く前の仮の字幕）も、届いている声と食い違わない
    for (const id of NPC_IDS) { const v = voiceOf(id); if (v) expect(INTRO.entries[id].text).toBe(v.text); }
  });

  it('声が無い字幕は、読める長さだけ出しておく', () => {
    expect(textHoldMs('あ')).toBe(INTRO.timing.minTextMs);
    expect(textHoldMs('あ'.repeat(500))).toBe(INTRO.timing.maxTextMs);
  });

  it('紹介が済むと、手帳に公開プロフィールが載る印が付き、各自の行き先は集合場所以外の施設', () => {
    const g = newGame({ gender: 'f', name: '天城 葵', seed: 3 });
    markIntroduced(g, introParticipants(g));
    expect(g.flags.introDone).toBe(true);
    for (const id of NPC_IDS) {
      expect(g.flags[`heroMet_${id}`]).toBe(true);
      const d = departRoom(id as NpcId);
      expect(d).not.toBe(INTRO.venue.room);
      expect(d && ROOMS[d]).toBeTruthy();
    }
  });
});
