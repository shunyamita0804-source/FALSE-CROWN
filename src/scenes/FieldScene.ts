import { Sound } from '../audio/audio';
import { isPrivateRoom, plateOf, refreshHomes } from '../world/rooms';
import { cellPlates, gateOpen, isCellRoom } from '../world/cells';
import Phaser from 'phaser';
import { G } from '../app/game';
import { assetFile, CHAR_FOOT, CHAR_H, CHAR_SCALE, CHAR_W, charFolder, TILE } from '../assets/registry';
import { drawCharSheet, drawLightmap, drawProp, drawRoom, drawShadow } from '../assets/placeholders';
import { hashString } from '../core/rng';
import { shortName } from '../core/state';
import type { Actor, Dir } from '../core/types';
import { ALL_IDS, HERO_PALETTES, NPC_BY_ID, type CharId, type NpcId } from '../data/characters';
import { fitCameraToReference, type LogicalView } from '../display/viewport';
import { t } from '../i18n/i18n';
import { Input } from '../input/InputState';
import { anyModal } from '../ui/dom';
import { ROOMS, doorApproach, inspectsOf, doorDir, propVisible, type DoorDef, type InspectDef, type RoomDef } from '../world/maps';
import { PROPS } from '../world/props';
import { furnitureOf, seatDepth, type Facing, type FurnitureProp, type Seat } from '../world/furniture';
import { DIRS, actorsIn, drainDoorPasses, facingTile, nearbyAction, stepToward } from '../world/sim';
import { face4, keysVector, type Vec } from '../input/stick';
import { WALK_LINGER_MS, walkFrame } from '../world/walk';
import standAlign from '../data/stand_align.json';

const STAND_ALIGN = standAlign as Record<string, Record<string, { x: number; y: number; k: number }>>;

/** 仮素材テクスチャの解像度倍率（論理 64px/タイル に対して） */
const TEX = 1.5;
const DIR_ROW: Record<Dir, number> = { down: 0, up: 1, left: 2, right: 3 };
/** 席の向き → 立ち絵の向き（斜めは左右に寄せる） */
/** 正式の着席の絵（sit.png）で、腰が乗る点のセル内の高さ（制作依頼の取り決め：x=48, y=90） */
const SIT_HIP_Y = 90;
/** 背を向けて座る椅子の背もたれの上端は、腰の位置からおよそこの高さ（px）上。前の絵を分ける高さに使う */
const FG_SPLIT_ABOVE_HIP = 30;
/** 斜めの着席の絵（sit_diag.png）のコマ：右下・左下・右上・左上 */
const SIT_DIAG: Partial<Record<Facing, number>> = { SE: 0, SW: 1, NE: 2, NW: 3 };
const SEAT_DIR: Record<Facing, Dir> = { N: 'up', S: 'down', E: 'right', W: 'left', NE: 'right', SE: 'right', NW: 'left', SW: 'left' };
/**
 * 座っている人の仮の描き方（正式の着席の絵が届くまで）。立ち絵の腰の線（セル内 y）を席の腰の位置に合わせ、
 * 腿から下を表示の時だけ隠す（絵は加工しない）。家具の前の絵が、その上に重なる。
 */
const SEAT_HIP_Y = 82;
const SEAT_CROP_Y = 96;


interface ActorView {
  id: CharId;
  shadow: Phaser.GameObjects.Image;
  sprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  bubble: Phaser.GameObjects.Text;
  /** 歩き始めてから進んだ距離（px）。歩行のコマ送りに使う */
  dist: number;
  /** 止まってからの経過時間（ms） */
  idle: number;
  lastX: number;
  lastY: number;
}

export type Target = { kind: 'npc'; id: CharId } | { kind: 'inspect'; ins: InspectDef } | { kind: 'door'; door: DoorDef } | { kind: 'sit'; seat: Seat } | { kind: 'stand' } | { kind: 'bed' } | null;

/**
 * フィールド描画レイヤー。UI（DOM）とは別レイヤーで、端末の実解像度で描く。
 * 状態（位置・衝突・扉）はすべて world/ のデータにあり、ここは描画と入力の橋渡しだけを行う。
 */
export class FieldScene extends Phaser.Scene {
  private view!: LogicalView;
  private roomId = '';
  private roomObjects: Phaser.GameObjects.GameObject[] = [];
  private roomTextures: string[] = [];
  /** 読み込み済みの正式背景（新しい順）。メモリを抑えるため古いものから解放する */
  private mapCache: string[] = [];
  private loading = new Set<string>();
  private actors = new Map<CharId, ActorView>();
  private lastFrameAt = 0;
  private marks: (Phaser.GameObjects.Image | Phaser.GameObjects.Text | Phaser.GameObjects.Graphics)[] = [];
  private flagsKey = '';
  private camTarget = new Phaser.Math.Vector2();
  target: Target = null;
  /** 集合移動中の目印（次に通る扉の上の矢印） */
  private guide: Phaser.GameObjects.Text | null = null;

  constructor() {
    super('Field');
  }

  create(): void {
    G.field = this;
    this.load.setBaseURL(import.meta.env.BASE_URL);
    fitCameraToReference(this, (view) => {
      this.view = view;
      this.applyBounds();
      for (const v of this.actors.values()) this.setTextRes(v);
    });
    this.ensureCommonTextures();
  }

  private ensureCommonTextures(): void {
    if (!this.textures.exists('shadow')) this.textures.addCanvas('shadow', drawShadow(128, 56));
    if (!this.textures.exists('mark')) {
      const c = document.createElement('canvas');
      c.width = c.height = 48;
      const g = c.getContext('2d')!;
      const gr = g.createRadialGradient(24, 24, 0, 24, 24, 24);
      gr.addColorStop(0, 'rgba(255,240,180,0.95)');
      gr.addColorStop(0.3, 'rgba(240,216,144,0.5)');
      gr.addColorStop(1, 'rgba(240,216,144,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 48, 48);
      g.strokeStyle = 'rgba(255,250,220,0.9)';
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(24, 8); g.lineTo(24, 40); g.moveTo(8, 24); g.lineTo(40, 24); g.stroke();
      this.textures.addCanvas('mark', c);
    }
    if (!this.textures.exists('arrow')) {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d')!;
      g.beginPath(); g.moveTo(32, 10); g.lineTo(54, 44); g.lineTo(32, 36); g.lineTo(10, 44); g.closePath();
      g.fillStyle = 'rgba(244,222,150,0.95)';
      g.shadowColor = 'rgba(0,0,0,0.8)'; g.shadowBlur = 6;
      g.fill();
      g.lineWidth = 2; g.strokeStyle = 'rgba(40,28,8,0.9)'; g.stroke();
      this.textures.addCanvas('arrow', c);
    }
    if (!this.textures.exists('doorglow')) {
      // 扉が開いた時に、室内の明かりが床へ漏れる表現（扉の絵そのものは変えない）
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d')!;
      for (let i = 0; i < 6; i++) {
        const inset = i * 5;
        const grad = g.createLinearGradient(0, 0, 0, 128);
        grad.addColorStop(0, 'rgba(255,255,255,0.34)');
        grad.addColorStop(0.4, 'rgba(255,255,255,0.14)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        g.beginPath(); g.moveTo(24 + inset, 0); g.lineTo(104 - inset, 0); g.lineTo(128 - inset * 1.6, 128); g.lineTo(inset * 1.6, 128); g.closePath();
        g.fill();
      }
      this.textures.addCanvas('doorglow', c);
    }
  }

  /** 開いている扉（扉 ID → 明かりの表示と、閉じる時刻） */
  private doorFx = new Map<string, { img: Phaser.GameObjects.Image; until: number; iron: boolean; closing: boolean }>();

  /** 扉が開く。開いている間に続けて人が通った時は、閉じる時刻を延ばすだけにする */
  private openDoor(d: DoorDef, who: CharId): void {
    if (d.kind === 'open' || d.kind === 'stairs_up' || d.kind === 'stairs_down') return;
    const now = this.time.now;
    const cur = this.doorFx.get(d.id);
    if (cur && !cur.closing) { cur.until = now + 650; return; }
    const v = DIRS[d.dir];
    const cx = (d.tiles.reduce((a, tl) => a + tl.x, 0) / d.tiles.length + 0.5 + v.dx * 0.5) * TILE;
    const cy = (d.tiles.reduce((a, tl) => a + tl.y, 0) / d.tiles.length + 0.5 + v.dy * 0.5) * TILE;
    const iron = d.kind === 'iron' || d.kind === 'black';
    const img = this.add.image(cx, cy, 'doorglow').setOrigin(0.5, 0).setDisplaySize((d.size + 0.6) * TILE, 2 * TILE)
      .setAngle({ up: 0, right: 90, down: 180, left: 270 }[d.dir]).setDepth(0.8).setAlpha(0).setTint(iron ? 0xb8ccff : 0xffd596).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: img, alpha: 1, duration: 180, ease: 'Sine.easeOut' });
    this.doorFx.set(d.id, { img, until: now + 650, iron, closing: false });
    if (who !== 'hero') Sound.se(iron ? 'latch' : 'doorOpen', { volume: 0.45 });
  }

  private updateDoors(): void {
    const s = G.state!;
    for (const p of drainDoorPasses()) {
      if (p.room !== this.roomId) continue;
      const d = ROOMS[p.room]?.doors.find((x) => x.id === p.door);
      if (d && !(d.lock && !s.flags[d.lock])) this.openDoor(d, p.who);
    }
    const now = this.time.now;
    for (const [id, fx] of this.doorFx) {
      if (fx.closing || now < fx.until) continue;
      fx.closing = true;
      Sound.se(fx.iron ? 'latch' : 'doorClose', { volume: 0.4 });
      this.tweens.add({ targets: fx.img, alpha: 0, duration: 240, ease: 'Sine.easeIn', onComplete: () => { fx.img.destroy(); if (this.doorFx.get(id) === fx) this.doorFx.delete(id); } });
    }
  }

  private setTextRes(v: ActorView): void {
    const res = Math.max(1, Math.ceil(this.view.zoom * 2) / 2);
    v.label.setResolution(res);
    v.bubble.setResolution(res);
  }

  /** キャラクターのスプライトシート（正式素材があれば読み込み済みのもの、無ければ仮素材） */
  private charTexture(id: CharId): string {
    const s = G.state!;
    const folder = charFolder(id, s.hero.gender);
    const key = `char:${folder}`;
    if (this.textures.exists(key)) return key;
    const def = id === 'hero' ? null : NPC_BY_ID[id as NpcId];
    const pal = def ? def.palette : HERO_PALETTES[s.hero.gender];
    const gender = def ? def.gender : s.hero.gender;
    const sc = 2;
    const canvas = drawCharSheet(pal, gender, sc, hashString(folder));
    const tex = this.textures.addCanvas(key, canvas)!;
    for (let r = 0; r < 4; r++) for (let f = 0; f < 4; f++) tex.add(r * 4 + f, 0, f * CHAR_W * sc, r * CHAR_H * sc, CHAR_W * sc, CHAR_H * sc);
    return key;
  }

  private propTexture(type: string): string {
    const key = `prop:${type}`;
    if (!this.textures.exists(key)) this.textures.addCanvas(key, drawProp(type, TILE * TEX));
    return key;
  }

  /** 正式背景を必要になった時に読み込む（全マップを起動時に読むと初回が重いため） */
  private requestAssets(keys: string[]): void {
    let added = false;
    for (const key of keys) {
      if (this.textures.exists(key) || this.loading.has(key)) continue;
      const file = assetFile(key.slice('asset:'.length));
      if (!file) continue;
      this.loading.add(key);
      this.load.image(key, `assets/${file}`);
      added = true;
    }
    if (!added) return;
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      for (const key of keys) this.loading.delete(key);
      const room = G.state ? ROOMS[G.state.actors.hero.pos.room] : null;
      if (room && this.roomId === room.id && keys.some((k) => k === `asset:${room.image}` || k === `asset:${room.overlay?.image}` || this.furnitureKeys(room.id).includes(k))) this.buildRoom();
    });
    this.load.start();
  }

  private touchMap(key: string): void {
    this.mapCache = [key, ...this.mapCache.filter((k) => k !== key)];
  }

  /** 隣の部屋の背景を先読みし、離れた部屋の背景は解放する */
  private preloadNeighbours(room: RoomDef): void {
    const s = G.state!;
    const near = new Set<string>([`asset:${room.image}`]);
    if (room.overlay) near.add(`asset:${room.overlay.image}`);
    for (const d of room.doors) {
      if (d.lock && !s.flags[d.lock]) continue;
      const t = ROOMS[d.to];
      if (t) near.add(`asset:${t.image}`);
    }
    if (this.textures.exists(`asset:${room.image}`)) this.requestAssets([...near].filter((k) => !k.includes('_overlay') || (room.overlay && s.flags[room.overlay.flag])));
    const keep = 8;
    for (const k of this.mapCache.slice(keep)) if (!near.has(k) && this.textures.exists(k)) this.textures.remove(k);
    this.mapCache = this.mapCache.filter((k) => this.textures.exists(k));
    for (const k of near) if (this.textures.exists(k) && !this.mapCache.includes(k)) this.mapCache.push(k);
  }

  /** 集合移動中：次に通る扉に「会場へ」の矢印を出す（部屋を移るたびに付け直す） */
  private updateGuide(): void {
    const d = G.gather?.next;
    if (!d || !G.fieldVisible) {
      if (this.guide) { this.guide.destroy(); this.guide = null; }
      return;
    }
    const arrow = { up: '▲', down: '▼', left: '◀', right: '▶' }[d.dir];
    if (!this.guide) {
      this.guide = this.add.text(0, 0, '', { fontFamily: '"Noto Sans JP", "Hiragino Sans", sans-serif', fontSize: '22px', color: '#f1d88a', backgroundColor: 'rgba(8,12,28,0.82)', padding: { x: 9, y: 4 } }).setOrigin(0.5).setDepth(50);
      this.guide.setResolution(Math.max(1, Math.ceil(this.view.zoom * 2) / 2));
    }
    const label = d.dir === 'left' || d.dir === 'right' ? `${arrow} ${t('gather.arrow')}` : `${t('gather.arrow')} ${arrow}`;
    if (this.guide.text !== label) this.guide.setText(label);
    const xs = d.tiles.map((p) => p.x);
    const ys = d.tiles.map((p) => p.y);
    const cx = ((Math.min(...xs) + Math.max(...xs)) / 2 + 0.5) * TILE;
    const cy = ((Math.min(...ys) + Math.max(...ys)) / 2 + 0.5) * TILE;
    // 扉の手前（部屋の内側）に、扉の方を指して出す
    const off = { up: [0, 1.5], down: [0, -1.4], left: [1.6, -0.6], right: [-1.6, -0.6] }[d.dir];
    const bob = Math.sin(performance.now() / 260) * 6;
    const vx = d.dir === 'left' ? -bob : d.dir === 'right' ? bob : 0;
    const vy = d.dir === 'up' ? -bob : d.dir === 'down' ? bob : 0;
    this.guide.setPosition(cx + off[0] * TILE + vx, cy + off[1] * TILE + vy);
  }

  private clearRoom(): void {
    for (const o of this.roomObjects) o.destroy();
    this.roomObjects = [];
    for (const m of this.marks) m.destroy();
    this.marks = [];
    for (const fx of this.doorFx.values()) { this.tweens.killTweensOf(fx.img); fx.img.destroy(); }
    this.doorFx.clear();
    for (const k of this.roomTextures) if (this.textures.exists(k)) this.textures.remove(k);
    this.roomTextures = [];
    for (const v of this.actors.values()) {
      v.shadow.destroy(); v.sprite.destroy(); v.label.destroy(); v.bubble.destroy();
    }
    this.actors.clear();
  }

  private currentFlagsKey(room: RoomDef): string {
    const s = G.state!;
    const keys = new Set<string>();
    for (const p of room.props) { if (p.showIf) keys.add(p.showIf); if (p.hideIf) keys.add(p.hideIf); }
    for (const d of room.doors) if (d.lock) keys.add(d.lock);
    if (room.overlay) keys.add(room.overlay.flag);
    // 個室の名札（持ち主、空室、閉鎖中）が変わった時も描き直す
    const plates = room.doors.filter((d) => isPrivateRoom(d.to)).map((d) => { const p = plateOf(s, d.to)!; return `${p.owner ?? ''}/${p.away ?? ''}`; }).join(',');
    // 監獄棟の房：持ち主と格子の扉の開け閉めが変わった時も描き直す
    if (isCellRoom(room.id)) refreshHomes(s);
    const cells = cellPlates(s, room.id).map((c) => `${c.owner ?? ''}${c.open ? 'o' : 'c'}`).join(',');
    return [...keys].map((k) => (s.flags[k] ? 1 : 0)).join('') + (s.phase === 'night' ? 'n' : 'd') + plates + '|' + cells;
  }

  /** 建物改修の家具の絵のキー（後ろの絵、前の絵、扉の開閉） */
  private furnitureKeys(roomId: string): string[] {
    const f = furnitureOf(roomId);
    if (!f) return [];
    return f.props.flatMap((p) => [p.img, p.fg?.img, p.door?.open, p.door?.closed].filter((x): x is string => !!x)).map((x) => `asset:${x}`);
  }

  /**
   * 建物改修の家具を、背景の上に原寸の位置で置く（絵は加工しない）。
   * 分けた絵は、後ろの絵を家具の奥行き、前の絵をその少し手前に描く。座った人はその間に入る（furniture.ts の seatDepth）。
   * 房の扉は、開いているか閉じているかで絵を替える。
   */
  private addFurniture(roomId: string): void {
    const f = furnitureOf(roomId);
    if (!f) return;
    const need = [...new Set(this.furnitureKeys(roomId))].filter((k) => !this.textures.exists(k));
    if (need.length) { this.requestAssets(need); return; }
    const put = (key: string, p: FurnitureProp, depth: number) => {
      const img = this.add.image(p.x, p.y, `asset:${key}`).setOrigin(0).setDisplaySize(p.w, p.h).setDepth(depth);
      this.roomObjects.push(img);
      return img;
    };
    for (const p of f.props) {
      if (p.door) { put(this.gateOpen(roomId, p) ? p.door.open : p.door.closed, p, p.depth); continue; }
      // 前の絵に、机の縁と、こちらに背を向けて座る椅子（N 向き）が一緒に入っている家具（競技場の大机など）：
      // そのままだと、座った人が机の縁ごと前の絵に隠れる。前の絵を表示の時だけ上下に分け、上（机の縁）は人の後ろ、
      // 下（椅子の背もたれ）は人の前に描く。分ける高さは、その椅子の腰の位置から決める（絵は加工しない）
      const backSeats = p.fg ? f.seats.filter((q) => q.prop === p.id && q.facing === 'N' && q.hip[1] > p.y && q.hip[1] < p.y + p.h) : [];
      if (p.fg && backSeats.length) {
        const splitY = Math.min(...backSeats.map((q) => q.hip[1])) - FG_SPLIT_ABOVE_HIP;
        put(p.img, p, Math.min(p.depth, p.fg.depth - 4));
        const tex = this.textures.get(`asset:${p.fg.img}`).getSourceImage() as { width: number; height: number };
        const k = tex.height / p.h;
        const cut = Math.round((splitY - p.y) * k);
        put(p.fg.img, p, p.fg.depth - 3).setCrop(0, 0, tex.width, cut);
        put(p.fg.img, p, p.fg.depth).setCrop(0, cut, tex.width, tex.height - cut);
        continue;
      }
      put(p.img, p, p.fg ? Math.min(p.depth, p.fg.depth - 2) : p.depth);
      if (p.fg) put(p.fg.img, p, p.fg.depth);
    }
  }

  /** 房の扉が開いているか（房の持ち主の出入りに合わせる。決まりは world/cells.ts） */
  private gateOpen(roomId: string, p: FurnitureProp): boolean {
    const cell = p.door?.cell ?? p.cell;
    return cell ? gateOpen(G.state!, roomId, cell) : p.door?.initial === 'open';
  }

  /** 部屋を描画し直す */
  buildRoom(): void {
    const s = G.state;
    if (!s) return;
    const room = ROOMS[s.actors.hero.pos.room];
    this.clearRoom();
    this.roomId = room.id;
    this.flagsKey = this.currentFlagsKey(room);
    const W = room.w * TILE;
    const H = room.h * TILE;
    const formal = assetFile(room.image);
    const bgKey = `room:${room.id}`;
    if (formal) {
      // 正式背景（家具込みの一枚絵）。画像は加工せず等倍の縦横比で表示し、衝突・扉・調査地点はデータ側で持つ
      const key = `asset:${room.image}`;
      const ovKey = room.overlay && s.flags[room.overlay.flag] ? `asset:${room.overlay.image}` : null;
      const need = [key, ovKey].filter((k): k is string => !!k && !this.textures.exists(k));
      if (need.length) {
        this.requestAssets(need);
        this.cameras.main.setBackgroundColor('#05060c');
      }
      if (this.textures.exists(key)) {
        this.touchMap(key);
        this.roomObjects.push(this.add.image(0, 0, key).setOrigin(0).setDisplaySize(W, H).setDepth(0));
        if (ovKey && this.textures.exists(ovKey)) this.roomObjects.push(this.add.image(0, 0, ovKey).setOrigin(0).setDisplaySize(W, H).setDepth(0.6));
        this.addFurniture(room.id);
      }
      this.preloadNeighbours(room);
    } else {
      this.textures.addCanvas(bgKey, drawRoom(room, TILE * TEX, s.flags));
      this.roomTextures.push(bgKey);
      this.roomObjects.push(this.add.image(0, 0, bgKey).setOrigin(0).setDisplaySize(W, H).setDepth(0));
      for (const p of room.props) {
        if (!propVisible(p, s.flags)) continue;
        const def = PROPS[p.type];
        if (!def) continue;
        const img = this.add.image(p.x * TILE, p.y * TILE, this.propTexture(p.type)).setOrigin(0).setDisplaySize(def.w * TILE, def.h * TILE);
        const flat = p.type === 'emblem_floor' || p.type === 'carpet';
        img.setDepth(flat ? 0.5 : def.wall ? 1 : def.ceiling ? 8500 : (p.y + def.h) * TILE - 4);
        if (def.ceiling) img.setAlpha(0.92);
        this.roomObjects.push(img);
      }
      // 仮素材の時だけ、環境光と光源を重ねる（正式背景は絵の照明をそのまま使い、色を変えない）
      const lmKey = `light:${room.id}`;
      this.textures.addCanvas(lmKey, drawLightmap(room, 24, s.flags, s.phase === 'night'));
      this.roomTextures.push(lmKey);
      this.roomObjects.push(this.add.image(0, 0, lmKey).setOrigin(0).setDisplaySize(W, H).setDepth(8000));
    }
    // 出入口の目印（通れる扉だけ。隠し扉は解錠後に表示）
    for (const d of room.doors) {
      if (d.lock && !s.flags[d.lock]) continue;
      const v = DIRS[d.dir];
      const cx = d.tiles.reduce((a, t) => a + t.x, 0) / d.tiles.length + 0.5 + v.dx * 0.55;
      const cy = d.tiles.reduce((a, t) => a + t.y, 0) / d.tiles.length + 0.5 + v.dy * 0.55;
      const m = this.add.image(cx * TILE, cy * TILE, 'arrow').setDisplaySize(34, 34).setDepth(8590).setAlpha(0.75)
        .setAngle({ up: 0, right: 90, down: 180, left: 270 }[d.dir]);
      this.tweens.add({ targets: m, alpha: 0.3, x: m.x + v.dx * 6, y: m.y + v.dy * 6, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.marks.push(m);
      // 行き先の名前を出入口に表示する（他の参加者の個室は持ち主の名前）
      // 個室の扉：部屋番号と持ち主の名前を、扉の脇にプログラムで表示する（背景画像には書き込まない）
      const plate = plateOf(s, d.to);
      const name = !plate ? d.label : `${plate.no}　${plate.owner === 'hero' ? t('door.mine') : plate.owner ? shortName(s, plate.owner) : plate.away ? t('door.away', { name: shortName(s, plate.away) }) : t('door.vacant')}`;
      const closed = !!plate && !plate.owner;
      const lx = cx * TILE + (d.dir === 'left' ? 26 : d.dir === 'right' ? -26 : 0);
      const ly = cy * TILE + (d.dir === 'up' ? 30 : d.dir === 'down' ? -30 : 0);
      const lab = this.add.text(lx, ly, name, { fontFamily: '"Noto Sans JP", "Hiragino Sans", sans-serif', fontSize: '17px', color: closed ? '#8f96ad' : plate?.owner === 'hero' ? '#f1d88a' : '#f3ead2', backgroundColor: 'rgba(8,12,28,0.78)', padding: { x: 7, y: 3 } })
        .setOrigin(d.dir === 'left' ? 0 : d.dir === 'right' ? 1 : 0.5, 0.5).setDepth(8592).setResolution(Math.max(1, Math.ceil(this.view.zoom * 2) / 2));
      this.marks.push(lab);
    }
    // 監獄棟の房：番号と持ち主の名前を、格子の前にプログラムで表示する
    for (const c of cellPlates(s, room.id)) {
      const name = `${c.no}　${c.owner === 'hero' ? t('door.mine') : c.owner ? shortName(s, c.owner) : t('door.vacant')}`;
      // 上の列の房は、廊下より上（房の中の立つ位置が、外の立つ位置より上）。名札は格子の高さに出す
      const upper = c.y > (furnitureOf(room.id)?.cells.find((x) => x.id === c.cell)?.inside[1] ?? 0);
      const lab = this.add.text(c.x, c.y + (upper ? -56 : 48), name, { fontFamily: '"Noto Sans JP", "Hiragino Sans", sans-serif', fontSize: '15px', color: !c.owner ? '#8f96ad' : c.owner === 'hero' ? '#f1d88a' : '#f3ead2', backgroundColor: 'rgba(8,12,28,0.78)', padding: { x: 6, y: 2 } })
        .setOrigin(0.5, 0.5).setDepth(8592).setResolution(Math.max(1, Math.ceil(this.view.zoom * 2) / 2));
      this.marks.push(lab);
    }
    // 遊べる卓など、家具ごと光らせて目立たせる所
    for (const ins of inspectsOf(room, s.flags)) {
      const prop = ins.glow ? furnitureOf(room.id)?.props.find((p) => p.id === ins.glow) : undefined;
      if (!prop) continue;
      const g = this.add.graphics().setDepth(prop.depth + 6).setBlendMode(Phaser.BlendModes.ADD);
      for (let i = 0; i < 4; i++) {
        g.lineStyle(10 - i * 2, 0xf1c86a, 0.16 + i * 0.12);
        g.strokeRoundedRect(prop.x + 4 - i * 3, prop.y + 4 - i * 3, prop.w - 8 + i * 6, prop.h - 8 + i * 6, 18);
      }
      g.fillStyle(0xf1c86a, 0.1);
      g.fillRoundedRect(prop.x + 6, prop.y + 6, prop.w - 12, prop.h - 12, 14);
      this.tweens.add({ targets: g, alpha: 0.35, duration: 1200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.marks.push(g);
    }
    // 調査地点の目印
    for (const ins of inspectsOf(room, s.flags)) {
      if (ins.glow) continue;
      const m = this.add.image((ins.x + 0.5) * TILE, (ins.y + 0.3) * TILE, 'mark').setDisplaySize(30, 30).setDepth(8600).setAlpha(0.8).setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({ targets: m, alpha: 0.25, scale: m.scale * 0.7, duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.marks.push(m);
    }
    this.applyBounds();
    this.syncActors(0, true);
    const hero = this.actors.get('hero');
    if (hero) {
      this.camTarget.set(hero.sprite.x, hero.sprite.y - 40);
      this.cameras.main.centerOn(this.camTarget.x, this.camTarget.y);
    }
  }

  private applyBounds(): void {
    if (!this.roomId || !this.view) return;
    const room = ROOMS[this.roomId];
    const W = room.w * TILE;
    const H = room.h * TILE;
    const vw = this.view.width;
    const vh = this.view.height;
    const bw = Math.max(W, vw);
    const bh = Math.max(H, vh);
    this.cameras.main.setBounds((W - bw) / 2, (H - bh) / 2, bw, bh);
  }

  private makeActor(a: Actor): ActorView {
    const s = G.state!;
    const key = this.charTexture(a.id);
    const shadow = this.add.image(0, 0, 'shadow').setDisplaySize(64 * CHAR_SCALE, 26 * CHAR_SCALE).setAlpha(0.75);
    const sprite = this.add.sprite(0, 0, key, 0).setOrigin(CHAR_FOOT.x / CHAR_W, CHAR_FOOT.y / CHAR_H).setDisplaySize(CHAR_W * CHAR_SCALE, CHAR_H * CHAR_SCALE);
    const name = a.id === 'hero' ? '' : NPC_BY_ID[a.id as NpcId].short;
    const style = { fontFamily: '"Hiragino Sans","Yu Gothic UI","Noto Sans JP",system-ui,sans-serif', fontSize: '15px', color: '#f2ecdc', stroke: '#05060c', strokeThickness: 4 };
    const label = this.add.text(0, 0, name, style).setOrigin(0.5, 1);
    const bubble = this.add.text(0, 0, '', { ...style, fontSize: '22px' }).setOrigin(0.5, 1).setVisible(false);
    const v: ActorView = { id: a.id, shadow, sprite, label, bubble, dist: 0, idle: 1e9, lastX: NaN, lastY: NaN };
    void s;
    this.setTextRes(v);
    return v;
  }

  private syncActors(dt: number, snap = false): void {
    const s = G.state!;
    const here = new Set<CharId>();
    for (const a of actorsIn(s, this.roomId)) {
      here.add(a.id);
      let v = this.actors.get(a.id);
      if (!v) {
        v = this.makeActor(a);
        this.actors.set(a.id, v);
      }
      let tx = a.pos.x;
      let ty = a.pos.y;
      if (a.step) {
        tx += (a.step.x - a.pos.x) * a.step.p;
        ty += (a.step.y - a.pos.y) * a.step.p;
      }
      const px = (tx + 0.5) * TILE;
      const py = (ty + 1) * TILE - 10;
      // 座っている人：席の腰の位置に、席の向きで描く（仮。正式の着席の絵が届いたら差し替える）
      const seat = a.seat && a.seat.room === this.roomId ? furnitureOf(this.roomId)?.seats.find((q) => q.id === a.seat!.id) : undefined;
      if (seat) {
        const folder = charFolder(a.id, s.hero.gender);
        const sitKey = `sit:${folder}`;
        const diagKey = `sitd:${folder}`;
        if (this.textures.exists(diagKey) && SIT_DIAG[seat.facing] !== undefined) {
          // 正式の着席の絵（斜め）
          if (v.sprite.texture.key !== diagKey) v.sprite.setTexture(diagKey);
          v.sprite.setFrame(SIT_DIAG[seat.facing]!).setOrigin(0.5, SIT_HIP_Y / CHAR_H);
          if (v.sprite.isCropped) v.sprite.setCrop();
        } else if (this.textures.exists(sitKey)) {
          // 正式の着席の絵（正面・後ろ・左・右。斜めの席は近い向き）
          if (v.sprite.texture.key !== sitKey) v.sprite.setTexture(sitKey);
          v.sprite.setFrame(DIR_ROW[SEAT_DIR[seat.facing] ?? 'down']).setOrigin(0.5, SIT_HIP_Y / CHAR_H);
          if (v.sprite.isCropped) v.sprite.setCrop();
        } else {
          // 仮：立ち絵の腿から下を表示の時だけ隠す
          const standKey = `stand:${folder}`;
          const key = this.textures.exists(standKey) ? standKey : `char:${folder}`;
          if (v.sprite.texture.key !== key) v.sprite.setTexture(key);
          const row = DIR_ROW[SEAT_DIR[seat.facing] ?? 'down'];
          v.sprite.setFrame(key === standKey ? row : row * 4 + 1);
          v.sprite.setOrigin(0.5, SEAT_HIP_Y / CHAR_H);
          v.sprite.setCrop(0, 0, CHAR_W, SEAT_CROP_Y);
        }
        v.sprite.setDisplaySize(CHAR_W * CHAR_SCALE, CHAR_H * CHAR_SCALE);
        v.sprite.setPosition(seat.hip[0], seat.hip[1]).setDepth(seatDepth(this.roomId, seat));
        v.shadow.setVisible(false);
        v.label.setPosition(seat.hip[0], seat.hip[1] - (SEAT_HIP_Y - 8) * CHAR_SCALE).setDepth(8700);
        if (a.bubble && a.bubble.until > s.simTime) v.bubble.setText(a.bubble.text).setPosition(seat.hip[0], seat.hip[1] - (SEAT_HIP_Y + 4) * CHAR_SCALE).setDepth(8701).setVisible(true);
        else v.bubble.setVisible(false);
        v.lastX = NaN;
        continue;
      }
      if (v.sprite.isCropped) v.sprite.setCrop();
      // 座っていた人が立った時は、足元の基準に戻す
      if (v.sprite.originY !== CHAR_FOOT.y / CHAR_H) v.sprite.setOrigin(CHAR_FOOT.x / CHAR_W, CHAR_FOOT.y / CHAR_H);
      v.shadow.setVisible(true);
      v.sprite.setPosition(px, py);
      v.shadow.setPosition(px, py - 2);
      // 歩行アニメーションは主人公と NPC で共通。進んだ距離でコマを送るので、移動速度と足の動きが常に一致する。
      // 1 マスと次の 1 マスの継ぎ目で一瞬だけ止まって見えないよう、止まってから少し経つまでは歩行のままにする。
      const moved = Number.isNaN(v.lastX) ? 0 : Math.abs(px - v.lastX) + Math.abs(py - v.lastY);
      const jumped = moved > TILE * 1.5;
      v.lastX = px;
      v.lastY = py;
      if (a.step && !jumped) {
        v.dist += moved;
        v.idle = 0;
      } else v.idle += dt;
      const walking = !!a.step || v.idle < WALK_LINGER_MS;
      if (!walking || jumped) v.dist = 0;
      const folder = charFolder(a.id, s.hero.gender);
      const standKey = `stand:${folder}`;
      const walkKey = `char:${folder}`;
      const row = DIR_ROW[a.pos.dir];
      if (!walking && this.textures.exists(standKey)) {
        if (v.sprite.texture.key !== standKey) v.sprite.setTexture(standKey);
        v.sprite.setFrame(row);
        // 待機画像は歩行画像と基準位置（頭部の中心、足元）や大きさが少し違うものがある。
        // 画像は変えず、描画の原点と表示倍率だけを合わせて、歩き出しと停止で位置が動かないようにする。
        const al = STAND_ALIGN[folder]?.[a.pos.dir];
        if (al) {
          v.sprite.setOrigin(al.x / CHAR_W, al.y / CHAR_H);
          v.sprite.setDisplaySize(CHAR_W * CHAR_SCALE * al.k, CHAR_H * CHAR_SCALE * al.k);
        } else {
          v.sprite.setOrigin(CHAR_FOOT.x / CHAR_W, CHAR_FOOT.y / CHAR_H);
          v.sprite.setDisplaySize(CHAR_W * CHAR_SCALE, CHAR_H * CHAR_SCALE);
        }
      } else {
        if (v.sprite.texture.key !== walkKey) v.sprite.setTexture(walkKey);
        v.sprite.setFrame(row * 4 + (walking ? walkFrame(v.dist) : 1));
        v.sprite.setOrigin(CHAR_FOOT.x / CHAR_W, CHAR_FOOT.y / CHAR_H);
        v.sprite.setDisplaySize(CHAR_W * CHAR_SCALE, CHAR_H * CHAR_SCALE);
      }
      v.sprite.setDepth(py);
      v.shadow.setDepth(py - 1);
      v.label.setPosition(px, py - CHAR_H * CHAR_SCALE + 14).setDepth(8700);
      if (a.bubble && a.bubble.until > s.simTime) v.bubble.setText(a.bubble.text).setPosition(px, py - CHAR_H * CHAR_SCALE - 4).setDepth(8701).setVisible(true);
      else v.bubble.setVisible(false);
    }
    for (const [id, v] of this.actors) {
      if (!here.has(id)) {
        v.shadow.destroy(); v.sprite.destroy(); v.label.destroy(); v.bubble.destroy();
        this.actors.delete(id);
      }
    }
    void snap;
  }

  /** プレイヤーの正面・周囲にある操作対象 */
  private findTarget(): Target {
    const s = G.state!;
    const hero = s.actors.hero;
    if (hero.step) return null;
    const f = facingTile(hero);
    const room = ROOMS[hero.pos.room];
    for (const a of actorsIn(s, room.id)) {
      if (a.id === 'hero') continue;
      const ax = a.step ? a.step.x : a.pos.x;
      const ay = a.step ? a.step.y : a.pos.y;
      if ((ax === f.x && ay === f.y) || (a.pos.x === f.x && a.pos.y === f.y)) return { kind: 'npc', id: a.id };
    }
    for (const ins of inspectsOf(room, s.flags)) {
      const df = Math.abs(ins.x - f.x) + Math.abs(ins.y - f.y);
      const dh = Math.abs(ins.x - hero.pos.x) + Math.abs(ins.y - hero.pos.y);
      if (df <= 1 || dh <= 1) return { kind: 'inspect', ins };
      // 卓などの家具ごと調べられる所：家具に向いている時
      if (ins.area) {
        const [x0, y0, x1, y1] = ins.area;
        if (f.x >= x0 && f.x <= x1 && f.y >= y0 && f.y <= y1) return { kind: 'inspect', ins };
      }
    }
    // 隣にいる NPC（向きが合っていなくても話せる）
    for (const a of actorsIn(s, room.id)) {
      if (a.id === 'hero') continue;
      if (Math.abs(a.pos.x - hero.pos.x) + Math.abs(a.pos.y - hero.pos.y) === 1) return { kind: 'npc', id: a.id };
    }
    // 向いている方向の 2 マス先にいる NPC にも声を掛けられる（机越しや、歩いている相手を呼び止める時）
    const f2 = { x: f.x + (f.x - hero.pos.x), y: f.y + (f.y - hero.pos.y) };
    for (const a of actorsIn(s, room.id)) {
      if (a.id === 'hero') continue;
      const ax = a.step ? a.step.x : a.pos.x;
      const ay = a.step ? a.step.y : a.pos.y;
      if ((ax === f2.x && ay === f2.y) || (a.pos.x === f2.x && a.pos.y === f2.y)) return { kind: 'npc', id: a.id };
    }
    for (const d of room.doors) {
      if (doorDir(d) === hero.pos.dir && doorApproach(room, d).some((t) => t.x === hero.pos.x && t.y === hero.pos.y)) return { kind: 'door', door: d };
    }
    // 椅子に座る、立つ、房の寝台で休む
    const na = nearbyAction(s);
    if (na) return na.kind === 'sit' ? { kind: 'sit', seat: na.seat } : { kind: na.kind };
    return null;
  }

  private pushKey = '';
  private prevHeld: Dir | undefined;
  private pushMs = 0;

  update(_time: number, delta: number): void {
    Input.update();
    const s = G.state;
    if (!s || !G.fieldVisible) {
      if (this.roomId) { this.clearRoom(); this.roomId = ''; }
      return;
    }
    const hero = s.actors.hero;
    if (hero.pos.room !== this.roomId || this.flagsKey !== this.currentFlagsKey(ROOMS[hero.pos.room])) this.buildRoom();
    const dt = Math.min(delta, 100);
    // 描画の状況を記録する（1 秒あたりのコマ数と、50ms を超えて遅れたコマの数）
    const now = performance.now();
    if (this.lastFrameAt) {
      const gap = now - this.lastFrameAt;
      G.perf.fps = G.perf.fps ? G.perf.fps * 0.95 + (1000 / Math.max(1, gap)) * 0.05 : 1000 / Math.max(1, gap);
      if (gap > 50) G.perf.slow++;
    }
    this.lastFrameAt = now;
    G.perf.w = this.scale.gameSize.width;
    G.perf.h = this.scale.gameSize.height;
    const control = G.fieldActive && !anyModal() && !G.heroBusy;
    if (control) {
      // 移動：スティック（スマホ）かキーボードの方向キー。斜めにも 1 マスずつ進む。速さは一定
      const v: Vec | null = Input.stickVector() ?? keysVector(Input.isDown('up'), Input.isDown('down'), Input.isDown('left'), Input.isDown('right'));
      const held: Dir | undefined = v ? face4(v, hero.pos.dir) : undefined;
      const fresh = !!held && held !== this.prevHeld;
      this.prevHeld = held;
      // 押している向きは「意図」として渡し、1 マス歩き終えた瞬間に次の 1 マスへ途切れずに進ませる
      hero.intent = held;
      hero.intentV = v ?? undefined;
      if (!v) G.doorHold = false;
      if (v && held) {
        hero.path = [];
        hero.route = [];
        if (!hero.step) {
          const before = hero.pos.dir;
          if (!stepToward(s, hero, v)) {
            // 壁に向かって押した：扉なら通る（斜めに押した時は、縦横どちらかの成分が扉の向きなら通る）
            const room = ROOMS[hero.pos.room];
            const comps = new Set<Dir>([held]);
            if (Math.abs(v.x) > 0.38) comps.add(v.x > 0 ? 'right' : 'left');
            if (Math.abs(v.y) > 0.38) comps.add(v.y > 0 ? 'down' : 'up');
            const door = room.doors.find((d) => comps.has(doorDir(d)) && doorApproach(room, d).some((t) => t.x === hero.pos.x && t.y === hero.pos.y));
            if (door && !G.doorHold && (before === doorDir(door) || fresh || comps.size > 1)) {
              hero.pos.dir = doorDir(door);
              G.interact({ kind: 'door', door }, true);
            } else if (!door) {
              // 人に道を塞がれている：同じ方向へ押し続けると、相手と場所を入れ替わって通り抜ける（閉じ込められないようにする）
              const dd = DIRS[held];
              const tx = hero.pos.x + dd.dx;
              const ty = hero.pos.y + dd.dy;
              const blocker = actorsIn(s, room.id).find((a) => a.id !== 'hero' && !a.step && a.pos.x === tx && a.pos.y === ty);
              const key = blocker ? `${blocker.id}:${held}` : '';
              this.pushMs = key && key === this.pushKey ? this.pushMs + dt : 0;
              this.pushKey = key;
              if (blocker && this.pushMs >= 380) {
                blocker.step = { x: hero.pos.x, y: hero.pos.y, p: 0 };
                blocker.pos.dir = held === 'up' ? 'down' : held === 'down' ? 'up' : held === 'left' ? 'right' : 'left';
                blocker.path = [];
                hero.pos.dir = held;
                hero.step = { x: tx, y: ty, p: 0 };
                this.pushMs = 0;
              }
            }
          } else this.pushKey = '';
        }
      }
      if (Input.justPressed('a')) {
        const t = this.findTarget();
        if (t) G.interact(t);
      }
      if (Input.justPressed('start') || Input.justPressed('b')) G.openMenu();
    }
    if (!control) {
      hero.intent = undefined;
      hero.intentV = undefined;
      this.prevHeld = undefined;
      // 画面の切り替え（扉）や会話の間は、スティックの指を解除する。触れ直すまで動かない
      if (Input.stickActive()) Input.releaseStick();
    }
    G.tick(dt);
    if (hero.pos.room !== this.roomId) this.buildRoom();
    this.updateDoors();
    this.updateGuide();
    this.syncActors(dt);
    this.target = control ? this.findTarget() : null;
    // カメラは主人公に遅れなく付ける（遅れて追う方式は、主人公と背景の動きがずれてガタついて見えるため使わない）
    const hv = this.actors.get('hero');
    if (G.camFocus) {
      // 演出中（自己紹介など）：指定の位置へ、なめらかに寄せる
      const k = Math.min(1, dt / 220);
      this.camTarget.set(this.camTarget.x + ((G.camFocus.x * TILE) - this.camTarget.x) * k, this.camTarget.y + ((G.camFocus.y * TILE) - this.camTarget.y) * k);
      this.cameras.main.centerOn(this.camTarget.x, this.camTarget.y);
    } else if (hv) {
      this.camTarget.set(hv.sprite.x, hv.sprite.y - 40);
      this.cameras.main.centerOn(this.camTarget.x, this.camTarget.y);
    }
    void DIRS; void ALL_IDS;
  }
}
