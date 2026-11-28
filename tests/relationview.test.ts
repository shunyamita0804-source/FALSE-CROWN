import { describe, expect, it } from 'vitest';
import { heroStatus, otherRelations, relationRows } from '../src/core/relationview';
import { addInfo, adjustRel, learn } from '../src/core/state';
import type { Deal, DealKind } from '../src/core/types';
import { NPC_IDS } from '../src/data/characters';
import { observeAttitude } from '../src/npc/social';
import { freshState } from './helpers';

const K = 'npc_02_kanzaki';
const M = 'npc_04_mido';
const S = 'npc_05_shiraishi';

const deal = (over: Partial<Deal> & { kind: DealKind | 'pledge' }): Deal => ({
  id: `d_${Math.random()}`, day: 1, from: 'hero', to: K, payNow: 0, payOnSuccess: 0, untilDay: 2, status: 'active', witnesses: [], createdAt: 0, ...over,
} as Deal);

describe('手帳「関係一覧」', () => {
  it('一覧を作っても状態は変わらない（開くだけで情報を得ない）', () => {
    const s = freshState(3);
    s.deals.push(deal({ kind: 'alliance' }));
    const before = JSON.stringify(s);
    relationRows(s, 'step', { coop: true });
    otherRelations(s);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('全員が並び、親密度は推定の段階（未確認は 0）だけを使う', () => {
    const s = freshState(3);
    const rows = relationRows(s);
    expect(rows.map((r) => r.id).sort()).toEqual([...NPC_IDS].sort());
    expect(rows.every((r) => r.step === 0)).toBe(true);
    // 内部の関係値を変えても、推定は動かない
    adjustRel(s, K, 'hero', { like: 60, trust: 60 });
    expect(relationRows(s).find((r) => r.id === K)!.step).toBe(0);
    observeAttitude(s, K, 30);
    expect(relationRows(s).find((r) => r.id === K)!.step).toBe(5);
    const byStep = relationRows(s, 'step');
    expect(byStep[0].id).toBe(K);
  });

  it('協力と約束を分けて数え、絞り込める。協力の約束（pledge）は約束の側', () => {
    const s = freshState(3);
    s.deals.push(deal({ kind: 'alliance', to: K }));
    s.deals.push(deal({ kind: 'pledge', to: M }));
    s.deals.push(deal({ kind: 'nonaggression', to: S, status: 'expired' }));
    const k = relationRows(s).find((r) => r.id === K)!;
    expect(k.coop.length).toBe(1);
    expect(k.promises.length).toBe(0);
    const m = relationRows(s).find((r) => r.id === M)!;
    expect(m.coop.length).toBe(0);
    expect(m.promises[0].short).toContain('次は協力しよう');
    expect(relationRows(s, 'name', { coop: true }).map((r) => r.id)).toEqual([K]);
    expect(relationRows(s, 'name', { promise: true }).map((r) => r.id)).toEqual([M]);
  });

  it('裏で破棄された約束は、主人公が知るまで有効に見える', () => {
    const s = freshState(3);
    const d = deal({ kind: 'alliance', to: K, untilDay: 3, status: 'broken' });
    s.deals.push(d);
    expect(heroStatus(s, d)).toBe('active');
    const info = addInfo(s, { kind: 'betrayal', text: 'x', truth: true, about: [K, 'hero'], source: K, value: 2, tags: ['betrayal'] });
    learn(s, 'hero', info.id, M, 0.6);
    expect(heroStatus(s, d)).toBe('broken');
  });

  it('他の人どうしの関係は、主人公が知っている情報だけ。出所と確かさを分ける', () => {
    const s = freshState(3);
    const seen = addInfo(s, { kind: 'rumor', text: 'a', truth: true, about: [K, M], source: 'world', value: 1, tags: ['sighting'] });
    const heard = addInfo(s, { kind: 'deal', text: 'b', truth: true, about: [M, S], source: K, value: 1, tags: ['deal'] });
    const said = addInfo(s, { kind: 'deal', text: 'c', truth: true, about: [S, K], source: S, value: 1, tags: ['deal'] });
    addInfo(s, { kind: 'deal', text: '知らない話', truth: true, about: [K, S], source: M, value: 1, tags: ['deal'] });
    learn(s, 'hero', seen.id, 'self', 1);
    learn(s, 'hero', heard.id, K, 0.5);
    learn(s, 'hero', said.id, S, 0.7);
    const list = otherRelations(s);
    expect(list.map((o) => o.info.text).sort()).toEqual(['a', 'b', 'c']);
    expect(list.find((o) => o.info.text === 'a')).toMatchObject({ source: 'sight', sure: 'sure' });
    expect(list.find((o) => o.info.text === 'b')).toMatchObject({ source: 'rumor', teller: K, sure: 'unconfirmed' });
    expect(list.find((o) => o.info.text === 'c')).toMatchObject({ source: 'self', teller: S, sure: 'claimed' });
    expect(otherRelations(s, K).map((o) => o.info.text).sort()).toEqual(['a', 'c']);
    // NPC どうしの内部の同盟は、見聞きしなければ出ない
    s.deals.push(deal({ kind: 'alliance', from: M, to: S }));
    expect(otherRelations(s).length).toBe(3);
  });
});
