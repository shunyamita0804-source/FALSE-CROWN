import { describe, expect, it } from 'vitest';
import { addInfo, learn } from '../src/core/state';
import type { GameState } from '../src/core/types';
import { NPC_IDS, type CharId } from '../src/data/characters';
import {
  BG_DEFS, BG_WINGS, CLUE_KEYS, backGames, beginBg, confirmClue, bgClueToTell, canChallenge, checkOrder, freeSlot, openLock, prisonCode, readBgRun, recOf,
  retireLegacyRun, settleBg, syncClues, unlock, type BgWing, type ClueKey,
} from '../src/story/backgames';
import { CLUES, activeClue } from '../src/story/clues';
import { ROOMS, inspectsOf } from '../src/world/maps';
import { canEnter } from '../src/world/access';
import { validate } from '../src/save/save';
import { hashString } from '../src/core/rng';
import { freshState } from './helpers';

const mask = 'mask' as CharId;
const WIN: Record<BgWing, [Partial<Record<CharId, number>>, CharId[][]]> = { living: [{ hero: 1 }, [['hero']]], prison: [{ hero: 9, [mask]: 3 }, [['hero'], [mask]]] };
const LOSE: Record<BgWing, [Partial<Record<CharId, number>>, CharId[][]]> = { living: [{ hero: 0 }, [['hero']]], prison: [{ hero: 3, [mask]: 9 }, [[mask], ['hero']]] };

/** 指定の版のセーブとして包む（save.ts の wrap と同じ形） */
function wrap(state: GameState, version: number): string {
  const data = JSON.stringify(state);
  return JSON.stringify({ app: 'false-crown', version, savedAt: 1, sum: hashString(data), data });
}

function at(day = 2, phase: GameState['phase'] = 'morning'): GameState {
  const s = freshState(5);
  s.day = day;
  s.phase = phase;
  s.phaseLeft = 400_000;
  for (const a of Object.values(s.actors)) a.house = null;
  return s;
}

/** 調べた時と同じ形で、手掛かりの情報を知る */
function see(s: GameState, who: CharId, id: string, from: CharId | 'self' = 'self') {
  const c = CLUES.find((x) => x.id === id)!;
  if (!s.infos[id]) addInfo(s, { id, kind: 'clue', text: c.text, truth: true, about: [], source: 'world', value: c.value, tags: c.tags });
  learn(s, who, id, from, 1);
}
const seeAll = (s: GameState, wing: BgWing, keys: ClueKey[] = CLUE_KEYS) => { for (const k of keys) see(s, 'hero', BG_DEFS[wing].clues[k]); syncClues(s); };

function perms<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}

describe('解放パズル：3 つの手掛かりで答えが 1 つ', () => {
  for (const wing of BG_WINGS) {
    it(`${wing}：3 つとも満たす並びは答えだけ。2 つだけでは 1 つに決まらない`, () => {
      const def = BG_DEFS[wing];
      const all = perms(def.tiles);
      const fit = (keys: ClueKey[]) => all.filter((o) => keys.every((k) => def.fits[k](o)));
      expect(fit(CLUE_KEYS)).toEqual([def.answer]);
      for (const drop of CLUE_KEYS) {
        const keys = CLUE_KEYS.filter((k) => k !== drop);
        // 監獄棟の A は図形と数字の組（並びは決めない）。A が無いと数字にならないので、A を抜いた時は並びが決まっても番号は読めない
        if (wing === 'prison' && drop === 'A') continue;
        expect(fit(keys).length).toBeGreaterThan(1);
      }
    });
  }
  it('監獄棟の番号は 4231', () => { expect(prisonCode()).toBe('4231'); });

  it('3 つそろうまで確かめられない。違えば食い違う手掛かりを返す', () => {
    const s = at();
    seeAll(s, 'living', ['A', 'B']);
    expect(checkOrder(s, 'living', BG_DEFS.living.answer)).toEqual({ ok: false, why: 'clues', n: 1 });
    expect(unlock(s, 'living', BG_DEFS.living.answer)).toBe(false);
    seeAll(s, 'living');
    expect(checkOrder(s, 'living', ['♛', '☾', '★', '☀'])).toEqual({ ok: false, why: 'wrong', miss: ['A'] });
    expect(checkOrder(s, 'living', ['☾', '★'])).toEqual({ ok: false, why: 'shape' });
    expect(unlock(s, 'living', BG_DEFS.living.answer)).toBe(true);
    expect(unlock(s, 'living', BG_DEFS.living.answer)).toBe(false);
    expect(recOf(s, 'living').unlockedDay).toBe(2);
  });
});

describe('手掛かりの記録：自分で確かめた、NPC から聞いた、噂', () => {
  it('NPC が実際に調べて知っていた手掛かりを聞けば、聞いた相手と一緒に数える', () => {
    const s = at();
    const npc = NPC_IDS[3];
    see(s, npc, 'bg_live_b');
    see(s, 'hero', 'bg_live_b', npc);
    syncClues(s);
    expect(recOf(s, 'living').clues.B).toMatchObject({ via: npc });
    // あとで自分で調べれば「自分で確かめた」に替わる
    confirmClue(s, 'living', 'B');
    expect(recOf(s, 'living').clues.B).toMatchObject({ via: 'self' });
  });
  it('噂やうそ（別の情報）は手掛かりに数えない。誤った噂を聞いていても解ける', () => {
    const s = at();
    const fake = addInfo(s, { kind: 'rumor', text: '遊戯室の箱の蓋には「王冠は先頭」と書いてあるらしい。', truth: false, about: [], source: NPC_IDS[2], value: 1, tags: ['rumor'] });
    learn(s, 'hero', fake.id, NPC_IDS[2], 1);
    syncClues(s);
    expect(recOf(s, 'living').clues).toEqual({});
    // 誤った噂を聞いていても、自分で調べれば正しい手掛かりで解ける（解放不能にならない）
    seeAll(s, 'living');
    expect(unlock(s, 'living', BG_DEFS.living.answer)).toBe(true);
  });
  it('雑談で話すのは、自分で調べた NPC だけ。誰でも話せる。1 人 1 日 1 件。解いたあとは話さない', () => {
    const s = at();
    const [a, b, c] = NPC_IDS;
    see(s, a, 'bg_prison_b');
    see(s, b, 'bg_prison_b');
    see(s, c, 'bg_prison_b', a);
    expect(bgClueToTell(s, c)).toBeNull();
    expect(bgClueToTell(s, a)).toBe('bg_prison_b');
    expect(bgClueToTell(s, a)).toBeNull();
    expect(bgClueToTell(s, b)).toBe('bg_prison_b');
    // 主人公がもう知っていれば話さない
    const s2 = at();
    see(s2, a, 'bg_prison_b');
    see(s2, 'hero', 'bg_prison_b');
    expect(bgClueToTell(s2, a)).toBeNull();
    // 解放済みの系統の手掛かりは話さない
    const s3 = at();
    seeAll(s3, 'prison');
    unlock(s3, 'prison', BG_DEFS.prison.answer);
    see(s3, a, 'bg_live_a');
    expect(bgClueToTell(s3, a)).toBe('bg_live_a');
    // 旧裏ルートでは話さない
    const s4 = at();
    s4.flags.hiddenLayout = 'legacy';
    see(s4, a, 'bg_live_a');
    expect(bgClueToTell(s4, a)).toBeNull();
  });
  it('手掛かりの置き場所は、いまの館の通常の部屋にあり、主人公が自分で調べられる', () => {
    const s = at();
    for (const wing of BG_WINGS) {
      const def = BG_DEFS[wing];
      for (const id of [...Object.values(def.clues), def.lockInfo]) {
        const c = CLUES.find((x) => x.id === id)!;
        const rooms = Object.values(ROOMS).filter((r) => inspectsOf(r, s.flags).some((i) => i.event === c.event));
        expect(rooms.length, id).toBeGreaterThan(0);
        for (const r of rooms) {
          expect(r.area, id).not.toBe('secret');
          expect(canEnter(s, 'hero', r.id), `${id} ${r.id}`).toBe(true);
        }
        expect(activeClue(s.flags, c.event)?.id).toBe(id);
      }
    }
  });
  it('旧裏ルートだけの手掛かりと調べる所は、通常の構成では出ない', () => {
    const s = at();
    expect(activeClue(s.flags, 'h01_shelf')).toBeUndefined();
    expect(activeClue(s.flags, 'lib_rulebook')).toBeUndefined();
    expect(inspectsOf(ROOMS.bathroom, s.flags).some((i) => i.id === 'bath_sink')).toBe(false);
    s.flags.hiddenLayout = 'legacy';
    expect(activeClue(s.flags, 'h01_shelf')?.id).toBe('clue_h01_shelf');
    expect(activeClue(s.flags, 'game_box')).toBeUndefined();
    expect(inspectsOf(ROOMS.bathroom, s.flags).some((i) => i.id === 'bath_sink')).toBe(true);
    expect(inspectsOf(ROOMS.dining, s.flags).some((i) => i.event === 'bg_live_lock')).toBe(false);
  });
});

describe('2 系統は互いに独立', () => {
  it('生活棟を解かなくても、監獄棟は解放・挑戦できる', () => {
    const s = at();
    seeAll(s, 'prison');
    expect(unlock(s, 'prison', BG_DEFS.prison.answer)).toBe(true);
    expect(canChallenge(s, 'prison')).toEqual({ ok: false, why: 'closed' });
    expect(openLock(s, 'prison')).toBe(true);
    expect(s.flags.h04_open).toBe(true);
    expect(canChallenge(s, 'prison')).toEqual({ ok: true, practice: false });
    expect(recOf(s, 'living').unlockedDay).toBeNull();
    expect(canChallenge(s, 'living')).toEqual({ ok: false, why: 'locked' });
  });
  it('生活棟は錠を開けても扉の旗を立てない（本棚からそのまま挑戦へ）', () => {
    const s = at();
    seeAll(s, 'living');
    unlock(s, 'living', BG_DEFS.living.answer);
    expect(canChallenge(s, 'living')).toEqual({ ok: true, practice: false });
    openLock(s, 'living');
    expect(s.flags.h01_open).toBeUndefined();
  });
  it('監獄棟は、生活棟に所属している棟分けの間は挑めない。時間が足りない時も不可', () => {
    const s = at();
    seeAll(s, 'prison');
    unlock(s, 'prison', BG_DEFS.prison.answer);
    openLock(s, 'prison');
    s.actors.hero.house = 'living';
    expect(canChallenge(s, 'prison')).toEqual({ ok: false, why: 'wing' });
    s.actors.hero.house = 'prison';
    expect(canChallenge(s, 'prison')).toMatchObject({ ok: true });
    s.phaseLeft = 10_000;
    expect(canChallenge(s, 'prison')).toEqual({ ok: false, why: 'time' });
  });
});

describe('挑戦と報酬', () => {
  const ready = (wing: BgWing) => {
    const s = at();
    seeAll(s, wing);
    unlock(s, wing, BG_DEFS[wing].answer);
    openLock(s, wing);
    return s;
  };
  for (const wing of BG_WINGS) {
    it(`${wing}：成功で 3 ピース。報酬は 1 大会 1 回。そのあとは腕試し（報酬も解放も動かない）`, () => {
      const s = ready(wing);
      const p0 = s.actors.hero.pieces;
      beginBg(s, wing, false);
      expect(readBgRun(s)).toMatchObject({ bg: wing, practice: false, stake: 0 });
      expect(settleBg(s, wing, ...WIN[wing])).toMatchObject({ outcome: 'win', reward: 3 });
      expect(s.actors.hero.pieces).toBe(p0 + 3);
      expect(readBgRun(s)).toBeNull();
      expect(s.claimed).toContain(`bg:${wing}:reward`);
      // 2 度目の清算（読み直しなど）でも増えない
      expect(settleBg(s, wing, ...WIN[wing]).reward).toBe(0);
      const can = canChallenge(s, wing);
      expect(can).toEqual({ ok: true, practice: true });
      beginBg(s, wing, true);
      const r = settleBg(s, wing, ...WIN[wing]);
      expect(r).toMatchObject({ outcome: 'win', reward: 0, practice: true });
      expect(s.actors.hero.pieces).toBe(p0 + 3);
      expect(recOf(s, wing).unlockedDay).toBe(2);
      expect(recOf(s, wing).plays).toBe(2);
    });
    it(`${wing}：負けは何も失わず、同じ自由時間には挑めない。次の自由時間から挑める`, () => {
      const s = ready(wing);
      const p0 = s.actors.hero.pieces;
      beginBg(s, wing, false);
      expect(settleBg(s, wing, ...LOSE[wing])).toMatchObject({ outcome: 'lose', reward: 0 });
      expect(s.actors.hero.pieces).toBe(p0);
      expect(recOf(s, wing).failSlot).toBe(freeSlot(s));
      expect(canChallenge(s, wing)).toEqual({ ok: false, why: 'tomorrow' });
      s.phase = 'night';
      expect(canChallenge(s, wing)).toEqual({ ok: true, practice: false });
    });
  }
  it('監獄棟：同点は何も記録せず、挑戦中のまま（その場でもう一度）', () => {
    const s = ready('prison');
    beginBg(s, 'prison', false);
    expect(settleBg(s, 'prison', { hero: 5, [mask]: 5 }, [['hero', mask]])).toMatchObject({ outcome: 'draw' });
    expect(readBgRun(s)).not.toBeNull();
    expect(recOf(s, 'prison').failSlot).toBeNull();
  });
});

describe('旧セーブの移し替え', () => {
  it('版 2 以前：旧の報酬と扉から記録を作る。旧の報酬を 2 度もらわない', () => {
    const s = at(6);
    s.claimed.push('h01:reward', 'h06:win');
    s.flags.h01_open = true;
    s.flags.h04_open = true;
    delete (s as GameState & { backGames?: unknown }).backGames;
    s.version = 2;
    const loaded = validate(wrap(s, 2));
    expect(loaded.ok).toBe(true);
    const t = loaded.ok ? loaded.state : s;
    expect(recOf(t, 'living')).toMatchObject({ rewardDay: 6, unlockedDay: 6, openedDay: 6 });
    expect(Object.keys(recOf(t, 'living').clues).length).toBe(3);
    // 監獄棟：報酬は受け取り済み、扉は開いたまま。挑戦権は旧の謎と別なので付けない
    expect(recOf(t, 'prison')).toMatchObject({ rewardDay: 6, openedDay: 6, unlockedDay: null });
    expect(canChallenge(t, 'living')).toEqual({ ok: true, practice: true });
    beginBg(t, 'living', true);
    expect(settleBg(t, 'living', ...WIN.living).reward).toBe(0);
  });
  it('版 3 のセーブは旗から作り直さない（開発メニューで鍵を開けても、解放にはならない）', () => {
    const s = at();
    s.flags.h01_open = true;
    delete (s as GameState & { backGames?: unknown }).backGames;
    const loaded = validate(wrap(s, 3));
    expect(loaded.ok && recOf(loaded.state, 'living').unlockedDay).toBeNull();
  });
  it('旧裏ゲームの挑戦の途中だったら、預けた賭けを返して終わりにする', () => {
    const s = at();
    const p0 = s.actors.hero.pieces;
    s.actors.hero.pieces -= 2;
    s.flags.hiddenRun = JSON.stringify({ id: 'h02', stake: 2, day: s.day });
    s.match = { kind: 'hidden', id: 'h02' } as GameState['match'];
    expect(retireLegacyRun(s)).toBe(2);
    expect(s.actors.hero.pieces).toBe(p0);
    expect(s.flags.hiddenRun).toBeUndefined();
    expect(s.match).toBeNull();
    // 2 系統の挑戦は触らない
    beginBg(s, 'living', false);
    expect(retireLegacyRun(s)).toBe(0);
    expect(readBgRun(s)).not.toBeNull();
  });
  it('新しい大会の記録は空（どちらにも触れなくても大会は進む）', () => {
    const s = freshState(9);
    const bg = backGames(s);
    for (const w of BG_WINGS) expect(bg[w]).toMatchObject({ unlockedDay: null, openedDay: null, rewardDay: null, clues: {} });
  });
});
