import { describe, expect, it } from 'vitest';
import { autoAdvance } from '../src/core/autoplay';
import { CLOCK, clampPhaseLeft, clockMinutes, crossed, fmtClock, nextSchedule, phaseDuration, scheduleOf } from '../src/core/clock';
import { aliveIds } from '../src/core/state';
import { startMorning } from '../src/core/tournament';
import { fastForward } from '../src/npc/brain';
import { canEnter } from '../src/world/access';
import { freshState } from './helpers';

describe('ゲーム内時計（v10）', () => {
  it('自由行動は実時間 1 秒 = 1 分。朝は 07:00 から 12:00、棟別は 14:30 から 18:00、夜は 19:00 から 22:00', () => {
    expect(phaseDuration('morning')).toBe(300_000);
    expect(phaseDuration('house')).toBe(210_000);
    expect(phaseDuration('night')).toBe(180_000);
    expect(fmtClock(clockMinutes({ phase: 'morning', phaseLeft: 300_000 }))).toBe('07:00');
    expect(fmtClock(clockMinutes({ phase: 'morning', phaseLeft: 0 }))).toBe('12:00');
    expect(fmtClock(clockMinutes({ phase: 'house', phaseLeft: 210_000 }))).toBe('14:30');
    expect(fmtClock(clockMinutes({ phase: 'night', phaseLeft: 90_000 }))).toBe('20:30');
    expect(fmtClock(clockMinutes({ phase: 'main', phaseLeft: 12345 }))).toBe('12:00');
    expect(fmtClock(clockMinutes({ phase: 'curfew', phaseLeft: 0 }))).toBe('22:00');
  });

  it('時刻は単調に進み、フレームレートが違っても同じ時刻になる', () => {
    const run = (dts: number[]) => {
      const s = { phase: 'morning' as const, phaseLeft: phaseDuration('morning') };
      let prev = clockMinutes(s);
      let i = 0;
      let total = 0;
      while (total < 120_000) {
        const dt = Math.min(dts[i++ % dts.length], 120_000 - total);
        total += dt;
        s.phaseLeft = Math.max(0, s.phaseLeft - dt);
        const now = clockMinutes(s);
        expect(now).toBeGreaterThanOrEqual(prev);
        prev = now;
      }
      return prev;
    };
    const a = run([1000 / 60]);
    expect(run([1000 / 30])).toBeCloseTo(a, 6);
    expect(run([1000 / 120])).toBeCloseTo(a, 6);
    expect(run([7, 41, 16, 250, 3])).toBeCloseTo(a, 6);
    expect(fmtClock(a)).toBe('09:00');
  });

  it('予定と事前通知（30 分前、10 分前）は 1 度だけ発火する', () => {
    const fired: Record<string, unknown> = {};
    const all: string[] = [];
    let before: number = CLOCK.wake;
    for (let now = CLOCK.wake + 0.7; now <= CLOCK.main; now += 0.7) {
      for (const e of crossed(1, before, now, fired)) {
        fired[e.key] = true;
        all.push(e.notice ? `${e.item.key}-${e.notice}` : e.item.key);
      }
      // 同じ区間をもう一度評価しても（セーブからの再開など）二重に出ない
      expect(crossed(1, before, now, fired)).toEqual([]);
      before = now;
    }
    for (const e of crossed(1, before, CLOCK.main, fired)) all.push(e.item.key);
    expect(all).toEqual(['breakfast', 'free', 'prep', 'main-30', 'main-10', 'main']);
  });

  it('次の予定と残り時間。DAY 11 は決勝まで', () => {
    expect(nextSchedule({ day: 1, phase: 'morning', phaseLeft: 300_000 })).toMatchObject({ item: { key: 'breakfast' }, inMin: 60 });
    expect(nextSchedule({ day: 1, phase: 'morning', phaseLeft: 45_000 })).toMatchObject({ item: { key: 'main', hard: true }, inMin: 45 });
    expect(nextSchedule({ day: 1, phase: 'night', phaseLeft: 30_000 })).toMatchObject({ item: { key: 'curfew' }, inMin: 30 });
    expect(scheduleOf(11).map((x) => x.key)).toEqual(['wake', 'breakfast', 'prep', 'final']);
    expect(scheduleOf(11).some((x) => x.key === 'prison' || x.key === 'curfew')).toBe(false);
  });

  it('古いセーブの残り時間は、フェーズの長さに丸める', () => {
    const s = { phase: 'house' as const, phaseLeft: 420_000 };
    clampPhaseLeft(s);
    expect(s.phaseLeft).toBe(210_000);
    expect(fmtClock(clockMinutes(s))).toBe('14:30');
  });
});

describe('共同生活（v10）', () => {
  it('07:00 は全員が自分の個室から始まり、朝食の時間に食堂へ行く参加者がいる', () => {
    const s = freshState(21);
    s.phase = 'morning';
    startMorning(s);
    s.phaseLeft = phaseDuration('morning');
    for (const id of aliveIds(s)) expect(s.actors[id].pos.room).toBe(`bedroom_${id}`);
    // 09:30 まで進める
    for (let i = 0; i < 150; i++) {
      fastForward(s, 1000);
      s.phaseLeft -= 1000;
    }
    const ate = aliveIds(s).filter((id) => s.flags[`ate:1:breakfast:${id}`]);
    expect(ate.length).toBeGreaterThanOrEqual(4);
    expect(ate).not.toContain('hero'); // 主人公は強制参加ではない
    // 個室に籠もったままの NPC はいない
    expect(aliveIds(s).filter((id) => id !== 'hero' && s.actors[id].pos.room.startsWith('bedroom_')).length).toBeLessThan(6);
  });

  it('夜は夕食と入浴があり、脱落者は含まれない。消灯後は自分の個室から出られない', async () => {
    const s = freshState(33);
    s.phase = 'morning';
    await autoAdvance(s, 1, 'night');
    if (!s.actors.hero.alive) return;
    const out = Object.values(s.actors).filter((a) => !a.alive).map((a) => a.id);
    expect(out.length).toBe(1);
    s.phaseLeft = phaseDuration('night');
    for (const id of aliveIds(s)) s.actors[id].house = null;
    for (let i = 0; i < 180; i++) {
      fastForward(s, 1000);
      s.phaseLeft -= 1000;
    }
    expect(aliveIds(s).filter((id) => s.flags[`ate:1:dinner:${id}`]).length).toBeGreaterThanOrEqual(3);
    expect(aliveIds(s).filter((id) => s.flags[`bath:1:${id}`]).length).toBeGreaterThanOrEqual(3);
    for (const id of out) {
      expect(s.flags[`ate:1:dinner:${id}`]).toBeUndefined();
      expect(s.flags[`bath:1:${id}`]).toBeUndefined();
    }
    s.phase = 'curfew';
    expect(canEnter(s, 'hero', 'living_hallway')).toBe(false);
    expect(canEnter(s, 'hero', 'bedroom_hero')).toBe(true);
    expect(canEnter(s, 'npc_02_kanzaki', 'dining')).toBe(false);
  });

  it('消灯を経て翌朝へ進む（進行と報酬が重複しない）', async () => {
    const s = freshState(5);
    s.phase = 'morning';
    await autoAdvance(s, 1, 'curfew');
    if (!s.actors.hero.alive) return;
    const pieces = Object.values(s.actors).reduce((a, x) => a + x.pieces, 0);
    expect(s.history.length).toBe(0);
    await autoAdvance(s, 2, 'morning');
    expect(s.day).toBe(2);
    expect(s.history.length).toBe(1);
    expect(Object.values(s.actors).reduce((a, x) => a + x.pieces, 0)).toBe(pieces);
  });
});
