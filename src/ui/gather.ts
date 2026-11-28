/**
 * 集合移動中の画面（本人の依頼 2026-11-28）。core/gather.ts の動きを、フィールドの上で見せる。
 *
 * - 集合案内を閉じてから歩き始める（案内の間は集合期限を数えない）。
 * - 上の帯：「集合移動中」、目的地、次に通る扉、着いた人数、集合期限、「会場へ移動」（移動の省略）。
 * - 会場への道にある扉だけ通れる。寄り道の扉、調べる所、椅子は「今は集合が先だ」と短く出す（同じ案内は続けて出さない）。
 * - 手帳・アイテム・設定は使える（開いている間は全員が止まる。今の時計と同じ）。
 * - NPC に話しかけると、通常の会話メニューではなく短い一言（ui はこの下の gatherTalk）。
 */
import { G } from '../app/game';
import { Sound } from '../audio/audio';
import { shortName } from '../core/state';
import { arrivedCount, finishGather, GATHER, heroGoes, heroMayEnter, heroNextDoor, npcsArrived, tickGather, type GatherState } from '../core/gather';
import { gatherLine, gatherMood, MOOD_EXPR } from '../core/gathertalk';
import { NPC_BY_ID, type NpcId } from '../data/characters';
import { t } from '../i18n/i18n';
import { ROOMS, type DoorDef } from '../world/maps';
import { roomTitle } from '../world/rooms';
import { moveActor, speedOf } from '../world/sim';
import { bust } from './art';
import { alertDialog, button, clockPaused, closeLayer, confirmDialog, fade, fmtTime, h, openLayer, toast, topLayer, type Layer } from './dom';

export interface GatherCtx {
  g: GatherState;
  /** 次に通る扉（フィールドの目印に使う） */
  next: DoorDef | null;
}

/** 同じ案内を続けて出さない間隔 */
const NOTE_GAP = 2600;
let lastNote = { text: '', at: 0 };

/** 集合移動中に、寄り道・探索などをしようとした時の短い案内（移動の入力は止めない） */
export function gatherNote(key = 'gather.notNow'): void {
  const text = t(key);
  const now = performance.now();
  if (lastNote.text === text && now - lastNote.at < NOTE_GAP) return;
  lastNote = { text, at: now };
  toast(text, 'info', 2000);
}

/** 扉を通ってよいか。だめな時は案内を出して false */
export function gatherDoor(d: DoorDef): boolean {
  const ctx = G.gather;
  const s = G.state;
  if (!ctx || !s) return true;
  if (heroMayEnter(s, ctx.g, d.to)) return true;
  gatherNote(s.actors.hero.pos.room === ctx.g.venue ? 'gather.inVenue' : 'gather.notNow');
  return false;
}

/** 扉の向きを、画面の言葉で */
function doorWhere(d: DoorDef): string {
  return t(`gather.dir.${d.dir}`);
}

function closeTalk(): void {
  for (let i = 0; i < 3; i++) {
    const top = topLayer();
    if (!top || top.name !== 'gatherTalk' || !top.onCancel) break;
    top.onCancel();
  }
}

/** 集合中の短い会話。相手はその場で立ち止まり、閉じると歩き出す */
export function gatherTalk(npc: NpcId): Promise<void> {
  const s = G.state!;
  const ctx = G.gather;
  if (!ctx) return Promise.resolve();
  const g = ctx.g;
  const A = s.actors[npc];
  const def = NPC_BY_ID[npc];
  const mood = gatherMood(s, g, npc);
  const text = gatherLine(s, npc, mood, shortName(s, 'hero'));
  if (!g.talked.includes(npc)) g.talked.push(npc);
  return new Promise((resolve) => {
    let layer: Layer;
    let closed = false;
    const hold = () => {
      A.busyUntil = s.simTime + 1500;
      A.step = undefined;
      // 主人公の方を向く
      const hp = s.actors.hero.pos;
      const dx = hp.x - A.pos.x;
      const dy = hp.y - A.pos.y;
      if (hp.room === A.pos.room) A.pos.dir = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
    };
    hold();
    const iv = setInterval(() => { if (!closed) hold(); }, 400);
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(iv);
      // 会話を終えたら、すぐ集合移動を再開する
      A.busyUntil = 0;
      document.body.classList.remove('talking');
      closeLayer(layer);
      G.heroBusy = false;
      resolve();
    };
    G.heroBusy = true;
    const box = h('div', { class: 'dlg-box' }, h('div', { class: 'dlg-name' }, h('b', null, def.name), h('span', null, `${t('intro.age', { n: def.age })}　${def.job}`)), h('div', { class: 'dlg-text' }, text));
    const menu = h('div', { class: 'talk-menu gather-talk-menu' }, button(t('gather.talkEnd'), close, { kind: 'primary', autofocus: true }));
    const el = h('div', { class: 'overlay clear dlg-screen gather-talk' }, bust(npc, MOOD_EXPR[mood], 'dlg-portrait left'), h('div', { class: 'talk-info hud-box' }, h('span', { class: 'tag where' }, t('gather.talkWhere'))), menu, box);
    document.body.classList.add('talking');
    Sound.se('notice');
    layer = openLayer(el, { pausesClock: false, name: 'gatherTalk', onCancel: close });
  });
}

/**
 * 集合移動を最初から最後まで進める。主人公が会場へ向かわない時（監獄マッチの日の生活棟）は呼ばない。
 * 終わると全員が会場の席にいる。
 */
export function runGather(g: GatherState): Promise<void> {
  const s = G.state!;
  return new Promise((resolve) => {
    const ctx: GatherCtx = { g, next: null };
    const title = h('span', null, t('gather.title'));
    const timeEl = h('b', { class: 'strat-time' });
    const destEl = h('div', { class: 'gather-dest' });
    const nextEl = h('div', { class: 'gather-next' });
    const countEl = h('div', { class: 'gather-count dim' });
    const skip = button(t('gather.skip'), async () => {
      if (!(await confirmDialog(t('gather.skipTitle'), t('gather.skipText'), { ok: t('gather.skipOk'), cancel: t('common.cancel'), pauses: true }))) return;
      void finish('skip');
    }, { small: true, kind: 'ghost' });
    const el = h('div', { class: 'strat-panel gather-panel hud-box' }, h('div', { class: 'strat-head' }, title, timeEl, skip), destEl, nextEl, countEl);
    let panel: Layer | null = null;
    let done = false;
    let settleMs = 0;
    let lastRoom = '';

    const venueName = () => `${ROOMS[g.venue].floor}　${roomTitle(s, g.venue)}`;
    const render = () => {
      timeEl.textContent = fmtTime(g.left);
      timeEl.classList.toggle('low', g.left <= 20_000);
      destEl.textContent = t('gather.dest', { room: venueName() });
      const here = s.actors.hero.pos.room;
      ctx.next = heroNextDoor(s, g);
      if (here === g.venue) nextEl.textContent = t('gather.arrivedHero');
      else if (ctx.next) nextEl.textContent = t('gather.next', { door: ctx.next.label || roomTitle(s, ctx.next.to), where: doorWhere(ctx.next) });
      else nextEl.textContent = t('gather.noRoute');
      const c = arrivedCount(g, s);
      countEl.textContent = t('gather.count', { n: c.n, m: c.of });
    };

    const finish = async (why: 'all' | 'deadline' | 'skip') => {
      if (done) return;
      done = true;
      closeTalk();
      G.cutscene = null;
      G.fieldActive = false;
      if (why !== 'all') {
        // 集合期限・移動の省略：まだ着いていない人を会場へ（失格にはしない）
        if (why === 'deadline') toast(t('gather.deadline'), 'info', 2600);
        await fade(true, 260, why === 'skip' ? venueName() : '');
      }
      finishGather(s, g);
      G.gather = null;
      G.camFocus = null;
      if (panel) closeLayer(panel);
      panel = null;
      G.ui.hudShow(false);
      G.save();
      resolve();
    };

    const begin = async () => {
      if (!g.started) {
        // 集合案内（この間は集合期限を数えない）
        Sound.se('gong');
        await alertDialog(t(g.kind === 'prison' ? 'gather.noticePrisonTitle' : 'gather.noticeTitle'), h('div', { class: 'col', style: 'gap:10px' },
          h('div', { class: 'text' }, t(g.kind === 'prison' ? 'gather.noticePrison' : 'gather.notice', { room: venueName() })),
          h('div', { class: 'text dim' }, t('gather.noticeNote', { sec: Math.round(GATHER.limitMs / 1000) })),
        ), t('gather.go'), true);
        g.started = true;
      }
      G.gather = ctx;
      G.fieldVisible = true;
      G.fieldActive = true;
      G.ui.hudShow(true);
      panel = openLayer(h('div', null, el), { modal: false, name: 'gatherPanel' });
      render();
      G.cutscene = (dt: number) => {
        if (done || clockPaused()) return;
        const hero = s.actors.hero;
        moveActor(s, hero, dt, speedOf('hero'));
        tickGather(s, g, dt);
        if (hero.pos.room !== lastRoom) {
          lastRoom = hero.pos.room;
          if (lastRoom === g.venue) { Sound.se('confirm'); toast(t('gather.heroIn'), 'good', 2200); }
        }
        render();
        G.ui.hudUpdate();
        // 集合期限：会話を安全に終えて、会場へ
        if (g.left <= 0) { void finish('deadline'); return; }
        // 主人公が会場に着き、全員がそろった
        if (heroGoes(g) && hero.pos.room === g.venue && npcsArrived(g, s) && topLayer()?.name !== 'gatherTalk') {
          settleMs += dt;
          if (settleMs >= GATHER.settleMs) void finish('all');
        } else settleMs = 0;
      };
    };
    void begin();
  });
}
