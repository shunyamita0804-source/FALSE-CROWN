import { describe, expect, it } from 'vitest';
import { freshState } from './helpers';
import { DEAD_ZONE, StickTracker, face4, keysVector, knobOffset, octant, stickVector } from '../src/input/stick';
import { collisionOf, moveActor, placeIn, speedOf, stepToward } from '../src/world/sim';

describe('スティックの入力', () => {
  it('中央の無反応領域では動かない', () => {
    expect(stickVector(0, 0, 100)).toBeNull();
    expect(stickVector(DEAD_ZONE * 100 - 1, 0, 100)).toBeNull();
    expect(stickVector(0, DEAD_ZONE * 100 + 1, 100)).toEqual({ x: 0, y: 1 });
  });

  it('倒し具合によらず速さは一定（大きさ 1）', () => {
    for (const [dx, dy] of [[40, 0], [100, 0], [300, 0], [30, 30], [80, -60]]) {
      const v = stickVector(dx, dy, 100)!;
      expect(Math.hypot(v.x, v.y)).toBeCloseTo(1, 9);
    }
  });

  it('つまみは縁で止まる', () => {
    const o = knobOffset(300, 400, 100);
    expect(Math.hypot(o.x, o.y)).toBeCloseTo(100, 9);
  });

  it('8 方向に丸める（斜めを含む）', () => {
    const at = (deg: number) => octant({ x: Math.cos((deg * Math.PI) / 180), y: Math.sin((deg * Math.PI) / 180) });
    expect(at(0)).toEqual({ dx: 1, dy: 0 });
    expect(at(45)).toEqual({ dx: 1, dy: 1 });
    expect(at(-135)).toEqual({ dx: -1, dy: -1 });
    expect(at(90)).toEqual({ dx: 0, dy: 1 });
    expect(at(20)).toEqual({ dx: 1, dy: 0 });
  });

  it('向きは近い 4 方向。境目では今の向きを保つ', () => {
    const v = (deg: number) => ({ x: Math.cos((deg * Math.PI) / 180), y: Math.sin((deg * Math.PI) / 180) });
    expect(face4(v(10))).toBe('right');
    expect(face4(v(80))).toBe('down');
    expect(face4(v(50), 'right')).toBe('right');
    expect(face4(v(50), 'down')).toBe('down');
    expect(face4(v(180))).toBe('left');
  });

  it('キーボードは 2 つ同時押しで斜め', () => {
    expect(keysVector(false, false, false, false)).toBeNull();
    const v = keysVector(true, false, false, true)!;
    expect(v.x).toBeCloseTo(Math.SQRT1_2);
    expect(v.y).toBeCloseTo(-Math.SQRT1_2);
  });

  it('スティックは 1 本の指だけを追い、離すと解除される', () => {
    const s = new StickTracker();
    expect(s.down(1, 60, 0, 100)).toBe(true);
    expect(s.down(2, 0, 60, 100)).toBe(false);
    s.move(2, 0, -90, 100);
    expect(s.vector).toEqual({ x: 1, y: 0 });
    s.move(1, 0, 10, 100);
    expect(s.vector).toBeNull();
    expect(s.active).toBe(true);
    s.up(2);
    expect(s.active).toBe(true);
    s.up(1);
    expect(s.active).toBe(false);
    expect(s.vector).toBeNull();
  });
});

/** 4×4 マスの空いた床を探して、主人公をその左上に置く */
function openFloor() {
  const s = freshState();
  for (const a of Object.values(s.actors)) if (a.id !== 'hero') placeIn(s, a.id, 'main_hall');
  for (const room of ['living_hallway', 'common_lounge', 'dining', 'entrance']) {
    placeIn(s, 'hero', room);
    const g = collisionOf(s, room);
    for (let y = 1; y < g.length - 5; y++) for (let x = 1; x < g[0].length - 5; x++) {
      let ok = true;
      for (let j = 0; j < 5 && ok; j++) for (let i = 0; i < 5 && ok; i++) if (g[y + j][x + i]) ok = false;
      if (ok) {
        s.actors.hero.pos = { room, x, y, dir: 'down' };
        return s;
      }
    }
  }
  throw new Error('空いた床が無い');
}

describe('斜めの移動', () => {
  it('斜めに 1 マスずつ進み、斜めだけ速くならない', () => {
    const s = openFloor();
    const hero = s.actors.hero;
    const x0 = hero.pos.x, y0 = hero.pos.y;
    const v = { x: Math.SQRT1_2, y: Math.SQRT1_2 };
    hero.intentV = v;
    stepToward(s, hero, v);
    for (let k = 0; k < 60; k++) moveActor(s, hero, 1000 / 60, speedOf('hero'));
    const p = hero.step ? hero.step.p : 0;
    const dist = Math.hypot(hero.pos.x - x0 + (hero.step ? (hero.step.x - hero.pos.x) * p : 0), hero.pos.y - y0 + (hero.step ? (hero.step.y - hero.pos.y) * p : 0));
    expect(dist).toBeCloseTo(speedOf('hero'), 6);
    expect(hero.pos.x - x0).toBe(hero.pos.y - y0);
    expect(['right', 'down']).toContain(hero.pos.dir);
  });

  it('角は削らない：斜め先の縦横どちらかが壁なら、壁沿いに縦横へ進む', () => {
    const s = openFloor();
    const hero = s.actors.hero;
    const g = collisionOf(s, hero.pos.room);
    const { x, y } = hero.pos;
    g[y][x + 1] = true; // 右隣を壁にする
    const ok = stepToward(s, hero, { x: Math.SQRT1_2, y: Math.SQRT1_2 });
    g[y][x + 1] = false;
    expect(ok).toBe(true);
    expect(hero.step).toMatchObject({ x, y: y + 1 });
  });
});
