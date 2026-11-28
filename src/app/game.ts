/**
 * ゲーム全体の進行（1 日の流れ）と、フィールド・UI・ロジックの橋渡し。
 * 競技の勝敗、棟分け、脱落はすべて core/ のルールで決まり、ここは結果に従って画面と物語を進めるだけ。
 * 主人公専用の分岐は「プレイヤーが操作するか」「プレイヤーが脱落したら終局」だけで、勝敗への補正は一切ない。
 */
import { reserveSeat, seatTile, sitDown, standUp } from '../world/seats';
import { cellOf } from '../world/cells';
import { homeOf, isCell, isPrivateRoom, knockable, ownerOfRoom, roomTitle } from '../world/rooms';
import { Sound, type BgmId } from '../audio/audio';
import { announce } from '../audio/announce';
import { engineOf, newSlot, resolveTies, runToEnd } from '../core/runner';
import { addInfo, adjustRel, aliveIds, learn, log, nameOf, rngOf, shortName, transfer } from '../core/state';
import { medalIssued, npcRescuePromises } from '../core/rescue';
import { subGamesScreen } from '../ui/subhub';
import { hiddenInspect, resumeHiddenRun } from '../ui/hiddenhub';
import { applyMainResult, applyPrisonResult, championEnding, endDay, gatherAt, isFinalDay, mainMatchId, moveToHouses, prisonMatchId, startMorning } from '../core/tournament';
import { scheduleFor } from '../data/config';
import type { GameState, MatchSlot, Phase } from '../core/types';
import type { CharId, NpcId } from '../data/characters';
import storyJson from '../data/story_events.json';
import endingsJson from '../data/endings.json';
import { t } from '../i18n/i18n';
import { clampPhaseLeft, CLOCK, clockMinutes, crossed, fmtClock, phaseDuration } from '../core/clock';
import { isImplemented } from '../matches/registry';
import { addInvite, clearSocial, INVITE_TIME, isBedroom, observeAttitude, ownerOf, visitVerdict, witnessEntry } from '../npc/social';

/** その日のメインマッチと監獄マッチが両方とも実装済みか */
const dayPlayable = (day: number) => isImplemented(mainMatchId(day)) && (!prisonMatchId(day) || isImplemented(prisonMatchId(day)!));
import { fastForward, tickNpcs, type BrainEvent } from '../npc/brain';
import { recordBetrayal, settlePlans } from '../npc/negotiation';
import { loadMeta, saveGame, saveMeta, type Meta } from '../save/save';
import type { Target } from '../scenes/FieldScene';
import { CLUE_BY_EVENT } from '../story/clues';
import { alertDialog, anyModal, choose, clockPaused, confirmDialog, fade, toast, topLayer } from '../ui/dom';
import { fxPop } from '../ui/art';
import { canEnter, denyReason } from '../world/access';
import { ROOMS, type DoorDef } from '../world/maps';
import { enterDoor, moveActor, placeIn, setRouteTo, speedOf } from '../world/sim';
import { CHANNEL, dayUnlocked } from './entitlement';

export interface StoryLine {
  speaker: string;
  text: string;
}
interface StoryEvent {
  id: string;
  day: number;
  phase: string;
  mandatory: boolean;
  lines: StoryLine[];
}
const STORY: Record<string, StoryEvent> = Object.fromEntries((storyJson as unknown as { events: StoryEvent[] }).events.map((e) => [e.id, e]));
export const ENDINGS = (endingsJson as { endings: { id: string; title: string; lines: string[] }[] }).endings;

/** 画面側（ui/）が実装する機能。循環参照を避けるため起動時に登録する */
export interface Screens {
  playStory(lines: StoryLine[], opts?: { bg?: string }): Promise<void>;
  hudShow(v: boolean): void;
  hudUpdate(): void;
  hudLog(text: string): void;
  openMenu(): void;
  talkTo(npc: NpcId, opts?: { event?: BrainEvent }): Promise<void>;
  playMatch(slot: MatchSlot): Promise<void>;
  rulesScreen(matchId: string, opts: { prison: boolean }): Promise<void>;
  rankingScreen(opts: RankingView): Promise<void>;
  eliminationScreen(id: CharId): Promise<void>;
  endingScreen(id: string): Promise<void>;
  boardScreen(): Promise<void>;
  purchaseScreen(afterDay: boolean): Promise<boolean>;
  showInspect(text: string): Promise<void>;
  /** 救いのメダル：発行から確定配属の発表まで（v11） */
  rescueFlow(): Promise<void>;
  /** 開会式と、その後の配布（v11） */
  ceremony(opts: { review?: boolean; skippable?: boolean }): Promise<void>;
  handout(): Promise<void>;
}

export interface RankingView {
  title: string;
  ranking: CharId[];
  scores: Partial<Record<CharId, number>>;
  rewards?: Partial<Record<CharId, number>>;
  /** 下位何人が監獄棟（または脱落） */
  cut: number;
  cutLabel: string;
  notes: string[];
  prison?: boolean;
  /** 決勝の順位（優勝の祝いは戴冠の時に言う） */
  final?: boolean;
}

interface FieldLike {
  buildRoom(): void;
  target: Target;
}

let freeEnd: (() => void) | null = null;
let lastStepKey = '';
let running = false;

export const G = {
  state: null as GameState | null,
  field: null as FieldLike | null,
  /** プレイヤーがフィールドを操作できる */
  fieldActive: false,
  fieldVisible: false,
  /** 描画の状況（実機での確認用。設定画面に表示する） */
  perf: { fps: 0, slow: 0, w: 0, h: 0 },
  /** 会話中など、NPC から話しかけられない状態 */
  heroBusy: false,
  /** 扉を通った直後。方向キーを一度離すまで、歩いて扉に入り直さない */
  doorHold: false,
  meta: loadMeta() as Meta,
  ui: null as unknown as Screens,
  /** 終局してタイトルへ戻る時に呼ばれる */
  onExit: null as (() => void) | null,

  /** 自由行動中のシミュレーションを進める（フィールドシーンから毎フレーム呼ばれる） */
  tick(dt: number): void {
    const s = G.state;
    if (!s || !freeEnd || clockPaused() || document.hidden) return;
    s.simTime += dt;
    const curfew = s.phase === 'curfew';
    const before = clockMinutes(s);
    // 開発版のみ：自由時間の残りを早く減らせる（NPC の行動速度や競技には影響しない）。消灯後は時計を進めない
    if (!curfew) s.phaseLeft = Math.max(0, s.phaseLeft - dt * CLOCK.realRate * (CHANNEL === 'dev' ? G.meta.settings.timeScale || 1 : 1));
    if (!curfew) clockEvents(s, before, clockMinutes(s));
    const hero = s.actors.hero;
    moveActor(s, hero, dt, speedOf('hero'));
    const key = `${hero.pos.room}:${hero.pos.x},${hero.pos.y}`;
    if (key !== lastStepKey) {
      if (lastStepKey && lastStepKey.split(':')[0] === hero.pos.room) Sound.se('step', { gap: 150 });
      lastStepKey = key;
    }
    const events = tickNpcs(s, dt, G.heroBusy || anyModal());
    for (const e of events) onBrainEvent(e);
    G.ui.hudUpdate();
    if (!curfew && s.phaseLeft <= 0) {
      // 締切：会話は切り上げる（成立済みの取引は残る）。確認中の画面は閉じるのを待つ
      const top = topLayer();
      if (top && (top.name === 'talk' || top.name === 'inspect') && top.onCancel) {
        top.onCancel();
        toast(t('clock.cutTalk'), 'info', 2600);
      }
      if (!anyModal()) freeEnd();
    }
  },

  interact(target: Target, quiet = false): void {
    const s = G.state;
    if (!s || !target || !G.fieldActive || anyModal()) return;
    if (target.kind === 'sit') {
      // 椅子に座る（立つ位置へ寄せてから座る。歩き出すと立つ）
      const hero = s.actors.hero;
      const t0 = seatTile(target.seat);
      if (reserveSeat(s, 'hero', hero.pos.room, target.seat.id)) {
        hero.pos = { ...hero.pos, x: t0.x, y: t0.y };
        if (!sitDown(s, 'hero')) standUp(s, 'hero');
      }
    } else if (target.kind === 'stand') {
      standUp(s, 'hero');
    } else if (target.kind === 'bed') {
      void inspect('cell_bed', t('cell.bedText'), 'rest_bed');
    } else if (target.kind === 'npc') {
      void G.ui.talkTo(target.id as NpcId);
    } else if (target.kind === 'door') {
      const d = target.door;
      if (canEnter(s, 'hero', d.to, d.lock)) {
        // 部屋の切り替え：短く暗転して行き先の名前を出し、明けるまで操作を受け付けない。
        // 着いた直後に押しっぱなしの方向で扉へ戻ってしまわないよう、方向キーを一度離すまで扉は反応しない
        const from = s.actors.hero.pos.room;
        const dest = ROOMS[d.to];
        G.heroBusy = true;
        G.doorHold = true;
        Sound.se(d.kind === 'iron' ? 'latch' : 'doorOpen');
        void (async () => {
          try {
            const destName = dest ? roomTitle(s, d.to) : '';
            await fade(true, 170, dest ? `${destName.startsWith(dest.floor) ? '' : dest.floor + '　'}${destName}` : '');
            if (G.state === s && enterDoor(s, s.actors.hero, d)) {
              if (dest?.area === 'secret') s.flags[`visited_${d.to}`] = true;
              // 他人の個室へ入るところは、廊下にいた人に見られることがある
              if (isBedroom(d.to) && ownerOfRoom(s, d.to) && ownerOfRoom(s, d.to) !== 'hero') witnessEntry(s, ownerOf(s, d.to), 'hero', from, rngOf(s));
              lastStepKey = '';
              setFieldBgm();
            }
            await new Promise((r) => setTimeout(r, 260));
            await fade(false, 240);
          } finally {
            G.heroBusy = false;
          }
        })();
      } else if (!quiet && knockable(s, d.to)) {
        void knockAt(d);
      } else {
        // 歩いて扉に触れただけの時は何も出さない（行動ボタンを押した時だけ理由を伝える）
        const why = quiet ? '' : denyReason(s, d.to, d.lock);
        if (why) {
          Sound.se('locked');
          toast(why, 'info', 2200);
        }
      }
    } else {
      void inspect(target.ins.id, target.ins.text, target.ins.event);
    }
  },

  openMenu(): void {
    if (!G.state || anyModal()) return;
    G.ui.openMenu();
  },

  /** 自由時間を切り上げる（残り時間ぶん NPC は行動を続ける） */
  skipFree(): void {
    const s = G.state;
    if (!s || !freeEnd) return;
    if (s.phase !== 'curfew') {
      const before = clockMinutes(s);
      fastForward(s, Math.max(0, s.phaseLeft));
      s.phaseLeft = 0;
      clockEvents(s, before, clockMinutes(s), true);
    }
    freeEnd();
  },

  inFreePhase: () => !!freeEnd,
  save,

  /** 物語イベントを 1 度だけ再生する（裏ルートの画面から使う） */
  story: (id: string) => story(id),

  /** 自分で選んだ結末を記録し、自由時間を終える（結末の処理は step() の側で行う） */
  chooseEnding(id: string): void {
    const s = G.state;
    if (!s) return;
    s.flags.endingChoice = id;
    save();
    freeEnd?.();
  },

  /** 主人公を別の部屋へ移す（保守用の昇降機）。扉と同じ暗転と部屋名を出す */
  async warpHero(room: string): Promise<void> {
    const s = G.state;
    const dest = ROOMS[room];
    if (!s || !dest) return;
    G.heroBusy = true;
    try {
      const destName = roomTitle(s, room);
      await fade(true, 170, `${destName.startsWith(dest.floor) ? '' : dest.floor + '　'}${destName}`);
      placeIn(s, 'hero', room);
      if (dest.area === 'secret') s.flags[`visited_${room}`] = true;
      lastStepKey = '';
      setFieldBgm();
      save();
      await new Promise((r) => setTimeout(r, 260));
      await fade(false, 240);
    } finally {
      G.heroBusy = false;
    }
  },
};

export function save(): void {
  if (G.state) saveGame(G.state);
}

export function phaseName(p: Phase): string {
  return t(`phase.${p}`);
}

/**
 * 他の参加者の個室の扉を叩く。部屋の主が中にいれば、入れてくれるかを相手が決める（信頼、先客、時刻による）。
 * 入れてもらえたら、その場で部屋へ入る。
 */
async function knockAt(d: DoorDef): Promise<void> {
  const s = G.state!;
  const owner = ownerOfRoom(s, d.to);
  if (!owner || owner === 'hero' || G.heroBusy) return;
  const name = shortName(s, owner);
  G.heroBusy = true;
  try {
    Sound.knock();
    await new Promise((r) => setTimeout(r, 900));
    if (G.state !== s) return;
    const o = s.actors[owner];
    if (o.pos.room !== d.to) {
      toast(t('knock.away', { name }), 'info', 2600);
      return;
    }
    const v = visitVerdict(s, 'hero', owner as NpcId, rngOf(s));
    if (!v.accept || !addInvite(s, owner, 'hero')) {
      toast(t(`knock.no.${v.reason === 'ok' ? 'full' : v.reason}`, { name }), 'info', 3200);
      o.talkCd.hero = Math.max(o.talkCd.hero ?? 0, s.simTime + 4000);
      return;
    }
    toast(t('knock.yes', { name }), 'good', 2400);
    // 部屋の主は、客が帰るまで部屋にいる
    o.goal = { kind: 'goto', room: d.to, note: 'host:hero', until: s.simTime + INVITE_TIME };
    o.path = [];
    o.route = [];
  } finally {
    G.heroBusy = false;
  }
  if (G.state === s && canEnter(s, 'hero', d.to, d.lock)) G.interact({ kind: 'door', door: d }, true);
}

function onBrainEvent(e: BrainEvent): void {
  const s = G.state!;
  if (e.type === 'approach' && e.other === 'hero') {
    if (anyModal() || G.heroBusy) return;
    Sound.se('notice');
    void G.ui.talkTo(e.npc, { event: e });
  } else if (e.type === 'invite') {
    if (anyModal() || G.heroBusy) return;
    Sound.se('notice');
    const npc = e.npc;
    const name = shortName(s, npc);
    G.heroBusy = true;
    void choose(t('inviteIn.title', { name }), t('inviteIn.text', { name }), [{ label: t('inviteIn.yes'), value: true, kind: 'primary' }, { label: t('inviteIn.no'), value: false }], { cancel: false, pauses: false }).then((ok) => {
      G.heroBusy = false;
      const a = s.actors[npc];
      if (!ok || !a.alive || !addInvite(s, npc, 'hero')) return;
      observeAttitude(s, npc, 4);
      a.goal = { kind: 'goto', room: homeOf(s, npc), note: 'host:hero', until: s.simTime + INVITE_TIME };
      a.path = [];
      a.route = [];
      setRouteTo(s, a, homeOf(s, npc));
      toast(t('inviteIn.go', { name }), 'info', 3600);
    });
  } else if (e.type === 'knock' && e.other === 'hero') {
    // 自分の個室にいる時に、誰かが訪ねてきた。入れるかどうかは自分で決める
    if (anyModal() || G.heroBusy) return;
    const npc = e.npc;
    const name = shortName(s, npc);
    Sound.knock();
    G.heroBusy = true;
    void choose(t('knockIn.title', { name }), t('knockIn.text', { name }), [{ label: t('knockIn.yes'), value: true, kind: 'primary' }, { label: t('knockIn.no'), value: false }], { cancel: false, pauses: false }).then((ok) => {
      G.heroBusy = false;
      const a = s.actors[npc];
      a.busyUntil = 0;
      if (!ok) {
        adjustRel(s, npc, 'hero', { like: -1 });
        return;
      }
      if (!a.alive || !addInvite(s, 'hero', npc)) return;
      observeAttitude(s, npc, 2);
      a.talkCd.hero = 0;
      a.goal = { kind: 'talk', target: 'hero', until: s.simTime + 60_000 };
    });
  } else if (e.type === 'knock') {
    // 廊下で、誰かが他の人の部屋を訪ねているのが聞こえる
    Sound.knock(0.45);
  } else if (e.type === 'sight' && e.other) {
    G.ui.hudLog(t('log.sawEnter', { a: shortName(s, e.npc), b: shortName(s, e.other) }));
  } else if (e.type === 'followEnd') {
    G.ui.hudLog(t('log.followEnd', { a: shortName(s, e.npc) }));
  } else if (e.type === 'talk' && e.other) {
    G.ui.hudLog(t('log.sawTalk', { a: shortName(s, e.npc), b: shortName(s, e.other) }));
  } else if (e.type === 'deal' && e.other) {
    G.ui.hudLog(t('log.sawDeal', { a: shortName(s, e.npc), b: shortName(s, e.other) }));
  } else if (e.type === 'found' && s.actors[e.npc].pos.room === s.actors.hero.pos.room) {
    G.ui.hudLog(t('log.sawSearch', { a: shortName(s, e.npc) }));
  }
}

/** 場所に応じたフィールド BGM */
export function setFieldBgm(): void {
  const s = G.state;
  if (!s) return;
  const room = ROOMS[s.actors.hero.pos.room];
  let id: BgmId = 'living';
  if (room.area === 'secret') id = 'hidden';
  else if (room.area === 'prison') id = 'prison';
  else if (s.phase === 'strategy' || s.phase === 'rules') id = 'match_main';
  else if (isPrivateRoom(room.id) && !isCell(room.id)) id = 'room';
  else if (room.id === 'living_hallway') id = 'corridor';
  else if (room.id.endsWith('lounge')) id = 'lounge';
  else if (room.area === 'common' || room.area === 'ground') id = 'common';
  // 部屋を移る時は、少し長めに重ねて切り替える
  Sound.bgm(id, 1500);
}

// ---------------- 時計 ----------------

/** 予定の時刻をまたいだ時の通知。同じ通知を 2 度出さない（セーブからの再開でも同じ） */
function clockEvents(s: GameState, before: number, after: number, silent = false): void {
  for (const e of crossed(s.day, before, after, s.flags)) {
    s.flags[e.key] = true;
    if (silent) continue;
    // 自分に関係のない予定は知らせない（監獄棟にいる間の食事など）
    const inPrison = s.actors.hero.house === 'prison';
    if (inPrison && ['dinner', 'bath', 'breakfast'].includes(e.item.key)) continue;
    if (e.item.key === 'prison' && s.actors.hero.house !== 'prison' && e.notice) continue;
    if (e.notice) {
      Sound.se('tick');
      toast(t('clock.notice', { what: t(`sched.${e.item.key}`), n: e.notice }), 'info', 3600);
    } else if (!e.item.hard && t(`sched.at.${e.item.key}`) !== `sched.at.${e.item.key}`) {
      toast(`${fmtClock(e.item.at)}　${t(`sched.at.${e.item.key}`)}`, 'info', 3600);
    }
  }
}

// ---------------- 調査 ----------------

/** 食事で同じ卓を囲める距離（マス）と人数 */
const MEAL_NEAR = 6;
const MEAL_MAX = 4;
const dist = (s: GameState, x: CharId) => { const a = s.actors[x].pos; const b = s.actors.hero.pos; return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); };

async function inspect(id: string, text: string, event?: string): Promise<void> {
  const s = G.state!;
  const hero = s.actors.hero;
  Sound.se('page');
  if (event === 'board') {
    await G.ui.boardScreen();
    // 掲示台の過去の記録（v05 の I04）。裏ルートの条件にはしない
    if (s.day >= 4 && freeEnd) { await story('I04'); s.flags.v04_board_record = true; }
    return;
  }
  // 寝台と机の出来事は、自分に割り当てられた個室でだけ起きる（他人の部屋では眺めるだけ）
  if ((event === 'rest_bed' || event === 'desk_map') && ownerOfRoom(s, hero.pos.room) !== 'hero' && !(id === 'cell_bed' && cellOf(s, 'hero')?.room === hero.pos.room)) event = undefined;
  await G.ui.showInspect(text);
  if (!hero.searched.includes(id)) hero.searched.push(id);
  const clue = event ? CLUE_BY_EVENT[event] : undefined;
  if (clue && !(clue.fromDay && s.day < clue.fromDay) && !(clue.nightOnly && s.phase !== 'night')) {
    if (!s.infos[clue.id]) addInfo(s, { id: clue.id, kind: 'clue', text: clue.text, truth: true, about: [], source: 'world', value: clue.value, tags: clue.tags });
    if (learn(s, 'hero', clue.id, 'self', 1)) {
      fxPop('discovery', t('fx.discovery'));
      toast(t('toast.noted'), 'good');
      Sound.se('bookOpen');
    }
  }
  // 裏ルート（入口の謎、裏ゲーム、昇降機、資料、結末の選択）
  if (event && freeEnd && s.phase !== 'curfew' && await hiddenInspect(event)) return;
  if (event === 'rest_bed' && freeEnd) {
    const sleep = s.phase === 'curfew';
    const ok = await confirmDialog(t(sleep ? 'sleep.title' : 'rest.title'), sleep ? t('sleep.text') : t('rest.text', { time: fmtClock(clockMinutes(s) + s.phaseLeft / 1000) }), { ok: t(sleep ? 'sleep.ok' : 'rest.ok'), cancel: t('common.cancel') });
    if (ok) {
      await fade(true);
      G.skipFree();
      await fade(false);
    }
  } else if (event === 'dining_meal' && freeEnd) {
    // 食事：同じ時間帯に 1 回、その場にいる参加者と少し打ち解ける（日常の交流）
    const key = `meal:${s.day}:${clockMinutes(s) < 15 * 60 ? 'am' : 'pm'}`;
    if (!s.flags[key]) {
      const ok = await confirmDialog(t('meal.title'), t('meal.text'), { ok: t('meal.ok'), cancel: t('common.cancel') });
      if (ok) {
        s.flags[key] = true;
        // 同じ卓を囲むのは、近くにいる人だけ（同じ部屋でも入口や反対の端にいる人は数えない）。囲んだ人は主人公の近くの席へ寄せる
        const near = (x: CharId) => { const p = s.actors[x].pos; return p.room === hero.pos.room && Math.abs(p.x - hero.pos.x) + Math.abs(p.y - hero.pos.y) <= MEAL_NEAR; };
        const mates = aliveIds(s).filter((x) => x !== 'hero' && near(x)).sort((a, b) => dist(s, a) - dist(s, b)).slice(0, MEAL_MAX);
        for (const x of mates) placeIn(s, x, hero.pos.room, { x: hero.pos.x, y: hero.pos.y + 1 });
        for (const x of mates) {
          adjustRel(s, x, 'hero', { like: 3, trust: 1 });
          adjustRel(s, 'hero', x, { like: 3, trust: 1 });
        }
        s.phaseLeft = Math.max(5000, s.phaseLeft - 15000);
        Sound.se('confirm');
        await G.ui.showInspect(mates.length ? t('meal.with', { names: mates.map((x) => shortName(s, x)).join('、'), more: '' }) : t('meal.alone'));
        log(s, t('meal.log'));
      }
    }
  } else if (event === 'sub_games' && freeEnd) {
    await subGamesScreen();
  } else if (event === 'shop') {
    toast(t('toast.notYet'), 'info');
  }
}

// ---------------- 物語 ----------------

function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);
}

/** イベントを 1 度だけ再生する（必須イベントは時計停止） */
async function story(id: string, vars: Record<string, string> = {}, repeat = false, bg?: string): Promise<void> {
  const s = G.state!;
  const ev = STORY[id];
  if (!ev) return;
  const key = repeat ? `${id}@${s.day}` : id;
  if (s.seen.includes(key)) return;
  s.seen.push(key);
  save();
  const v = { player: s.hero.name, ...vars };
  await G.ui.playStory(ev.lines.map((l) => ({ speaker: fill(l.speaker, v), text: fill(l.text, v) })), { bg });
}

// ---------------- フェーズ ----------------

function enter(phase: Phase): void {
  const s = G.state!;
  s.phase = phase;
  s.phaseLeft = 0;
  delete s.flags.phaseKey;
  save();
}

/** フェーズの初期化を 1 度だけ行う（セーブからの再開時は繰り返さない） */
function first(): boolean {
  const s = G.state!;
  const key = `${s.day}:${s.phase}`;
  if (s.flags.phaseKey === key) return false;
  s.flags.phaseKey = key;
  return true;
}

function freePhase(): Promise<void> {
  const s = G.state!;
  G.fieldVisible = true;
  G.fieldActive = true;
  lastStepKey = '';
  clampPhaseLeft(s);
  G.ui.hudShow(true);
  G.ui.hudUpdate();
  setFieldBgm();
  save();
  return new Promise((res) => {
    freeEnd = () => {
      freeEnd = null;
      // 締切：同行と招待を解く（成立済みの取引は残る）
      clearSocial(s);
      G.fieldActive = false;
      s.actors.hero.path = [];
      res();
    };
    // 裏ゲームの途中で閉じていたら、続きから
    void resumeHiddenRun();
  });
}

/** 自由時間。自分で選んだ結末（脱出者など）が決まっていたら、そこで物語を閉じて true */
async function freeOrEnd(): Promise<boolean> {
  await freePhase();
  const s = G.state!;
  if (!s.flags.endingChoice) return false;
  await finish(String(s.flags.endingChoice));
  return true;
}

function showField(v: boolean): void {
  G.fieldVisible = v;
  G.fieldActive = false;
  G.ui.hudShow(false);
}

async function banner(text: string): Promise<void> {
  Sound.se('gong');
  await alertDialog(text, '', t('common.next'), true);
}

async function playAndRank(slot: MatchSlot): Promise<{ ranking: CharId[]; scores: Partial<Record<CharId, number>>; notes: string[] }> {
  const s = G.state!;
  const engine = engineOf(slot.id);
  if (slot.players.includes('hero')) await G.ui.playMatch(slot);
  else runToEnd(s, slot);
  const notes: string[] = [];
  const ranking = await resolveTies(s, engine.ranking(slot.state), (tb) => G.ui.playMatch(tb), (e) => {
    const names = e.players.map((p) => shortName(s, p)).join('・');
    notes.push(e.lottery ? t('tie.lottery', { names }) : t('tie.resolved', { names, order: e.result.map((p) => shortName(s, p)).join(' ＞ ') }));
  });
  return { ranking, scores: engine.scores(slot.state), notes };
}

/** プレイヤーが支払う側の成功報酬：支払うか、踏み倒すか（踏み倒せば相手に記録される） */
async function settleHeroPayments(): Promise<void> {
  const s = G.state!;
  for (const d of s.deals) {
    if (d.status !== 'active' || d.kind !== 'plan' || d.from !== 'hero' || d.paidLater !== false) continue;
    const can = s.actors.hero.pieces >= d.payOnSuccess;
    const pay = can && (await choose(t('pay.title'), t('pay.text', { name: nameOf(s, d.to), n: d.payOnSuccess, plan: d.plan?.label ?? '' }), [
      { label: t('pay.yes', { n: d.payOnSuccess }), value: true, kind: 'primary' },
      { label: t('pay.no'), value: false, kind: 'danger' },
    ]));
    if (pay && transfer(s, 'hero', d.to, d.payOnSuccess, '成功報酬')) {
      d.paidLater = true;
      d.status = 'fulfilled';
      Sound.se('coins');
    } else {
      d.status = 'broken';
      recordBetrayal(s, 'hero', d.to, [d.to], `${nameOf(s, 'hero')}は約束の成功報酬${d.payOnSuccess}ピースを支払わなかった。`, 1, 'nonpayment');
      if (!can) toast(t('pay.cannot'), 'bad');
    }
  }
}

async function finish(endingId: string): Promise<void> {
  const s = G.state!;
  s.ending = endingId;
  s.phase = 'ending';
  save();
  if (!G.meta.endings.includes(endingId)) G.meta.endings.push(endingId);
  saveMeta(G.meta);
  showField(false);
  Sound.bgm(endingId === 'E_BAD' ? 'elimination' : 'ending');
  await G.ui.endingScreen(endingId);
}

/** 1 日の流れを、現在のフェーズから終局まで進める */
export async function runGame(): Promise<void> {
  if (running) return;
  running = true;
  try {
    // v11：競技のルールが全面的に変わった。旧版のセーブで競技が進行中なら、その競技の開始前へ戻す（報酬や支払いは競技後なので重複しない）
    const s0 = G.state;
    if (s0 && s0.flags.rules !== 'v11') {
      const had = !!s0.match;
      s0.match = null;
      s0.flags.rules = 'v11';
      if (had) await alertDialog(t('v11.title'), t('v11.text'), t('common.next'));
    }
    for (;;) {
      const s = G.state;
      if (!s) break;
      if (s.phase !== 'prologue' && s.phase !== 'morning' && s.phase !== 'ending' && !dayPlayable(s.day)) {
        showField(false);
        await alertDialog(t('wip.title'), t('wip.text', { day: s.day }), t('common.toTitle'));
        break;
      }
      if (s.phase === 'ending') {
        showField(false);
        await G.ui.endingScreen(s.ending ?? 'E_BAD');
        break;
      }
      if (s.flags.endingChoice) {
        // 結末を選んだ直後に閉じていた時
        await finish(String(s.flags.endingChoice));
        break;
      }
      const cont = await step(s);
      if (!cont) break;
    }
  } finally {
    running = false;
    freeEnd = null;
    showField(false);
    void fade(false);
    G.state = null;
    G.onExit?.();
  }
}

const dd = (n: number) => String(n).padStart(2, '0');

async function step(s: GameState): Promise<boolean> {
  switch (s.phase) {
    case 'prologue': {
      // 開会式（v11）：中央ホールに 12 人が集まり、進行役が大会の仕組みを段階的に説明する。時計は式が終わってから動き出す
      showField(false);
      Sound.bgm('title');
      await G.ui.ceremony({ skippable: G.meta.ceremonySeen === true });
      if (!G.meta.ceremonySeen) { G.meta.ceremonySeen = true; saveMeta(G.meta); }
      await G.ui.handout();
      enter('morning');
      return true;
    }
    case 'morning': {
      // 2 日目以降：完全版の解放と、実装済みの範囲を確認する
      if (!dayUnlocked(s.day) || !dayPlayable(s.day)) {
        showField(false);
        await fade(false);
      }
      if (!dayUnlocked(s.day)) {
        const ok = await G.ui.purchaseScreen(true);
        if (!ok) return false;
      }
      if (!dayPlayable(s.day)) {
        showField(false);
        await alertDialog(t('wip.title'), t('wip.text', { day: s.day }), t('common.toTitle'));
        return false;
      }
      if (first()) {
        startMorning(s);
        // DAY 1 は開会式の直後。全員が中央ホールから散っていく
        if (s.day === 1) gatherAt(s, 'main_hall');
        s.phaseLeft = phaseDuration('morning');
        log(s, t('log.morning', { day: s.day }), 'day');
      }
      showField(true);
      await fade(false);
      await story(`S${dd(s.day)}A`);
      if (await freeOrEnd()) return false;
      await fade(true);
      enter('rules');
      return true;
    }
    case 'rules': {
      if (first()) gatherAt(s, 'main_arena');
      showField(true);
      Sound.bgm('match_main');
      await fade(false);
      // 進行の声：決勝の日は「最後の戦い」
      if (isFinalDay(s.day)) void announce('final');
      await banner(t('banner.gather'));
      await G.ui.rulesScreen(mainMatchId(s.day), { prison: false });
      enter('main');
      return true;
    }
    case 'strategy': {
      // 旧版の「作戦時間」。v10 で朝の自由行動（11:00 からの競技準備）に統合した。古いセーブはそのまま競技へ進む
      enter('main');
      return true;
    }
    case 'main': {
      showField(false);
      void fade(false);
      Sound.bgm('match_main');
      const id = mainMatchId(s.day);
      if (!s.match || s.match.kind !== 'main' || s.match.day !== s.day) { npcRescuePromises(s); s.match = newSlot(s, id, aliveIds(s), 'main'); }
      const slot = s.match;
      const { ranking, scores, notes } = await playAndRank(slot);
      const engine = engineOf(id);
      settlePlans(s, id, (plan, actor, obs) => engine.checkPlan?.(slot.state, plan, actor, obs) ?? 'unknown');
      const res = applyMainResult(s, ranking, scores);
      s.match = null;
      s.flags.lastNotes = JSON.stringify(notes);
      s.flags.lastRewards = JSON.stringify(res.rewards);
      enter('reward');
      return true;
    }
    case 'reward': {
      showField(false);
      const ranking = s.today.mainRanking ?? [];
      const nPrison = scheduleFor(s.day).prison;
      Sound.se('result');
      if (isFinalDay(s.day)) {
        // 決勝：監獄棟も夜もない。優勝者が決まり、その場で結末へ進む（主人公が負ければ、例外なく敗者の結末）
        const champ = ranking[0];
        await G.ui.rankingScreen({ title: t('rank.finalTitle'), ranking, scores: s.today.mainScores ?? {}, rewards: {}, cut: 0, cutLabel: '', notes: JSON.parse(String(s.flags.lastNotes ?? '[]')), final: true });
        await settleHeroPayments();
        Sound.se('gong');
        // 進行の声：主人公の優勝だけ祝う（負けた時は何も言わない）
        if (champ === 'hero') void announce('champion');
        await alertDialog(t('final.crownTitle'), t('final.crownText', { name: nameOf(s, champ) }), t('common.next'), true);
        await finish(champ === 'hero' ? championEnding(s) : 'E_BAD');
        return false;
      }
      await G.ui.rankingScreen({
        title: t('rank.mainTitle', { day: s.day }),
        ranking,
        scores: s.today.mainScores ?? {},
        rewards: JSON.parse(String(s.flags.lastRewards ?? '{}')),
        cut: nPrison,
        cutLabel: t(medalIssued(s.day) && s.today.rescue?.status !== 'used' && s.today.rescue?.status !== 'forgone' ? 'rank.toPrisonProv' : 'rank.toPrison'),
        notes: JSON.parse(String(s.flags.lastNotes ?? '[]')),
      });
      await G.ui.rescueFlow();
      // 進行の声：監獄棟へ移る人がいる日だけ
      if (nPrison > 0) void announce('prison_transfer');
      await settleHeroPayments();
      await story('S_MAIN_RESULT', {}, true);
      if (first()) moveToHouses(s);
      enter('house');
      return true;
    }
    case 'house': {
      const inPrison = s.actors.hero.house === 'prison';
      if (first()) s.phaseLeft = phaseDuration('house');
      showField(true);
      await fade(false);
      if (!s.seen.includes(`house@${s.day}`)) {
        s.seen.push(`house@${s.day}`);
        await alertDialog(t(inPrison ? 'house.prisonTitle' : 'house.livingTitle'), t(inPrison ? 'house.prisonText' : 'house.livingText'), t('common.next'));
      }
      if (await freeOrEnd()) return false;
      await fade(true);
      enter('prison');
      return true;
    }
    case 'prison': {
      const id = prisonMatchId(s.day);
      const prisoners = aliveIds(s).filter((p) => s.actors[p].house === 'prison');
      if (!id || prisoners.length < 2) {
        enter('night');
        return true;
      }
      const heroIn = prisoners.includes('hero');
      if (!s.match || s.match.kind !== 'prison' || s.match.day !== s.day) {
        // 参加順は当日メインマッチの順位が低い順（全員に同じ規則）
        s.match = newSlot(s, id, prisoners, 'prison');
        if (heroIn) gatherAt(s, 'prison_arena', prisoners);
      }
      if (heroIn) {
        showField(true);
        Sound.bgm('match_prison');
        await fade(false);
        void announce('prison_start');
        await banner(t('banner.prison'));
        await G.ui.rulesScreen(id, { prison: true });
        showField(false);
      } else {
        showField(false);
        await fade(false);
        await banner(t('banner.prisonAway'));
      }
      const slot = s.match;
      const { ranking, scores, notes } = await playAndRank(slot);
      const engine = engineOf(id);
      settlePlans(s, id, (plan, actor, obs) => engine.checkPlan?.(slot.state, plan, actor, obs) ?? 'unknown');
      applyPrisonResult(s, ranking, scores);
      s.match = null;
      s.flags.lastNotes = JSON.stringify(notes);
      enter('elimination');
      return true;
    }
    case 'elimination': {
      showField(false);
      const ranking = s.today.prisonRanking ?? [];
      const out = ranking[ranking.length - 1];
      Sound.se('result');
      await G.ui.rankingScreen({
        title: t('rank.prisonTitle', { day: s.day }),
        ranking,
        scores: s.today.prisonScores ?? {},
        cut: 1,
        cutLabel: t('rank.eliminated'),
        notes: JSON.parse(String(s.flags.lastNotes ?? '[]')),
        prison: true,
      });
      Sound.bgm('elimination');
      await G.ui.eliminationScreen(out);
      if (out === 'hero') {
        // 例外なく終局。救済はしない
        await finish('E_BAD');
        return false;
      }
      await story(`S${dd(s.day)}P`, { eliminated: nameOf(s, out) }, false, 'prison_night');
      enter('night');
      return true;
    }
    case 'night': {
      if (first()) {
        for (const id of aliveIds(s)) {
          s.actors[id].house = null;
          s.actors[id].goal = undefined;
          placeIn(s, id, id === 'hero' ? 'living_hallway' : 'living_lounge');
        }
        s.phaseLeft = phaseDuration('night');
      }
      showField(true);
      await fade(false);
      if (await freeOrEnd()) return false;
      await fade(true);
      enter('curfew');
      return true;
    }
    case 'curfew': {
      // 22:00 消灯：全員が自分の個室へ。寝台で眠ると翌朝 07:00 になる
      if (first()) {
        for (const id of aliveIds(s)) {
          const a = s.actors[id];
          a.house = null;
          a.goal = undefined;
          a.path = [];
          a.route = [];
          a.step = undefined;
          placeIn(s, id, homeOf(s, id));
        }
      }
      showField(true);
      await fade(false);
      if (!s.seen.includes(`curfew@${s.day}`)) {
        s.seen.push(`curfew@${s.day}`);
        Sound.se('phase');
        void announce('curfew');
        // 施錠の音：監獄棟は鉄格子、生活棟は扉
        Sound.se(isCell(homeOf(s, 'hero')) ? 'locked' : 'doorClose');
        await alertDialog(t('curfew.title'), t('curfew.text'), t('common.next'));
      }
      if (await freeOrEnd()) return false;
      await fade(true);
      const notes = endDay(s);
      enter('morning');
      for (const n of notes) toast(n, 'info', 5000);
      // 07:00 起床の合図。監獄棟では鉄格子が開く
      Sound.se('alarm', { volume: 0.7 });
      if (isCell(homeOf(s, 'hero'))) Sound.se('latch', { volume: 0.8 });
      return true;
    }
    default:
      enter('morning');
      return true;
  }
}
