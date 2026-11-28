/**
 * 裏ゲーム 2 系統の画面：手掛かりの追記、錠、挑戦の確認と結果、手帳の「気になること」と組み合わせのパズル。
 * 決まり（記録、確かめ方、報酬）は src/story/backgames.ts。ここは画面と流れだけ。案と本人の決定は docs/back_games.md。
 */
import { G } from '../app/game';
import { Sound } from '../audio/audio';
import { engineOf, newSlot } from '../core/runner';
import { log, shortName } from '../core/state';
import type { GameState } from '../core/types';
import type { CharId } from '../data/characters';
import { t } from '../i18n/i18n';
import { saveMeta } from '../save/save';
import {
  BG_CLUE_EVENTS, BG_DEFS, BG_WINGS, CLUE_KEYS,
  beginBg, bgPlayers, canChallenge, confirmClue, checkOrder, clueCount, noticed, openLock, prisonCode, readBgRun, recOf, retireLegacyRun, settleBg, syncClues, unlock,
  type BgWing, type ClueKey,
} from '../story/backgames';
import { alertDialog, button, confirmDialog, h, toast, type Child } from './dom';
import { playMatch } from './matchui';
import { tutorialScreen } from './tutorial';

/** 手掛かりを記録した知らせ（新しく記録した時だけ） */
function noteNew(): void {
  const got = syncClues(G.state!);
  if (!got.length) return;
  toast(t('bg.noted'), 'good');
}

// ---------------- 挑戦 ----------------

async function playBg(wing: BgWing): Promise<void> {
  const s = G.state!;
  const def = BG_DEFS[wing];
  const eng = engineOf(def.game);
  for (;;) {
    const slot = s.match && s.match.kind === 'hidden' && s.match.id === def.game ? s.match : newSlot(s, def.game, bgPlayers(wing), 'hidden');
    s.match = slot;
    G.save();
    await playMatch(slot);
    s.match = null;
    const res = settleBg(s, wing, eng.scores(slot.state), eng.ranking(slot.state));
    // 影の対戦者は、同点ならその場でもう一度（挑戦中の記録はそのまま）
    if (res.outcome === 'draw') { G.save(); await alertDialog(eng.name, t('hid.h06.again'), t('common.next')); continue; }
    s.phaseLeft = Math.max(5000, s.phaseLeft - def.minutes * 1000);
    log(s, t('log.hidden', { game: eng.name, res: t(`bg.res.${wing}.${res.outcome}`) }));
    G.save();
    if (res.reward) Sound.se('coins');
    const lines: string[] = [];
    if (res.reward) lines.push(t('bg.rw.pieces', { n: res.reward, have: s.actors.hero.pieces }));
    else if (res.outcome === 'win') lines.push(t(res.practice ? 'bg.rw.practice' : 'bg.rw.already'));
    else lines.push(t('bg.rw.lose'));
    await alertDialog(t('hid.res.title', { game: eng.name }), h('div', { class: 'col', style: 'gap:6px' },
      h('b', { class: res.outcome === 'win' ? 'gold' : '' }, t(`bg.res.${wing}.${res.outcome}`)),
      ...lines.map((l) => h('div', null, l))), t('common.next'));
    return;
  }
}

/** 挑戦の確認（かかる時間、報酬、腕試しかどうかを先に出す）→ 対局 → 清算 */
async function launchBg(wing: BgWing): Promise<void> {
  const s = G.state!;
  const def = BG_DEFS[wing];
  const eng = engineOf(def.game);
  const can = canChallenge(s, wing);
  if (!can.ok) { await alertDialog(eng.name, t(`bg.deny.${can.why}`, { min: def.minutes }), t('common.close')); return; }
  const notes = [t('bg.confirm.time', { min: def.minutes })];
  notes.push(t(can.practice ? 'bg.confirm.practice' : 'bg.confirm.reward', { n: def.reward }));
  if (wing === 'prison') notes.push(t('bg.confirm.free'));
  const ok = await confirmDialog(eng.name, h('div', { class: 'col', style: 'gap:6px' }, h('div', { class: 'small dim' }, eng.summary), ...notes.map((n) => h('div', null, n))),
    { ok: t(can.practice ? 'bg.confirm.okPractice' : 'hid.confirm.ok'), cancel: t('common.cancel') });
  if (!ok) return;
  beginBg(s, wing, can.practice);
  G.save();
  if (!G.meta.matchesPlayed.includes(def.game)) {
    await tutorialScreen(def.game);
    G.meta.matchesPlayed.push(def.game);
    saveMeta(G.meta);
  }
  await playBg(wing);
}

/** 錠：解放済みなら開ける。生活棟は、開けたらそのまま挑戦の画面へ進む */
async function lockInspect(wing: BgWing): Promise<void> {
  const s = G.state!;
  const rec = recOf(s, wing);
  if (rec.unlockedDay === null) {
    await G.ui.showInspect(t(`bg.lock.${wing}.locked`) + (clueCount(s, wing) ? t('bg.lock.hint') : ''));
    return;
  }
  if (rec.openedDay === null) {
    const ok = await confirmDialog(t(`bg.lock.${wing}.title`), t(`bg.lock.${wing}.ask`, { code: wing === 'prison' ? prisonCode() : BG_DEFS.living.answer.join(' → ') }), { ok: t(`bg.lock.${wing}.ok`), cancel: t('common.cancel') });
    if (!ok) return;
    openLock(s, wing);
    G.save();
    Sound.se('latch');
    if (wing === 'prison') { await alertDialog(t('bg.lock.prison.title'), t('bg.lock.prison.opened'), t('common.next')); return; }
  }
  if (wing === 'living') await launchBg('living');
  else await G.ui.showInspect(t('bg.lock.prison.done'));
}

/** 調べる所が 2 系統のものなら処理して true（調べた文はもう出したあと。手掛かりの情報も記録済み） */
export async function bgInspect(event: string): Promise<boolean> {
  const clue = BG_CLUE_EVENTS[event];
  if (clue) {
    await G.ui.showInspect(t(`bg.note.${clue.wing}.${clue.key}`));
    noteNew();
    confirmClue(G.state!, clue.wing, clue.key);
    G.save();
    return true;
  }
  for (const wing of BG_WINGS) {
    const def = BG_DEFS[wing];
    if (event === def.lockEvent) { noteNew(); await lockInspect(wing); return true; }
    if (event === def.playEvent) { await launchBg(wing); return true; }
  }
  // 旧セーブで秘密の書斎へ入れる人（旧の書棚の謎を解いていた）：金庫からも挑める。第零牢の封筒の束は、影の対戦者の卓
  if (event === 'h01_safe') { await launchBg('living'); return true; }
  if (event === 'h04_game') { await launchBg('prison'); return true; }
  return false;
}

/** 挑戦の途中でアプリを閉じていた時、自由時間の始めに続きから。旧裏ルートの挑戦の途中なら、預けたピースを返して終わりにする */
export async function resumeBgRun(): Promise<void> {
  const s = G.state;
  if (!s) return;
  const back = retireLegacyRun(s);
  if (back) { G.save(); toast(t('bg.legacyRefund', { n: back }), 'info'); }
  const run = readBgRun(s);
  if (!run) return;
  if (run.day !== s.day) {
    // 日をまたいでいたら、その挑戦は終わったことにする（負けと同じ。腕試しなら何も動かない）
    const eng = engineOf(BG_DEFS[run.bg].game);
    const slot = s.match?.kind === 'hidden' ? s.match : null;
    settleBg(s, run.bg, slot ? eng.scores(slot.state) : {}, slot ? eng.ranking(slot.state) : [['mask' as CharId], ['hero']]);
    s.match = null;
    G.save();
    return;
  }
  await new Promise((r) => setTimeout(r, 400));
  await alertDialog(engineOf(BG_DEFS[run.bg].game).name, t('hid.resume'), t('common.next'));
  await playBg(run.bg);
}

// ---------------- 手帳「気になること」 ----------------

/** 手帳に欄を出すか */
export const hasOddNotes = (s: GameState): boolean => { syncClues(s); return BG_WINGS.some((w) => noticed(s, w)); };

/** 並べかけの札（手帳を閉じても、この起動の間は残す） */
const draft: Record<BgWing, string[]> = { living: [], prison: [] };
const lastMiss: Record<BgWing, ClueKey[] | null> = { living: null, prison: null };

function viaText(s: GameState, via: 'self' | string): string {
  return via === 'self' ? t('bg.via.self') : t('bg.via.told', { name: shortName(s, via) });
}

function wingBlock(s: GameState, wing: BgWing, rerender: () => void): Child {
  const def = BG_DEFS[wing];
  const rec = recOf(s, wing);
  const order = draft[wing];
  const have = CLUE_KEYS.filter((k) => rec.clues[k]);
  const clueRows = have.map((k) => {
    const miss = lastMiss[wing]?.includes(k);
    return h('div', { class: `bg-clue${miss ? ' miss' : ''}` }, h('b', null, miss ? '× ' : '・'), G.state!.infos[def.clues[k]]?.text ?? t(`bg.note.${wing}.${k}`),
      h('span', { class: 'small dim' }, `（${viaText(s, rec.clues[k]!.via)}）`));
  });
  const status = rec.rewardDay !== null ? t('bg.st.reward') : rec.unlockedDay !== null ? t(`bg.st.unlocked.${wing}`) : '';
  const parts: Child[] = [h('h4', null, t(`bg.title.${wing}`)), ...clueRows];
  if (have.length < CLUE_KEYS.length && rec.unlockedDay === null) parts.push(h('div', { class: 'small dim' }, t(`bg.more.${wing}`)));
  if (!have.length && s.actors.hero.knows[def.lockInfo]) parts.push(h('div', null, '・', s.infos[def.lockInfo]?.text ?? ''));
  if (rec.unlockedDay === null) {
    // 組み合わせのパズル：札をタップして枠へ。枠をタップすると外す
    const left = def.tiles.filter((x) => !order.includes(x));
    const digit = (x: string) => (def.digits ? (rec.clues.A ? def.digits[x] : '？') : '');
    parts.push(
      h('div', { class: 'small' }, t(`bg.puzzle.${wing}`)),
      h('div', { class: 'sg-slots bg-slots' }, def.tiles.map((_, i) => {
        const x = order[i];
        const b = h('button', { class: `sg-slot${x ? ' on' : ''}`, type: 'button', 'data-slot': String(i) }, x ? h('span', null, x, def.digits ? h('small', null, digit(x)) : null) : '');
        b.addEventListener('click', () => { if (!x) return; draft[wing] = order.filter((y) => y !== x); lastMiss[wing] = null; Sound.se('click'); rerender(); });
        return b;
      })),
      h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, left.map((x) => {
        const b = h('button', { class: 'sg-key bg-tile', type: 'button', 'data-tile': x }, x);
        b.addEventListener('click', () => { draft[wing] = [...order, x]; lastMiss[wing] = null; Sound.se('select'); rerender(); });
        return b;
      })),
      h('div', { class: 'row', style: 'gap:8px' },
        button(t('bg.puzzle.check'), () => {
          const r = checkOrder(s, wing, order);
          if (r.ok) {
            unlock(s, wing, order);
            lastMiss[wing] = null;
            G.save();
            Sound.se('latch');
            void alertDialog(t(`bg.title.${wing}`), t(`bg.solved.${wing}`, { code: wing === 'prison' ? prisonCode() : def.answer.join(' → ') }), t('common.next')).then(rerender);
            return;
          }
          Sound.se('error');
          if (r.why === 'clues') toast(t('bg.puzzle.needClues'), 'info');
          else if (r.why === 'shape') toast(t('bg.puzzle.fill'), 'info');
          else { lastMiss[wing] = r.miss; toast(t(r.miss.length ? 'bg.puzzle.wrong' : 'bg.puzzle.wrongNone'), 'bad'); }
          rerender();
        }, { small: true, kind: 'primary', disabled: have.length < CLUE_KEYS.length }),
        button(t('bg.puzzle.reset'), () => { draft[wing] = []; lastMiss[wing] = null; rerender(); }, { small: true, kind: 'ghost' })),
    );
  } else parts.push(h('div', { class: 'gold' }, status), h('div', { class: 'small dim' }, t(`bg.where.${wing}`, { code: wing === 'prison' ? prisonCode() : def.answer.join(' → ') })));
  return h('div', { class: 'box col bg-wing', style: 'gap:6px' }, parts);
}

/** 手帳の「気になること」の中身 */
export function renderOddTab(s: GameState, rerender: () => void): Child[] {
  syncClues(s);
  const wings = BG_WINGS.filter((w) => noticed(s, w));
  if (!wings.length) return [h('div', { class: 'dim' }, t('bg.empty'))];
  return [h('div', { class: 'small dim' }, t('bg.lead')), ...wings.map((w) => wingBlock(s, w, rerender))];
}
