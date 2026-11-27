/**
 * 裏ルートの画面：入口の小さな謎、裏ゲームの起動と結果、手紙と資料、保守用の昇降機、隔離区域の端末、自分で選ぶ結末。
 * 決まり（挑めるか、報酬、旗）は src/story/hiddenroute.ts。ここは画面と流れだけ。設計は docs/hidden_route.md。
 */
import { G } from '../app/game';
import { Sound } from '../audio/audio';
import { engineOf, newSlot } from '../core/runner';
import { log } from '../core/state';
import { t } from '../i18n/i18n';
import { saveMeta } from '../save/save';
import { EVIDENCE, LETTERS } from '../story/hiddendata';
import {
  ENTRY_BY_EVENT, GAME_EVENT, HIDDEN_MINUTES, HIDDEN_NOTES, LIFT_MINUTES, VAULT_MINUTES,
  beginHidden, canNotice, canPermit, canPrepareRescue, canStartHidden, canUseLift, collectVault, confirmIsolation, endingOptions,
  h06Fee, hiddenOpts, hiddenPlayers, readRun, settleHidden, takeNote, takeZeroLetters,
  type ChosenEnding, type EntryPuzzle, type HiddenId, type Line,
} from '../story/hiddenroute';
import { ROOMS } from '../world/maps';
import { alertDialog, append, button, choose, clear, closeLayer, confirmDialog, h, openLayer, panel, toast, type Layer } from './dom';
import { playMatch } from './matchui';
import { tutorialScreen } from './tutorial';

const line = (l: Line) => t(l.k, { ...l.v, ...(l.v?.name ? { name: t(`item.${l.v.name}`) } : {}) });
const letterTitle = (id: string) => LETTERS.find((l) => l.id === id)?.title ?? id;

/** 手紙や資料が手に入った時の知らせ */
function gotToast(ids: string[]): void {
  for (const id of ids) {
    if (id.startsWith('L')) toast(t('hid.got.letter', { title: letterTitle(id) }), 'good');
    else if (!id.startsWith('E')) toast(t('hid.got.item', { name: t(`item.${id}`) }), 'good');
  }
  const ev = ids.filter((x) => x.startsWith('E')).length;
  if (ev) toast(t('hid.got.evidence', { n: ev }), 'good');
  if (ids.length) Sound.se('bookOpen');
}

// ---------------- 入口の小さな謎 ----------------

/** ボタンを順に押す。間違えたら最初から（何度でも。時間は進まない）。開いたら true */
function entryPuzzle(p: EntryPuzzle): Promise<boolean> {
  return new Promise((resolve) => {
    let layer: Layer;
    let seq: string[] = [];
    let wrong = false;
    const body = h('div', { class: 'col hd-entry', style: 'gap:12px;align-items:center' });
    const close = (v: boolean) => { closeLayer(layer); resolve(v); };
    const render = () => {
      clear(body);
      append(body, [
        h('div', null, t(`hid.entry.${p.id}.lead`)),
        h('div', { class: 'sg-slots' }, p.answer.map((_, i) => h('span', { class: `sg-slot${seq[i] ? ' on' : ''}` }, seq[i] ?? ''))),
        h('div', { class: 'row', style: 'gap:10px' }, p.keys.map((k) => {
          const b = h('button', { class: 'sg-key hd-ekey', type: 'button', 'data-key': k }, k);
          b.addEventListener('click', () => {
            seq.push(k);
            Sound.se('select');
            wrong = false;
            if (seq.length === p.answer.length) {
              if (seq.join('|') === p.answer.join('|')) { Sound.se('latch'); close(true); return; }
              wrong = true; seq = []; Sound.se('error');
            }
            render();
          });
          return b;
        })),
        h('div', { class: 'small hd-miss', style: 'min-height:1.4em' }, wrong ? t('hid.entry.wrong') : ''),
      ]);
    };
    render();
    layer = openLayer(h('div', { class: 'overlay' }, panel(t(`hid.entry.${p.id}.title`), body, { footer: button(t('common.close'), () => close(false)) })), { pausesClock: true, onCancel: () => close(false), name: 'hid-entry' });
  });
}

async function tryEntry(p: EntryPuzzle): Promise<boolean> {
  const s = G.state!;
  if (s.flags[p.flag] || s.day < p.minDay || (p.nightOnly && s.phase !== 'night')) return false;
  if (!(await entryPuzzle(p))) return true;
  s.flags[p.flag] = true;
  G.save();
  const door = Object.values(ROOMS).flatMap((r) => r.doors).find((d) => d.lock === p.flag);
  await alertDialog(t(`hid.entry.${p.id}.title`), t('hid.entry.open', { room: door ? ROOMS[door.to].name : '' }), t('common.next'));
  return true;
}

// ---------------- 裏ゲーム ----------------

function denyText(id: HiddenId, why: string, n?: number): string {
  const k = `hid.deny.${why}.${id}`;
  const own = t(k, { n: n ?? 0 });
  return own !== k ? own : t(`hid.deny.${why}`, { n: n ?? 0, min: HIDDEN_MINUTES[id] });
}

async function playHidden(id: HiddenId): Promise<void> {
  const s = G.state!;
  const eng = engineOf(id);
  for (;;) {
    const slot = s.match && s.match.kind === 'hidden' && s.match.id === id ? s.match : newSlot(s, id, hiddenPlayers(id), 'hidden', hiddenOpts(s, id));
    s.match = slot;
    G.save();
    await playMatch(slot);
    s.match = null;
    const ranking = eng.ranking(slot.state);
    // 影の対戦者は、同点ならその場でもう一度（参加費は取り直さない）
    if (id === 'h06' && ranking.length === 1) { await alertDialog(eng.name, t('hid.h06.again'), t('common.next')); continue; }
    const res = settleHidden(s, id, eng.scores(slot.state), ranking);
    s.phaseLeft = Math.max(5000, s.phaseLeft - HIDDEN_MINUTES[id] * 1000);
    log(s, t('log.hidden', { game: eng.name, res: t(`hid.res.${res.outcome}`) }));
    G.save();
    if (res.lines.some((l) => l.k === 'hid.rw.pieces')) Sound.se('coins');
    await alertDialog(t('hid.res.title', { game: eng.name }), h('div', { class: 'col', style: 'gap:6px' },
      h('b', { class: res.outcome === 'win' ? 'gold' : '' }, t(`hid.res.${id}.${res.outcome}`) !== `hid.res.${id}.${res.outcome}` ? t(`hid.res.${id}.${res.outcome}`) : t(`hid.res.${res.outcome}`)),
      ...res.lines.map((l) => h('div', null, line(l)))), t('common.next'));
    if (res.story) await G.story(res.story);
    return;
  }
}

/** 裏ゲームを始める：確かめて、参加費や賭けを預け、対局し、清算する */
async function launchHidden(id: HiddenId): Promise<void> {
  const s = G.state!;
  if (id === 'h04') gotToast(takeZeroLetters(s));
  const can = canStartHidden(s, id);
  if (!can.ok) { if (can.why !== 'day') await alertDialog(engineOf(id).name, denyText(id, can.why, can.n), t('common.close')); return; }
  const eng = engineOf(id);
  let stake = 0;
  if (id === 'h02') {
    const max = Math.min(3, s.actors.hero.pieces);
    stake = await choose(t('hid.h02.stake.title'), t('hid.h02.stake.text', { have: s.actors.hero.pieces }), [
      ...[1, 2, 3].map((n) => ({ label: t('hid.h02.stake.n', { n }), value: n, disabled: n > max, kind: 'primary' as const })),
      { label: t('common.cancel'), value: 0 },
    ], { cancel: 0 });
    if (!stake) return;
  } else {
    const notes = [t('hid.confirm.text', { min: HIDDEN_MINUTES[id] })];
    if (id === 'h05') notes.push(t('hid.confirm.once'));
    if (id === 'h06') notes.push(t('hid.confirm.fee', { n: h06Fee(s), have: s.actors.hero.pieces }));
    if (id === 'h08' && Number(s.flags.h08_stage ?? 0) > 0) notes.push(t('hid.confirm.resume', { n: Number(s.flags.h08_stage) + 1 }));
    const ok = await confirmDialog(eng.name, h('div', { class: 'col', style: 'gap:6px' }, h('div', { class: 'small dim' }, eng.summary), ...notes.map((n) => h('div', null, n))), { ok: t('hid.confirm.ok'), cancel: t('common.cancel') });
    if (!ok) return;
  }
  beginHidden(s, id, stake);
  G.save();
  if (!G.meta.matchesPlayed.includes(id)) {
    await tutorialScreen(id);
    G.meta.matchesPlayed.push(id);
    saveMeta(G.meta);
  }
  await playHidden(id);
}

/** 裏ゲームの途中でアプリを閉じていた時、自由時間の始めに続きから遊んで清算する */
export async function resumeHiddenRun(): Promise<void> {
  const s = G.state;
  if (!s) return;
  const run = readRun(s);
  if (!run) { if (s.match?.kind === 'hidden') s.match = null; return; }
  if (run.day !== s.day) {
    // 日をまたいでいたら、その挑戦は終わったことにする（中断と同じ）
    const eng = engineOf(run.id);
    const slot = s.match?.kind === 'hidden' && s.match.id === run.id ? s.match : null;
    settleHidden(s, run.id, slot ? eng.scores(slot.state) : {}, slot ? eng.ranking(slot.state) : [['hero']]);
    s.match = null;
    G.save();
    return;
  }
  await new Promise((r) => setTimeout(r, 400));
  await alertDialog(engineOf(run.id).name, t('hid.resume'), t('common.next'));
  await playHidden(run.id);
}

// ---------------- 資料、昇降機、端末 ----------------

/** 記録保管庫の索引 */
async function vaultIndex(): Promise<void> {
  const s = G.state!;
  if (s.day < 8) { await alertDialog(t('vault.title'), t('vault.locked'), t('common.close')); return; }
  const got = collectVault(s);
  if (got.length) { s.phaseLeft = Math.max(5000, s.phaseLeft - VAULT_MINUTES * 1000); G.save(); }
  gotToast(got);
  const have = EVIDENCE.filter((e) => (s.actors.hero.items[e.id] ?? 0) > 0);
  await alertDialog(t('vault.title'), h('div', { class: 'col hd-vault', style: 'gap:6px' },
    h('div', { class: 'small dim' }, t(got.length ? 'vault.lead' : 'vault.again')),
    h('b', { class: 'gold' }, t('vault.sec.evidence', { n: have.length })),
    h('div', { class: 'hd-vlist' }, have.map((e) => h('div', null, h('b', null, e.subject), '　', e.text))),
    got.includes('KEY_SERVICE') ? h('div', { class: 'gold' }, t('vault.sec.key')) : null,
    got.some((x) => x.startsWith('L')) ? h('div', null, t('vault.sec.letters')) : null), t('common.close'));
}

/** 自分で選ぶ結末。確認で「はい」の時だけ決まる */
async function pickEnding(opts: ChosenEnding[], title: string, lead: string): Promise<boolean> {
  const v = await choose<ChosenEnding | null>(title, lead, [
    ...opts.map((e) => ({ label: t(`endsel.${e}`), value: e as ChosenEnding | null, kind: 'danger' as const, hint: t(`endsel.${e}.hint`) })),
    { label: t('endsel.stay'), value: null },
  ], { cancel: null });
  if (!v) return false;
  const ok = await confirmDialog(t('endsel.confirm.title'), t('endsel.confirm.text'), { ok: t('endsel.confirm.ok'), cancel: t('common.cancel'), danger: true });
  if (!ok) return false;
  G.chooseEnding(v);
  return true;
}

/** 案内図（2F 共用廊下）：保守の知らせと、保守用の昇降機で下りる */
async function floorGuide(): Promise<boolean> {
  const s = G.state!;
  if (!canNotice(s)) return false;
  if (!s.flags.v04_maintenance_notice) { await G.story('I07'); s.flags.v04_maintenance_notice = true; G.save(); }
  if (s.day < 8) return true;
  if (!canUseLift(s)) { await alertDialog(t('svc.lift.title'), t(s.flags.svc_permit ? 'svc.lift.split' : 'svc.lift.closed'), t('common.close')); return true; }
  const go = await choose(t('svc.lift.title'), t('svc.lift.text', { min: LIFT_MINUTES }), [{ label: t('svc.lift.down'), value: true, kind: 'primary' }, { label: t('svc.lift.stay'), value: false }], { cancel: false });
  if (!go) return true;
  s.phaseLeft = Math.max(5000, s.phaseLeft - LIFT_MINUTES * 1000);
  await G.warpHero('records_vault');
  return true;
}

/** 記録保管庫の昇降機：上へ戻る。条件がそろっていれば、外へ出る結末も選べる */
async function liftUp(): Promise<void> {
  const s = G.state!;
  const ends = endingOptions(s, 'lift');
  if (!canUseLift(s) && !ends.length) { await alertDialog(t('svc.lift.title'), t(s.day < 8 ? 'svc.lift.dark' : s.actors.hero.house !== null ? 'svc.lift.split' : 'svc.lift.closed'), t('common.close')); return; }
  const opts: { label: string; value: string; kind?: 'primary' | 'secondary' | 'danger' }[] = [];
  if (canUseLift(s)) opts.push({ label: t('svc.lift.up'), value: 'up', kind: 'primary' });
  if (ends.length) opts.push({ label: t('endsel.lift'), value: 'end', kind: 'danger' });
  opts.push({ label: t('svc.lift.stay'), value: '' });
  const v = await choose(t('svc.lift.title'), t('svc.lift.upText'), opts, { cancel: '' });
  if (v === 'up') { s.phaseLeft = Math.max(5000, s.phaseLeft - LIFT_MINUTES * 1000); await G.warpHero('common_hall'); }
  else if (v === 'end') await pickEnding(ends, t('endsel.title'), t('endsel.liftLead'));
}

/** 隔離区域の端末：解放の準備、または、いま扉を開ける */
async function isoTerminal(): Promise<void> {
  const s = G.state!;
  if (canPrepareRescue(s)) {
    const ok = await confirmDialog(t('iso.term.title'), t('iso.term.prepareText'), { ok: t('iso.term.prepare'), cancel: t('common.cancel') });
    if (!ok) return;
    s.flags.RESCUE_READY = true;
    G.save();
    Sound.se('latch');
    await alertDialog(t('iso.term.title'), t('iso.term.ready'), t('common.next'));
    return;
  }
  const ends = endingOptions(s, 'terminal');
  if (!ends.length) { await alertDialog(t('iso.term.title'), t('iso.term.none'), t('common.close')); return; }
  await pickEnding(ends, t('iso.term.title'), t('iso.term.release'));
}

// ---------------- 入口 ----------------

/** 調査の event が裏ルートのものなら処理して true（調べた文はもう出したあと） */
export async function hiddenInspect(event: string): Promise<boolean> {
  const s = G.state!;
  const entry = ENTRY_BY_EVENT[event];
  if (entry) return tryEntry(entry);
  const game = GAME_EVENT[event];
  if (game) { await launchHidden(game); return true; }
  const note = HIDDEN_NOTES[event];
  if (note && s.day >= note.minDay && !(note.nightOnly && s.phase !== 'night')) {
    await G.ui.showInspect(t(note.key));
    if (event === 'archive_records' && !s.flags.passage_open) { s.flags.passage_open = true; toast(t('hid.passage'), 'good'); Sound.se('latch'); }
    gotToast(takeNote(s, event));
    G.save();
    return true;
  }
  switch (event) {
    case 'floor_guide': return floorGuide();
    case 'shop':
      if (!canPermit(s)) return false;
      if (await confirmDialog(t('svc.permit.title'), t('svc.permit.text'), { ok: t('svc.permit.ok'), cancel: t('common.cancel') })) { s.flags.svc_permit = true; G.save(); Sound.se('confirm'); toast(t('svc.permit.done'), 'good'); }
      return true;
    case 'vault_docs': await vaultIndex(); return true;
    case 'svc_lift': await liftUp(); return true;
    case 'iso_found':
      if (confirmIsolation(s)) { G.save(); await G.story('I09'); }
      return true;
    case 'iso_terminal': await isoTerminal(); return true;
    default: return false;
  }
}
