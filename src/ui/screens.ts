/**
 * 画面（DOM）。タイトル、物語の再生、HUD、手帳、結果、終局。
 * ここは表示と入力だけを担当し、勝敗や関係の計算はしない。
 * 手帳には「プレイヤーが知っていること」だけを表示する（NPC の内部値や未発見の情報は出さない）。
 */
import { CORE01, EVIDENCE, LETTERS } from '../story/hiddendata';
import { isPrivateRoom, knockable, roomTitle } from '../world/rooms';
import { CHANNEL, fullUnlocked, Purchase } from '../app/entitlement';
import { ENDINGS, G, phaseName, type RankingView, type StoryLine } from '../app/game';
import { BGM, BGM_CREDITS, Sound } from '../audio/audio';
import { clockMinutes, fmtClock, nextSchedule } from '../core/clock';
import { activeDeals, nameOf, shortName } from '../core/state';
import type { GameState } from '../core/types';
import { DEFAULT_HERO_NAMES, NPC_BY_ID, NPC_IDS, type CharId, type NpcId } from '../data/characters';
import { CONFIG, scheduleFor, type Difficulty } from '../data/config';
import guideJson from '../data/match_guide.json';
import { getLang, LANGS, setLang, t, type Lang } from '../i18n/i18n';
import { CATALOG, isImplemented, MATCHES } from '../matches/registry';
import { TIEBREAK } from '../matches/tiebreak';
import { hasGuide, reviewVoiced, tutorialScreen } from './tutorial';
import { sceneFor } from './scene';
import { VOICED } from './voiceguides';
import { announce } from '../audio/announce';
import { describeDeal } from '../npc/negotiation';
import { attitudeStep } from '../npc/social';
import { deleteSave, exportSave, hasSave, importSave, saveMeta } from '../save/save';
import { canEnter } from '../world/access';
import { ROOMS } from '../world/maps';
import { ceremonyScreen } from './ceremony';
import { renderRelations } from './relations';
import { playVoice, resetVoiceHistory, voiceClip } from '../audio/voice';
import { introLine } from '../core/introduction';
import { bgUrl, bust, emblemUrl, face, fxBanner, icon, logoUrl, portraitUrl, rankMark, setBust, setHeroGender } from './art';
import { alertDialog, append, button, clear, closeLayer, confirmDialog, h, openLayer, panel, toast, type Child, type Layer } from './dom';

const GUIDE = Object.fromEntries((guideJson as { id: string; goal: string; practice: string; attention: string }[]).map((g) => [g.id.toLowerCase(), g]));

/** 音量を変えた時に試し聞きするキャラクター（音源が無ければ無音） */
const VOICE_SAMPLE = 'npc_02_kanzaki';

export const pieces = (n: number): HTMLElement => h('span', { class: 'piece' }, String(n));

// ---------------- タイトル ----------------

export type TitleChoice = 'new' | 'continue' | 'dev';

export function titleScreen(): Promise<TitleChoice> {
  Sound.bgm('title');
  return new Promise((resolve) => {
    let layer: Layer;
    const done = (c: TitleChoice) => {
      closeLayer(layer);
      resolve(c);
    };
    const logo = logoUrl();
    const root = h('div', { class: `title-screen${logo ? ' has-logo' : ''}` });
    const render = () => {
      clear(root);
      const saved = hasSave();
      root.append(
        ...(logo
          ? [h('img', { class: 'title-logo-img', src: logo, alt: 'FALSE CROWN', draggable: false })]
          : [h('img', { class: 'title-emblem', src: emblemUrl(), alt: '', draggable: false }), h('div', { class: 'title-logo' }, 'FALSE CROWN')]),
        h('div', { class: 'title-sub' }, t('title.sub')),
        h('div', { class: 'title-menu' }, [
          saved ? button(t('title.continue'), () => done('continue'), { kind: 'primary', autofocus: true }) : null,
          button(t('title.new'), async () => {
            if (saved && !(await confirmDialog(t('title.newConfirmTitle'), t('title.newConfirm'), { ok: t('title.new'), cancel: t('common.cancel'), danger: true }))) return;
            done('new');
          }, { kind: saved ? 'secondary' : 'primary', autofocus: !saved }),
          button(t('title.settings'), () => void settingsScreen().then(render)),
          button(t('title.howto'), () => void howtoScreen()),
          button(t('title.credits'), () => void creditsScreen()),
          button(t('title.purchase'), () => void purchaseScreen(false)),
          button(t('title.restore'), async () => {
            const ok = await Purchase.restore();
            toast(t(ok ? 'purchase.restored' : fullUnlocked() ? 'purchase.devUnlocked' : 'purchase.none'), ok ? 'good' : 'info', 4200);
          }),
          button(`${t('title.language')}：${LANGS.find((l) => l.id === getLang())?.name}`, () => {
            const i = LANGS.findIndex((l) => l.id === getLang());
            applyLang(LANGS[(i + 1) % LANGS.length].id);
            render();
          }),
          CHANNEL === 'dev' ? button(t('title.dev'), () => done('dev'), { kind: 'ghost' }) : null,
        ]),
        h('div', { class: 'title-foot' }, `${t(CHANNEL === 'dev' ? 'title.devBuild' : 'title.productBuild')}　v${__APP_VERSION__}`),
      );
    };
    render();
    layer = openLayer(root, { name: 'title' });
  });
}

function applyLang(l: Lang): void {
  setLang(l);
  G.meta.settings.lang = l;
  saveMeta(G.meta);
}

export function newGameScreen(): Promise<{ gender: 'm' | 'f'; name: string; difficulty: Difficulty } | null> {
  return new Promise((resolve) => {
    let layer: Layer;
    let gender: 'm' | 'f' = 'm';
    let difficulty: Difficulty = G.meta.settings.difficulty;
    const nameInput = h('input', { type: 'text', maxLength: 12, value: DEFAULT_HERO_NAMES.m, class: 'text-input' });
    const body = h('div', { class: 'newgame' });
    const done = (ok: boolean) => {
      closeLayer(layer);
      if (!ok) return resolve(null);
      G.meta.settings.difficulty = difficulty;
      saveMeta(G.meta);
      resolve({ gender, name: nameInput.value.trim() || DEFAULT_HERO_NAMES[gender], difficulty });
    };
    const render = () => {
      clear(body);
      body.append(
        h('div', { class: 'row', style: 'gap:18px;align-items:stretch' }, (['m', 'f'] as const).map((g) =>
          h('button', { class: `hero-pick${gender === g ? ' selected' : ''}`, type: 'button', onclick: () => {
            if (nameInput.value === DEFAULT_HERO_NAMES[gender]) nameInput.value = DEFAULT_HERO_NAMES[g];
            gender = g;
            Sound.se('select');
            render();
          } }, bust(`hero_${g}`), h('span', null, t(g === 'm' ? 'new.male' : 'new.female'))),
        ), h('div', { class: 'col grow', style: 'gap:14px' }, [
          h('div', { class: 'form-grid' }, [
            h('label', null, t('new.name')), nameInput,
            h('label', null, t('new.difficulty')),
            h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, (Object.keys(CONFIG.difficulty) as Difficulty[]).map((d) => button(t(`diff.${d}`), () => { difficulty = d; render(); }, { small: true, cls: difficulty === d ? 'selected' : '' }))),
          ]),
          h('div', { class: 'note-box' }, t(`diff.${difficulty}.desc`)),
          h('div', { class: 'note-box' }, t('new.notice')),
        ])),
      );
    };
    render();
    layer = openLayer(h('div', { class: 'overlay solid' }, panel(t('new.title'), body, { wide: true, footer: [button(t('common.back'), () => done(false), { kind: 'ghost' }), button(t('new.start'), () => done(true), { kind: 'primary', autofocus: true })] })), { onCancel: () => done(false), name: 'newgame' });
  });
}

// ---------------- 物語・台詞 ----------------

function speakerName(s: GameState | null, sp: string): string {
  if (sp === 'narrator') return '';
  if (sp === 'host_observer' || sp === 'host') return t('name.host');
  if (sp === 'hero') return s?.hero.name ?? '';
  if (sp in NPC_BY_ID) return NPC_BY_ID[sp as NpcId].name;
  return sp;
}

/** 台詞を順に表示する。スキップは演出だけを飛ばす（フラグや結果には影響しない） */
export function playStory(lines: StoryLine[], opts: { bg?: string; expr?: string } = {}): Promise<void> {
  if (!lines.length) return Promise.resolve();
  return new Promise((resolve) => {
    let layer: Layer;
    let i = 0;
    const s = G.state;
    const portrait = h('div', { class: 'bust dlg-portrait right' });
    const name = h('div', { class: 'dlg-name' });
    const text = h('div', { class: 'dlg-text' });
    const done = () => {
      closeLayer(layer);
      resolve();
    };
    const show = () => {
      const l = lines[i];
      const who = speakerName(s, l.speaker);
      const hasPortrait = l.speaker !== 'narrator' && (l.speaker === 'host_observer' || l.speaker === 'hero' || l.speaker in NPC_BY_ID);
      portrait.style.display = hasPortrait ? '' : 'none';
      if (hasPortrait) setBust(portrait, l.speaker, opts.expr ?? 'normal');
      name.style.display = who ? '' : 'none';
      name.textContent = who;
      text.className = `dlg-text${l.speaker === 'narrator' ? ' narration' : ''}`;
      text.textContent = l.text;
    };
    const next = () => {
      Sound.se('click');
      i += 1;
      if (i >= lines.length) done();
      else show();
    };
    const box = h('div', { class: 'dlg-box', onclick: next, 'data-focus': '', tabIndex: 0 }, name, text, h('div', { class: 'dlg-next' }, '▼'));
    const bg = opts.bg ? bgUrl(opts.bg) : null;
    const el = h('div', { class: `overlay ${bg ? 'solid story-bg' : G.fieldVisible ? 'clear' : 'solid'} dlg-screen`, style: bg ? `background-image:url("${bg}")` : '' }, portrait, box, lines.length > 1 ? h('div', { class: 'dlg-skip' }, button(t('common.skip'), done, { small: true, kind: 'ghost' })) : null);
    show();
    layer = openLayer(el, { pausesClock: true, name: 'story', onCancel: next, onKey: (k) => (k === 'a' ? (next(), true) : false) });
  });
}

export function showInspect(text: string): Promise<void> {
  return new Promise((resolve) => {
    let layer: Layer;
    const done = () => {
      closeLayer(layer);
      resolve();
    };
    const box = h('div', { class: 'dlg-box', onclick: done }, h('div', { class: 'dlg-text narration' }, text), h('div', { class: 'dlg-next' }, '▼'));
    layer = openLayer(h('div', { class: 'overlay clear dlg-screen' }, box), { pausesClock: false, name: 'inspect', onCancel: done, onKey: (k) => (k === 'a' ? (done(), true) : false) });
  });
}

// ---------------- HUD ----------------

let hudLayer: Layer | null = null;
let hudEls: { day: HTMLElement; phase: HTMLElement; timer: HTMLElement; room: HTMLElement; pieces: HTMLElement; prompt: HTMLElement; log: HTMLElement; skip: HTMLElement; act: HTMLElement } | null = null;
let lastTick = -1;

export function hudShow(v: boolean): void {
  if (!v) {
    if (hudLayer) closeLayer(hudLayer);
    hudLayer = null;
    hudEls = null;
    return;
  }
  if (hudLayer) return;
  const day = h('span', { class: 'hud-day' });
  const phase = h('span', { class: 'hud-phase' });
  const timer = h('span', { class: 'hud-timer' });
  const room = h('span', { class: 'hud-room' });
  const pc = h('span', { class: 'piece' });
  const prompt = h('div', { class: 'prompt', style: 'display:none' });
  const logBox = h('div', { class: 'hud-log' });
  const skip = button(t('hud.skip'), async () => {
    if (await confirmDialog(t('hud.skipTitle'), t('hud.skipText'), { ok: t('hud.skipOk'), cancel: t('common.cancel') })) G.skipFree();
  }, { small: true, kind: 'ghost' });
  const pad = h('div', { class: 'touch-pad' }, (['up', 'down', 'left', 'right'] as const).map((d) => h('button', { class: d, type: 'button', 'data-key': d, 'aria-label': d }, { up: '▲', down: '▼', left: '◀', right: '▶' }[d])));
  const actBtn = h('button', { type: 'button', 'data-key': 'a' }, h('span', { class: 'act-label' }, ''));
  const act = h('div', { class: 'touch-act' }, actBtn);
  const el = h('div', null,
    h('div', { class: 'hud' },
      h('div', { class: 'hud-band' },
        h('div', { class: 'hud-cell' }, day, icon('timer'), timer, pc),
        h('div', { class: 'hud-cell' }, phase),
        h('div', { class: 'hud-cell' }, icon('map'), room),
        h('div', { class: 'hud-cell fill hud-menu' }, skip, button([icon('notebook'), t('hud.menu')], () => G.openMenu(), { small: true })),
      ),
    ),
    logBox, prompt, pad, act,
  );
  hudLayer = openLayer(el, { modal: false, name: 'hud' });
  hudEls = { day, phase, timer, room, pieces: pc, prompt, log: logBox, skip, act: actBtn };
  hudUpdate();
}

export function hudUpdate(): void {
  const s = G.state;
  if (!s || !hudEls) return;
  const e = hudEls;
  e.day.textContent = `DAY ${s.day}`;
  const free = G.inFreePhase();
  const curfew = s.phase === 'curfew';
  // ゲーム内時刻と、次の予定までの時間（v10）
  e.timer.textContent = fmtClock(clockMinutes(s));
  const next = curfew ? null : nextSchedule(s);
  e.phase.textContent = curfew ? t('sched.sleepHint') : next ? t('hud.next', { what: t(`sched.${next.item.key}`), at: fmtClock(next.item.at), n: next.inMin }) : '';
  const low = free && !curfew && !!next?.item.hard && next.inMin <= 10;
  e.timer.classList.toggle('low', low);
  e.phase.classList.toggle('low', low);
  const sec = next?.inMin ?? -1;
  if (low && sec !== lastTick && sec <= 5 && sec > 0) Sound.se('tick');
  lastTick = sec;
  e.room.textContent = `${ROOMS[s.actors.hero.pos.room].floor}　${roomTitle(s, s.actors.hero.pos.room)}`;
  e.pieces.textContent = String(s.actors.hero.pieces);
  e.skip.style.display = free && !curfew ? '' : 'none';
  const tg = G.fieldActive ? G.field?.target : null;
  // 行動ボタンの文字は、いまできることを 1 語だけ出す（何もなければ空）
  const actLabel = !tg ? '' : tg.kind === 'npc' ? t('act.talk') : tg.kind === 'door' ? t(knockable(s, tg.door.to) ? 'act.knock' : 'act.enter') : tg.kind === 'inspect' ? t('act.inspect') : t(`act.${tg.kind}`);
  const al = e.act.firstElementChild as HTMLElement;
  if (al.textContent !== actLabel) al.textContent = actLabel;
  e.act.classList.toggle('idle', !tg);
  if (tg) {
    const label = tg.kind === 'npc' ? t('prompt.talk', { name: shortName(s, tg.id) }) : tg.kind === 'door' ? t('prompt.door', { name: isPrivateRoom(tg.door.to) ? roomTitle(s, tg.door.to) : tg.door.label }) : tg.kind === 'inspect' ? t('prompt.inspect') : t(`prompt.${tg.kind}`);
    if (e.prompt.dataset.label !== label) {
      e.prompt.dataset.label = label;
      clear(e.prompt);
      append(e.prompt, [icon(tg.kind === 'npc' ? 'rumor' : tg.kind === 'door' ? 'unlock' : 'search'), label]);
    }
    e.prompt.style.display = '';
  } else e.prompt.style.display = 'none';
}

export function hudLog(text: string): void {
  if (!hudEls) return;
  const d = h('div', null, text);
  hudEls.log.appendChild(d);
  while (hudEls.log.children.length > 4) hudEls.log.firstChild?.remove();
  setTimeout(() => d.remove(), 6000);
}

// ---------------- 手帳（メニュー） ----------------

type Tab = 'status' | 'relations' | 'people' | 'deals' | 'info' | 'files' | 'history' | 'rules' | 'map' | 'system';

const TAB_ICONS: Record<Tab, string> = { status: 'rank', relations: 'alliance', people: 'participant_list', deals: 'contract', info: 'evidence', files: 'document', history: 'document', rules: 'help', map: 'map', system: 'settings' };

export function openMenu(initial: Tab = 'status'): void {
  const s = G.state;
  if (!s) return;
  Sound.se('bookOpen');
  let tab: Tab = initial;
  let layer: Layer;
  const body = h('div', { class: 'scroll grow' });
  const tabs = h('div', { class: 'tabs' });
  const close = () => {
    Sound.se('bookClose');
    closeLayer(layer);
  };
  const render = () => {
    clear(tabs);
    // 「資料」の欄は、裏ルートで何か手に入れてから出す（序盤から匂わせない）
    const hasFiles = Object.values(s.actors.hero.items).some((n) => n > 0);
    for (const k of ['status', 'relations', 'people', 'deals', 'info', ...(hasFiles ? ['files'] : []), 'history', 'rules', 'map', 'system'] as Tab[]) {
      tabs.append(h('button', { class: `tab${tab === k ? ' on' : ''}`, type: 'button', onclick: () => { tab = k; Sound.se('page'); render(); } }, icon(TAB_ICONS[k]), t(`menu.${k}`)));
    }
    clear(body);
    append(body, renderTab(s, tab, close, render));
  };
  render();
  const el = h('div', { class: 'overlay' }, h('div', { class: 'panel book' }, h('div', { class: 'panel-title row' }, icon('notebook'), t('menu.title'), h('div', { class: 'spacer' }), button([icon('close'), t('common.close')], close, { small: true, kind: 'ghost' })), h('div', { class: 'panel-body col', style: 'gap:10px' }, tabs, body)));
  layer = openLayer(el, { pausesClock: true, onCancel: close, name: 'menu' });
}

function renderTab(s: GameState, tab: Tab, close: () => void, rerender: () => void): Child[] {
  const hero = s.actors.hero;
  switch (tab) {
    case 'status': {
      const sch = scheduleFor(s.day);
      const alive = Object.values(s.actors).filter((a) => a.alive);
      const main = CATALOG.find((c) => c.id === sch.main);
      return [
        h('div', { class: 'row', style: 'gap:16px;align-items:flex-start' },
          face('hero', 'lg'),
          h('div', { class: 'col grow', style: 'gap:6px' },
            h('div', { class: 'gold', style: 'font-size:1.2em' }, s.hero.name),
            h('div', null, `DAY ${s.day}　${phaseName(s.phase)}`),
            h('div', null, t('status.pieces'), '　', pieces(hero.pieces)),
            h('div', null, t('status.house'), '　', t(hero.house === 'prison' ? 'house.prison' : hero.house === 'living' ? 'house.living' : 'house.none')),
            h('div', null, t('status.alive', { n: alive.length })),
            h('div', null, t('status.today', { name: main?.name ?? '', n: sch.prison })),
            h('div', { class: 'dim small' }, t('status.rule')),
          ),
        ),
        h('h4', { class: 'gold' }, t('status.log')),
        ...s.log.slice(-14).reverse().map((l) => h('div', { class: 'logline' }, `DAY${l.day}　${l.text}`)),
      ];
    }
    case 'relations':
      return renderRelations(s, rerender);
    case 'people': {
      return [h('div', { class: 'dim small' }, t('people.note')), ...NPC_IDS.map((id) => {
        const a = s.actors[id];
        const def = NPC_BY_ID[id];
        const met = !!s.flags[`heroMet_${id}`];
        const deals = activeDeals(s, 'hero', id);
        if (!a.alive) {
          // 脱落者は状態だけを残す
          return h('div', { class: 'entry row rel-out', style: 'gap:12px;align-items:center' }, face(id), h('b', null, def.name), h('span', { class: 'tag' }, t('people.out', { day: a.eliminatedDay ?? 0 })));
        }
        // 推定の好意：主人公が観測した会話と行動だけから動く（本当の値ではない）
        const step = attitudeStep(s, id);
        const gaugeEl = h('div', { class: 'rel-gauge', title: t('people.estimate') }, h('small', null, t('people.estimate')),
          step === 0 ? h('span', { class: 'dim small' }, t('people.unknown')) : h('span', { class: `rel-steps s${step}` }, [1, 2, 3, 4, 5].map((n) => h('i', { class: n <= step ? 'on' : '' }))),
          step === 0 ? null : h('small', { class: 'dim' }, t(`people.step${step}`)));
        // この人物について知っていること：自分で確認した事実と、伝聞や推測を分ける
        const about = Object.entries(hero.knows).map(([k, kn]) => ({ info: s.infos[k], kn })).filter((x) => x.info && x.info.about.includes(id) && x.info.kind !== 'profile' && x.info.kind !== 'result' && x.info.kind !== 'clue');
        const facts = about.filter((x) => x.kn.from === 'self' && x.kn.conf >= 0.9 && !x.info.tags.includes('sighting'));
        const sights = about.filter((x) => x.info.tags.includes('sighting'));
        const rumors = about.filter((x) => !facts.includes(x) && !sights.includes(x));
        const lines = (list: typeof about, cls: string, label: string) => list.slice(-3).map((x) => h('div', { class: 'small rel-line' }, h('span', { class: `tag ${cls}` }, label), ' ', x.info.text));
        return h('div', { class: 'entry row', style: 'gap:12px;align-items:flex-start' }, face(id), gaugeEl,
          h('div', { class: 'col grow', style: 'gap:2px' },
            h('div', null, h('b', null, def.name), '　', h('span', { class: 'dim small' }, met ? `${def.age}${t('people.age')}・${def.job}` : t('people.unmet')),
              a.alive ? (a.house ? h('span', { class: `tag ${a.house === 'living' ? 'living' : ''}` }, t(a.house === 'prison' ? 'house.prison' : 'house.living')) : null) : h('span', { class: 'tag' }, t('people.out', { day: a.eliminatedDay ?? 0 }))),
            met ? h('div', { class: 'small' }, def.profile) : null,
            s.flags[`introHeard_${id}`] ? introRow(id) : null,
            a.alive ? h('div', { class: 'small dim' }, t('people.pieces'), ' ', String(a.pieces)) : null,
            ...deals.map((d) => h('div', { class: 'small gold' }, describeDeal(s, d))),
            ...lines(facts, 'fact', t('people.fact')), ...lines(sights, '', t('people.sight')), ...lines(rumors, '', t('people.rumor')),
          ));
      })];
    }
    case 'deals': {
      const mine = s.deals.filter((d) => d.from === 'hero' || d.to === 'hero');
      if (!mine.length) return [h('div', { class: 'dim' }, t('deals.none'))];
      return mine.slice().reverse().map((d) => h('div', { class: 'entry' }, h('span', { class: `tag ${d.status === 'active' ? 'fact' : ''}` }, t(`deal.status.${d.status}`)), ' ', `DAY${d.day}　`, describeDeal(s, d)));
    }
    case 'info': {
      const list = Object.entries(hero.knows).map(([id, k]) => ({ info: s.infos[id], k })).filter((x) => x.info && x.info.kind !== 'result').sort((a, b) => b.k.day - a.k.day);
      if (!list.length) return [h('div', { class: 'dim' }, t('info.none'))];
      return [h('div', { class: 'dim small' }, t('info.note')), ...list.map(({ info, k }) => h('div', { class: 'entry' },
        h('span', { class: `tag ${k.from === 'self' || k.from === 'public' ? 'fact' : ''}` }, k.from === 'self' ? t('info.self') : k.from === 'public' ? t('info.public') : t('info.heard', { name: shortName(s, k.from) })),
        ' ', `DAY${k.day}　`, info.text))];
    }
    case 'history': {
      const out: Child[] = [];
      for (const b of s.board.slice().reverse()) out.push(h('div', { class: 'entry' }, b.text));
      for (const r of s.history.slice().reverse()) {
        out.push(h('div', { class: 'entry' }, h('b', { class: 'gold' }, `DAY ${r.day}`), h('div', { class: 'small' }, t('history.main'), '：', r.mainRanking.map((id, i) => `${i + 1}.${shortName(s, id)}(${r.mainScores[id] ?? 0})`).join('　')),
          r.prisonRanking.length ? h('div', { class: 'small' }, t('history.prison'), '：', r.prisonRanking.map((id, i) => `${i + 1}.${shortName(s, id)}(${r.prisonScores[id] ?? 0})`).join('　')) : null));
      }
      return out.length ? out : [h('div', { class: 'dim' }, t('history.none'))];
    }
    case 'rules': {
      // 今日の競技を先に、そのあと前の日の競技（いつでも見直せるように）
      const days = Array.from({ length: s.day }, (_, i) => scheduleFor(s.day - i));
      const ids = [...new Set(days.flatMap((sch) => [sch.main, sch.prisonGame] as (string | null)[]))].filter((x): x is string => !!x && isImplemented(x));
      return [button([icon('help'), t('rules.ceremony')], () => void ceremonyScreen({ review: true }), { small: true }), h('div', { class: 'text' }, t('rules.core')), ...ids.map((id) => h('div', { class: 'entry' }, h('div', { class: 'row', style: 'gap:10px;align-items:center' }, h('b', { class: 'gold grow' }, `${id.toUpperCase()}　${MATCHES[id].name}`),
        // いつでも説明を見直せる（音声付きの説明は声つき、それ以外は図と練習）
        hasGuide(id) ? button([icon('help'), t('rules.replayTut')], () => void (reviewVoiced(id, sceneFor(id)) ?? tutorialScreen(id, { scene: sceneFor(id) })), { small: true, cls: 'nb-tut' }) : null), ...MATCHES[id].rules.map((r) => h('div', { class: 'small', style: 'margin-top:4px' }, `・${r}`)))),
        h('div', { class: 'entry' }, h('b', { class: 'gold' }, TIEBREAK.name), ...TIEBREAK.rules.map((r) => h('div', { class: 'small', style: 'margin-top:4px' }, `・${r}`)))];
    }
    case 'files': {
      // 裏ルートで手に入れた持ち物、手紙、資料。持っているものだけ、文を読み返せる
      const has = (id: string) => (hero.items[id] ?? 0) > 0;
      const sec = (title: string, rows: Child[]) => (rows.length ? h('div', { class: 'entry' }, h('b', { class: 'gold' }, title), ...rows) : null);
      const keys = ['KEY_MIRROR', 'KEY_SERVICE', 'RELEASE_AUTH', 'DOC_CROWN'].filter(has).map((id) => h('div', { class: 'small', style: 'margin-top:4px' }, `・${t(`item.${id}`)}`));
      const letters = LETTERS.filter((l) => has(l.id)).map((l) => h('div', { class: 'small', style: 'margin-top:6px' }, h('b', null, l.title), '　', l.text));
      const ev = EVIDENCE.filter((e) => has(e.id)).map((e) => h('div', { class: 'small', style: 'margin-top:6px' }, h('b', null, e.subject), '　', e.text));
      const docs = has('CORE01') ? [h('div', { class: 'small', style: 'margin-top:6px' }, h('b', null, t('item.CORE01')), '　', CORE01)] : [];
      const out = [sec(t('files.sec.keys'), keys), sec(t('files.sec.letters'), letters), sec(t('files.sec.evidence'), ev), sec(t('files.sec.docs'), docs)].filter(Boolean) as Child[];
      return out.length ? out : [h('div', { class: 'dim' }, t('files.empty'))];
    }
    case 'map': {
      // 立ち入ったことのある部屋と、通常の案内図にある部屋だけを表示する（隠し区画は発見するまで載せない）
      const floors = ['3F', '2F', '1F', 'B1', 'B2'] as const;
      return floors.map((f) => {
        const rooms = Object.values(ROOMS).filter((r) => r.floor === f && !isPrivateRoom(r.id) && (r.area !== 'secret' || !!s.flags[`visited_${r.id}`]));
        if (!rooms.length) return null;
        return h('div', { class: 'map-floor' }, h('b', null, f), h('div', { class: 'map-rooms' }, rooms.map((r) => {
          const here = hero.pos.room === r.id;
          const ok = canEnter(s, 'hero', r.id);
          const n = Object.values(s.actors).filter((a) => a.alive && a.id !== 'hero' && a.pos.room === r.id && here).length;
          return h('div', { class: `map-room${here ? ' here' : ''}${ok ? '' : ' locked'}` }, r.name, here ? h('small', null, t('map.here', { n })) : !ok ? h('small', null, t('map.locked')) : null);
        })));
      });
    }
    case 'system':
      return [settingsBody(rerender), h('div', { class: 'row', style: 'gap:10px;margin-top:14px;flex-wrap:wrap' },
        button(t('system.save'), () => { G.save(); toast(t('system.saved'), 'good'); }),
        button(t('system.toTitle'), async () => {
          if (await confirmDialog(t('system.toTitle'), t('system.toTitleText'), { ok: t('system.toTitle'), cancel: t('common.cancel') })) {
            G.save();
            close();
            location.reload();
          }
        }, { kind: 'danger' }),
      ), h('div', { class: 'dim small', style: 'margin-top:12px' }, t('system.perf', { v: __APP_VERSION__, fps: Math.round(G.perf.fps), slow: G.perf.slow, w: G.perf.w, h: G.perf.h, sw: Math.round(window.innerWidth), sh: Math.round(window.innerHeight) }))];
  }
}

// ---------------- 設定・遊び方・クレジット ----------------

function slider(label: string, value: number, onChange: (v: number) => void): HTMLElement[] {
  const out = h('b', null, `${Math.round(value * 100)}`);
  const input = h('input', { type: 'range', min: '0', max: '100', step: '5', value: String(Math.round(value * 100)), class: 'slider' });
  input.addEventListener('input', () => {
    out.textContent = input.value;
    onChange(Number(input.value) / 100);
  });
  return [h('label', null, label), h('div', { class: 'row', style: 'gap:12px' }, input, out)];
}

function settingsBody(rerender: () => void): HTMLElement {
  const st = G.meta.settings;
  const commit = () => {
    saveMeta(G.meta);
    Sound.setVolumes(st.bgm, st.se, st.voice);
    document.documentElement.style.setProperty('--text-scale', String(st.textScale));
  };
  return h('div', { class: 'form-grid' }, [
    ...slider(t('set.bgm'), st.bgm, (v) => { st.bgm = v; commit(); }),
    ...slider(t('set.se'), st.se, (v) => { st.se = v; commit(); Sound.se('confirm'); }),
    ...slider(t('set.voice'), st.voice, (v) => { st.voice = v; commit(); resetVoiceHistory(); playVoice(VOICE_SAMPLE, 'hello'); }),
    h('label', null, t('set.text')),
    h('div', { class: 'row', style: 'gap:6px' }, [0.9, 1, 1.15, 1.3].map((v) => button(t(`set.text.${v}`), () => { st.textScale = v; commit(); rerender(); }, { small: true, cls: st.textScale === v ? 'selected' : '' }))),
    h('label', null, t('title.language')),
    h('div', { class: 'row', style: 'gap:6px' }, LANGS.map((l) => button(l.name, () => { applyLang(l.id); rerender(); }, { small: true, cls: getLang() === l.id ? 'selected' : '' }))),
    h('label', null, t('set.data')),
    h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, [
      button(t('set.export'), async () => {
        const raw = exportSave();
        if (!raw) return toast(t('set.noSave'), 'info');
        try {
          await navigator.clipboard.writeText(raw);
          toast(t('set.exported'), 'good');
        } catch {
          await alertDialog(t('set.export'), h('textarea', { class: 'text-input', style: 'width:100%;height:160px', readOnly: true }, raw));
        }
      }, { small: true }),
      button(t('set.import'), async () => {
        const ta = h('textarea', { class: 'text-input', style: 'width:100%;height:160px', placeholder: t('set.importHint') });
        if (!(await confirmDialog(t('set.import'), ta, { ok: t('set.import'), cancel: t('common.cancel') }))) return;
        const r = importSave(ta.value.trim());
        toast(r.ok ? t('set.imported') : `${t('set.importFail')} ${r.error ?? ''}`, r.ok ? 'good' : 'bad');
      }, { small: true }),
    ]),
  ]);
}

export function settingsScreen(): Promise<void> {
  return new Promise((resolve) => {
    let layer: Layer;
    const body = h('div');
    const render = () => {
      clear(body);
      body.append(settingsBody(render));
    };
    const done = () => {
      closeLayer(layer);
      resolve();
    };
    render();
    layer = openLayer(h('div', { class: 'overlay' }, panel(t('title.settings'), body, { wide: true, footer: button(t('common.close'), done, { kind: 'primary', autofocus: true }) })), { onCancel: done, pausesClock: true, name: 'settings' });
  });
}

export function howtoScreen(): Promise<void> {
  const items = ['move', 'talk', 'deal', 'note', 'flow', 'time'];
  return alertDialog(t('title.howto'), h('div', { class: 'col', style: 'gap:8px' }, items.map((k) => h('div', { class: 'entry' }, h('b', { class: 'gold' }, t(`howto.${k}.h`)), h('div', { class: 'small' }, t(`howto.${k}`))))), t('common.close'));
}

/** 手帳：自己紹介で本人が話した言葉（公開の情報だけ）。声があれば聞き直せる */
function introRow(id: NpcId): HTMLElement {
  const l = introLine(G.state!, id, (who) => voiceClip(who, 'introduction'));
  const v = l.voice;
  return h('div', { class: 'small rel-line intro-note' }, h('span', { class: 'tag fact' }, t('people.intro')), ' ', `「${l.text}」`,
    v ? button(`♪ ${t('people.replay')}`, () => Sound.voice(v.url, v.gain, { duck: true }), { small: true, kind: 'ghost', cls: 'intro-replay' }) : null);
}

export function creditsScreen(): Promise<void> {
  return alertDialog(t('title.credits'), h('div', { class: 'col small', style: 'gap:8px' }, [
    h('div', null, h('b', { class: 'gold' }, t('credits.bgm')), ...Object.entries(BGM_CREDITS).map(([key, c]) => { const titles = [...new Set(Object.values(BGM).filter((b) => b.file && b.by === key).map((b) => b.title))]; if (!titles.length) return null;
      // 曲ごとの表記を求める配布元（Kevin MacLeod）は、曲名ごとに決まった形で並べる
      if (c.perTitle) return h('div', { style: 'margin-top:4px' }, ...titles.map((ti) => h('div', null, c.perTitle!.replace('{title}', ti))), ...c.license.split('\n').map((x) => h('div', { class: 'dim' }, x)));
      return h('div', { style: 'margin-top:4px' }, h('div', null, `${c.name}（${c.url}）`), h('div', { class: 'dim' }, titles.join(' / ')), h('div', { class: 'dim' }, c.license)); })),
    h('div', null, h('b', { class: 'gold' }, t('credits.se')), h('div', null, 'Kenney（https://kenney.nl/）— Casino Audio / Interface Sounds / RPG Audio'), h('div', { class: 'dim' }, t('credits.seLicense'))),
    h('div', null, h('b', { class: 'gold' }, t('credits.voice')), h('div', null, t('credits.voiceBy')), h('div', { class: 'dim' }, t('credits.voiceNote'))),
    h('div', null, h('b', { class: 'gold' }, t('credits.engine')), h('div', null, 'Phaser 4 (MIT) / Vite / TypeScript')),
    h('div', { class: 'dim' }, t('credits.note')),
  ]), t('common.close'));
}

/** 完全版の案内。決済は未実装のため、購入できるようになるまでは案内だけを表示する（価格は未確定） */
export function purchaseScreen(afterDay: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    let layer: Layer;
    const done = (v: boolean) => {
      closeLayer(layer);
      resolve(v);
    };
    const unlocked = fullUnlocked();
    const body = h('div', { class: 'col', style: 'gap:10px' }, [
      h('div', { class: 'text' }, t(afterDay ? 'purchase.afterDay' : 'purchase.lead')),
      h('div', { class: 'note-box' }, ['p1', 'p2', 'p3', 'p4'].map((k) => h('div', null, `・${t(`purchase.${k}`)}`))),
      h('div', { class: 'gold' }, t(unlocked ? (CHANNEL === 'dev' ? 'purchase.devUnlocked' : 'purchase.owned') : Purchase.available() ? 'purchase.ready' : 'purchase.soon')),
    ]);
    const buy = button(t('purchase.buy'), async () => {
      const ok = await Purchase.purchase();
      if (ok) {
        toast(t('purchase.thanks'), 'good');
        done(true);
      } else toast(t('purchase.soon'), 'info');
    }, { kind: 'primary', disabled: unlocked || !Purchase.available() });
    const restore = button(t('title.restore'), async () => {
      if (await Purchase.restore()) done(true);
      else toast(t('purchase.none'), 'info');
    }, { disabled: unlocked });
    layer = openLayer(h('div', { class: 'overlay solid' }, panel(t('purchase.title'), body, { footer: [button(t(afterDay && !unlocked ? 'common.toTitle' : 'common.close'), () => done(unlocked), { kind: 'ghost' }), restore, buy] })), { onCancel: () => done(unlocked), pausesClock: true, name: 'purchase' });
  });
}

// ---------------- 競技説明・結果 ----------------

export function rulesScreen(matchId: string, opts: { prison: boolean }): Promise<void> {
  // v11 の競技は、図と練習で段階的に説明する
  // 音声付きの説明がある競技は、説明の声が最初に名前を言うので重ねない
  if (!(matchId in VOICED)) announce('rules');
  if (hasGuide(matchId)) return tutorialScreen(matchId, { cutNote: t(opts.prison ? 'rules.prisonCut' : 'rules.mainCut', { n: scheduleFor(G.state?.day ?? 1).prison }), scene: sceneFor(matchId) });
  const eng = MATCHES[matchId];
  const g = GUIDE[matchId];
  return new Promise((resolve) => {
    let layer: Layer;
    const done = () => {
      closeLayer(layer);
      resolve();
    };
    const body = h('div', { class: 'col', style: 'gap:8px' }, [
      h('div', { class: 'row', style: 'gap:14px;align-items:flex-start' }, h('img', { class: 'face lg', src: portraitUrl('host_observer'), alt: '', style: 'object-fit:cover;object-position:top' }),
        h('div', { class: 'col grow', style: 'gap:6px' }, h('div', { class: 'text' }, eng.summary), g ? h('div', { class: 'note-box' }, h('b', { class: 'gold' }, t('rules.goal')), '　', g.goal, h('br'), h('b', { class: 'gold' }, t('rules.attention')), '　', g.attention) : null)),
      ...eng.rules.map((r, i) => h('div', { class: 'entry' }, `${i + 1}. ${r}`)),
      h('div', { class: 'note-box' }, t(opts.prison ? 'rules.prisonCut' : 'rules.mainCut', { n: scheduleFor(G.state?.day ?? 1).prison })),
      h('div', { class: 'note-box' }, t('rules.tie')),
    ]);
    layer = openLayer(h('div', { class: `overlay ${G.fieldVisible ? '' : 'solid'}` }, panel(`${matchId.toUpperCase()}　${eng.name}`, body, { wide: true, footer: button(t('rules.ok'), done, { kind: 'primary', autofocus: true }) })), { onCancel: undefined, pausesClock: true, name: 'rules' });
  });
}

export function rankingScreen(v: RankingView): Promise<void> {
  const s = G.state!;
  return new Promise((resolve) => {
    let layer: Layer;
    const done = () => {
      shown = false;
      closeLayer(layer);
      resolve();
    };
    const n = v.ranking.length;
    const list = h('div', { class: 'rank-list' }, v.ranking.map((id, i) => {
      const cut = i >= n - v.cut;
      return h('div', { class: `rank${cut ? ' prison' : ''}${id === 'hero' ? ' me' : ''}` },
        h('span', { class: 'no' }, rankMark(i)), face(id), h('span', { class: 'grow' }, nameOf(s, id)),
        cut ? h('span', { class: 'st' }, icon(v.prison ? 'eliminated' : 'prison'), h('span', { class: 'tag' }, v.cutLabel)) : null,
        v.rewards && v.rewards[id] ? h('span', { class: 'good' }, '+', pieces(v.rewards[id] ?? 0)) : null,
        h('span', { class: 'pts' }, `${v.scores[id] ?? 0}${t('rank.pts')}`));
    }));
    const mine = v.ranking.indexOf('hero');
    // 監獄マッチで脱落を免れた時は勝ち抜けの帯（1 位も含む）。本戦の 1 位は勝利の帯
    const fx = mine < 0 ? null : mine >= n - v.cut ? fxBanner('defeat', v.cutLabel, 'sm') : v.prison ? fxBanner('prison_survive', t('rank.survive'), 'sm') : mine === 0 ? fxBanner('victory', t('rank.first'), 'sm') : null;
    const body = h('div', { class: 'col', style: 'gap:8px' }, fx, list, ...v.notes.map((x) => h('div', { class: 'note-box' }, x)));
    // 追加ボイス：1 位の人の勝利の声。持っていなければ、最下位の人の敗北の声（監獄マッチの最下位は、脱落の画面で鳴らす）
    // 進行の声：結果の発表（主人公が 1 位なら勝利の祝い。決勝の優勝は、このあとの戴冠で祝う）。そのあとに参加者の声
    let shown = true;
    const said = announce(mine === 0 && !v.final ? 'victory' : 'results');
    void said.then(() => { if (shown && !playVoice(v.ranking[0], 'victory') && !v.prison && n > 1) playVoice(v.ranking[n - 1], 'defeat'); });
    layer = openLayer(h('div', { class: `overlay solid ${v.prison ? 'prison-bg' : 'result-bg'}` }, panel(v.title, body, { wide: true, footer: button(t('common.next'), done, { kind: 'primary', autofocus: true }) })), { pausesClock: true, name: 'ranking' });
  });
}

export function eliminationScreen(id: CharId): Promise<void> {
  const s = G.state!;
  return new Promise((resolve) => {
    let layer: Layer;
    const done = () => {
      closeLayer(layer);
      resolve();
    };
    const line = id === 'hero' ? t('elim.hero') : t('elim.npc', { name: nameOf(s, id) });
    const el = h('div', { class: 'overlay solid elim-screen', onclick: done },
      fxBanner('elimination', t('elim.title')),
      h('div', { class: 'elim-name' }, nameOf(s, id)),
      h('div', { class: 'text center' }, line),
      button(t('common.next'), done, { kind: 'primary', autofocus: true }),
    );
    Sound.se('drop');
    // 追加ボイス：脱落が確定した時だけ。主人公の脱落は進行役が告げる
    if (id === 'hero') void announce('elimination');
    else playVoice(id, 'elimination');
    layer = openLayer(el, { pausesClock: true, name: 'elim' });
  });
}

/** エンディングごとのストーリー背景（正式素材。未納品の組み合わせは背景なし） */
const ENDING_BG: Record<string, string> = {
  E_BAD: 'prison_night', E_WIN: 'ending_winner', E_LONE: 'ending_winner', E_BOND: 'ending_winner',
  E_ESCAPE: 'ending_escape', E_RESCUE: 'isolation', E_REPORT: 'secret_lab', E_TRUE: 'ending_truth',
};

export async function endingScreen(id: string): Promise<void> {
  const s = G.state;
  const e = ENDINGS.find((x) => x.id === id) ?? ENDINGS[0];
  await playStory(e.lines.map((text) => ({ speaker: 'narrator', text })), { bg: ENDING_BG[id] });
  const reached = s ? t('ending.reached', { day: s.day }) : '';
  await new Promise<void>((resolve) => {
    let layer: Layer;
    const done = () => {
      closeLayer(layer);
      resolve();
    };
    const hist = s ? s.board.map((b) => h('div', { class: 'small dim' }, b.text)) : [];
    layer = openLayer(h('div', { class: 'overlay solid' }, panel(`${t('ending.label')}　${e.title}`, h('div', { class: 'col', style: 'gap:8px' }, h('div', { class: 'text' }, reached), h('div', { class: 'note-box' }, t(id === 'E_BAD' ? 'ending.badNote' : 'ending.note')), ...hist), { footer: button(t('common.toTitle'), done, { kind: 'primary', autofocus: true }) })), { pausesClock: true, name: 'ending' });
  });
}

export function boardScreen(): Promise<void> {
  const s = G.state!;
  const sch = scheduleFor(s.day);
  const main = CATALOG.find((c) => c.id === sch.main);
  return alertDialog(t('board.title'), h('div', { class: 'col', style: 'gap:6px' }, [
    h('div', { class: 'entry' }, t('board.today', { day: s.day, name: main?.name ?? '', n: sch.prison })),
    h('div', { class: 'entry' }, t('board.alive'), '：', Object.values(s.actors).filter((a) => a.alive).map((a) => shortName(s, a.id)).join('、')),
    ...s.board.slice().reverse().map((b) => h('div', { class: 'entry small' }, b.text)),
  ]), t('common.close'), false);
}

export function initSettings(): void {
  const st = G.meta.settings;
  if (st.lang) setLang(st.lang);
  document.documentElement.style.setProperty('--text-scale', String(st.textScale));
  if (G.state) setHeroGender(G.state.hero.gender);
}

export { deleteSave };
