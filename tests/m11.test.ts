import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { ALL_IDS } from '../src/data/characters';
import { DUEL, type DuelState } from '../src/matches/duel';
import { EVENTS, M11, NEED, type M11State } from '../src/matches/m11';
import { simulate } from './helpers';

// 試行の数字の書き出し先（環境に依らない一時フォルダ）
const S = (() => { const d = join(tmpdir(), 'false-crown-sim'); mkdirSync(d, { recursive: true }); return d; })();
const TWO = ALL_IDS.slice(0, 2);

describe('カード対決', () => {
  it('目標に近い方が 1 勝、同じ差は 0.5 勝ずつ。出したカードは戻らない', () => {
    const s = DUEL.init(TWO, Rng.from(3), { cards: 5 }) as DuelState;
    expect(s.targets.slice().sort()).toEqual([1, 2, 3, 4, 5]);
    const t0 = s.targets[0];
    const far = t0 <= 3 ? 5 : 1;
    DUEL.submit(s, TWO[0], { t: 'play', card: t0 });
    expect(s.round).toBe(0);
    DUEL.submit(s, TWO[1], { t: 'play', card: far });
    expect(s.wins).toEqual([1, 0]);
    expect(s.hands[0]).not.toContain(t0);
    expect(DUEL.validate(s, TWO[0], { t: 'play', card: t0 })).toBe(false);
    const c = s.hands[0].find((x) => s.hands[1].includes(x))!;
    DUEL.submit(s, TWO[0], { t: 'play', card: c });
    DUEL.submit(s, TWO[1], { t: 'play', card: c });
    expect(s.wins).toEqual([1.5, 0.5]);
    // これから出る目標は、順番を伏せて見せる
    const v = DUEL.view(s, TWO[0]);
    expect(v.left).toEqual([...v.left].sort((a, b) => a - b));
    expect(v.left.length).toBe(2);
  });
});

describe('M11 最後の王座', () => {
  it('5 種目を順に行う。補助の手は受け付けない', () => {
    const s = M11.init(TWO, Rng.from(5)) as M11State;
    expect(EVENTS.map((e) => e.id)).toEqual(['m01', 'p02', 'm05', 'm07', 'duel']);
    expect(s.event).toBe(0);
    expect(M11.validate(s, TWO[0], { t: 'hint' })).toBe(false);
    expect(s.sub.puzzles.length).toBe(3);
    expect([s.sub.puzzles[0].w, s.sub.puzzles[2].w]).toEqual([4, 6]);
    expect(M11.stage(s).label).toContain('種目 1 / 5');
    expect(M11.stage(s).label).not.toMatch(/\/ 6/);
  });

  it('CPU だけで最後まで進む。先に 3 勝した方が 1 位で、3 勝した時点で終わる', () => {
    const N = 40;
    let games = 0;
    let rematches = 0;
    const first = [0, 0];
    const perEvent = EVENTS.map(() => [0, 0]);
    const lens: number[] = [];
    for (let seed = 1; seed <= N; seed++) {
      const ps = [ALL_IDS[seed % 12], ALL_IDS[(seed + 5) % 12]];
      const r = simulate('m11', seed, ps);
      const st = r.slot.state as M11State;
      expect(M11.done(st)).toBe(true);
      expect(Math.max(...st.wins)).toBe(NEED);
      expect(Math.min(...st.wins)).toBeLessThan(NEED);
      const decided = st.results.filter((x) => x.winner >= 0);
      expect(decided.length).toBe(st.wins[0] + st.wins[1]);
      expect(decided.map((x) => x.event)).toEqual(decided.map((_, i) => i));
      expect(r.ranking[0]).toEqual([ps[st.wins[0] > st.wins[1] ? 0 : 1]]);
      games += decided.length;
      rematches += st.results.length - decided.length;
      first[st.wins[0] > st.wins[1] ? 0 : 1]++;
      for (const x of decided) perEvent[x.event][x.winner]++;
      lens.push(decided.length);
    }
    writeFileSync(`${S}/m11-sim.txt`, `events/game ${(games / N).toFixed(2)} rematches ${rematches} first ${first.join(' ')}\nper event wins ${perEvent.map((x) => x.join('-')).join(' ')}\nlens ${lens.join('')}`);
    expect(Math.min(...first)).toBeGreaterThan(N * 0.25);
  }, 120_000);
});
