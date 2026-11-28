import { afterEach, describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { luckOf, luckPick, luckRate, newLuckBook, setLuckOverride } from '../src/core/luck';
import { ALL_IDS, NPC_IDS, type CharId } from '../src/data/characters';
import { M06, ROUNDS, type M06State } from '../src/matches/m06';
import { S05, type S05State } from '../src/matches/s05';
import { M04, planFor, type M04State, type M04View } from '../src/matches/m04';
import { simulate } from './helpers';

const SEVEN = NPC_IDS.slice(0, 7) as CharId[];
const LUCKY = SEVEN[0];
afterEach(() => { for (const id of ALL_IDS) setLuckOverride(id, null); });

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** M06 を最後まで進める（毎回、手札の先頭 2 枚を出す。lucky は最初のラウンドで山札と交換）。各手の後に check を呼ぶ */
function playM06(s: M06State, check: (s: M06State) => void = () => {}, stopAt = Infinity): number {
  let steps = 0;
  while (s.phase !== 'done' && steps < stopAt) {
    const p = M06.pending(s)[0];
    let m;
    if (s.phase === 'swap') m = s.round === 0 && p === LUCKY && !s.aidUsed[p] ? { t: 'aid' as const, card: s.hands[p][0] } : { t: 'pass' as const };
    else if (s.phase === 'submit') m = { t: 'submit' as const, cards: s.hands[p].slice(0, 2) };
    else m = { t: 'ready' as const };
    M06.submit(s, p, m);
    check(s);
    steps++;
  }
  return steps;
}

const allCards = (s: M06State) => [...s.deck, ...s.discard, ...s.field, ...s.players.flatMap((p) => s.hands[p])];

describe('運（試験導入）の基本', () => {
  it('運 5〜7 は補正なし、8 で 10%、9 で 20%、10 で 30%。いまの参加者は全員 5', () => {
    expect([1, 4, 5, 6, 7, 8, 9, 10].map(luckRate)).toEqual([0, 0, 0, 0, 0, 0.1, 0.2, 0.3]);
    for (const id of ALL_IDS) expect(luckOf(id)).toBe(5);
  });

  it('2 つ目の候補が出せない時は、最初の候補のまま「候補なし」と記録する', () => {
    setLuckOverride(LUCKY, 10);
    const b = newLuckBook(1);
    let fired = 0;
    for (let i = 0; i < 100; i++) expect(luckPick(b, LUCKY, 'a', () => undefined, () => 0)).toBe('a');
    fired = b.fired[LUCKY];
    expect(fired).toBeGreaterThan(10);
    expect(b.noAlt[LUCKY]).toBe(fired);
    expect(b.took[LUCKY] ?? 0).toBe(0);
  });

  it('運 5 の人は乱数を使わず、記録もしない（導入前と同じ結果になる）', () => {
    for (const [id, n] of [['m06', 7], ['s05', 2], ['m04', 9]] as const) {
      for (let seed = 1; seed <= 5; seed++) {
        const r = simulate(id, seed, NPC_IDS.slice(0, n) as CharId[]);
        const st = r.slot.state as { luck?: ReturnType<typeof newLuckBook> };
        if (!st.luck) continue; // M04 は交換を使った時に作る
        expect(st.luck.tries).toEqual({});
      }
    }
  });
});

describe('M06：初期手札・補充・山札との交換', () => {
  it('運 10 でも、52 枚が重複なく、手札は 5 枚まで。毎手の後で確かめる', () => {
    setLuckOverride(LUCKY, 10);
    let fired = 0;
    let took = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const s = M06.init(SEVEN, Rng.from(seed)) as M06State;
      const ok = (x: M06State) => {
        const all = allCards(x);
        expect(all.length).toBe(52);
        expect(new Set(all).size).toBe(52);
        for (const p of x.players) expect(x.hands[p].length).toBeLessThanOrEqual(5);
      };
      ok(s);
      playM06(s, ok);
      fired += s.luck!.fired[LUCKY] ?? 0;
      took += s.luck!.took[LUCKY] ?? 0;
      // 運の判定は lucky だけ
      expect(Object.keys(s.luck!.tries)).toEqual([LUCKY]);
    }
    expect(fired).toBeGreaterThan(0);
    expect(took).toBeGreaterThan(0);
  });

  it('途中で保存して再開しても、同じ続きになる', () => {
    setLuckOverride(LUCKY, 10);
    for (let seed = 1; seed <= 20; seed++) {
      const a = M06.init(SEVEN, Rng.from(seed)) as M06State;
      playM06(a, () => {}, 25);
      const b = clone(a);
      playM06(a);
      playM06(b);
      expect(b).toEqual(a);
    }
  });

  it('評価は本人の手札と公開の目標だけ：他の人の手札や、山札の奥の並びを変えても結果は同じ', () => {
    setLuckOverride(LUCKY, 10);
    let compared = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const a = M06.init(SEVEN, Rng.from(seed)) as M06State;
      const b = clone(a);
      // 他の人の手札を入れ替え、山札の上 2 枚より下を並べ替える
      [b.hands[SEVEN[1]], b.hands[SEVEN[2]]] = [b.hands[SEVEN[2]], b.hands[SEVEN[1]]];
      const top = b.deck.slice(-2);
      b.deck = [...b.deck.slice(0, -2).reverse(), ...top];
      const card = a.hands[LUCKY][0];
      M06.submit(a, LUCKY, { t: 'aid', card });
      M06.submit(b, LUCKY, { t: 'aid', card });
      expect(b.hands[LUCKY]).toEqual(a.hands[LUCKY]);
      if (a.luck!.fired[LUCKY]) compared++;
    }
    expect(compared).toBeGreaterThan(0);
  });

  it('山札が 1 枚だけの時は、捨て札を切り直さず「候補なし」', () => {
    setLuckOverride(LUCKY, 10);
    let noAlt = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const s = M06.init(SEVEN, Rng.from(seed)) as M06State;
      s.discard = s.deck.splice(0, s.deck.length - 1);
      const before = s.discard.length;
      M06.submit(s, LUCKY, { t: 'aid', card: s.hands[LUCKY][0] });
      expect(s.deck.length).toBe(0);
      expect(s.discard.length).toBe(before + 1);
      expect(new Set(allCards(s)).size).toBe(52);
      noAlt += s.luck!.noAlt[LUCKY] ?? 0;
    }
    expect(noAlt).toBeGreaterThan(0);
  });

  it('最終ラウンドの後は補充しない（運でも引かない）', () => {
    setLuckOverride(LUCKY, 10);
    const s = M06.init(SEVEN, Rng.from(3)) as M06State;
    playM06(s);
    expect(s.round).toBe(ROUNDS - 1);
    expect(s.hands[LUCKY].length).toBe(5 - 2);
  });
});

describe('S05：振り直しの出目', () => {
  it('振り直したサイコロだけが変わる。相手の出目と共通のサイコロは変わらない。条件を満たす方だけを取る', () => {
    let took = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const players = [NPC_IDS[0], NPC_IDS[1]] as CharId[];
      const play = (luck: number | null) => {
        setLuckOverride(players[0], luck);
        const s = S05.init(players, Rng.from(seed)) as S05State;
        while (s.phase !== 'done') {
          for (const p of S05.pending(s)) {
            const i = s.players.indexOf(p);
            S05.submit(s, p, s.phase === 'show' ? { t: 'ok' } : { t: 'roll', re: [0, 1, 2], cond: s.used[i].indexOf(false) });
          }
        }
        return s;
      };
      const base = play(null);
      const lucky = play(10);
      lucky.log.forEach((r, k) => {
        expect(r.base).toEqual(base.log[k].base);
        expect(r.picks[1]).toEqual(base.log[k].picks[1]);
        expect(r.picks[0].dice.slice(3)).toEqual(r.base.slice(3));
        // 取り替えたのは、最初の出目が条件を満たさず、2 つ目が満たした時だけ
        if (r.picks[0].ok !== base.log[k].picks[0].ok) expect(r.picks[0].ok).toBe(true);
      });
      took += lucky.luck!.took[players[0]] ?? 0;
      expect(lucky.points[0]).toBeGreaterThanOrEqual(base.points[0]);
    }
    expect(took).toBeGreaterThan(0);
  });

  it('振り直していなければ「候補なし」', () => {
    const players = [NPC_IDS[0], NPC_IDS[1]] as CharId[];
    setLuckOverride(players[0], 10);
    let noAlt = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const s = S05.init(players, Rng.from(seed)) as S05State;
      S05.submit(s, players[0], { t: 'roll', re: [], cond: 0 });
      S05.submit(s, players[1], { t: 'roll', re: [], cond: 0 });
      expect(s.log[0].picks[0].dice).toEqual(s.log[0].base);
      noAlt += s.luck!.noAlt[players[0]] ?? 0;
    }
    expect(noAlt).toBeGreaterThan(0);
  });
});

describe('M04：任務交換の候補の生成', () => {
  it('候補は 2 つで、同じ得点・重複なし・卓の任務と重ならない。選ぶのは本人', () => {
    const NINE = NPC_IDS.slice(0, 9) as CharId[];
    setLuckOverride(NINE[0], 10);
    let took = 0;
    let costLucky = 0;
    let costBase = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const a = M04.init(NINE, Rng.from(seed)) as M04State;
      const t = a.tables.find((x) => x.players.includes(NINE[0]))!;
      const seat = t.players.indexOf(NINE[0]);
      const old = t.missions[seat][1];
      const plain = clone(a);
      M04.submit(a, NINE[0], { t: 'aid', mission: 1 });
      setLuckOverride(NINE[0], null);
      M04.submit(plain, NINE[0], { t: 'aid', mission: 1 });
      setLuckOverride(NINE[0], 10);
      const cands = a.aid[NINE[0]]!.cands;
      expect(cands.length).toBe(2);
      expect(a.aid[NINE[0]]!.picked).toBe(false);
      const keys = cands.map((c) => [c.from, c.to].sort().join('-'));
      expect(new Set(keys).size).toBe(2);
      const mine = new Set(t.missions.flat().map((x) => [x.from, x.to].sort().join('-')));
      for (const c of cands) { expect(c.points).toBe(old.points); expect(mine.has([c.from, c.to].sort().join('-'))).toBe(false); }
      const tb = { costs: t.costs, owner: t.owner } as M04View['table'];
      const cost = (cs: typeof cands) => cs.reduce((n, c) => n + planFor(tb, seat, c).cost, 0);
      costLucky += cost(cands);
      costBase += cost(plain.aid[NINE[0]]!.cands);
      took += a.luck!.took[NINE[0]] ?? 0;
      // 本人が選んで、その任務に替わる
      M04.submit(a, NINE[0], { t: 'pick', c: 1 });
      expect(t.missions[seat][1]).toMatchObject({ from: cands[1].from, to: cands[1].to });
    }
    expect(took).toBeGreaterThan(0);
    expect(costLucky).toBeLessThan(costBase);
  });
});
