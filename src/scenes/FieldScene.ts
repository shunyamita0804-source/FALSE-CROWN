import Phaser from 'phaser';
import { G } from '../app/game';
import { assetFile, CHAR_FOOT, CHAR_H, CHAR_SCALE, CHAR_W, charFolder, TILE } from '../assets/registry';
import { drawCharSheet, drawLightmap, drawProp, drawRoom, drawShadow } from '../assets/placeholders';
import { hashString } from '../core/rng';
import type { Actor, Dir } from '../core/types';
import { ALL_IDS, HERO_PALETTES, NPC_BY_ID, type CharId, type NpcId } from '../data/characters';
import { fitCameraToReference, type LogicalView } from '../display/viewport';
import { Input } from '../input/InputState';
import { anyModal } from '../ui/dom';
import { ROOMS, doorApproach, doorDir, propVisible, type DoorDef, type InspectDef, type RoomDef } from '../world/maps';
import { PROPS } from '../world/props';
import { DIRS, actorsIn, collisionOf, facingTile, setPathTo, tryStep } from '../world/sim';

/** 仮素材テクスチャの解像度倍率（論理 64px/タイル に対して） */
const TEX = 1.5;
const DIR_ROW: Record<Dir, number> = { down: 0, up: 1, left: 2, right: 3 };

interface ActorView {
  id: CharId;
  shadow: Phaser.GameObjects.Image;
  sprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  bubble: Phaser.GameObjects.Text;
  anim: number;
}

export type Target = { kind: 'npc'; id: CharId } | { kind: 'inspect'; ins: InspectDef } | { kind: 'door'; door: DoorDef } | null;

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
  private marks: Phaser.GameObjects.Image[] = [];
  private flagsKey = '';
  private pendingTarget: Target = null;
  private camTarget = new Phaser.Math.Vector2();
  target: Target = null;

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
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onTap(p));
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
      if (room && this.roomId === room.id && keys.some((k) => k === `asset:${room.image}` || k === `asset:${room.overlay?.image}`)) this.buildRoom();
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

  private clearRoom(): void {
    for (const o of this.roomObjects) o.destroy();
    this.roomObjects = [];
    for (const m of this.marks) m.destroy();
    this.marks = [];
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
    return [...keys].map((k) => (s.flags[k] ? 1 : 0)).join('') + (s.phase === 'night' ? 'n' : 'd');
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
    }
    // 調査地点の目印
    for (const ins of room.inspects) {
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
    const v: ActorView = { id: a.id, shadow, sprite, label, bubble, anim: 0 };
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
      v.sprite.setPosition(px, py);
      v.shadow.setPosition(px, py - 2);
      const walking = !!a.step;
      v.anim = walking ? v.anim + dt / 130 : 0;
      // 静止時は正式素材の静止シート（下・上・左・右の 4 コマ）を使う。無ければ歩行シートの 2 コマ目
      const standKey = `stand:${charFolder(a.id, s.hero.gender)}`;
      const walkKey = `char:${charFolder(a.id, s.hero.gender)}`;
      if (!walking && this.textures.exists(standKey)) {
        if (v.sprite.texture.key !== standKey) v.sprite.setTexture(standKey);
        v.sprite.setFrame(DIR_ROW[a.pos.dir]);
      } else {
        if (v.sprite.texture.key !== walkKey) v.sprite.setTexture(walkKey);
        v.sprite.setFrame(DIR_ROW[a.pos.dir] * 4 + (walking ? Math.floor(v.anim) % 4 : 1));
      }
      v.sprite.setDisplaySize(CHAR_W * CHAR_SCALE, CHAR_H * CHAR_SCALE);
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
    for (const ins of room.inspects) {
      const df = Math.abs(ins.x - f.x) + Math.abs(ins.y - f.y);
      const dh = Math.abs(ins.x - hero.pos.x) + Math.abs(ins.y - hero.pos.y);
      if (df <= 1 || dh <= 1) return { kind: 'inspect', ins };
    }
    // 隣にいる NPC（向きが合っていなくても話せる）
    for (const a of actorsIn(s, room.id)) {
      if (a.id === 'hero') continue;
      if (Math.abs(a.pos.x - hero.pos.x) + Math.abs(a.pos.y - hero.pos.y) === 1) return { kind: 'npc', id: a.id };
    }
    for (const d of room.doors) {
      if (doorDir(d) === hero.pos.dir && doorApproach(room, d).some((t) => t.x === hero.pos.x && t.y === hero.pos.y)) return { kind: 'door', door: d };
    }
    return null;
  }

  private onTap(p: Phaser.Input.Pointer): void {
    const s = G.state;
    if (!s || !G.fieldActive || anyModal() || G.heroBusy) return;
    const cam = this.cameras.main;
    const wp = cam.getWorldPoint(p.x, p.y);
    const tx = Math.floor(wp.x / TILE);
    const ty = Math.floor(wp.y / TILE);
    const hero = s.actors.hero;
    const room = ROOMS[hero.pos.room];
    this.pendingTarget = null;
    // NPC
    for (const a of actorsIn(s, room.id)) {
      if (a.id === 'hero') continue;
      if (Math.abs(a.pos.x - tx) <= 0 && (a.pos.y === ty || a.pos.y - 1 === ty)) {
        this.pendingTarget = { kind: 'npc', id: a.id };
        if (Math.abs(a.pos.x - hero.pos.x) + Math.abs(a.pos.y - hero.pos.y) === 1) { this.arrive(); return; }
        setPathTo(s, hero, a.pos.x, a.pos.y);
        if (hero.path.length) hero.path.pop();
        return;
      }
    }
    // 調査地点
    for (const ins of room.inspects) {
      if (Math.abs(ins.x - tx) <= 1 && Math.abs(ins.y - ty) <= 1) {
        this.pendingTarget = { kind: 'inspect', ins };
        if (Math.abs(ins.x - hero.pos.x) + Math.abs(ins.y - hero.pos.y) <= 1) { this.arrive(); return; }
        const grid = collisionOf(s, room.id);
        setPathTo(s, hero, ins.x, ins.y);
        if (grid[ins.y]?.[ins.x] === false && hero.path.length) hero.path.pop();
        return;
      }
    }
    // 扉
    for (const d of room.doors) {
      const tiles = doorApproach(room, d);
      const v = DIRS[d.dir];
      const hit = tiles.some((t) => [0, 1, 2].some((k) => t.x + v.dx * k === tx && t.y + v.dy * k === ty));
      if (hit) {
        this.pendingTarget = { kind: 'door', door: d };
        const t = tiles.reduce((a, b) => (Math.abs(a.x - hero.pos.x) + Math.abs(a.y - hero.pos.y) <= Math.abs(b.x - hero.pos.x) + Math.abs(b.y - hero.pos.y) ? a : b));
        if (t.x === hero.pos.x && t.y === hero.pos.y) { this.arrive(); return; }
        setPathTo(s, hero, t.x, t.y);
        return;
      }
    }
    setPathTo(s, hero, tx, ty);
  }

  /** タップで指定した対象に到着した */
  private arrive(): void {
    const s = G.state!;
    const hero = s.actors.hero;
    const t = this.pendingTarget;
    this.pendingTarget = null;
    if (!t) return;
    if (t.kind === 'npc') {
      const a = s.actors[t.id];
      if (a.pos.room === hero.pos.room && Math.abs(a.pos.x - hero.pos.x) + Math.abs(a.pos.y - hero.pos.y) <= 2) {
        hero.pos.dir = Math.abs(a.pos.x - hero.pos.x) > Math.abs(a.pos.y - hero.pos.y) ? (a.pos.x > hero.pos.x ? 'right' : 'left') : a.pos.y > hero.pos.y ? 'down' : 'up';
        G.interact(t);
      }
    } else if (t.kind === 'inspect') {
      G.interact(t);
    } else if (t.kind === 'door') {
      hero.pos.dir = doorDir(t.door);
      G.interact(t);
    }
  }

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
    const control = G.fieldActive && !anyModal() && !G.heroBusy;
    if (control) {
      // 4 方向移動：押している方向へ 1 タイルずつ進む
      const dirs: Dir[] = ['up', 'down', 'left', 'right'];
      const held = dirs.find((d) => Input.isDown(d));
      if (held) {
        hero.path = [];
        this.pendingTarget = null;
        if (!hero.step) {
          const before = hero.pos.dir;
          if (!tryStep(s, hero, held)) {
            // 壁に向かって押した：扉なら通る
            const room = ROOMS[hero.pos.room];
            const door = room.doors.find((d) => doorDir(d) === held && doorApproach(room, d).some((t) => t.x === hero.pos.x && t.y === hero.pos.y));
            if (door && (before === held || Input.justPressed(held))) G.interact({ kind: 'door', door });
          }
        }
      }
      if (Input.justPressed('a')) {
        const t = this.findTarget();
        if (t) G.interact(t);
      }
      if (Input.justPressed('start') || Input.justPressed('b')) G.openMenu();
    }
    G.tick(dt);
    if (hero.pos.room !== this.roomId) this.buildRoom();
    // タップ移動の到着判定
    if (this.pendingTarget && !hero.step && !hero.path.length && control) this.arrive();
    this.syncActors(dt);
    this.target = control ? this.findTarget() : null;
    // カメラ追従（滑らかに）
    const hv = this.actors.get('hero');
    if (hv) {
      const k = 1 - Math.pow(0.001, dt / 1000);
      this.camTarget.x += (hv.sprite.x - this.camTarget.x) * k;
      this.camTarget.y += (hv.sprite.y - 40 - this.camTarget.y) * k;
      this.cameras.main.centerOn(this.camTarget.x, this.camTarget.y);
    }
    void DIRS; void ALL_IDS;
  }
}
