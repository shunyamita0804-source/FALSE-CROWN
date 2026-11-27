import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { ALL_IDS } from '../src/data/characters';
import { P05, SETS, TURNS, moverAt, outcome, type P05State } from '../src/matches/p05';
import { simulate } from './helpers';

const THREE = ALL_IDS.slice(0, 3);
const S = '/tmp/claude-0/-home-claude/ced3d2db-bac9-5d25-8782-91ee7ff6cc58/scratchpad';

describe('P05 21の攻防', () => {
  it('ちょうど 21 で +4、超えると −3、どちらも合計は 0 に戻る', () => {
    expect(outcome(12, 9)).toEqual({ total: 0, delta: 4, kind: 'hit' });
    expect(outcome(13, 9)).toEqual({ total: 0, delta: -3, kind: 'bust' });
    expect(outcome(11, 9)).toEqual({ total: 20, delta: 0, kind: 'add' });
  });

  it('先手は巡ごと、セットごとに交代し、全員が同じ回数だけ先手になる', () => {
    const first: Record<string, number> = {};
    for (let set = 0; set < SETS; set++) for (let turn = 0; turn < TURNS; turn++) { const p = moverAt(THREE, set, turn * 3); first[p] = (first[p] ?? 0) + 1; }
    expect(Object.values(first)).toEqual([9, 9, 9]);
    expect(moverAt(THREE, 0, 0)).toBe(THREE[0]);
    expect(moverAt(THREE, 0, 3)).toBe(THREE[1]);
    expect(moverAt(THREE, 1, 0)).toBe(THREE[1]);
  });

  it('手番の人だけが、持っているカードを出せる。出したカードは手札から消え、全員に見える', () => {
    const s = P05.init(THREE, Rng.from(1)) as P05State;
    const [a, b, c] = THREE;
    expect(P05.validate(s, b, { t: 'play', card: 5 })).toBe(false);
    P05.submit(s, a, { t: 'play', card: 9 });
    expect(P05.validate(s, a, { t: 'play', card: 8 })).toBe(false);
    P05.submit(s, b, { t: 'play', card: 9 });
    expect(P05.view(s, c).hands[a]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(P05.view(s, c).total).toBe(18);
    P05.submit(s, c, { t: 'play', card: 3 });
    expect(s.scores[c]).toBe(4);
    expect(s.total).toBe(0);
    expect(P05.view(s, a).toMove).toBe(b);
    expect(P05.validate(s, b, { t: 'play', card: 9 })).toBe(false);
    expect(P05.defaultMove(s, b)).toEqual({ t: 'play', card: 1 });
  });

  it('CPU だけで最後まで進む。セットの最後に残った合計は捨てる。読みの深い人が上位になりやすい', () => {
    const rows: string[] = [];
    const wins: Record<string, number> = {};
    const plays: Record<string, number> = {};
    let hits = 0;
    let busts = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const ps = [ALL_IDS[seed % 12], ALL_IDS[(seed + 3) % 12], ALL_IDS[(seed + 7) % 12]];
      const r = simulate('p05', seed, ps);
      const st = r.slot.state as P05State;
      expect(P05.done(st)).toBe(true);
      expect(st.log.length).toBe(SETS * TURNS * 3);
      for (const p of ps) { hits += st.hits[p]; busts += st.busts[p]; plays[p] = (plays[p] ?? 0) + 1; }
      wins[r.ranking[0][0]] = (wins[r.ranking[0][0]] ?? 0) + 1;
      rows.push(ps.map((p) => `${p.slice(0, 6)}=${r.scores[p]}`).join(' '));
    }
    writeFileSync(`${S}/p05-sim.txt`, `hits/game ${hits / 60} busts/game ${busts / 60}\n${Object.keys(plays).map((p) => `${p} ${(wins[p] ?? 0)}/${plays[p]}`).join('\n')}\n${rows.slice(0, 12).join('\n')}`);
    expect(hits).toBeGreaterThan(60);
  });
});
