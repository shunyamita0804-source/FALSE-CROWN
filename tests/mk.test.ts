/**
 * 市場予測（試作）。ルールの検証、見えてよい情報だけを CPU に渡すこと、繰り返しで得をしないこと、
 * CPU だけの試行での偏りと「情報を得て判断が変わるか」を確かめる。数字は docs/market.md に記録する。
 */
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { ALL_IDS, type CharId } from '../src/data/characters';
import { MATCHES } from '../src/matches/registry';
import { MK, FACTORS, GOODS, NG, PERIODS, START_COINS, affordable, estimate, type MkState, type MkView } from '../src/matches/mk';
import { buildCtx } from '../src/core/runner';
import { applyMarketSocial } from '../src/core/market_social';
import { freshState, simulate } from './helpers';

const P4 = ALL_IDS.slice(0, 4);
const init = (players: CharId[] = P4, seed = 1) => MK.init(players, Rng.from(seed)) as MkState;
const plan = (s: MkState, p: CharId, respond: Partial<MkView> = {}) => MK.submit(s, p, { t: 'plan', req: [], respond: { swap: {}, ask: {}, give: [], ...respond } as never });

describe('市場予測（試作）のルール', () => {
  it('全員に同じ枚数の札。同じ人に同じ要因は配らない。各要因は −2〜+2、値段は 6〜9 から', () => {
    for (const n of [3, 7, 12]) {
      const s = init(ALL_IDS.slice(0, n), n);
      for (let t = 0; t < PERIODS; t++) {
        const count = new Map<string, number>();
        for (const p of s.players) {
          const cs = s.cards[p][t];
          expect(cs.length).toBe(2);
          expect(new Set(cs.map((c) => `${c.good}:${c.k}`)).size).toBe(2);
          for (const c of cs) count.set(`${c.good}:${c.k}`, (count.get(`${c.good}:${c.k}`) ?? 0) + 1);
        }
        // 均等に配る：どの要因も、最も多い物と少ない物の差は 1 以内（配りきれない人数では 0 枚の要因がある）
        const vals = [...count.values()];
        expect(Math.max(...vals) - Math.min(...vals)).toBeLessThanOrEqual(1);
        for (const g of s.factors[t]) for (const v of g) expect(Math.abs(v)).toBeLessThanOrEqual(2);
        expect(s.factors[t].every((g) => g.length === FACTORS)).toBe(true);
      }
      for (const p of s.prices) expect(p >= 6 && p <= 9).toBe(true);
    }
  });

  it('CPU に渡す view に、他人の札、未来の要因、他人の持ち物とコインは含まれない', () => {
    const s = init();
    const v = MK.view(s, 'hero') as MkView;
    const text = JSON.stringify(v);
    expect(v.cards.length).toBe(2);
    expect(v.pastFactors.length).toBe(0);
    expect(text).not.toContain('"factors":[[[');
    expect(Object.keys(v)).not.toContain('holdingsAll');
    expect(v.cards.every((c) => s.cards.hero[0].some((m) => m.good === c.good && m.k === c.k))).toBe(true);
  });

  it('買えない量、持っていない物の売り、3 個を超える注文は不正。払える範囲は約定が最も高くなった時で数える', () => {
    const s = init();
    for (const p of s.players) plan(s, p);
    expect(s.phase).toBe('order');
    expect(MK.validate(s, 'hero', { t: 'order', q: [-1, 0, 0, 0, 0] })).toBe(false);
    expect(MK.validate(s, 'hero', { t: 'order', q: [4, 0, 0, 0, 0] })).toBe(false);
    expect(MK.validate(s, 'hero', { t: 'order', q: [3, 0, 0, 0, 0] })).toBe(affordable(s, START_COINS, [0, 0, 0, 0, 0], [3, 0, 0, 0, 0]));
    expect(MK.validate(s, 'hero', { t: 'order', q: [3, 3, 3, 3, 3] })).toBe(false);
  });

  it('同じ物を皆で買うと約定が上がる。値動きは要因の合計（±4 まで）。期の終わりに要因が公開され、嘘が分かる', () => {
    const s = init(ALL_IDS.slice(0, 6), 3);
    const [a, b] = s.players;
    // a が b に嘘を言う：「紅茶に +2」。本当の要因に +2 が無い時だけ嘘と判定される
    for (const p of s.players) plan(s, p);
    s.phase = 'talk'; s.ready = Object.fromEntries(s.players.map((p) => [p, false])); s.plans = {};
    for (const p of s.players.filter((x) => x !== a)) plan(s, p);
    MK.submit(s, a, { t: 'tell', to: b, good: 1, value: 2 });
    MK.submit(s, a, { t: 'ready' });
    const before = s.prices[1];
    for (const p of s.players) MK.submit(s, p, { t: 'order', q: [0, 1, 0, 0, 0] });
    const f = s.factors[0][1];
    expect(s.last!.exec[1]).toBe(Math.min(20, before + 2));
    expect(s.prices[1]).toBe(Math.max(1, Math.min(20, before + Math.max(-4, Math.min(4, f[0] + f[1])))));
    const c = s.claims[b].find((x) => x.from === a)!;
    expect(c.verdict).toBe(f.includes(2) ? 'ok' : 'lie');
    expect((MK.view(s, b) as MkView).liars.includes(a)).toBe(!f.includes(2));
  });

  it('同じ期に同じ相手へ同じ申し出は 1 回だけ。同じ質問には同じ答え（繰り返して得をしない）', () => {
    const s = init();
    const [, x] = s.players;
    for (const p of s.players.filter((q) => q !== 'hero')) MK.submit(s, p, { t: 'plan', req: [], respond: { swap: { hero: 'no' }, ask: { hero: ['true', 'true', 'true', 'true', 'true'] }, give: [0] } });
    MK.submit(s, 'hero', { t: 'swap', to: x, give: [0] });
    expect(MK.validate(s, 'hero', { t: 'swap', to: x, give: [1] })).toBe(false);
    MK.submit(s, 'hero', { t: 'ask', to: x, good: 0 });
    expect(MK.validate(s, 'hero', { t: 'ask', to: x, good: 0 })).toBe(false);
    expect(MK.validate(s, 'hero', { t: 'ask', to: x, good: 1 })).toBe(true);
  });

  it('見せ合いは本物の札を見せる（両方に確かな情報が残る）。関係が上がるのは同じ相手と 1 回だけ', () => {
    const st = freshState(3);
    const s = init(['hero', 'npc_07_tachibana', 'npc_08_dojima'], 2);
    for (const p of s.players.filter((q) => q !== 'hero')) MK.submit(s, p, { t: 'plan', req: [], respond: { swap: { hero: 'yes' }, ask: {}, give: [1] } });
    MK.submit(s, 'hero', { t: 'swap', to: 'npc_07_tachibana', give: [0] });
    const got = s.shown.hero.filter((x) => x.from === 'npc_07_tachibana');
    expect(got.length).toBe(1);
    expect(got[0].value).toBe(s.factors[0][got[0].good][got[0].k]);
    const t0 = st.actors.npc_07_tachibana.rel.hero.trust;
    applyMarketSocial(st, s);
    applyMarketSocial(st, s);
    expect(st.actors.npc_07_tachibana.rel.hero.trust).toBe(Math.min(100, t0 + 2));
  });

  it('CPU だけで 3〜12 人の全員の順位が決まる', () => {
    for (const n of [3, 5, 8, 12]) {
      const r = simulate('mk', n, ALL_IDS.slice(0, n));
      expect(r.ranking.flat().length).toBe(n);
      expect((r.slot.state as MkState).history.length).toBe(PERIODS + 1);
    }
  });
});

describe('市場予測（試作）の CPU 試行', () => {
  it('偏り、席、情報で判断が変わる割合、情報の価値（docs/market.md に記録）', () => {
    const lines: string[] = [];
    const N = 150;
    // 1. 人物ごとの 1 位の割合（12 人・6 人）
    for (const n of [12, 6]) {
      const first: Record<string, number> = {};
      for (let seed = 1; seed <= N; seed++) {
        const r = simulate('mk', seed * 7, ALL_IDS.slice(0, n));
        first[r.ranking[0][0]] = (first[r.ranking[0][0]] ?? 0) + 1;
      }
      const top = Math.max(...Object.values(first)) / N;
      lines.push(`${n} 人：1 位の割合 ${Object.entries(first).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k.replace(/^npc_\d+_/, '')} ${Math.round((v / N) * 100)}%`).join('、')}`);
      expect(top).toBeLessThan(n === 12 ? 0.3 : 0.45);
    }
    // 2. 情報で判断が変わる割合：注文の時に、自分の札だけで決めた注文と、聞いた・見せてもらった情報も使った注文が違った割合
    let changed = 0;
    let total = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const st = freshState(seed);
      const players = ALL_IDS.slice(0, 8);
      const s = MK.init(players, Rng.from(seed)) as MkState;
      while (s.phase !== 'done') {
        for (const p of MK.pending(s)) {
          const v = MK.view(s, p) as MkView;
          const ctx = buildCtx(st, p, 'mk', new Rng({ s: [seed, 2, 3, 4] } as never));
          if (s.phase === 'order') {
            const a = estimate(v, { ...ctx, rng: Rng.from(1), memoryLoss: 0 });
            const b = estimate(v, { ...ctx, rng: Rng.from(1), memoryLoss: 0 }, { useInfo: false });
            total++;
            if (a.some((x, g) => Math.sign(Math.round(x)) !== Math.sign(Math.round(b[g])))) changed++;
          }
          let m = MK.ai(v, ctx);
          if (!MK.validate(s, p, m)) m = MK.defaultMove(s, p);
          MK.submit(s, p, m);
        }
      }
    }
    lines.push(`8 人：情報（見せ合い・質問・伝聞）で、どれかの銘柄の見込みの向きが変わった注文 ${Math.round((changed / total) * 100)}%（${total} 回中）`);
    expect(changed / total).toBeGreaterThan(0.3);
    // 3. 情報の価値：主人公の席だけ、札を増やした時の順位（自分の 2 枚だけ → 5 銘柄の要因を 1 つずつ → 全部）
    const variant = (k: 'none' | 'half' | 'all') => ({ ...MK, id: `mk_${k}`, view: (s: MkState, p: CharId | 'spectator') => {
      const v = MK.view(s, p) as MkView;
      if (p === 'hero' && s.phase !== 'done' && k !== 'none') { v.cards = []; for (let g = 0; g < NG; g++) for (let j = 0; j < (k === 'all' ? FACTORS : 1); j++) v.cards.push({ good: g, k: j, value: s.factors[s.period][g][j] }); }
      return v;
    } });
    for (const k of ['none', 'half', 'all'] as const) (MATCHES as Record<string, unknown>)[`mk_${k}`] = variant(k);
    for (const n of [4, 8, 12]) {
      const res: string[] = [];
      for (const k of ['none', 'half', 'all'] as const) {
        let rk = 0;
        for (let seed = 1; seed <= 100; seed++) {
          const r = simulate(`mk_${k}`, seed * 3, ALL_IDS.slice(0, n));
          rk += r.ranking.findIndex((g) => g.includes('hero')) + 1;
        }
        res.push(`${k === 'none' ? '自分の札 2 枚' : k === 'half' ? '各銘柄 1 つずつ' : '全部'} ${(rk / 100).toFixed(2)} 位`);
      }
      lines.push(`${n} 人：主人公の席の平均順位（${res.join('、')}）`);
    }
    for (const k of ['none', 'half', 'all']) delete (MATCHES as Record<string, unknown>)[`mk_${k}`];
    writeFileSync('/tmp/mk-sim.txt', lines.join('\n'));
  }, 120_000);
});

describe('市場予測（試作）の作戦時間', () => {
  it('作戦時間が使える。NPC どうしの相談が進み、終わる（主人公が何もしなくても止まらない）', async () => {
    const { newSlot } = await import('../src/core/runner');
    const { aliveIds } = await import('../src/core/state');
    const { finishStrategy, newStrategy, startStrategy, strategyEnabled } = await import('../src/core/strategy');
    expect(strategyEnabled('mk')).toBe(true);
    const s = freshState(5);
    const slot = newSlot(s, 'mk', aliveIds(s), 'main');
    const st = newStrategy(s, 'mk');
    expect(st.slots * st.slotMs).toBeLessThanOrEqual(120_000);
    startStrategy(s, slot, st, Rng.derive(5, 'a'));
    finishStrategy(s, slot, st, Rng.derive(5, 'b'));
    expect(st.done).toBe(true);
    // 組の無い競技でも、見せ合いの相手を探して相談する（主人公も同じ点の付け方で誘われる）
    expect(st.meetings.filter((m) => m.members.length >= 2 && !m.members.includes('hero')).length).toBeGreaterThan(3);
  });

  it('作戦時間に協力を約束した相手には、見せ合いに応じやすい', () => {
    let withAlly = 0, without = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const s = init(P4, seed);
      const v = MK.view(s, P4[1]) as MkView;
      const base = buildCtx(freshState(seed), P4[1], 'mk', Rng.from(seed));
      const a = MK.ai(v, { ...base, allies: [P4[0]] }) as { respond: { swap: Record<string, string> } };
      const b = MK.ai(v, { ...base, rng: Rng.from(seed), allies: [] }) as { respond: { swap: Record<string, string> } };
      if (a.respond?.swap[P4[0]] === 'yes') withAlly++;
      if (b.respond?.swap[P4[0]] === 'yes') without++;
    }
    expect(withAlly).toBeGreaterThan(without);
  });
});
