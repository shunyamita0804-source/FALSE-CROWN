import { describe, expect, it } from 'vitest';
import { freshState } from './helpers';
import { moveActor, placeIn, speedOf, tryStep } from '../src/world/sim';
import { WALK_FRAME_PX, walkFrame } from '../src/world/walk';
const TILE = 64;

/** 生活棟の廊下（横に長い床）で、主人公を右へ歩かせる */
function walkRight(frameMs: number[], totalMs: number): { dist: number; gaps: number } {
  const s = freshState();
  const hero = s.actors.hero;
  for (const a of Object.values(s.actors)) if (a.id !== 'hero') placeIn(s, a.id, 'main_hall');
  placeIn(s, 'hero', 'living_hallway', { x: 2, y: 5 });
  const startX = hero.pos.x;
  let t = 0;
  let i = 0;
  let gaps = 0;
  while (t < totalMs - 1e-6) {
    const dt = Math.min(frameMs[i++ % frameMs.length], totalMs - t);
    hero.intent = 'right';
    hero.intentV = { x: 1, y: 0 };
    if (!hero.step) tryStep(s, hero, 'right');
    moveActor(s, hero, dt, speedOf('hero'));
    // 押し続けている間に「歩いていない」フレームが挟まらないこと
    if (!hero.step) gaps += 1;
    t += dt;
  }
  return { dist: hero.pos.x - startX + (hero.step ? hero.step.p : 0), gaps };
}

describe('歩行', () => {
  it('方向キーを押し続けている間、マスの継ぎ目で止まらない', () => {
    expect(walkRight([1000 / 60], 3000).gaps).toBe(0);
    expect(walkRight([1000 / 30], 3000).gaps).toBe(0);
  });

  it('移動距離はフレームレートに依存しない（60fps、30fps、120fps、不規則なフレームで同じ距離）', () => {
    const expected = (3000 / 1000) * speedOf('hero');
    for (const frames of [[1000 / 60], [1000 / 30], [1000 / 120], [7, 31, 16, 52, 9, 24]]) {
      expect(walkRight(frames, 3000).dist).toBeCloseTo(expected, 6);
    }
  });

  it('離すと、歩いている 1 マスを終えた所で止まる', () => {
    const s = freshState();
    const hero = s.actors.hero;
    for (const a of Object.values(s.actors)) if (a.id !== 'hero') placeIn(s, a.id, 'main_hall');
    placeIn(s, 'hero', 'living_hallway', { x: 2, y: 5 });
    hero.intent = 'right';
    hero.intentV = { x: 1, y: 0 };
    tryStep(s, hero, 'right');
    moveActor(s, hero, 100, speedOf('hero'));
    hero.intent = undefined;
    hero.intentV = undefined;
    for (let k = 0; k < 60; k++) moveActor(s, hero, 1000 / 60, speedOf('hero'));
    expect(hero.step).toBeUndefined();
    expect(hero.pos.x).toBe(3);
  });

  it('歩行のコマは進んだ距離で決まり、2 マスで 4 コマを 1 巡する', () => {
    expect(walkFrame(0)).toBe(0);
    expect(walkFrame(WALK_FRAME_PX - 0.01)).toBe(0);
    expect(walkFrame(WALK_FRAME_PX)).toBe(1);
    expect(walkFrame(TILE)).toBe(2);
    expect(walkFrame(TILE * 1.5)).toBe(3);
    expect(walkFrame(TILE * 2)).toBe(0);
  });
});
