import { describe, expect, it } from 'vitest';
import { CLOCK, phaseDuration } from '../src/core/clock';
import { Rng } from '../src/core/rng';
import { adjustRel, aliveIds, aliveNpcs } from '../src/core/state';
import { startMorning } from '../src/core/tournament';
import { ALL_IDS } from '../src/data/characters';
import { fastForward, tickNpcs } from '../src/npc/brain';
import { addInvite, visitVerdict } from '../src/npc/social';
import { canEnter, denyReason } from '../src/world/access';
import { ROOMS } from '../src/world/maps';
import { findPath } from '../src/world/path';
import { awayOwner, homeOf, isCell, knockable, LIVING_ROOMS, ownerOfRoom, plateOf, PRIVATE_ROOMS, roomTitle } from '../src/world/rooms';
import { CELLS, cellOf, cellOwner, cellPlates, gateOpen } from '../src/world/cells';
import { cellSleepTile, collisionOf, placeIn } from '../src/world/sim';
import { freshState } from './helpers';

const K = 'npc_02_kanzaki';
const M = 'npc_04_mido';

function morning(seed: number) {
  const s = freshState(seed);
  s.phase = 'morning';
  startMorning(s);
  s.phaseLeft = phaseDuration('morning');
  return s;
}

describe('個室の割り当て', () => {
  it('部屋の表：生活棟は参加者と同じ数、監獄棟の房は 11 室（家具の表から数える）。どの個室もマップにあり、通路の扉と行き来できる', () => {
    expect(LIVING_ROOMS.length).toBe(ALL_IDS.length);
    expect(CELLS.length).toBe(11);
    expect(new Set(CELLS.map((c) => c.no)).size).toBe(CELLS.length);
    expect(PRIVATE_ROOMS.every((r) => r.wing === 'living')).toBe(true);
    for (const r of PRIVATE_ROOMS) {
      const room = ROOMS[r.room];
      expect(room, r.room).toBeTruthy();
      const out = room.doors[0];
      const corridor = ROOMS[out.to];
      const back = corridor.doors.find((d) => d.id === out.toDoor)!;
      expect(back.to).toBe(r.room);
      expect(back.toDoor).toBe(out.id);
      const g = collisionOf(freshState(1), corridor.id);
      for (const tl of back.tiles) expect(g[tl.y][tl.x], `${corridor.id} ${back.id}`).toBe(false);
    }
  });

  it('開始時は 1 人 1 室。扉の表示は部屋番号と持ち主で、自分の部屋だけ入れる', () => {
    const s = morning(1);
    const homes = ALL_IDS.map((id) => homeOf(s, id));
    expect(new Set(homes).size).toBe(ALL_IDS.length);
    for (const id of ALL_IDS) {
      expect(ownerOfRoom(s, homeOf(s, id))).toBe(id);
      expect(canEnter(s, id, homeOf(s, id))).toBe(true);
    }
    expect(plateOf(s, homeOf(s, 'hero'))).toEqual({ no: '301', owner: 'hero', away: null });
    expect(roomTitle(s, homeOf(s, K))).toBe('302 神崎の個室');
    expect(canEnter(s, 'hero', homeOf(s, K))).toBe(false);
    expect(knockable(s, homeOf(s, K))).toBe(true);
    expect(knockable(s, homeOf(s, 'hero'))).toBe(false);
  });

  it('監獄棟へ送られると共同牢の房が 1 人 1 つ割り当てられ、生活棟の部屋は閉鎖される。消灯の間は格子が閉まる。戻ると元の部屋を使う', () => {
    const s = morning(2);
    const prison = ['hero', K, M] as const;
    for (const id of ALL_IDS) s.actors[id].house = (prison as readonly string[]).includes(id) ? 'prison' : 'living';
    const homes = prison.map((id) => homeOf(s, id));
    expect(homes.every((h) => h === 'prison_cells')).toBe(true);
    expect(homes.every(isCell)).toBe(true);
    const mine = prison.map((id) => cellOf(s, id)!);
    expect(new Set(mine.map((c) => c.cell.id)).size).toBe(3);
    expect(mine[0].no).toBe('B01');
    expect(cellOwner(s, 'prison_cells', mine[0].cell.id)).toBe('hero');
    expect(cellPlates(s, 'prison_cells').filter((p) => p.owner).length).toBe(3);
    // 生活棟の部屋：名札は残るが、誰も入れない
    expect(ownerOfRoom(s, 'bedroom_hero')).toBeNull();
    expect(awayOwner(s, 'bedroom_hero')).toBe('hero');
    expect(roomTitle(s, `bedroom_${K}`)).toBe('302 神崎の個室（閉鎖中）');
    expect(denyReason(s, `bedroom_${K}`)).toMatch(/閉鎖/);
    for (const id of ALL_IDS) expect(canEnter(s, id, 'bedroom_hero')).toBe(false);
    // 昼は格子が開いていて、房の寝台の脇まで歩ける
    placeIn(s, 'hero', 'prison_cells');
    const bed = cellSleepTile(s, mine[0]);
    expect(gateOpen(s, 'prison_cells', mine[0].cell.id)).toBe(true);
    expect(findPath(collisionOf(s, 'prison_cells'), s.actors.hero.pos, bed, new Set())).toBeTruthy();
    // 消灯の間は、人の入っている房の格子が閉まる（空いている房は開いたまま）
    for (const id of ALL_IDS) s.actors[id].house = null;
    expect(homeOf(s, 'hero')).toBe('prison_cells');
    s.phase = 'curfew';
    expect(gateOpen(s, 'prison_cells', mine[0].cell.id)).toBe(false);
    const empty = CELLS.find((c) => !cellOwner(s, c.room, c.cell.id))!;
    expect(gateOpen(s, 'prison_cells', empty.cell.id)).toBe(true);
    expect(findPath(collisionOf(s, 'prison_cells'), s.actors.hero.pos, bed, new Set())).toBeNull();
    // 翌日、生活棟に入れば元の部屋へ戻り、房は空く
    s.phase = 'house';
    s.actors.hero.house = 'living';
    expect(homeOf(s, 'hero')).toBe('bedroom_hero');
    expect(cellOf(s, 'hero')).toBeNull();
  });

  it('脱落した人の部屋は空室になり、誰も入れない', () => {
    const s = morning(3);
    s.actors[K].alive = false;
    expect(ownerOfRoom(s, `bedroom_${K}`)).toBeNull();
    expect(plateOf(s, `bedroom_${K}`)).toEqual({ no: '302', owner: null, away: null });
    expect(roomTitle(s, `bedroom_${K}`)).toBe('302 空室');
    expect(denyReason(s, `bedroom_${K}`)).toMatch(/空室/);
    expect(knockable(s, `bedroom_${K}`)).toBe(false);
    for (const id of aliveIds(s)) expect(canEnter(s, id, `bedroom_${K}`)).toBe(false);
  });

  it('訪問：入れるかどうかは部屋の主が決める。信頼されていれば入れ、敵視されていれば断られる', () => {
    let yes = 0;
    let no = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const s = morning(seed);
      placeIn(s, K, homeOf(s, K));
      adjustRel(s, K, 'hero', { trust: 40, like: 30 });
      if (visitVerdict(s, 'hero', K, Rng.from(seed)).accept) yes++;
      adjustRel(s, M, 'hero', { hostility: 60 });
      placeIn(s, M, homeOf(s, M));
      if (!visitVerdict(s, 'hero', M, Rng.from(seed)).accept) no++;
    }
    expect(yes).toBe(40);
    expect(no).toBe(40);
    // 入れてもらった後は、その部屋へ入れる。先客がいる部屋は断られる
    const s = morning(9);
    placeIn(s, K, homeOf(s, K));
    expect(addInvite(s, K, 'hero')).toBe(true);
    expect(canEnter(s, 'hero', homeOf(s, K))).toBe(true);
    placeIn(s, M, homeOf(s, K));
    expect(visitVerdict(s, 'npc_05_shiraishi', K, Rng.from(1))).toEqual({ accept: false, reason: 'busy' });
  });

  it('NPC が他の NPC の個室を訪ねる（扉の前まで歩いてノックし、入れてもらえたら中で話す）', () => {
    let entered = 0;
    let refused = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const s = morning(seed * 7);
      for (const id of aliveIds(s)) if (id !== K && id !== M) { placeIn(s, id, 'dining'); s.actors[id].busyUntil = 1e15; }
      placeIn(s, K, homeOf(s, K));
      s.actors[K].goal = { kind: 'rest', room: homeOf(s, K), note: 'at', until: s.simTime + 600_000 };
      placeIn(s, M, 'living_hallway');
      adjustRel(s, K, M, seed % 2 ? { trust: 50, like: 40 } : { hostility: 70 });
      s.actors[M].goal = { kind: 'talk', target: K, note: 'visit', until: s.simTime + 600_000 };
      for (let i = 0; i < 600 && s.actors[M].pos.room !== homeOf(s, K) && s.actors[M].goal; i++) { s.simTime += 100; tickNpcs(s, 100, true); }
      if (s.actors[M].pos.room === homeOf(s, K)) entered++;
      else refused++;
      expect(s.facts.some((f) => f.type === 'invite' && f.text.includes('訪ねた'))).toBe(true);
    }
    expect(entered).toBe(6);
    expect(refused).toBe(6);
  });

  it('就寝：21:20 から個室へ戻り始め、22:00 にはほぼ全員が割り当てられた個室にいる（監獄棟の部屋の人も）', () => {
    const s = morning(11);
    s.phase = 'night';
    s.phaseLeft = phaseDuration('night');
    const npcs = aliveNpcs(s);
    // 2 人は監獄棟の部屋に割り当てられている
    s.actors[K].house = 'prison';
    s.actors[M].house = 'prison';
    homeOf(s, K); homeOf(s, M);
    for (const id of aliveIds(s)) { s.actors[id].house = null; placeIn(s, id, id === 'hero' ? 'living_hallway' : 'living_lounge'); }
    expect(isCell(homeOf(s, K))).toBe(true);
    let at2100 = 0;
    // 本編と同じ速さ（ゲーム内 1 分 = 実時間 約 1.43 秒）で進める
    for (let i = 0; i < 180; i++) {
      fastForward(s, Math.round(1000 / CLOCK.realRate));
      s.phaseLeft -= 1000;
      if (i === 120) at2100 = npcs.filter((id) => s.actors[id].pos.room === homeOf(s, id)).length;
    }
    const home = npcs.filter((id) => s.actors[id].pos.room === homeOf(s, id));
    if (home.length < npcs.length - 1) throw new Error(npcs.filter((id) => !home.includes(id)).map((id) => `${id}@${s.actors[id].pos.room}:${s.actors[id].goal?.kind}${s.actors[id].goal?.note}:${s.actors[id].route.join('>')}:busy${(s.actors[id].busyUntil ?? 0) > s.simTime}`).join(' | '));
    expect(home.length).toBeGreaterThanOrEqual(npcs.length - 1);
    expect(home).toContain(K);
    expect(at2100).toBeLessThan(npcs.length); // 21:00 の時点では、まだ外にいる人がいる
  });
});
