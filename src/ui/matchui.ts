/**
 * 競技画面の共通部分。ルールの処理は MatchEngine が行い、ここは
 * 「プレイヤーに見えてよい情報（engine.view('hero')）」を描画して入力を渡すだけ。
 * NPC の手は core/runner.ts が、本人の view だけを渡して決める。
 */
import { G } from '../app/game';
import { sceneFor } from './scene';
import { announce } from '../audio/announce';
import { Sound } from '../audio/audio';
import { buildCtx, engineOf, stepNpcs } from '../core/runner';
import { rel, rngOf, shortName } from '../core/state';
import type { GameState, MatchSlot } from '../core/types';
import type { CharId, NpcId } from '../data/characters';
import { t } from '../i18n/i18n';
import type { MatchEngine } from '../matches/types';
import { chooseProposal, type BrainEvent } from '../npc/brain';
import { commit, evaluate, type Proposal } from '../npc/negotiation';
import { face, icon } from './art';
import { alertDialog, append, button, clear, clockPaused, closeLayer, fmtTime, h, openLayer, toast, type Child, type Layer } from './dom';
import { reviewVoiced } from './tutorial';
import { renderM01 } from './games/m01';
import { renderM02 } from './games/m02';
import { renderM03 } from './games/m03';
import { renderM04 } from './games/m04';
import { renderP01 } from './games/p01';
import { renderP02 } from './games/p02';
import { renderP04 } from './games/p04';
import { renderM05 } from './games/m05';
import { renderP05 } from './games/p05';
import { renderM07 } from './games/m07';
import { renderP07 } from './games/p07';
import { renderM08 } from './games/m08';
import { renderP08 } from './games/p08';
import { renderP09 } from './games/p09';
import { renderM10 } from './games/m10';
import { renderP10 } from './games/p10';
import { renderM11 } from './games/m11';
import { renderDuel } from './games/duel';
import { renderH01, renderH03, renderH04, renderH05, renderH07, renderH08 } from './games/hidden';
import { renderS01, renderS02, renderS03, renderS04, renderS05, renderS06 } from './games/subs';
import { renderM09 } from './games/m09';
import { renderM06 } from './games/m06';
import { renderP06 } from './games/p06';
import { renderP03 } from './games/p03';
import { renderTiebreak } from './games/tiebreak';
import { talkTo } from './talk';

export interface MatchUi {
  slot: MatchSlot;
  state: GameState;
  engine: MatchEngine;
  /** 画面内の一時的な選択状態（段階が変わると消える） */
  local: Record<string, unknown>;
  submit(move: unknown): void;
  talk(npc: NpcId): void;
  rerender(): void;
  name(id: CharId): string;
  /** この段階で経過した時間（ミリ秒） */
  elapsed(): number;
  finished: boolean;
  /** 話しかけてきた NPC */
  inbox: BrainEvent[];
  /** 時間切れの時に提出する手（盤面を操作する競技で、その時点の配置を出すために使う） */
  timeoutMove?: () => unknown;
}

export type Renderer = (view: never, ui: MatchUi) => { main: Child; side?: Child };

const RENDERERS: Record<string, Renderer> = {
  h01: renderH01 as Renderer,
  h02: renderDuel as Renderer,
  h03: renderH03 as Renderer,
  h04: renderH04 as Renderer,
  h05: renderH05 as Renderer,
  h06: renderP10 as Renderer,
  h07: renderH07 as Renderer,
  h08: renderH08 as Renderer,
  s01: renderS01 as Renderer,
  s02: renderS02 as Renderer,
  s03: renderS03 as Renderer,
  s04: renderS04 as Renderer,
  s05: renderS05 as Renderer,
  s06: renderS06 as Renderer,
  m07: renderM07 as Renderer,
  p07: renderP07 as Renderer,
  m08: renderM08 as Renderer,
  p08: renderP08 as Renderer,
  p09: renderP09 as Renderer,
  m10: renderM10 as Renderer,
  p10: renderP10 as Renderer,
  m11: renderM11 as Renderer,
  duel: renderDuel as Renderer,
  m09: renderM09 as Renderer,
  m01: renderM01 as Renderer,
  m02: renderM02 as Renderer,
  m03: renderM03 as Renderer,
  m04: renderM04 as Renderer,
  p01: renderP01 as Renderer,
  p02: renderP02 as Renderer,
  p04: renderP04 as Renderer,
  m05: renderM05 as Renderer,
  p05: renderP05 as Renderer,
  m06: renderM06 as Renderer,
  p06: renderP06 as Renderer,
  p03: renderP03 as Renderer,
  tiebreak: renderTiebreak as Renderer,
};

/** 交渉時間の開始時に、NPC 同士が取引を試みる（プレイヤーも相手候補の 1 人として同じ基準で選ばれる） */
function npcNegotiate(s: GameState, slot: MatchSlot, inbox: BrainEvent[]): void {
  const rng = rngOf(s);
  const npcs = slot.players.filter((p): p is NpcId => p !== 'hero');
  const engine = engineOf(slot.id);
  let toHero = 0;
  for (const a of rng.shuffle([...npcs])) {
    const cands = slot.players.filter((b) => b !== a).map((b) => ({ b, v: (engine.allyValue?.(slot.state, a, b) ?? 1) * 10 + rel(s, a, b).like * 0.3 + rel(s, a, b).trust * 0.2 - rel(s, a, b).hostility * 0.5 + rng.gauss(0, 4) }));
    cands.sort((x, y) => y.v - x.v);
    const b = cands[0]?.b;
    if (!b) continue;
    const p = chooseProposal(s, a, b, rng);
    if (!p || (p.kind !== 'alliance' && p.kind !== 'nonaggression')) continue;
    if (b === 'hero') {
      if (toHero++ < 1 && slot.players.includes('hero')) inbox.push({ type: 'approach', npc: a, other: 'hero', proposal: p });
      continue;
    }
    let cur: Proposal = p;
    let v = evaluate(s, cur);
    if (!v.accept && v.counter) {
      const next = { ...cur, ...v.counter };
      if (next.payNow - cur.payNow <= 1 && s.actors[a].pieces >= Math.max(0, next.payNow)) {
        cur = next;
        v = evaluate(s, cur);
      }
    }
    if (v.accept) commit(s, cur, []);
  }
}

export function playMatch(slot: MatchSlot): Promise<void> {
  const s = G.state!;
  const engine = engineOf(slot.id);
  const heroIn = slot.players.includes('hero');
  return new Promise((resolve) => {
    let layer: Layer;
    let stageKey = '';
    let stageTime = 0;
    let first = true;
    let closed = false;
    /** 進行の声：終わりの声は 1 回だけ。時間切れの声が鳴っていれば、その後に続ける */
    let endSaid = false;
    let voiceChain: Promise<unknown> = Promise.resolve();
    const title = h('div', { class: 'match-title' }, `${slot.id === 'tiebreak' ? '' : slot.id.toUpperCase() + '　'}${engine.name}`);
    const stageEl = h('div', { class: 'match-stage' });
    const timerEl = h('div', { class: 'match-timer' });
    const gaugeClip = h('div', { class: 'gauge-clip' }, h('div', { class: 'gauge-fill' }));
    const gaugeEl = h('div', { class: 'gauge match-gauge' }, gaugeClip);
    const main = h('div', { class: 'match-main' });
    const side = h('div', { class: 'match-side' });
    const inboxEl = h('div', { class: 'row', style: 'gap:6px' });

    const finish = () => {
      if (closed) return;
      closed = true;
      clearInterval(iv);
      closeLayer(layer);
      resolve();
    };

    const ui: MatchUi = {
      slot, state: s, engine, local: {}, finished: false, inbox: [],
      name: (id) => shortName(s, id),
      elapsed: () => Math.max(0, stageTime - slot.stageLeft),
      rerender: () => render(),
      talk: (npc) => {
        void talkTo(npc, { match: slot }).then(render);
      },
      submit: (move) => {
        if (closed || engine.done(slot.state)) return;
        if (!engine.pending(slot.state).includes('hero')) return;
        if (!engine.validate(slot.state, 'hero', move)) {
          Sound.se('error');
          toast(t('match.illegal'), 'bad');
          return;
        }
        engine.submit(slot.state, 'hero', move);
        sync();
      },
    };

    const render = () => {
      if (closed) return;
      const done = engine.done(slot.state);
      const st = engine.stage(slot.state);
      stageEl.textContent = done ? t('match.done') : st.label;
      const r = RENDERERS[slot.id];
      const out = r(engine.view(slot.state, heroIn ? 'hero' : 'spectator') as never, ui);
      clear(main);
      append(main, out.main);
      clear(side);
      if (out.side) append(side, out.side);
      side.style.display = out.side ? '' : 'none';
      clear(inboxEl);
      for (const e of ui.inbox) {
        inboxEl.append(button(t('match.inbox', { name: shortName(s, e.npc) }), () => {
          ui.inbox = ui.inbox.filter((x) => x !== e);
          void talkTo(e.npc, { match: slot, event: e }).then(render);
        }, { small: true, kind: 'primary' }));
      }
      if (done) main.append(h('div', { class: 'row', style: 'justify-content:center;padding:8px' }, button(t('match.toResult'), finish, { kind: 'primary', autofocus: true })));
      updateTimer();
    };

    const updateTimer = () => {
      const st = engine.stage(slot.state);
      const show = !engine.done(slot.state) && st.time && engine.pending(slot.state).includes('hero');
      timerEl.textContent = show ? fmtTime(slot.stageLeft) : '';
      timerEl.classList.toggle('low', !!show && slot.stageLeft < 10_000);
      gaugeEl.style.visibility = show && stageTime > 0 ? '' : 'hidden';
      gaugeEl.classList.toggle('low', !!show && slot.stageLeft < 10_000);
      gaugeClip.style.width = `${stageTime > 0 ? Math.max(0, Math.min(1, slot.stageLeft / stageTime)) * 100 : 0}%`;
    };

    /** NPC の手を進め、プレイヤーの番か終局まで進行する */
    const sync = () => {
      for (let guard = 0; guard < 500; guard++) {
        if (engine.done(slot.state)) break;
        const st = engine.stage(slot.state);
        const key = `${st.label}|${String((slot.state as { stage?: string }).stage ?? '')}`;
        if (key !== stageKey) {
          stageKey = key;
          stageTime = st.time ?? 0;
          if (!(first && slot.stageLeft > 0 && slot.stageLeft <= stageTime)) slot.stageLeft = stageTime;
          ui.local = {};
          ui.timeoutMove = undefined;
          ui.inbox = [];
          if (st.negotiation && !(first && slot.stageLeft < stageTime)) npcNegotiate(s, slot, ui.inbox);
        }
        first = false;
        const heroPending = engine.pending(slot.state).includes('hero');
        const progressed = stepNpcs(s, slot, { holdNegotiation: heroPending });
        if (heroPending || !progressed) break;
      }
      ui.finished = engine.done(slot.state);
      if (ui.finished) Sound.se('gong');
      if (ui.finished && !endSaid) { endSaid = true; voiceChain = voiceChain.then(() => announce('game_end')); }
      G.save();
      render();
    };

    const iv = setInterval(() => {
      if (closed || document.hidden || clockPaused() || engine.done(slot.state)) return;
      const st = engine.stage(slot.state);
      if (!st.time || !engine.pending(slot.state).includes('hero')) return;
      const before = slot.stageLeft;
      slot.stageLeft -= 200;
      if (slot.stageLeft <= 10_000 && Math.ceil(before / 1000) !== Math.ceil(slot.stageLeft / 1000) && slot.stageLeft > 0) Sound.se('tick');
      if (slot.stageLeft <= 0) {
        // 時間切れ：事前に明示した既定の合法手になる
        if (!st.negotiation) toast(t('match.timeout'), 'bad');
        // 進行の声：ステージの制限時間（1 分以上）が切れた時だけ。手番ごとの短い時間では鳴らさない
        if ((st.time ?? 0) >= 60_000) voiceChain = announce('time_up');
        const own = ui.timeoutMove?.();
        engine.submit(slot.state, 'hero', own && engine.validate(slot.state, 'hero', own) ? own : engine.defaultMove(slot.state, 'hero'));
        sync();
      } else updateTimer();
    }, 200);

    const rulesBtn = button(t('match.rules'), () => void (reviewVoiced(slot.id, sceneFor(slot.id, slot.players)) ?? alertDialog(engine.name, h('div', { class: 'col', style: 'gap:6px' }, engine.rules.map((r, i) => h('div', { class: 'entry small' }, `${i + 1}. ${r}`))), t('common.close'), true)), { small: true, kind: 'ghost' });
    const el = h('div', { class: `match${slot.kind === 'prison' ? ' prison' : ''}` },
      h('div', { class: 'match-head' }, title, stageEl, inboxEl, h('div', { class: 'spacer' }), heroIn ? h('span', { class: 'row', style: 'gap:6px' }, face('hero'), h('span', { class: 'piece' }, String(s.actors.hero.pieces))) : null, rulesBtn, icon('timer'), gaugeEl, timerEl),
      h('div', { class: 'match-body' }, main, side),
    );
    layer = openLayer(el, { pausesClock: false, name: 'match' });
    // 開発版のみ：画面の自動確認から、進行中の競技を参照できるようにする
    if (import.meta.env.VITE_CHANNEL !== 'product') {
      const w = window as unknown as { __fcSlot?: MatchSlot; __fcAuto?: () => boolean; __fcHint?: () => unknown };
      // 開発版のみ：CPU と同じ考え方で選んだ主人公の手を返す（出さない）。画面の自動確認が、その手を指の操作で入力するために使う
      w.__fcHint = () => (closed || engine.done(slot.state) || !engine.pending(slot.state).includes('hero') ? null : engine.ai(engine.view(slot.state, 'hero'), buildCtx(s, 'hero', slot.id, rngOf(s))));
      w.__fcSlot = slot;
      // 開発版のみ：主人公の手を CPU と同じ考え方で 1 手進める（長い競技の自動確認用）
      w.__fcAuto = () => {
        if (closed || engine.done(slot.state) || !engine.pending(slot.state).includes('hero')) return false;
        let mv = engine.ai(engine.view(slot.state, 'hero'), buildCtx(s, 'hero', slot.id, rngOf(s)));
        if (!engine.validate(slot.state, 'hero', mv)) mv = engine.defaultMove(slot.state, 'hero');
        engine.submit(slot.state, 'hero', mv);
        sync();
        return true;
      };
    }
    // 進行の声：競技の始まり（もう終わっている競技を開き直した時は鳴らさない）
    if (!engine.done(slot.state)) void announce('game_start');
    sync();
  });
}
