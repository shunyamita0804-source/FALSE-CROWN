import { describe, expect, it } from 'vitest';
import { canEnter } from '../src/world/access';
import { championEnding } from '../src/core/tournament';
import { NPC_IDS, type CharId } from '../src/data/characters';
import {
  EVIDENCE_IDS, HIDDEN_MIN_DAY, HIDDEN_IDS, LETTER_IDS, beginHidden, canStartHidden, canUseLift, collectVault, confirmIsolation,
  endingOptions, giveItem, h06Fee, hasItem, hiddenOpts, settleHidden, takeNote, takeZeroLetters, type HiddenId,
} from '../src/story/hiddenroute';
import { freshState } from './helpers';

const win: CharId[][] = [['hero'], ['dealer' as CharId]];
const lose: CharId[][] = [['dealer' as CharId], ['hero']];
const tie: CharId[][] = [['hero', 'dealer' as CharId]];

function at(day: number, phase: 'morning' | 'night' = 'morning') {
  const s = freshState(3);
  s.day = day;
  s.phase = phase;
  s.phaseLeft = 200_000;
  s.actors.hero.house = null;
  return s;
}

describe('裏ルート：挑める日と条件', () => {
  it('最早日より前は挑めない。H02 は夜だけ', () => {
    for (const id of HIDDEN_IDS) {
      const d = HIDDEN_MIN_DAY[id];
      if (d > 1) expect(canStartHidden(at(d - 1, 'night'), id)).toMatchObject({ ok: false, why: 'day' });
    }
    expect(canStartHidden(at(3), 'h02')).toMatchObject({ ok: false, why: 'night' });
    expect(canStartHidden(at(3, 'night'), 'h02').ok).toBe(true);
    expect(canStartHidden(at(1), 'h01')).toMatchObject({ ok: false, why: 'clues', n: 6 });
    const k = at(1);
    expect(takeNote(k, 'h01_note1')).toEqual(['K1', 'K2']);
    takeNote(k, 'h01_note2');
    expect(canStartHidden(k, 'h01')).toMatchObject({ why: 'clues', n: 2 });
    takeNote(k, 'h01_note3');
    expect(canStartHidden(k, 'h01').ok).toBe(true);
  });

  it('時間が足りない時は始められない', () => {
    const s = at(2);
    for (const e of ['h01_note1', 'h01_note2', 'h01_note3']) takeNote(s, e);
    s.phaseLeft = 5000;
    expect(canStartHidden(s, 'h01')).toMatchObject({ ok: false, why: 'time' });
  });

  it('H04 は手紙 5 通、H07 は資料 12 件がそろってから', () => {
    const s = at(8);
    expect(canStartHidden(s, 'h04')).toMatchObject({ why: 'letters', n: 5 });
    takeZeroLetters(s);
    expect(canStartHidden(s, 'h04')).toMatchObject({ why: 'letters', n: 3 });
    expect(takeNote(s, 'h04_letters')).toEqual(['L02', 'L04']);
    expect(takeNote(s, 'h04_memo')).toEqual(['L05']);
    expect(canStartHidden(s, 'h04').ok).toBe(true);
    for (const e of EVIDENCE_IDS.slice(0, 11)) giveItem(s, e);
    expect(canStartHidden(s, 'h07')).toMatchObject({ why: 'evidence', n: 1 });
    giveItem(s, 'E12');
    expect(canStartHidden(s, 'h07').ok).toBe(true);
  });
});

describe('裏ルート：結果の清算（1 回だけ）', () => {
  it('H01：成功で 3 ピース。2 回目は無い。失敗するとその日は挑めない', () => {
    const s = at(2);
    const p = s.actors.hero.pieces;
    settleHidden(s, 'h01', { hero: 1 }, [['hero']]);
    expect(s.actors.hero.pieces).toBe(p + 3);
    expect(canStartHidden(s, 'h01')).toMatchObject({ why: 'done' });
    settleHidden(s, 'h01', { hero: 1 }, [['hero']]);
    expect(s.actors.hero.pieces).toBe(p + 3);
    const t = at(2);
    settleHidden(t, 'h01', { hero: 0 }, [['hero']]);
    expect(canStartHidden(t, 'h01')).toMatchObject({ why: 'tomorrow' });
    t.day = 3;
    for (const e of ['h01_note1', 'h01_note2', 'h01_note3']) takeNote(t, e);
    expect(canStartHidden(t, 'h01').ok).toBe(true);
  });

  it('H02：賭けは勝てば 2 倍で戻り、同点は返金、負けは戻らない', () => {
    for (const [rk, diff] of [[win, 2], [tie, 0], [lose, -2]] as const) {
      const s = at(3, 'night');
      const p = s.actors.hero.pieces;
      beginHidden(s, 'h02', 2);
      expect(s.actors.hero.pieces).toBe(p - 2);
      settleHidden(s, 'h02', {}, rk as CharId[][]);
      expect(s.actors.hero.pieces).toBe(p + diff);
      expect(s.flags.hiddenRun).toBeUndefined();
    }
    const s = at(3, 'night');
    s.actors.hero.pieces = 0;
    expect(canStartHidden(s, 'h02')).toMatchObject({ why: 'pieces' });
  });

  it('H03：成功で鏡の鍵。H04：4 問で成功（3 問は失敗）', () => {
    const s = at(3);
    settleHidden(s, 'h03', { hero: 3 }, [['hero']]);
    expect(hasItem(s, 'KEY_MIRROR')).toBe(true);
    const a = at(3); const pa = a.actors.hero.pieces;
    expect(settleHidden(a, 'h04', { hero: 3 }, [['hero']]).outcome).toBe('lose');
    expect(a.actors.hero.pieces).toBe(pa);
    const b = at(3); const pb = b.actors.hero.pieces;
    expect(settleHidden(b, 'h04', { hero: 4 }, [['hero']]).outcome).toBe('win');
    expect(b.actors.hero.pieces).toBe(pb + 4);
    expect(b.flags.h04_cleared).toBe(true);
  });

  it('H05：1 回だけ。成功で 5 ピース。成功でも失敗でも奥の扉は開く', () => {
    const s = at(4);
    beginHidden(s, 'h05');
    expect(canStartHidden(s, 'h05')).toMatchObject({ why: 'once' });
    settleHidden(s, 'h05', { hero: 1 }, [['hero']]);
    expect(s.flags.h05_cleared).toBe(true);
    const t = at(4); const p = t.actors.hero.pieces;
    beginHidden(t, 'h05');
    settleHidden(t, 'h05', { hero: 3 }, [['hero']]);
    expect(t.actors.hero.pieces).toBe(p + 5);
  });

  it('H06：最初は扉の料金と参加費で 4、2 回目からは 2。勝つと 6 ピースと黒い扉', () => {
    const s = at(5);
    s.actors.hero.pieces = 10;
    const p = s.actors.hero.pieces;
    expect(h06Fee(s)).toBe(4);
    beginHidden(s, 'h06');
    expect(s.actors.hero.pieces).toBe(p - 4);
    settleHidden(s, 'h06', {}, [['mask' as CharId], ['hero']]);
    expect(s.flags.h06_open).toBeFalsy();
    s.day = 6;
    expect(h06Fee(s)).toBe(2);
    beginHidden(s, 'h06');
    settleHidden(s, 'h06', {}, [['hero'], ['mask' as CharId]]);
    expect(s.actors.hero.pieces).toBe(p - 6 + 6);
    expect(s.flags.h06_open).toBe(true);
    expect(canStartHidden(s, 'h06')).toMatchObject({ why: 'done' });
  });

  it('H07：解くと文書と記録。H08：段階は保存され、5 つで解放の権限', () => {
    const s = at(9);
    const r = settleHidden(s, 'h07', { hero: 1 }, [['hero']]);
    expect(r.story).toBe('I08');
    expect(hasItem(s, 'DOC_CROWN') && hasItem(s, 'CORE01') && !!s.flags.h07_cleared).toBe(true);
    settleHidden(s, 'h08', { hero: 3 }, [['hero']]);
    expect(s.flags.h08_stage).toBe(3);
    expect(hiddenOpts(s, 'h08')).toEqual({ from: 3 });
    settleHidden(s, 'h08', { hero: 2 }, [['hero']]);
    expect(s.flags.h08_stage).toBe(3);
    const done = settleHidden(s, 'h08', { hero: 5 }, [['hero']]);
    expect(done.outcome).toBe('win');
    expect(hasItem(s, 'RELEASE_AUTH') && !!s.flags.h08_cleared).toBe(true);
  });
});

describe('裏ルート：代替経路と結末', () => {
  it('H08 は鍵のどちらか、文書、記録、隔離区域の確認がそろってから', () => {
    const s = at(9);
    giveItem(s, 'DOC_CROWN'); giveItem(s, 'CORE01');
    expect(canStartHidden(s, 'h08')).toMatchObject({ why: 'prereq' });
    giveItem(s, 'KEY_SERVICE');
    expect(canStartHidden(s, 'h08')).toMatchObject({ why: 'prereq' });
    expect(confirmIsolation(s)).toBe(false); // まだ誰も脱落していない
    s.actors[NPC_IDS[0]].alive = false;
    expect(confirmIsolation(s)).toBe(true);
    expect(canStartHidden(s, 'h08').ok).toBe(true);
  });

  it('昇降機：DAY 8 から、許可があり、棟分けの無い時だけ', () => {
    const s = at(7);
    s.flags.svc_permit = true;
    expect(canUseLift(s)).toBe(false);
    s.day = 8;
    expect(canUseLift(s)).toBe(true);
    s.actors.hero.house = 'living';
    expect(canUseLift(s)).toBe(false);
  });

  it('ピース 0、裏ゲームに触れずに、昇降機の道だけで解放の準備まで届く', () => {
    const s = at(8);
    s.actors.hero.pieces = 0;
    s.flags.svc_permit = true;
    expect(canUseLift(s)).toBe(true);
    collectVault(s);
    expect(EVIDENCE_IDS.every((e) => hasItem(s, e)) && LETTER_IDS.every((l) => hasItem(s, l)) && hasItem(s, 'KEY_SERVICE')).toBe(true);
    expect(collectVault(s)).toEqual([]);
    expect(canStartHidden(s, 'h07').ok).toBe(true);
    settleHidden(s, 'h07', { hero: 1 }, [['hero']]);
    s.day = 9;
    s.actors[NPC_IDS[2]].alive = false;
    confirmIsolation(s);
    expect(canStartHidden(s, 'h08').ok).toBe(true);
    expect(endingOptions(s)).toEqual([]);
    settleHidden(s, 'h08', { hero: 5 }, [['hero']]);
    expect(endingOptions(s, 'lift')).toEqual(['E_ESCAPE', 'E_REPORT']);
    expect(endingOptions(s, 'terminal')).toEqual([]);
    s.flags.RESCUE_READY = true;
    expect(endingOptions(s, 'terminal')).toEqual(['E_RESCUE']);
  });

  it('優勝の結末：H08 と解放の準備がそろえば、偽りの王冠が先', () => {
    const s = at(11);
    s.flags.betrayals_hero = 9;
    expect(championEnding(s)).toBe('E_LONE');
    s.flags.h08_cleared = true;
    expect(championEnding(s)).toBe('E_LONE');
    s.flags.RESCUE_READY = true;
    expect(championEnding(s)).toBe('E_TRUE');
  });

  it('研究室から黒い扉の部屋へは、黒い扉が開くまで入れない', () => {
    const s = at(8);
    expect(canEnter(s, 'hero', 'black_door', 'h06_open')).toBe(false);
    s.flags.h06_open = true;
    expect(canEnter(s, 'hero', 'black_door', 'h06_open')).toBe(true);
  });

  it('全部の裏ゲームの ID が清算できる（例外が出ない）', () => {
    for (const id of HIDDEN_IDS) expect(() => settleHidden(at(9), id as HiddenId, { hero: 0 }, [['hero']])).not.toThrow();
  });
});
