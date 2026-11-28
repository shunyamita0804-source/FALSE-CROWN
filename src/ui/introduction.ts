/**
 * 参加者の自己紹介イベント（DAY 1、開会式の後）。
 * 1. 全員が集合場所（data/introductions.json の venue）に集まり、NPC は輪の自分の位置まで歩く
 * 2. 揃ったら順番に自己紹介。話す人の上半身、名前、年齢、職業、字幕を出し、収録済みの声を鳴らす（主人公は文字だけ）
 * 3. 声が終わると自動で次の人へ。画面を押すと送り、「全員の紹介を飛ばす」で最後まで飛ばせる
 * 4. 終わったら NPC はそれぞれの施設へ歩き出し、自由時間が始まる
 * 開いている間、大会の時計は止まる。能力値や人格値は出さない（名前、年齢、職業、本人の言葉だけ）。
 */
import { G } from '../app/game';
import { Sound, type BgmId } from '../audio/audio';
import { voiceClip } from '../audio/voice';
import { INTRO, departRoom, introLine, introOrder, introParticipants, markIntroduced, ringSeats, textHoldMs, type IntroLine, type Seat } from '../core/introduction';
import { rngOf } from '../core/state';
import type { Actor } from '../core/types';
import type { CharId, NpcId } from '../data/characters';
import { t } from '../i18n/i18n';
import { canEnter } from '../world/access';
import { ROOMS } from '../world/maps';
import { collisionOf, dirTo, moveActor, placeIn, setPathTo, setRouteTo, speedOf } from '../world/sim';
import { bust } from './art';
import { button, clear, closeLayer, h, openLayer, type Layer } from './dom';

const at = (a: Actor, p: { x: number; y: number }) => !a.step && a.pos.x === p.x && a.pos.y === p.y;
const MARK = '▼';

/** 自己紹介イベントを最初から最後まで進める。フィールドは表示済みで、全員が集合場所の部屋にいる前提 */
export function introductionEvent(): Promise<void> {
  const s = G.state!;
  const room = INTRO.venue.room in ROOMS ? INTRO.venue.room : s.actors.hero.pos.room;
  const ids = introParticipants(s);
  for (const id of ids) if (s.actors[id].pos.room !== room) placeIn(s, id, room);
  const seats = ringSeats(ids, collisionOf(s, room));
  const seatOf = new Map<CharId, Seat>(seats.map((x) => [x.id, x]));
  const [cx, cy] = INTRO.venue.center;
  const hero = s.actors.hero;
  const heroSeat = seatOf.get('hero');
  if (heroSeat) {
    // 主人公の席に誰かが立っていたら、その人を近くへずらしてから主人公を置く
    for (const id of ids) if (id !== 'hero' && at(s.actors[id], heroSeat)) placeIn(s, id, room, { x: heroSeat.x, y: heroSeat.y - 2 });
    hero.pos = { room, x: heroSeat.x, y: heroSeat.y, dir: dirTo(heroSeat.x, heroSeat.y, cx, cy) };
    hero.step = undefined;
    hero.path = [];
    hero.route = [];
    hero.intent = undefined;
  }
  const npcs = ids.filter((id) => id !== 'hero');
  for (const id of npcs) {
    const a = s.actors[id];
    a.goal = undefined;
    a.route = [];
    a.bubble = undefined;
    const st = seatOf.get(id)!;
    setPathTo(s, a, st.x, st.y);
  }
  const cam = INTRO.venue.camera;
  G.camFocus = cam ? { x: cam[0], y: cam[1] } : { x: cx + 0.5, y: cy };
  Sound.bgm(INTRO.bgm as BgmId, 1500);

  return new Promise((resolve) => {
    let layer: Layer;
    let mode: 'gather' | 'talk' | 'depart' = 'gather';
    let elapsed = 0;
    let retry = 0;
    let settle = -1;
    let idx = -1;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let departAt = 0;
    const order = introOrder(seats, s.seed);
    // 声が置かれている人は、その声の台詞を字幕にする
    const lines: IntroLine[] = order.map((id) => introLine(s, id, (who) => voiceClip(who, 'introduction')));
    const departing: { id: NpcId; at: number; dest: string | null; started: boolean }[] = [];

    const head = h('div', { class: 'intro-head' });
    const card = h('div', { class: 'intro-card', onclick: () => next(), 'data-focus': '', tabIndex: 0 });
    const skipBtn = button(t('intro.skipAll'), () => finishTalks(), { kind: 'ghost', small: true });
    const top = h('div', { class: 'intro-top' }, head, skipBtn);
    const root = h('div', { class: 'overlay clear intro' }, top, card);

    const clearTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };
    const faceAll = (who: CharId | null) => {
      for (const id of ids) {
        const a = s.actors[id];
        if (a.step) continue;
        if (who && id !== who) a.pos.dir = dirTo(a.pos.x, a.pos.y, s.actors[who].pos.x, s.actors[who].pos.y);
        else a.pos.dir = dirTo(a.pos.x, a.pos.y, cx, cy);
      }
    };
    const drawHead = (text: string) => { clear(head); head.append(h('b', null, t('intro.title')), h('span', null, text)); };

    const showGather = () => {
      drawHead(t('intro.gathering'));
      clear(card);
      card.className = 'intro-card wait';
      card.append(h('p', { class: 'intro-text narration' }, t('intro.gatherText', { place: ROOMS[room].name })));
    };

    const speak = () => {
      clearTimer();
      Sound.stopVoice();
      for (const id of ids) s.actors[id].bubble = undefined;
      const l = lines[idx];
      const a = s.actors[l.id];
      a.bubble = { text: MARK, until: s.simTime + 3_600_000 };
      faceAll(l.id);
      drawHead(t('intro.count', { i: idx + 1, n: lines.length }));
      clear(card);
      card.className = `intro-card${l.id === 'hero' ? ' hero' : ''}`;
      const meta = l.age != null ? `${t('intro.age', { n: l.age })}　${l.job ?? ''}` : t('intro.player');
      card.append(
        bust(l.id, 'normal', 'intro-bust'),
        h('div', { class: 'intro-body' },
          h('div', { class: 'intro-name' }, h('b', null, l.name), l.kana ? h('small', null, l.kana) : null),
          h('div', { class: 'intro-meta' }, meta),
          h('p', { class: 'intro-text' }, l.text),
          h('div', { class: 'intro-next' }, l.voice ? '♪' : '', ' ▼')));
      const hold = () => { timer = setTimeout(next, textHoldMs(l.text)); };
      if (!l.voice) { hold(); return; }
      let started = false;
      const mine = idx;
      Sound.voice(l.voice.url, l.voice.gain, {
        duck: true,
        onStart: () => { started = true; },
        onEnd: () => {
          if (mine !== idx || mode !== 'talk') return;
          // 鳴らせなかった時（音量 0、未解錠など）は字幕を読む長さだけ待つ
          if (!started) hold();
          else timer = setTimeout(next, INTRO.timing.afterVoiceMs);
        },
      });
    };

    const next = () => {
      if (mode === 'gather') return;
      if (mode === 'depart') { end(); return; }
      Sound.se('click');
      if (idx >= lines.length - 1) { finishTalks(); return; }
      idx++;
      speak();
    };

    const startTalks = () => {
      mode = 'talk';
      idx = 0;
      speak();
    };

    /** 紹介を終える（飛ばした時も同じ）。解散して施設へ向かう */
    const finishTalks = () => {
      if (mode === 'depart') { end(); return; }
      clearTimer();
      Sound.stopVoice();
      // 集合の途中で飛ばした時は、まだ歩いている人をその場の席へ置く
      for (const id of npcs) {
        const a = s.actors[id];
        const st = seatOf.get(id)!;
        if (!at(a, st)) { placeIn(s, id, room, st); a.path = []; }
        a.bubble = undefined;
      }
      faceAll(null);
      markIntroduced(s, ids);
      mode = 'depart';
      departAt = 0;
      const rng = rngOf(s);
      // 順番に、少しずつ間を空けて歩き出す
      const leave = npcs.slice().sort(() => rng.next() - 0.5);
      leave.forEach((id, i) => departing.push({ id: id as NpcId, at: i * INTRO.timing.departStaggerMs, dest: departRoom(id as NpcId, room, (r) => r in ROOMS && canEnter(s, id, r)), started: false }));
      skipBtn.style.visibility = 'hidden';
      drawHead(t('intro.done'));
      clear(card);
      card.className = 'intro-card wait';
      card.append(h('p', { class: 'intro-text narration' }, t('intro.doneText')), h('div', { class: 'intro-foot' }, button(t('cer.go'), () => end(), { kind: 'primary', autofocus: true })));
      G.save();
    };

    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      clearTimer();
      Sound.stopVoice();
      // まだ歩き出していない人にも行き先を渡す（あとは自由時間の行動に任せる）
      for (const d of departing) if (!d.started) startDepart(d);
      G.cutscene = null;
      G.camFocus = null;
      closeLayer(layer);
      G.save();
      resolve();
    };

    const startDepart = (d: (typeof departing)[number]) => {
      d.started = true;
      const a = s.actors[d.id];
      if (!d.dest) return;
      const spots = ROOMS[d.dest].spots;
      a.goal = { kind: 'wander', room: d.dest, spot: spots.length ? spots[Math.floor(rngOf(s).next() * spots.length)] : undefined, until: s.simTime + 120_000 };
      setRouteTo(s, a, d.dest, a.goal.spot);
    };

    // フィールドの 1 コマごと（時計は進めない）
    G.cutscene = (dt: number) => {
      elapsed += dt;
      if (mode === 'gather') {
        let all = true;
        retry += dt;
        for (const id of npcs) {
          const a = s.actors[id];
          const st = seatOf.get(id)!;
          moveActor(s, a, dt, speedOf(id));
          if (at(a, st)) { a.path = []; a.pos.dir = dirTo(a.pos.x, a.pos.y, cx, cy); continue; }
          all = false;
          // 道を塞がれて止まった人は、少し待って探し直す
          if (!a.step && !a.path.length && retry > 600) setPathTo(s, a, st.x, st.y);
        }
        if (retry > 600) retry = 0;
        if (!all && elapsed > INTRO.timing.gatherTimeoutMs) {
          for (const id of npcs) { const a = s.actors[id]; const st = seatOf.get(id)!; if (!at(a, st)) { placeIn(s, id, room, st); a.path = []; } }
          all = true;
        }
        if (all) {
          if (settle < 0) { settle = 0; faceAll(null); }
          settle += dt;
          if (settle >= INTRO.timing.settleMs) startTalks();
        }
      } else if (mode === 'depart') {
        departAt += dt;
        for (const d of departing) if (!d.started && departAt >= d.at) startDepart(d);
        for (const id of npcs) {
          const a = s.actors[id];
          moveActor(s, a, dt, speedOf(id));
        }
        if (departAt >= INTRO.timing.departShowMs + departing.length * INTRO.timing.departStaggerMs) end();
      }
    };

    showGather();
    layer = openLayer(root, {
      pausesClock: true,
      name: 'introduction',
      onCancel: () => next(),
      onKey: (k) => (k === 'a' ? (next(), true) : false),
    });
  });
}
