/**
 * 作戦時間の画面（試作、まず M01）。ルール説明の後、大会競技場（ホール）を歩いて、参加者と競技の相談をする。
 *
 * - 説明と操作案内を閉じてから計時を始める。1 枠 30 秒 × 4 枠（最大 2 分）。会話を開いても時間は止まらず、延びない。
 * - 手帳・設定を開いている間は、全員が止まる（今の時計と同じ）。
 * - 相談室は、ホールの左右の壁の入口（いまは仮素材：入口の前に立って調べる）。中の画面は仮の背景。
 * - 準備完了を押すと、残りの枠を NPC 同士だけで進めてから競技を始める。
 */
import { G } from '../app/game';
import { Sound } from '../audio/audio';
import { rngOf, shortName, nameOf, allied, rel } from '../core/state';
import {
  askTip, consultVerdict, finishStrategy, heroAnswerRole, heroSplitRoles, roleKey, splitRoles, giveTip, groupOf, roomById, roomOfGroup, startStrategy, STRATEGY_ROOMS, strategyLeft, tickStrategy, tipsOf,
  type StrategyMeeting, type StrategyRoom, type StrategyState,
} from '../core/strategy';
import type { CharId, NpcId } from '../data/characters';
import type { MatchSlot } from '../core/types';
import type { RoleId } from '../npc/group';
import { medalIssued, promiseRescue, promised } from '../core/rescue';
import { commit, evaluate, noteDeal } from '../npc/negotiation';
import { say } from '../npc/lines';
import { t } from '../i18n/i18n';
import { moveActor, setPathTo, speedOf, dirTo } from '../world/sim';
import { assetUrl } from '../assets/registry';
import { bust } from './art';
import { alertDialog, button, choose, clear, clockPaused, closeLayer, confirmDialog, fmtTime, h, openLayer, toast, topLayer, type Layer } from './dom';

export interface StrategyCtx {
  slot: MatchSlot;
  st: StrategyState;
  /** 主人公が開いている相談室の画面 */
  room?: { id: string; layer: Layer; refresh: () => void };
}

/** 主人公が今いる相談（相談室の会議、または相手を誘って向かっている途中） */
export function heroMeeting(st: StrategyState): StrategyMeeting | undefined {
  return st.meetings.find((m) => m.slot === st.slot && m.withHero && !m.resolved);
}

const roomNameOf = (id: string | null) => (id ? roomById(id)?.name ?? '' : t('strat.standing'));

/** 相談室の入口の前（その人が立つマス）。人ごとに別のマス */
function spotFor(room: StrategyRoom, members: CharId[], id: CharId): { x: number; y: number } {
  const i = Math.max(0, members.filter((m) => m !== 'hero').indexOf(id as never));
  const [x, y] = room.spot[i % room.spot.length];
  return { x, y };
}

/** 着いているか（入口の前の 3 マス以内） */
function arrived(id: CharId, room: StrategyRoom): boolean {
  const p = G.state!.actors[id].pos;
  return Math.abs(p.x - room.x) + Math.abs(p.y - room.y) <= 3;
}

/** NPC を、その枠の相談の場所へ歩かせる */
function moveNpcs(ctx: StrategyCtx, dt: number): void {
  const s = G.state!;
  const { st } = ctx;
  for (const mt of st.meetings) {
    if (mt.slot !== st.slot || mt.resolved) continue;
    for (const id of mt.members) {
      if (id === 'hero') continue;
      const a = s.actors[id];
      if ((a.busyUntil ?? 0) > s.simTime) continue;
      let goal: { x: number; y: number } | null = null;
      if (mt.room) goal = spotFor(roomById(mt.room)!, mt.members, id);
      else if (mt.host !== id) {
        // 立ち話：言い出した人の隣へ
        const hp = s.actors[mt.host].pos;
        goal = { x: hp.x + (a.pos.x < hp.x ? -1 : 1), y: hp.y };
      }
      if (!goal) continue;
      const at = a.pos.x === goal.x && a.pos.y === goal.y;
      if (!at && !a.step && !a.path.length) setPathTo(s, a, goal.x, goal.y);
      moveActor(s, a, dt, speedOf(id));
      if (at && !a.step) {
        const room = mt.room ? roomById(mt.room) : null;
        if (room) a.pos.dir = room.dir === 'left' ? 'left' : 'right';
        else { const hp = s.actors[mt.host].pos; a.pos.dir = dirTo(a.pos.x, a.pos.y, hp.x, hp.y); }
      }
    }
  }
}

let panelLayer: Layer | null = null;

function closeTalkLayers(): void {
  for (let i = 0; i < 4; i++) {
    const top = topLayer();
    if (!top || !['talk', 'strategyRoom'].includes(top.name) || !top.onCancel) break;
    top.onCancel();
  }
}

export function runStrategy(slot: MatchSlot, st: StrategyState): Promise<void> {
  const s = G.state!;
  return new Promise((resolve) => {
    const ctx: StrategyCtx = { slot, st };
    const timeEl = h('b', { class: 'strat-time' });
    const slotEl = h('span', { class: 'strat-slot' });
    const gauge = h('div', { class: 'strat-gauge' }, h('i'));
    const note = h('div', { class: 'strat-note' });
    const ready = button(t('strat.ready'), async () => {
      if (!(await confirmDialog(t('strat.readyTitle'), t('strat.readyText'), { ok: t('strat.readyOk'), cancel: t('common.cancel'), pauses: false }))) return;
      finish();
    }, { kind: 'primary', small: true });
    const el = h('div', { class: 'strat-panel hud-box' }, h('div', { class: 'strat-head' }, h('span', null, t('strat.title')), slotEl, timeEl, ready), gauge, note);
    let done = false;
    let lastSlot = -1;

    const render = () => {
      timeEl.textContent = fmtTime(strategyLeft(st));
      slotEl.textContent = t('strat.slot', { n: Math.min(st.slots, st.slot + 1), m: st.slots });
      (gauge.firstChild as HTMLElement).style.width = `${Math.max(0, Math.min(1, st.slotLeft / st.slotMs)) * 100}%`;
      clear(note);
      const mine = roomOfGroup(slot, 'hero');
      const lines: string[] = [];
      if (mine) lines.push(t('strat.myRoom', { room: mine.name, mates: groupOf(slot, 'hero').filter((x) => x !== 'hero').map((x) => shortName(s, x)).join('・') }));
      for (const iv of st.invites.filter((i) => i.slot === st.slot)) lines.push(t(iv.room ? 'strat.inviteRoom' : 'strat.inviteStand', { name: shortName(s, iv.from), room: roomNameOf(iv.room) }));
      const hm = heroMeeting(st);
      if (hm?.room) lines.push(t('strat.goRoom', { room: roomNameOf(hm.room), names: hm.members.filter((m) => m !== 'hero').map((m) => shortName(s, m)).join('・') }));
      for (const l of lines.slice(0, 3)) note.append(h('div', null, l));
    };

    const finish = () => {
      if (done) return;
      done = true;
      closeTalkLayers();
      finishStrategy(s, slot, st, rngOf(s));
      G.cutscene = null;
      G.strategy = null;
      G.fieldActive = false;
      G.ui.hudShow(false);
      if (panelLayer) closeLayer(panelLayer);
      panelLayer = null;
      G.save();
      resolve();
    };

    const begin = async () => {
      if (!st.started) {
        // 説明と操作案内（この間は計時しない）
        const groups = roomOfGroup(slot, 'hero') ? STRATEGY_ROOMS.slice(0, 3).map((r, i) => `${r.name}：${(slot.state as { groups: CharId[][] }).groups[i]?.map((x) => (x === 'hero' ? t('strat.you') : shortName(s, x))).join('・') ?? ''}`).join('\n') : '';
        await alertDialog(t('strat.guideTitle'), h('div', { class: 'col strat-guide', style: 'gap:10px' },
          h('div', { class: 'text' }, t('strat.guide1', { n: st.slots, sec: Math.round(st.slotMs / 1000) })),
          groups ? h('div', { class: 'text strat-groups' }, groups) : null,
          h('div', { class: 'text' }, t('strat.guide2')),
          h('div', { class: 'text dim' }, t('strat.guide3')),
        ), t('strat.start'), true);
        startStrategy(s, slot, st, rngOf(s));
        Sound.se('gong');
      }
      G.strategy = ctx;
      G.fieldVisible = true;
      G.fieldActive = true;
      G.ui.hudShow(true);
      panelLayer = openLayer(h('div', null, el), { modal: false, name: 'strategyPanel' });
      lastSlot = st.slot;
      render();
      G.cutscene = (dt: number) => {
        if (done) return;
        if (clockPaused()) return;
        const hero = s.actors.hero;
        moveActor(s, hero, dt, speedOf('hero'));
        moveNpcs(ctx, dt);
        const top = topLayer();
        const per = st.metrics.perSlot[st.slot];
        if (top && (top.name === 'talk' || top.name === 'strategyRoom')) { st.metrics.talkMs += dt; if (per) per.talkMs += dt; }
        else if (hero.moving) { st.metrics.walkMs += dt; if (per) per.walkMs += dt; }
        else st.metrics.idleMs += dt;
        const changed = tickStrategy(s, slot, st, dt, rngOf(s));
        if (changed) {
          // 枠の終わり：まだ決めていない話は取り消し、成立した約束は残す
          closeTalkLayers();
          if (st.done) { finish(); return; }
          Sound.se('tick');
          toast(t('strat.nextSlot', { n: st.slot + 1, m: st.slots }), 'info', 1800);
        }
        if (st.slot !== lastSlot) lastSlot = st.slot;
        render();
        G.ui.hudUpdate();
      };
    };
    void begin();
  });
}

// ---------------- 相談室 ----------------

/** 相談室の入口を調べた */
export async function openStrategyRoom(roomId: string): Promise<void> {
  const ctx = G.strategy;
  const s = G.state!;
  const room = roomById(roomId);
  if (!ctx || !room) {
    await G.ui.showInspect(t('strat.roomIdle', { room: room?.name ?? t('strat.roomGeneric') }));
    return;
  }
  const { st, slot } = ctx;
  let mt = st.meetings.find((m) => m.slot === st.slot && m.room === roomId && !m.resolved);
  if (mt && !mt.members.includes('hero')) {
    const invited = st.invites.some((i) => i.slot === st.slot && i.room === roomId && mt!.members.includes(i.from));
    if (!invited) {
      toast(t('strat.roomBusy', { room: room.name, names: mt.members.map((m) => shortName(s, m)).join('・') }), 'info', 2600);
      return;
    }
    mt.members.push('hero');
    mt.withHero = true;
    st.engaged.hero = st.slot;
  }
  if (!mt) {
    // 空いている：自分が使う（中で人を呼べる）
    mt = { slot: st.slot, room: roomId, host: 'hero', members: ['hero'], resolved: false, withHero: true };
    st.meetings.push(mt);
    st.engaged.hero = st.slot;
  }
  const meeting = mt;
  await new Promise<void>((resolve) => {
    let layer: Layer;
    let closed = false;
    const text = h('div', { class: 'dlg-text strat-room-text' });
    const people = h('div', { class: 'strat-room-people' });
    const menu = h('div', { class: 'talk-menu strat-room-menu' });
    const here = () => meeting.members.filter((m): m is NpcId => m !== 'hero' && arrived(m, room));
    const coming = () => meeting.members.filter((m): m is NpcId => m !== 'hero' && !arrived(m, room));
    const say1 = (lines: string[]) => { text.textContent = lines.join('\n'); };
    let lastKey = '';
    const refresh = (force = true) => {
      const key = `${here().join(',')}|${coming().join(',')}|${meeting.members.length}`;
      if (!force && key === lastKey) return;
      lastKey = key;
      clear(people);
      for (const id of here()) people.append(h('div', { class: 'strat-person' }, bust(id, 'normal', 'strat-bust'), h('b', null, shortName(s, id))));
      const c = coming();
      if (c.length) people.append(h('div', { class: 'strat-coming dim' }, t('strat.coming', { names: c.map((x) => shortName(s, x)).join('・') })));
      buildMenu();
    };
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(iv);
      closeLayer(layer);
      if (ctx.room?.layer === layer) ctx.room = undefined;
      G.heroBusy = false;
      G.save();
      resolve();
    };
    const iv = setInterval(() => { if (!closed) refresh(false); }, 800);

    const coop = () => {
      const out: string[] = [];
      for (const id of here()) {
        if (allied(s, 'hero', id)) { out.push(`${shortName(s, id)}：${t('talk.already')}`); continue; }
        const v = evaluate(s, { kind: 'alliance', from: 'hero', to: id, payNow: 0, payOnSuccess: 0, untilDay: s.day });
        if (v.accept) {
          const d = commit(s, { kind: 'alliance', from: 'hero', to: id, payNow: 0, payOnSuccess: 0, untilDay: s.day }, []);
          if (d) noteDeal(s, d);
          out.push(`${shortName(s, id)}「${say(s, id, 'accept', { name: shortName(s, 'hero') })}」`);
        } else out.push(`${shortName(s, id)}「${say(s, id, v.reason === 'counter' ? 'reject_price' : v.reason, { name: shortName(s, 'hero') })}」`);
      }
      Sound.se('confirm');
      say1(out.length ? out : [t('strat.nobody')]);
    };
    const tips = () => {
      const out: string[] = [];
      for (const id of here()) {
        const a = askTip(s, slot, st, id, 'hero', rngOf(s));
        if (a.kind === 'refuse') out.push(`${shortName(s, id)}「${say(s, id, 'tip_refuse')}」`);
        else out.push(`${shortName(s, id)}「${a.kind === 'again' ? say(s, id, 'tip_again') + ' ' : ''}${a.text}」`);
      }
      say1(out.length ? out : [t('strat.nobody')]);
    };
    const teach = async () => {
      const list = here();
      if (!list.length) return say1([t('strat.nobody')]);
      const pick = await choose<string | null>(t('strat.teachTitle'), t('strat.teachText'), [...tipsOf(st.match).map((x) => ({ label: x, value: x as string | null })), { label: t('common.cancel'), value: null }], { cancel: null, pauses: false });
      if (!pick || closed) return;
      say1(list.map((id) => { giveTip(s, st, 'hero', id); return `${shortName(s, id)}「${say(s, id, 'tip_thanks')}」`; }));
    };
    const rescue = () => {
      const out: string[] = [];
      for (const id of here()) {
        const r = rel(s, id, 'hero');
        if (promised(s, id, 'hero')) out.push(`${shortName(s, id)}「${t('talk.rescueAlready')}」`);
        else if (r.trust >= 35 || r.like >= 20 || allied(s, 'hero', id)) { promiseRescue(s, id, 'hero'); out.push(`${shortName(s, id)}「${t('talk.rescueYes')}」`); }
        else out.push(`${shortName(s, id)}「${t('talk.rescueNo')}」`);
      }
      say1(out.length ? out : [t('strat.nobody')]);
    };
    const call = async () => {
      const cands = slot.players.filter((p): p is NpcId => p !== 'hero' && !meeting.members.includes(p) && st.engaged[p] !== st.slot && s.actors[p].alive);
      if (!cands.length) return say1([t('strat.noOneFree')]);
      if (meeting.members.length >= 4) return say1([t('strat.full')]);
      const mates = groupOf(slot, 'hero');
      const pick = await choose<NpcId | null>(t('strat.callTitle'), t('strat.callText'), [...cands.sort((a, b) => Number(mates.includes(b)) - Number(mates.includes(a))).map((x) => ({ label: `${nameOf(s, x)}${mates.includes(x) ? t('strat.mateMark') : ''}`, value: x as NpcId | null })), { label: t('common.cancel'), value: null }], { cancel: null, pauses: false });
      if (!pick || closed) return;
      if (consultVerdict(s, slot, st, pick, 'hero', rngOf(s))) {
        meeting.members.push(pick);
        st.engaged[pick] = st.slot;
        Sound.se('confirm');
        say1([t('strat.callYes', { name: shortName(s, pick) })]);
      } else say1([t('strat.callNo', { name: shortName(s, pick) })]);
      refresh();
    };

    // 役割分担（集団行動）：言い出した人が割り振り、各自が引き受ける・別の役割を出す・断る・抜けるを選ぶ。主人公も同じ
    const listen = async () => {
      const r = splitRoles(s, slot, st, meeting, rngOf(s));
      const out = r.lines.map((l) => `${shortName(s, l.id)}「${l.text}」`);
      if (!out.length) return say1([t('role.none')]);
      say1(out);
      if (!r.heroRole || closed) return;
      const role = r.heroRole;
      const alt: RoleId = role === 'share' ? 'support' : 'share';
      const pick = await choose<'accept' | 'counter' | 'refuse' | 'leave'>(t('role.heroTitle'), t('role.heroText', { name: shortName(s, meeting.host), role: t(`role.${role}`) }), [
        { label: t('role.ansAccept'), value: 'accept' },
        { label: t('role.ansCounter', { role: t(`role.${alt}`) }), value: 'counter' },
        { label: t('role.ansRefuse'), value: 'refuse' },
        { label: t('role.ansLeave'), value: 'leave' },
      ], { cancel: 'refuse', pauses: false });
      const reply = heroAnswerRole(s, st, meeting, role, pick, alt, rngOf(s));
      say1([...out, `${shortName(s, meeting.host)}「${reply}」`]);
      if (pick === 'leave') close();
    };
    const split = async () => {
      const list = here();
      if (list.length < 2) return say1([t('strat.nobody')]);
      const pick = await choose<NpcId | null>(t('role.splitTitle'), t('role.splitText'), [...list.map((x) => ({ label: nameOf(s, x), value: x as NpcId | null })), { label: t('common.cancel'), value: null }], { cancel: null, pauses: false });
      if (!pick || closed) return;
      const others = list.filter((x) => x !== pick);
      const assign: Partial<Record<CharId, RoleId>> = { [pick]: 'share' };
      others.forEach((x, i) => { assign[x] = i === 0 ? 'scout' : 'support'; });
      const lines = heroSplitRoles(s, slot, st, meeting, assign, rngOf(s));
      say1(lines.map((l) => `${shortName(s, l.id)}「${l.text}」`));
    };

    function buildMenu(): void {
      clear(menu);
      const n = here().length;
      const add = (label: string, fn: () => void | Promise<void>, disabled = false) => menu.append(button(label, async () => { await fn(); if (!closed) refresh(); }, { small: true, disabled }));
      add(t('strat.cmdCoopAll'), coop, !n);
      add(t('strat.cmdTips'), tips, !n);
      add(t('strat.cmdTeach'), teach, !n);
      if (medalIssued(s.day)) add(t('strat.cmdRescue'), rescue, !n);
      add(t('strat.cmdCall'), call, meeting.members.length >= 4);
      if (meeting.host === 'hero') add(t('role.cmdSplit'), split, n < 2 || !!s.flags[roleKey(st, 'hero')]);
      else add(t('role.cmdListen'), listen, !here().includes(meeting.host as NpcId) || !!s.flags[roleKey(st, 'hero')]);
      menu.append(button(t('strat.leave'), () => close(), { kind: 'ghost', small: true }));
    }

    const bg = assetUrl('maps/2f/common_lounge');
    const elRoom = h('div', { class: 'overlay strat-room dlg-screen', style: bg ? `--strat-bg:url("${bg}")` : '' },
      h('div', { class: 'strat-room-title' }, h('b', null, room.name), h('span', { class: 'dim small' }, t('strat.roomNote'))),
      people, menu, h('div', { class: 'dlg-box strat-room-box' }, text),
    );
    G.heroBusy = true;
    say1([here().length ? t('strat.roomHello') : coming().length ? t('strat.roomWait') : t('strat.roomEmpty')]);
    layer = openLayer(elRoom, { pausesClock: false, name: 'strategyRoom', onCancel: () => close() });
    ctx.room = { id: roomId, layer, refresh };
    refresh();
  });
}

/**
 * 作戦時間の会話（1 対 1）で、相談室へ誘う。応じたら、相手は部屋の入口へ歩いていく。
 * 戻り値は案内の文。
 */
export function inviteToRoom(npc: NpcId): { ok: boolean; text: string } {
  const ctx = G.strategy;
  const s = G.state!;
  if (!ctx) return { ok: false, text: '' };
  const { st, slot } = ctx;
  const used = new Set(st.meetings.filter((m) => m.slot === st.slot && m.room && !m.resolved && !m.withHero).map((m) => m.room!));
  // 相手が、主人公も誘っている相談（組の相談室など）に向かっているなら、そこへ合流する
  const invitedTo = st.meetings.find((m) => m.slot === st.slot && !m.resolved && m.members.includes(npc) && !m.members.includes('hero') && st.invites.some((i) => i.slot === st.slot && m.members.includes(i.from)));
  if (invitedTo) {
    invitedTo.members.push('hero');
    invitedTo.withHero = true;
    st.engaged.hero = st.slot;
    const r = roomById(invitedTo.room);
    return { ok: true, text: r ? `${say(s, npc, 'consult_yes')}\n${t('strat.walkThere', { room: r.name, where: t(`strat.where.${r.id}`) })}` : say(s, npc, 'consult_yes') };
  }
  let mt = heroMeeting(st);
  const mine = roomOfGroup(slot, 'hero');
  // 部屋は、2 人がそれぞれ歩く距離の合計が短い所（同じ組の仲間なら、たいてい組の相談室）。遠い部屋を選ぶと、移動だけで枠を使ってしまう
  const dist = (id: CharId, r: StrategyRoom) => Math.abs(s.actors[id].pos.x - r.x) + Math.abs(s.actors[id].pos.y - r.y);
  const free = STRATEGY_ROOMS.filter((r) => !used.has(r.id)).sort((a, b) => dist('hero', a) + dist(npc, a) - (dist('hero', b) + dist(npc, b)) || (b === mine ? 1 : 0) - (a === mine ? 1 : 0));
  const room = mt?.room ? roomById(mt.room) : free[0] ?? null;
  if (!room) return { ok: false, text: t('strat.noRoom') };
  if (mt && mt.members.length >= 4) return { ok: false, text: t('strat.full') };
  if (!consultVerdict(s, slot, st, npc, 'hero', rngOf(s))) return { ok: false, text: say(s, npc, 'consult_no') };
  if (!mt) {
    mt = { slot: st.slot, room: room.id, host: 'hero', members: ['hero'], resolved: false, withHero: true };
    st.meetings.push(mt);
    st.engaged.hero = st.slot;
  }
  if (!mt.room) mt.room = room.id;
  mt.members.push(npc);
  st.engaged[npc] = st.slot;
  return { ok: true, text: `${say(s, npc, 'consult_yes')}\n${t('strat.walkThere', { room: room.name, where: t(`strat.where.${room.id}`) })}` };
}

/** 作戦時間に、その NPC がほかの人との相談に向かっているか（主人公との話は受けない） */
export function engagedElsewhere(npc: NpcId): string | null {
  const ctx = G.strategy;
  if (!ctx) return null;
  const { st } = ctx;
  const mt = st.meetings.find((m) => m.slot === st.slot && !m.resolved && m.members.includes(npc) && !m.members.includes('hero'));
  if (!mt) return null;
  // 主人公も誘われている相談なら、その仲間とは話せる（合流の相談ができる）
  if (st.invites.some((i) => i.slot === st.slot && mt.members.includes(i.from))) return null;
  const s = G.state!;
  return t('strat.busyWith', { name: shortName(s, npc), others: mt.members.filter((m) => m !== npc).map((m) => shortName(s, m)).join('・') || t('strat.someone'), room: roomNameOf(mt.room) });
}
