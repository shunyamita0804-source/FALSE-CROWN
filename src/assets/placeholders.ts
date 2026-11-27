/**
 * 仮素材の生成（Canvas 2D によるベクター描画）。正式素材が届くまでの代用で、
 * レジストリに正式 PNG があればそちらが使われる。低解像度の拡大やピクセル化はせず、
 * 表示倍率に合わせた解像度で滑らかに描く。
 */
import type { Palette } from '../data/characters';
import { PROPS } from '../world/props';
import type { RoomDef, Theme } from '../world/maps';

type Ctx = CanvasRenderingContext2D;

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function rr(g: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const k = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + k, y);
  g.arcTo(x + w, y, x + w, y + h, k);
  g.arcTo(x + w, y + h, x, y + h, k);
  g.arcTo(x, y + h, x, y, k);
  g.arcTo(x, y, x + w, y, k);
  g.closePath();
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt))));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function vgrad(g: Ctx, y0: number, y1: number, a: string, b: string): CanvasGradient {
  const gr = g.createLinearGradient(0, y0, 0, y1);
  gr.addColorStop(0, a);
  gr.addColorStop(1, b);
  return gr;
}

/** 決定論的な擬似乱数（模様用） */
function noise(i: number, j: number, k = 0): number {
  const s = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

// ---------------- キャラクター ----------------

/**
 * 歩行シート（4列×4行：下・上・左・右）。1コマ 96×128、足元基準 (48,120)。
 * 頭身・シルエットは GBA 期の見下ろし RPG に近い 2.5 頭身、描画は高精細。
 */
export function drawCharSheet(pal: Palette, gender: 'm' | 'f', scale: number, seed: number): HTMLCanvasElement {
  const c = makeCanvas(96 * 4 * scale, 128 * 4 * scale);
  const g = c.getContext('2d')!;
  g.scale(scale, scale);
  const dirs = ['down', 'up', 'left', 'right'] as const;
  dirs.forEach((dir, row) => {
    for (let f = 0; f < 4; f++) {
      g.save();
      g.translate(f * 96, row * 128);
      drawChar(g, pal, gender, dir, f, seed);
      g.restore();
    }
  });
  return c;
}

function drawChar(g: Ctx, pal: Palette, gender: 'm' | 'f', dir: 'down' | 'up' | 'left' | 'right', frame: number, seed: number): void {
  const cx = 48;
  const foot = 120;
  const phase = [0, 1, 0, -1][frame];
  const bob = frame % 2 === 1 ? -2 : 0;
  const side = dir === 'left' || dir === 'right';
  const flip = dir === 'left' ? -1 : 1;
  g.save();
  g.translate(cx, 0);
  if (side) g.scale(flip, 1);
  const out = 'rgba(12,10,20,0.85)';
  g.lineJoin = 'round';
  g.lineWidth = 2.5;
  // 脚
  const legW = 11;
  const legH = 26;
  const ly = foot - legH;
  const drawLeg = (x: number, dy: number, dark: boolean) => {
    g.fillStyle = dark ? shade(pal.pants, -0.25) : pal.pants;
    rr(g, x - legW / 2, ly + dy, legW, legH - dy, 4);
    g.fill(); g.strokeStyle = out; g.stroke();
    g.fillStyle = '#1a1418';
    rr(g, x - legW / 2 - 1, foot - 7, legW + (side ? 5 : 2), 7, 3);
    g.fill();
  };
  if (side) {
    drawLeg(-3 - phase * 7, phase < 0 ? 3 : 0, true);
    drawLeg(3 + phase * 7, phase > 0 ? 3 : 0, false);
  } else {
    drawLeg(-8, phase > 0 ? 4 : 0, false);
    drawLeg(8, phase < 0 ? 4 : 0, false);
  }
  // 胴（コート）
  const by = 62 + bob;
  const bw = side ? 30 : 38;
  const bh = gender === 'f' ? 40 : 36;
  g.fillStyle = vgrad(g, by, by + bh, shade(pal.coat, 0.16), shade(pal.coat, -0.2));
  g.beginPath();
  g.moveTo(-bw / 2, by + 6);
  g.quadraticCurveTo(-bw / 2, by, -bw / 2 + 8, by);
  g.lineTo(bw / 2 - 8, by);
  g.quadraticCurveTo(bw / 2, by, bw / 2, by + 6);
  g.lineTo(bw / 2 + (gender === 'f' ? 4 : 1), by + bh);
  g.lineTo(-bw / 2 - (gender === 'f' ? 4 : 1), by + bh);
  g.closePath();
  g.fill(); g.strokeStyle = out; g.stroke();
  // 襟・アクセント
  if (dir === 'down') {
    g.fillStyle = pal.accent;
    g.beginPath(); g.moveTo(-6, by + 1); g.lineTo(0, by + 16); g.lineTo(6, by + 1); g.closePath(); g.fill();
    g.strokeStyle = shade(pal.coat, -0.4); g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, by + 16); g.lineTo(0, by + bh - 2); g.stroke();
    g.lineWidth = 2.5;
  } else if (side) {
    g.fillStyle = pal.accent;
    rr(g, bw / 2 - 9, by + 2, 6, 12, 2); g.fill();
  }
  // 腕
  const armY = by + 5;
  const arm = (x: number, sw: number) => {
    g.fillStyle = shade(pal.coat, -0.08);
    g.save(); g.translate(x, armY); g.rotate(sw);
    rr(g, -5, 0, 10, 26, 5); g.fill(); g.strokeStyle = out; g.stroke();
    g.fillStyle = pal.skin; g.beginPath(); g.arc(0, 27, 4.5, 0, Math.PI * 2); g.fill(); g.stroke();
    g.restore();
  };
  if (side) arm(1, phase * 0.45);
  else { arm(-bw / 2 - 1, phase * 0.12 + 0.06); arm(bw / 2 + 1, -phase * 0.12 - 0.06); }
  // 頭
  const hy = 38 + bob;
  const hr = 22;
  g.fillStyle = pal.skin;
  g.beginPath(); g.ellipse(0, hy, hr - 1, hr, 0, 0, Math.PI * 2); g.fill(); g.strokeStyle = out; g.stroke();
  // 髪
  g.fillStyle = vgrad(g, hy - hr, hy + hr, shade(pal.hair, 0.22), pal.hair);
  const long = gender === 'f';
  g.beginPath();
  if (dir === 'up') {
    g.ellipse(0, hy - 1, hr + 1, hr + 1, 0, 0, Math.PI * 2);
    if (long) { g.rect(-hr - 1, hy, (hr + 1) * 2, 22 + (seed % 3) * 4); }
  } else if (side) {
    g.ellipse(-2, hy - 3, hr + 1, hr, 0, Math.PI * 0.95, Math.PI * 2.25);
    g.lineTo(-hr - 1, hy + (long ? 26 : 8));
    g.lineTo(-hr + 6, hy + (long ? 24 : 4));
    g.lineTo(4, hy - 8);
  } else {
    g.ellipse(0, hy - 4, hr + 1, hr, 0, Math.PI, Math.PI * 2);
    const part = (seed % 5) - 2;
    g.lineTo(hr + 1, hy + (long ? 24 : 2));
    g.lineTo(hr - 5, hy + (long ? 22 : 0));
    g.quadraticCurveTo(hr - 6, hy - 10, part * 3 + 4, hy - 12);
    g.quadraticCurveTo(-hr + 8, hy - 10, -hr + 5, hy + (long ? 22 : 0));
    g.lineTo(-hr - 1, hy + (long ? 24 : 2));
  }
  g.closePath(); g.fill(); g.strokeStyle = out; g.stroke();
  // 顔
  if (dir === 'down') {
    g.fillStyle = '#1b1620';
    g.beginPath(); g.ellipse(-8, hy + 4, 2.6, 3.6, 0, 0, Math.PI * 2); g.ellipse(8, hy + 4, 2.6, 3.6, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.beginPath(); g.arc(-7, hy + 3, 1, 0, Math.PI * 2); g.arc(9, hy + 3, 1, 0, Math.PI * 2); g.fill();
  } else if (side) {
    g.fillStyle = '#1b1620';
    g.beginPath(); g.ellipse(11, hy + 3, 2.4, 3.6, 0, 0, Math.PI * 2); g.fill();
  }
  g.restore();
}

/** 会話用の仮立ち絵（768×1024 相当の比率）。表情は眉と口で表す */
export function drawPortrait(pal: Palette, gender: 'm' | 'f', expr: string, w: number, seed: number): HTMLCanvasElement {
  const h = Math.round((w * 1024) / 768);
  const c = makeCanvas(w, h);
  const g = c.getContext('2d')!;
  const s = w / 768;
  g.scale(s, s);
  g.lineJoin = 'round';
  // 肩・胴
  g.fillStyle = vgrad(g, 560, 1024, shade(pal.coat, 0.14), shade(pal.coat, -0.35));
  g.beginPath();
  g.moveTo(90, 1024); g.quadraticCurveTo(100, 660, 300, 610); g.lineTo(468, 610); g.quadraticCurveTo(668, 660, 678, 1024); g.closePath(); g.fill();
  g.fillStyle = pal.accent;
  g.beginPath(); g.moveTo(320, 612); g.lineTo(384, 800); g.lineTo(448, 612); g.closePath(); g.fill();
  g.strokeStyle = shade(pal.coat, -0.5); g.lineWidth = 6;
  g.beginPath(); g.moveTo(300, 612); g.lineTo(384, 830); g.lineTo(468, 612); g.stroke();
  // 首
  g.fillStyle = shade(pal.skin, -0.12);
  rr(g, 334, 520, 100, 120, 30); g.fill();
  // 後ろ髪
  g.fillStyle = shade(pal.hair, -0.2);
  if (gender === 'f') { g.beginPath(); g.ellipse(384, 430, 230, 330, 0, 0, Math.PI * 2); g.fill(); }
  // 顔
  g.fillStyle = vgrad(g, 180, 600, shade(pal.skin, 0.06), shade(pal.skin, -0.08));
  g.beginPath(); g.ellipse(384, 380, 170, 205, 0, 0, Math.PI * 2); g.fill();
  // 前髪
  g.fillStyle = vgrad(g, 150, 420, shade(pal.hair, 0.25), pal.hair);
  g.beginPath();
  g.ellipse(384, 300, 190, 170, 0, Math.PI, Math.PI * 2);
  const part = ((seed % 5) - 2) * 26;
  g.lineTo(574, gender === 'f' ? 470 : 360);
  g.quadraticCurveTo(540, 290, 400 + part, 262);
  g.quadraticCurveTo(250, 290, 194, gender === 'f' ? 470 : 360);
  g.closePath(); g.fill();
  // 目・眉・口
  const brow = { normal: 0, smile: -4, anger: 14, sad: -12, wary: 8, smirk: 4, surprise: -16, think: 6 }[expr] ?? 0;
  const eyeH = expr === 'smile' ? 6 : expr === 'surprise' ? 26 : expr === 'wary' || expr === 'think' ? 12 : 18;
  g.fillStyle = '#1c1722';
  for (const sx of [-1, 1]) {
    g.beginPath(); g.ellipse(384 + sx * 68, 396, 17, eyeH, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = shade(pal.hair, -0.3); g.lineWidth = 9; g.lineCap = 'round';
    g.beginPath();
    g.moveTo(384 + sx * 98, 350 - (expr === 'sad' ? brow : 0));
    g.lineTo(384 + sx * 40, 350 + (expr === 'anger' || expr === 'wary' ? brow : expr === 'sad' ? 0 : brow / 2));
    g.stroke();
  }
  g.fillStyle = 'rgba(255,255,255,0.85)';
  if (eyeH > 8) { g.beginPath(); g.arc(322, 388, 5, 0, Math.PI * 2); g.arc(458, 388, 5, 0, Math.PI * 2); g.fill(); }
  g.strokeStyle = '#8a3a3a'; g.lineWidth = 7; g.lineCap = 'round';
  g.beginPath();
  if (expr === 'smile') { g.moveTo(344, 478); g.quadraticCurveTo(384, 514, 424, 478); }
  else if (expr === 'smirk') { g.moveTo(350, 488); g.quadraticCurveTo(396, 500, 430, 470); }
  else if (expr === 'anger') { g.moveTo(350, 496); g.quadraticCurveTo(384, 474, 418, 496); }
  else if (expr === 'sad') { g.moveTo(354, 494); g.quadraticCurveTo(384, 482, 414, 494); }
  else if (expr === 'surprise') { g.ellipse(384, 490, 16, 22, 0, 0, Math.PI * 2); }
  else { g.moveTo(356, 486); g.lineTo(412, 486); }
  g.stroke();
  return c;
}

export function drawFace(pal: Palette, gender: 'm' | 'f', size: number, seed: number): HTMLCanvasElement {
  const p = drawPortrait(pal, gender, 'normal', size * 1.5, seed);
  const c = makeCanvas(size, size);
  const g = c.getContext('2d')!;
  const bg = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.7);
  bg.addColorStop(0, '#2a3048'); bg.addColorStop(1, '#10121e');
  g.fillStyle = bg; g.fillRect(0, 0, size, size);
  g.drawImage(p, -size * 0.25, -size * 0.18);
  return c;
}

// ---------------- 部屋（床・壁） ----------------

const THEME: Record<Theme, { wall: string; wallTop: string; trim: string; floor: string; floor2: string; base: string }> = {
  living: { wall: '#5a4034', wallTop: '#2a1c18', trim: '#c9a55a', floor: '#8a6648', floor2: '#7a5a40', base: '#3a2820' },
  common: { wall: '#2e3850', wallTop: '#161c2a', trim: '#8a94a8', floor: '#5a6274', floor2: '#4e5668', base: '#1e2434' },
  arena: { wall: '#1c1a24', wallTop: '#0c0b12', trim: '#c9a55a', floor: '#2a2834', floor2: '#232230', base: '#131219' },
  prison: { wall: '#3a4048', wallTop: '#1a1e24', trim: '#5a6470', floor: '#4a5058', floor2: '#42484f', base: '#22262c' },
  secret: { wall: '#2a2e34', wallTop: '#121418', trim: '#4a7a8a', floor: '#3a3e44', floor2: '#34383e', base: '#1a1c20' },
  garden: { wall: '#2e3850', wallTop: '#161c2a', trim: '#8a94a8', floor: '#4a7a4a', floor2: '#427042', base: '#1e2434' },
};

function drawFloorTile(g: Ctx, style: string, th: (typeof THEME)[Theme], x: number, y: number, T: number, i: number, j: number): void {
  const n = noise(i, j);
  switch (style) {
    case 'wood': {
      g.fillStyle = (i + j) % 2 ? th.floor : th.floor2;
      g.fillRect(x, y, T, T);
      g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = Math.max(1, T / 48);
      for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(x, y + (k * T) / 4); g.lineTo(x + T, y + (k * T) / 4); g.stroke(); }
      const off = (j % 2) * T * 0.5 + n * T * 0.3;
      g.beginPath(); g.moveTo(x + (off % T), y); g.lineTo(x + (off % T), y + T / 4); g.stroke();
      g.fillStyle = `rgba(255,230,190,${0.03 + n * 0.04})`; g.fillRect(x, y, T, T);
      break;
    }
    case 'marble': {
      g.fillStyle = (i + j) % 2 ? th.floor : th.floor2;
      g.fillRect(x, y, T, T);
      g.strokeStyle = `rgba(255,255,255,${0.04 + n * 0.05})`; g.lineWidth = Math.max(1, T / 40);
      g.beginPath(); g.moveTo(x + n * T, y); g.bezierCurveTo(x + T * 0.3, y + T * 0.4, x + T * 0.8, y + T * 0.5, x + noise(j, i) * T, y + T); g.stroke();
      g.strokeStyle = 'rgba(201,165,90,0.22)'; g.lineWidth = Math.max(1, T / 64);
      g.strokeRect(x + 0.5, y + 0.5, T - 1, T - 1);
      break;
    }
    case 'carpet': {
      g.fillStyle = '#5a2430';
      g.fillRect(x, y, T, T);
      g.fillStyle = `rgba(0,0,0,${0.05 + n * 0.08})`; g.fillRect(x, y, T, T);
      g.strokeStyle = 'rgba(216,178,90,0.12)'; g.lineWidth = Math.max(1, T / 48);
      g.beginPath(); g.moveTo(x + T / 2, y + T * 0.15); g.lineTo(x + T * 0.85, y + T / 2); g.lineTo(x + T / 2, y + T * 0.85); g.lineTo(x + T * 0.15, y + T / 2); g.closePath(); g.stroke();
      break;
    }
    case 'grass': {
      g.fillStyle = (i + j) % 2 ? '#3f6a40' : '#3a633c';
      g.fillRect(x, y, T, T);
      g.strokeStyle = 'rgba(160,210,140,0.25)'; g.lineWidth = Math.max(1, T / 48);
      for (let k = 0; k < 5; k++) {
        const bx = x + noise(i, j, k) * T; const byy = y + noise(j, i, k) * T;
        g.beginPath(); g.moveTo(bx, byy); g.lineTo(bx + T * 0.04, byy - T * 0.12); g.stroke();
      }
      break;
    }
    case 'tile': {
      g.fillStyle = (i + j) % 2 ? '#c8d0d4' : '#b4bcc2';
      g.fillRect(x, y, T, T);
      g.strokeStyle = 'rgba(60,70,80,0.35)'; g.lineWidth = Math.max(1, T / 40);
      g.strokeRect(x + 0.5, y + 0.5, T - 1, T - 1);
      g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x + T * 0.1, y + T * 0.1, T * 0.35, T * 0.08);
      break;
    }
    case 'concrete': {
      g.fillStyle = th.floor; g.fillRect(x, y, T, T);
      g.fillStyle = `rgba(0,0,0,${n * 0.12})`; g.fillRect(x, y, T, T);
      if (i % 4 === 0) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, y, Math.max(1, T / 32), T); }
      if (j % 4 === 0) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, y, T, Math.max(1, T / 32)); }
      break;
    }
    default: {
      // stone
      g.fillStyle = (i + j) % 2 ? th.floor : th.floor2;
      g.fillRect(x, y, T, T);
      g.fillStyle = `rgba(0,0,0,${n * 0.14})`; g.fillRect(x, y, T, T);
      g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = Math.max(1, T / 40);
      g.strokeRect(x + 0.5, y + 0.5, T - 1, T - 1);
    }
  }
}

/** 部屋の背景（床・壁・扉）を 1 枚のキャンバスに描く。T は 1 タイルのピクセル数 */
export function drawRoom(room: RoomDef, T: number, flags: Record<string, unknown>): HTMLCanvasElement {
  const c = makeCanvas(room.w * T, room.h * T);
  const g = c.getContext('2d')!;
  const th = THEME[room.theme];
  const style = room.floorStyle ?? 'stone';
  g.fillStyle = th.base;
  g.fillRect(0, 0, c.width, c.height);
  for (let j = 2; j < room.h - 1; j++) for (let i = 1; i < room.w - 1; i++) drawFloorTile(g, style, th, i * T, j * T, T, i, j);
  // 上壁（2 タイル分の壁面）
  const wy = 0;
  g.fillStyle = vgrad(g, wy, T * 2, shade(th.wall, 0.12), shade(th.wall, -0.25));
  g.fillRect(T * 0.5, wy, c.width - T, T * 2);
  // 腰壁・モールディング
  g.fillStyle = shade(th.wall, -0.35);
  g.fillRect(T * 0.5, T * 1.35, c.width - T, T * 0.65);
  g.fillStyle = th.trim;
  g.globalAlpha = 0.75;
  g.fillRect(T * 0.5, T * 1.3, c.width - T, Math.max(2, T * 0.06));
  g.fillRect(T * 0.5, T * 0.12, c.width - T, Math.max(2, T * 0.05));
  g.globalAlpha = 1;
  // 壁の縦パネル
  g.strokeStyle = 'rgba(0,0,0,0.22)'; g.lineWidth = Math.max(1, T / 32);
  for (let i = 1; i < room.w; i += 2) { g.beginPath(); g.moveTo(i * T, T * 0.2); g.lineTo(i * T, T * 1.3); g.stroke(); }
  // 壁際の影
  const sh = g.createLinearGradient(0, T * 2, 0, T * 3);
  sh.addColorStop(0, 'rgba(0,0,0,0.45)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = sh; g.fillRect(T, T * 2, c.width - T * 2, T);
  // 左右・下の壁（上から見た壁の厚み）
  g.fillStyle = th.wallTop;
  g.fillRect(0, 0, T * 0.5, c.height);
  g.fillRect(c.width - T * 0.5, 0, T * 0.5, c.height);
  g.fillRect(0, c.height - T * 0.5, c.width, T * 0.5);
  g.fillStyle = shade(th.wall, -0.1);
  g.fillRect(T * 0.5, T * 2, T * 0.5, c.height - T * 2.5);
  g.fillRect(c.width - T, T * 2, T * 0.5, c.height - T * 2.5);
  g.fillRect(T * 0.5, c.height - T, c.width - T, T * 0.5);
  g.fillStyle = th.trim; g.globalAlpha = 0.4;
  g.fillRect(T - Math.max(1, T * 0.04), T * 2, Math.max(1, T * 0.04), c.height - T * 3);
  g.fillRect(c.width - T, T * 2, Math.max(1, T * 0.04), c.height - T * 3);
  g.fillRect(T, c.height - T, c.width - T * 2, Math.max(1, T * 0.04));
  g.globalAlpha = 1;
  // 扉
  for (const d of room.doors) {
    const locked = d.lock && !flags[d.lock];
    if (d.kind === 'hidden' && locked) continue; // 未発見の隠し扉は描かない
    drawDoor(g, room, d, T, !!locked);
  }
  return c;
}

function drawDoor(g: Ctx, room: RoomDef, d: RoomDef['doors'][number], T: number, locked: boolean): void {
  const col = d.kind === 'iron' ? '#4a525c' : d.kind === 'black' ? '#0a0a10' : d.kind === 'hidden' ? '#2a2420' : '#5a3a26';
  const trim = d.kind === 'iron' ? '#8a94a0' : d.kind === 'black' ? '#6a4ad0' : '#c9a55a';
  const stairs = d.kind === 'stairs_up' || d.kind === 'stairs_down';
  if (d.side === 'top') {
    const x = d.at * T; const w = d.size * T;
    if (stairs) {
      g.fillStyle = '#0a0a10'; g.fillRect(x, T * 0.25, w, T * 1.75);
      for (let k = 0; k < 6; k++) {
        const t = k / 6;
        g.fillStyle = d.kind === 'stairs_up' ? shade('#6a6258', -t * 0.5) : shade('#6a6258', -0.5 + t * 0.4);
        g.fillRect(x + w * 0.06 * (1 - t), T * 2 - (k + 1) * T * 0.27, w - w * 0.12 * (1 - t), T * 0.25);
      }
      g.strokeStyle = trim; g.lineWidth = Math.max(2, T * 0.06); g.strokeRect(x, T * 0.25, w, T * 1.75);
      // 上り下りの矢印（色に頼らない識別）
      g.fillStyle = trim; g.beginPath();
      const ax = x + w / 2; const ay = T * 0.75;
      if (d.kind === 'stairs_up') { g.moveTo(ax, ay - T * 0.22); g.lineTo(ax + T * 0.2, ay + T * 0.1); g.lineTo(ax - T * 0.2, ay + T * 0.1); }
      else { g.moveTo(ax, ay + T * 0.22); g.lineTo(ax + T * 0.2, ay - T * 0.1); g.lineTo(ax - T * 0.2, ay - T * 0.1); }
      g.closePath(); g.fill();
      return;
    }
    g.fillStyle = '#08080c'; rr(g, x + T * 0.08, T * 0.3, w - T * 0.16, T * 1.7, T * 0.12); g.fill();
    g.fillStyle = vgrad(g, T * 0.3, T * 2, shade(col, 0.15), shade(col, -0.25));
    const leaves = d.size >= 2 ? 2 : 1;
    for (let k = 0; k < leaves; k++) {
      const lw = (w - T * 0.24) / leaves;
      rr(g, x + T * 0.12 + k * lw, T * 0.36, lw - T * 0.03, T * 1.62, T * 0.08); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = Math.max(1, T * 0.03);
      g.strokeRect(x + T * 0.2 + k * lw, T * 0.5, lw - T * 0.2, T * 0.55);
      g.strokeRect(x + T * 0.2 + k * lw, T * 1.18, lw - T * 0.2, T * 0.62);
      g.fillStyle = trim; g.beginPath(); g.arc(x + T * 0.12 + k * lw + (k === 0 && leaves === 2 ? lw - T * 0.14 : T * 0.14), T * 1.2, T * 0.05, 0, Math.PI * 2); g.fill();
      g.fillStyle = vgrad(g, T * 0.3, T * 2, shade(col, 0.15), shade(col, -0.25));
    }
    if (d.kind === 'iron') {
      g.strokeStyle = '#1c2026'; g.lineWidth = Math.max(2, T * 0.05);
      for (let k = 1; k < d.size * 3; k++) { g.beginPath(); g.moveTo(x + (k * w) / (d.size * 3), T * 0.36); g.lineTo(x + (k * w) / (d.size * 3), T * 1.98); g.stroke(); }
    }
    g.strokeStyle = trim; g.lineWidth = Math.max(2, T * 0.05); rr(g, x + T * 0.08, T * 0.3, w - T * 0.16, T * 1.7, T * 0.12); g.stroke();
    if (locked) drawLock(g, x + w / 2, T * 1.15, T);
  } else if (d.side === 'bottom') {
    const x = d.at * T; const w = d.size * T; const y = (room.h - 1) * T;
    g.fillStyle = stairs ? '#3a362e' : shade(col, -0.2); g.fillRect(x, y, w, T * 0.5);
    g.fillStyle = trim; g.globalAlpha = 0.8; g.fillRect(x, y, w, Math.max(2, T * 0.06)); g.globalAlpha = 1;
    // 敷居マット
    g.fillStyle = 'rgba(216,178,90,0.25)'; rr(g, x + T * 0.1, y - T * 0.5, w - T * 0.2, T * 0.45, T * 0.08); g.fill();
    tri(g, x + w / 2, y - T * 0.26, T * 0.14, 'down', trim);
  } else {
    const left = d.side === 'left';
    const y = d.at * T; const h = d.size * T; const x = left ? T * 0.5 : (room.w - 1) * T;
    g.fillStyle = shade(col, -0.2); g.fillRect(x, y, T * 0.5, h);
    g.fillStyle = trim; g.globalAlpha = 0.8; g.fillRect(left ? x + T * 0.5 - Math.max(2, T * 0.06) : x, y, Math.max(2, T * 0.06), h); g.globalAlpha = 1;
    g.fillStyle = 'rgba(216,178,90,0.25)'; rr(g, left ? T * 1.05 : x - T * 0.5, y + T * 0.1, T * 0.45, h - T * 0.2, T * 0.08); g.fill();
    tri(g, left ? T * 1.27 : x - T * 0.27, y + h / 2, T * 0.14, left ? 'left' : 'right', trim);
    if (locked) drawLock(g, left ? T * 1.3 : x - T * 0.3, y + h / 2, T);
  }
}

function tri(g: Ctx, x: number, y: number, r: number, dir: 'up' | 'down' | 'left' | 'right', col: string): void {
  g.fillStyle = col; g.beginPath();
  if (dir === 'down') { g.moveTo(x - r, y - r * 0.6); g.lineTo(x + r, y - r * 0.6); g.lineTo(x, y + r * 0.8); }
  else if (dir === 'up') { g.moveTo(x - r, y + r * 0.6); g.lineTo(x + r, y + r * 0.6); g.lineTo(x, y - r * 0.8); }
  else if (dir === 'left') { g.moveTo(x + r * 0.6, y - r); g.lineTo(x + r * 0.6, y + r); g.lineTo(x - r * 0.8, y); }
  else { g.moveTo(x - r * 0.6, y - r); g.lineTo(x - r * 0.6, y + r); g.lineTo(x + r * 0.8, y); }
  g.closePath(); g.fill();
}

function drawLock(g: Ctx, x: number, y: number, T: number): void {
  g.fillStyle = '#d8b25a'; rr(g, x - T * 0.14, y - T * 0.06, T * 0.28, T * 0.24, T * 0.04); g.fill();
  g.strokeStyle = '#d8b25a'; g.lineWidth = T * 0.05; g.beginPath(); g.arc(x, y - T * 0.06, T * 0.09, Math.PI, 0); g.stroke();
  g.fillStyle = '#1a1410'; g.beginPath(); g.arc(x, y + T * 0.05, T * 0.03, 0, Math.PI * 2); g.fill();
}

// ---------------- 家具 ----------------

export function drawProp(type: string, T: number): HTMLCanvasElement {
  const def = PROPS[type];
  const W = def.w * T;
  const H = def.h * T;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d')!;
  g.lineJoin = 'round';
  const u = T / 64;
  const box = (x: number, y: number, w: number, h: number, col: string, r = 6, top = 0.3) => {
    // 接地影
    g.fillStyle = 'rgba(0,0,0,0.28)'; rr(g, x + 2 * u, y + h - 6 * u, w, 10 * u, r * u); g.fill();
    g.fillStyle = vgrad(g, y, y + h, shade(col, 0.12), shade(col, -0.3)); rr(g, x, y, w, h, r * u); g.fill();
    if (top > 0) { g.fillStyle = shade(col, 0.28); rr(g, x, y, w, h * top, r * u); g.fill(); }
    g.strokeStyle = 'rgba(8,6,12,0.7)'; g.lineWidth = 2 * u; rr(g, x, y, w, h, r * u); g.stroke();
  };
  const gold = '#c9a55a';
  switch (type) {
    case 'bookshelf': case 'bookshelf_secret': case 'shelf': {
      box(2 * u, 4 * u, W - 4 * u, H - 8 * u, type === 'shelf' ? '#4a4038' : '#4a2e1e', 5, 0.06);
      const rows = 4;
      for (let r0 = 0; r0 < rows; r0++) {
        const y = 14 * u + (r0 * (H - 30 * u)) / rows;
        const rh = (H - 30 * u) / rows - 6 * u;
        g.fillStyle = '#1a100c'; g.fillRect(8 * u, y, W - 16 * u, rh);
        let x = 10 * u;
        let k = 0;
        while (x < W - 16 * u) {
          const bw = (5 + noise(r0, k, type.length) * 6) * u;
          const cols = type === 'shelf' ? ['#6a7078', '#8a8478', '#5a6068', '#9a9488'] : ['#7a2a2a', '#2a4a6a', '#3a5a3a', '#8a6a2a', '#4a2a5a', '#2a2a3a'];
          g.fillStyle = cols[Math.floor(noise(k, r0, 3) * cols.length)];
          const bh = rh * (0.75 + noise(k, r0, 9) * 0.25);
          g.fillRect(x, y + rh - bh, bw - u, bh);
          g.fillStyle = 'rgba(255,220,150,0.5)'; g.fillRect(x + bw * 0.25, y + rh - bh + bh * 0.2, bw * 0.4, u * 1.5);
          x += bw; k++;
        }
      }
      if (type === 'bookshelf_secret') { g.fillStyle = 'rgba(0,0,0,0.85)'; rr(g, W * 0.3, 10 * u, W * 0.4, H - 22 * u, 4 * u); g.fill(); g.strokeStyle = gold; g.lineWidth = 2 * u; g.stroke(); }
      break;
    }
    case 'bed_luxury': case 'bed_prison': case 'medical_bed': {
      const lux = type === 'bed_luxury';
      box(4 * u, 4 * u, W - 8 * u, H - 10 * u, lux ? '#5a3a26' : '#4a5058', 8, 0);
      g.fillStyle = lux ? '#7a2434' : type === 'medical_bed' ? '#dfe6ea' : '#6a6e68'; rr(g, 9 * u, 40 * u, W - 18 * u, H - 54 * u, 8 * u); g.fill();
      g.fillStyle = lux ? '#f0e8d8' : '#c8ccc8'; rr(g, 14 * u, 12 * u, W - 28 * u, 32 * u, 10 * u); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2 * u; g.beginPath(); g.moveTo(9 * u, 58 * u); g.lineTo(W - 9 * u, 58 * u); g.stroke();
      if (lux) { g.strokeStyle = gold; g.lineWidth = 2 * u; g.strokeRect(12 * u, 64 * u, W - 24 * u, H - 84 * u); }
      break;
    }
    case 'desk': case 'small_table': case 'dining_table': case 'game_table': case 'counter': case 'buffet': {
      const col = type === 'game_table' ? '#1e3a2e' : type === 'counter' ? '#3a2c24' : '#6a4630';
      const top = type === 'dining_table' || type === 'game_table' ? T : 0;
      box(4 * u, 4 * u + top * 0.4, W - 8 * u, H - 12 * u - top * 0.4, '#4a3020', 8, 0);
      g.fillStyle = vgrad(g, 0, H, shade(col, 0.2), col); rr(g, 2 * u, 2 * u + top * 0.4, W - 4 * u, H * 0.62 - top * 0.2, 8 * u); g.fill();
      g.strokeStyle = type === 'game_table' ? gold : 'rgba(8,6,12,0.7)'; g.lineWidth = 2 * u; g.stroke();
      if (type === 'game_table') { g.strokeStyle = 'rgba(216,178,90,0.5)'; g.strokeRect(W * 0.3, top * 0.4 + H * 0.12, W * 0.4, H * 0.3); }
      if (type === 'dining_table') { for (let k = 0; k < 3; k++) { g.fillStyle = '#f0ece0'; g.beginPath(); g.ellipse(W * (0.22 + k * 0.28), top * 0.4 + H * 0.3, 12 * u, 8 * u, 0, 0, Math.PI * 2); g.fill(); } }
      if (type === 'buffet') { for (let k = 0; k < 4; k++) { g.fillStyle = ['#c86a4a', '#e0c070', '#7aa860', '#d8d0c0'][k]; g.beginPath(); g.ellipse(W * (0.14 + k * 0.24), H * 0.3, 20 * u, 12 * u, 0, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#c0c4c8'; g.stroke(); } }
      if (type === 'desk') { g.fillStyle = '#e8e0cc'; g.fillRect(W * 0.55, H * 0.14, 30 * u, 22 * u); g.fillStyle = '#2a2420'; g.fillRect(W * 0.2, H * 0.16, 18 * u, 14 * u); }
      break;
    }
    case 'chair': {
      box(10 * u, H * 0.5, W - 20 * u, H * 0.44, '#5a3a26', 5, 0.4);
      g.fillStyle = '#7a2434'; rr(g, 12 * u, H * 0.12, W - 24 * u, H * 0.42, 6 * u); g.fill(); g.strokeStyle = 'rgba(8,6,12,0.7)'; g.lineWidth = 2 * u; g.stroke();
      break;
    }
    case 'sofa': case 'bench': {
      const col = type === 'bench' ? '#5a4a3a' : '#5a2434';
      box(4 * u, H * 0.1, W - 8 * u, H * 0.82, col, 12, 0.36);
      if (type === 'sofa') { for (let k = 0; k < 3; k++) { g.fillStyle = shade(col, 0.2); rr(g, 12 * u + (k * (W - 24 * u)) / 3, H * 0.42, (W - 24 * u) / 3 - 4 * u, H * 0.42, 8 * u); g.fill(); } }
      break;
    }
    case 'clock': case 'grand_clock': {
      const gc = type === 'grand_clock';
      if (gc) box(W * 0.2, 4 * u, W * 0.6, H - 10 * u, '#3a2418', 6, 0);
      const cx = W / 2; const cy = gc ? H * 0.22 : H * 0.4; const r = gc ? W * 0.24 : W * 0.38;
      g.fillStyle = '#f0e8d0'; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
      g.strokeStyle = gold; g.lineWidth = 3 * u; g.stroke();
      g.strokeStyle = '#1a1410'; g.lineWidth = 2.5 * u; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx, cy - r * 0.7); g.moveTo(cx, cy); g.lineTo(cx + r * 0.5, cy + r * 0.1); g.stroke();
      if (gc) { g.strokeStyle = gold; g.lineWidth = 2 * u; g.beginPath(); g.moveTo(cx, H * 0.4); g.lineTo(cx, H * 0.72); g.stroke(); g.fillStyle = gold; g.beginPath(); g.arc(cx, H * 0.74, 9 * u, 0, Math.PI * 2); g.fill(); }
      break;
    }
    case 'mirror': case 'mirror_open': {
      g.fillStyle = gold; rr(g, W * 0.12, H * 0.06, W * 0.76, H * 0.72, W * 0.3); g.fill();
      const gr = g.createLinearGradient(0, 0, W, H);
      if (type === 'mirror_open') { gr.addColorStop(0, '#050508'); gr.addColorStop(1, '#101018'); }
      else { gr.addColorStop(0, '#dfeaf4'); gr.addColorStop(0.5, '#9fb4c8'); gr.addColorStop(1, '#c8d8e8'); }
      g.fillStyle = gr; rr(g, W * 0.18, H * 0.1, W * 0.64, H * 0.64, W * 0.26); g.fill();
      if (type === 'mirror') { g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 3 * u; g.beginPath(); g.moveTo(W * 0.3, H * 0.5); g.lineTo(W * 0.55, H * 0.2); g.stroke(); }
      break;
    }
    case 'chandelier': {
      const cx = W / 2; const cy = H * 0.42;
      const glow = g.createRadialGradient(cx, cy, 0, cx, cy, W * 0.5);
      glow.addColorStop(0, 'rgba(255,224,150,0.55)'); glow.addColorStop(1, 'rgba(255,224,150,0)');
      g.fillStyle = glow; g.fillRect(0, 0, W, H);
      g.strokeStyle = gold; g.lineWidth = 3 * u;
      g.beginPath(); g.arc(cx, cy, W * 0.3, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(cx, cy, W * 0.16, 0, Math.PI * 2); g.stroke();
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        g.fillStyle = '#fff4d0'; g.beginPath(); g.arc(cx + Math.cos(a) * W * 0.3, cy + Math.sin(a) * W * 0.3, 5 * u, 0, Math.PI * 2); g.fill();
      }
      break;
    }
    case 'prison_bars': {
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, H - 14 * u, W, 10 * u);
      g.fillStyle = '#3a4048'; g.fillRect(0, H * 0.3, W, 8 * u); g.fillRect(0, H - 14 * u, W, 8 * u);
      for (let k = 0; k <= 9; k++) { g.fillStyle = vgrad(g, 0, H, '#8a94a0', '#3a4048'); g.fillRect((k * (W - 6 * u)) / 9, H * 0.3, 6 * u, H * 0.66); }
      break;
    }
    case 'monitor': {
      g.fillStyle = '#16181e'; rr(g, 6 * u, 10 * u, W - 12 * u, H - 30 * u, 6 * u); g.fill();
      const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#2a5a7a'); gr.addColorStop(1, '#0e2a3a');
      g.fillStyle = gr; g.fillRect(12 * u, 16 * u, W - 24 * u, H - 42 * u);
      g.strokeStyle = 'rgba(160,220,255,0.5)'; g.lineWidth = u;
      for (let k = 0; k < 5; k++) { g.beginPath(); g.moveTo(12 * u, 22 * u + k * 12 * u); g.lineTo(W - 12 * u, 22 * u + k * 12 * u); g.stroke(); }
      break;
    }
    case 'control_console': case 'lab_equipment': {
      box(4 * u, H * 0.25, W - 8 * u, H * 0.7, '#3a424c', 8, 0.45);
      for (let k = 0; k < (type === 'control_console' ? 12 : 6); k++) {
        g.fillStyle = ['#5ad0a0', '#d85a5a', '#5aa0d8', '#d8c05a'][k % 4];
        g.beginPath(); g.arc(18 * u + ((k % 6) * (W - 36 * u)) / 5, H * 0.36 + Math.floor(k / 6) * 16 * u, 4 * u, 0, Math.PI * 2); g.fill();
      }
      if (type === 'lab_equipment') { g.fillStyle = 'rgba(120,255,210,0.35)'; rr(g, W * 0.3, 4 * u, W * 0.4, H * 0.36, 10 * u); g.fill(); g.strokeStyle = '#8ad0c0'; g.lineWidth = 2 * u; g.stroke(); }
      break;
    }
    case 'safe': {
      box(6 * u, 6 * u, W - 12 * u, H - 14 * u, '#3a3e46', 8, 0);
      g.strokeStyle = gold; g.lineWidth = 3 * u; g.beginPath(); g.arc(W / 2, H * 0.45, W * 0.2, 0, Math.PI * 2); g.stroke();
      g.fillStyle = gold; g.beginPath(); g.arc(W / 2, H * 0.45, 5 * u, 0, Math.PI * 2); g.fill();
      break;
    }
    case 'plant': {
      box(W * 0.25, H * 0.62, W * 0.5, H * 0.34, '#6a4a34', 6, 0.2);
      for (let k = 0; k < 7; k++) { const a = -Math.PI / 2 + (k - 3) * 0.38; g.fillStyle = k % 2 ? '#3f7a48' : '#2e6238'; g.beginPath(); g.ellipse(W / 2 + Math.cos(a) * W * 0.26, H * 0.4 + Math.sin(a) * H * 0.26, W * 0.14, H * 0.2, a + Math.PI / 2, 0, Math.PI * 2); g.fill(); }
      break;
    }
    case 'tree': {
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(W / 2, H * 0.93, W * 0.34, H * 0.05, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#4a3424'; rr(g, W * 0.42, H * 0.55, W * 0.16, H * 0.4, 6 * u); g.fill();
      for (let k = 0; k < 9; k++) { g.fillStyle = ['#2e6238', '#3a7444', '#4a8a50'][k % 3]; g.beginPath(); g.arc(W * (0.25 + noise(k, 1) * 0.5), H * (0.14 + noise(k, 2) * 0.4), W * 0.24, 0, Math.PI * 2); g.fill(); }
      break;
    }
    case 'hedge': {
      box(4 * u, H * 0.2, W - 8 * u, H * 0.74, '#2e6238', 16, 0.4);
      break;
    }
    case 'fountain': {
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(W / 2, H * 0.66, W * 0.48, H * 0.3, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#8a8e96'; g.beginPath(); g.ellipse(W / 2, H * 0.6, W * 0.47, H * 0.34, 0, 0, Math.PI * 2); g.fill();
      const wg = g.createRadialGradient(W / 2, H * 0.58, 0, W / 2, H * 0.58, W * 0.42); wg.addColorStop(0, '#bfe6f6'); wg.addColorStop(1, '#3a7aa0');
      g.fillStyle = wg; g.beginPath(); g.ellipse(W / 2, H * 0.58, W * 0.4, H * 0.27, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#a0a4ac'; g.beginPath(); g.ellipse(W / 2, H * 0.5, W * 0.1, H * 0.07, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#b8bcc4'; g.fillRect(W * 0.46, H * 0.2, W * 0.08, H * 0.3);
      g.fillStyle = 'rgba(220,245,255,0.8)'; g.beginPath(); g.arc(W / 2, H * 0.18, W * 0.06, 0, Math.PI * 2); g.fill();
      break;
    }
    case 'noticeboard': {
      g.fillStyle = '#3a2418'; rr(g, 4 * u, 12 * u, W - 8 * u, H - 30 * u, 6 * u); g.fill();
      g.fillStyle = '#6a5a3a'; g.fillRect(12 * u, 20 * u, W - 24 * u, H - 46 * u);
      for (let k = 0; k < 4; k++) { g.fillStyle = k % 2 ? '#f0e8d0' : '#e0d8c0'; g.fillRect(20 * u + k * 38 * u, 28 * u + (k % 2) * 8 * u, 30 * u, 40 * u); }
      g.strokeStyle = gold; g.lineWidth = 2 * u; g.strokeRect(4 * u, 12 * u, W - 8 * u, H - 30 * u);
      break;
    }
    case 'painting': {
      g.fillStyle = gold; g.fillRect(14 * u, 14 * u, W - 28 * u, H - 44 * u);
      const pg = g.createLinearGradient(0, 0, W, H); pg.addColorStop(0, '#2a3a5a'); pg.addColorStop(1, '#5a2a3a');
      g.fillStyle = pg; g.fillRect(20 * u, 20 * u, W - 40 * u, H - 56 * u);
      break;
    }
    case 'locker': {
      box(4 * u, 4 * u, W - 8 * u, H - 10 * u, '#4a3626', 5, 0);
      g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 2 * u; g.beginPath(); g.moveTo(W / 2, 8 * u); g.lineTo(W / 2, H - 10 * u); g.stroke();
      g.fillStyle = gold; g.beginPath(); g.arc(W / 2 - 8 * u, H * 0.5, 3 * u, 0, Math.PI * 2); g.arc(W / 2 + 8 * u, H * 0.5, 3 * u, 0, Math.PI * 2); g.fill();
      break;
    }
    case 'wall_lamp': case 'cold_lamp': {
      const warm = type === 'wall_lamp';
      const cx = W / 2; const cy = H * 0.5;
      const glow = g.createRadialGradient(cx, cy, 0, cx, cy, W * 0.5);
      glow.addColorStop(0, warm ? 'rgba(255,210,130,0.9)' : 'rgba(180,210,255,0.9)'); glow.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = glow; g.fillRect(0, 0, W, H);
      g.fillStyle = warm ? '#fff0c8' : '#e8f2ff'; rr(g, cx - 7 * u, cy - 12 * u, 14 * u, 22 * u, 6 * u); g.fill();
      g.fillStyle = warm ? gold : '#8a94a0'; g.fillRect(cx - 9 * u, cy + 10 * u, 18 * u, 5 * u);
      break;
    }
    case 'judge_stand': {
      box(4 * u, H * 0.3, W - 8 * u, H * 0.66, '#1c1a24', 8, 0.3);
      g.strokeStyle = gold; g.lineWidth = 3 * u; g.strokeRect(14 * u, H * 0.52, W - 28 * u, H * 0.34);
      crown(g, W / 2, H * 0.7, 30 * u, gold);
      break;
    }
    case 'arena_table': {
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.ellipse(W / 2, H * 0.62, W * 0.5, H * 0.38, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#16141c'; g.beginPath(); g.ellipse(W / 2, H * 0.56, W * 0.49, H * 0.4, 0, 0, Math.PI * 2); g.fill();
      const tg = g.createRadialGradient(W / 2, H * 0.5, 0, W / 2, H * 0.5, W * 0.5); tg.addColorStop(0, '#2c2a3a'); tg.addColorStop(1, '#15131c');
      g.fillStyle = tg; g.beginPath(); g.ellipse(W / 2, H * 0.5, W * 0.46, H * 0.36, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = gold; g.lineWidth = 3 * u; g.stroke();
      g.beginPath(); g.ellipse(W / 2, H * 0.5, W * 0.3, H * 0.22, 0, 0, Math.PI * 2); g.stroke();
      crown(g, W / 2, H * 0.5, 40 * u, gold);
      break;
    }
    case 'emblem_floor': {
      g.globalAlpha = 0.85;
      g.strokeStyle = gold; g.lineWidth = 4 * u;
      g.beginPath(); g.ellipse(W / 2, H / 2, W * 0.46, H * 0.46, 0, 0, Math.PI * 2); g.stroke();
      g.lineWidth = 2 * u; g.beginPath(); g.ellipse(W / 2, H / 2, W * 0.38, H * 0.38, 0, 0, Math.PI * 2); g.stroke();
      for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; g.beginPath(); g.moveTo(W / 2 + Math.cos(a) * W * 0.38, H / 2 + Math.sin(a) * H * 0.38); g.lineTo(W / 2 + Math.cos(a) * W * 0.46, H / 2 + Math.sin(a) * H * 0.46); g.stroke(); }
      crown(g, W / 2, H / 2, 70 * u, gold);
      g.globalAlpha = 1;
      break;
    }
    case 'carpet': {
      g.fillStyle = '#6a1c2c'; rr(g, 4 * u, 4 * u, W - 8 * u, H - 8 * u, 6 * u); g.fill();
      g.strokeStyle = gold; g.lineWidth = 3 * u; g.strokeRect(14 * u, 14 * u, W - 28 * u, H - 28 * u);
      g.lineWidth = u; g.strokeRect(24 * u, 24 * u, W - 48 * u, H - 48 * u);
      break;
    }
    case 'window': case 'big_window': {
      g.fillStyle = '#2a1c14'; rr(g, 6 * u, 10 * u, W - 12 * u, H - 34 * u, 8 * u); g.fill();
      const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#0c1430'); sky.addColorStop(1, '#2a3a6a');
      g.fillStyle = sky; g.fillRect(12 * u, 16 * u, W - 24 * u, H - 46 * u);
      for (let k = 0; k < 10; k++) { g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(14 * u + noise(k, 5) * (W - 30 * u), 18 * u + noise(k, 6) * (H - 54 * u), 2 * u, 2 * u); }
      g.strokeStyle = '#4a3424'; g.lineWidth = 3 * u;
      const n = type === 'big_window' ? 6 : 3;
      for (let k = 1; k < n; k++) { g.beginPath(); g.moveTo(12 * u + (k * (W - 24 * u)) / n, 16 * u); g.lineTo(12 * u + (k * (W - 24 * u)) / n, H - 30 * u); g.stroke(); }
      g.strokeStyle = gold; g.lineWidth = 2 * u; rr(g, 6 * u, 10 * u, W - 12 * u, H - 34 * u, 8 * u); g.stroke();
      break;
    }
    case 'bathtub': {
      box(4 * u, 6 * u, W - 8 * u, H - 14 * u, '#d8dee2', 26, 0);
      const wg = g.createLinearGradient(0, 0, 0, H); wg.addColorStop(0, '#9fd0e6'); wg.addColorStop(1, '#5a9ab8');
      g.fillStyle = wg; rr(g, 18 * u, 20 * u, W - 36 * u, H - 44 * u, 20 * u); g.fill();
      break;
    }
    case 'sink': {
      box(4 * u, 4 * u, W - 8 * u, H - 10 * u, '#d8dee2', 8, 0);
      g.fillStyle = '#9fb8c8'; g.beginPath(); g.ellipse(W / 2, H * 0.5, W * 0.3, H * 0.26, 0, 0, Math.PI * 2); g.fill();
      break;
    }
    case 'sealed_door': {
      g.fillStyle = '#22262c'; rr(g, 6 * u, 20 * u, W - 12 * u, H - 30 * u, 6 * u); g.fill();
      g.strokeStyle = '#5a646e'; g.lineWidth = 4 * u; g.stroke();
      g.fillStyle = '#5a646e'; g.fillRect(6 * u, H * 0.48, W - 12 * u, 14 * u);
      g.fillStyle = '#b8293d'; rr(g, W / 2 - 34 * u, H * 0.26, 68 * u, 30 * u, 4 * u); g.fill();
      g.fillStyle = '#ffd0d0'; g.font = `bold ${22 * u}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('11', W / 2, H * 0.26 + 16 * u);
      break;
    }
    case 'crate': {
      box(4 * u, 8 * u, W - 8 * u, H - 16 * u, '#6a5238', 4, 0.3);
      g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 3 * u; g.beginPath(); g.moveTo(8 * u, H * 0.4); g.lineTo(W - 8 * u, H - 12 * u); g.moveTo(W - 8 * u, H * 0.4); g.lineTo(8 * u, H - 12 * u); g.stroke();
      break;
    }
    case 'telescope': {
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(W / 2, H * 0.9, W * 0.3, H * 0.06, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#3a2c20'; g.lineWidth = 5 * u; g.beginPath(); g.moveTo(W / 2, H * 0.5); g.lineTo(W * 0.3, H * 0.9); g.moveTo(W / 2, H * 0.5); g.lineTo(W * 0.7, H * 0.9); g.moveTo(W / 2, H * 0.5); g.lineTo(W / 2, H * 0.9); g.stroke();
      g.save(); g.translate(W / 2, H * 0.45); g.rotate(-0.5); g.fillStyle = gold; rr(g, -W * 0.38, -9 * u, W * 0.76, 18 * u, 8 * u); g.fill(); g.strokeStyle = '#3a2c20'; g.lineWidth = 2 * u; g.stroke(); g.restore();
      break;
    }
    case 'piano': {
      box(4 * u, H * 0.3, W - 8 * u, H * 0.64, '#0e0c12', 14, 0.5);
      g.fillStyle = '#f0ece0'; g.fillRect(20 * u, H * 0.68, W - 40 * u, 16 * u);
      g.fillStyle = '#0e0c12'; for (let k = 0; k < 14; k++) g.fillRect(26 * u + (k * (W - 52 * u)) / 14, H * 0.68, 6 * u, 10 * u);
      break;
    }
    default:
      box(4 * u, 4 * u, W - 8 * u, H - 8 * u, '#5a4a3a');
  }
  return c;
}

function crown(g: Ctx, x: number, y: number, s: number, col: string): void {
  g.save();
  g.strokeStyle = col; g.lineWidth = Math.max(1.5, s * 0.07); g.lineJoin = 'miter';
  g.beginPath();
  g.moveTo(x - s * 0.5, y + s * 0.3); g.lineTo(x - s * 0.5, y - s * 0.2); g.lineTo(x - s * 0.25, y + s * 0.05); g.lineTo(x, y - s * 0.4);
  g.lineTo(x + s * 0.25, y + s * 0.05); g.lineTo(x + s * 0.5, y - s * 0.2); g.lineTo(x + s * 0.5, y + s * 0.3); g.closePath(); g.stroke();
  // 「偽り」を示す斜めの亀裂
  g.beginPath(); g.moveTo(x + s * 0.1, y - s * 0.32); g.lineTo(x - s * 0.05, y - s * 0.02); g.lineTo(x + s * 0.08, y + s * 0.1); g.lineTo(x - s * 0.04, y + s * 0.3); g.stroke();
  g.restore();
}

/** UI 用の紋章（タイトルなど）。正式ロゴが届くまでの仮 */
export function drawEmblem(size: number): HTMLCanvasElement {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d')!;
  const gr = g.createLinearGradient(0, 0, size, size);
  gr.addColorStop(0, '#f0d890'); gr.addColorStop(0.5, '#c9a55a'); gr.addColorStop(1, '#8a6a2a');
  g.strokeStyle = gr; g.lineWidth = size * 0.012;
  g.beginPath(); g.arc(size / 2, size / 2, size * 0.46, 0, Math.PI * 2); g.stroke();
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2 - Math.PI / 2;
    g.beginPath(); g.moveTo(size / 2 + Math.cos(a) * size * 0.4, size / 2 + Math.sin(a) * size * 0.4); g.lineTo(size / 2 + Math.cos(a) * size * 0.46, size / 2 + Math.sin(a) * size * 0.46); g.stroke();
  }
  crown(g, size / 2, size / 2, size * 0.5, '#d8b25a');
  return c;
}

/** 影の楕円 */
export function drawShadow(w: number, h: number): HTMLCanvasElement {
  const c = makeCanvas(w, h);
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  gr.addColorStop(0, 'rgba(0,0,0,0.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.save(); g.scale(1, h / w); g.fillStyle = gr; g.fillRect(0, 0, w, w); g.restore();
  return c;
}

/** 光源マップ：環境光で暗くし、光源の位置を明るく抜く */
export function drawLightmap(room: RoomDef, T: number, flags: Record<string, unknown>, night: boolean): HTMLCanvasElement {
  const c = makeCanvas(room.w * T, room.h * T);
  const g = c.getContext('2d')!;
  const amb = Math.max(0.2, room.ambient - (night ? 0.18 : 0));
  g.fillStyle = `rgba(6,8,22,${(1 - amb) * 0.92})`;
  g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'destination-out';
  for (const p of room.props) {
    if (p.showIf && !flags[p.showIf]) continue;
    if (p.hideIf && flags[p.hideIf]) continue;
    const def = PROPS[p.type];
    if (!def?.light) continue;
    const cx = (p.x + def.w / 2 + (def.light.dx ?? 0)) * T;
    const cy = (p.y + def.h / 2 + (def.light.dy ?? 0)) * T;
    const r = def.light.radius * T;
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    gr.addColorStop(0, `rgba(0,0,0,${Math.min(1, def.light.intensity * 1.6)})`);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  g.globalCompositeOperation = 'source-over';
  // ビネット
  const v = g.createRadialGradient(c.width / 2, c.height / 2, Math.min(c.width, c.height) * 0.3, c.width / 2, c.height / 2, Math.max(c.width, c.height) * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.fillStyle = v; g.fillRect(0, 0, c.width, c.height);
  return c;
}

/** 光源の色のにじみ（加算合成用） */
export function drawGlow(color: number, size: number): HTMLCanvasElement {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d')!;
  const r = (color >> 16) & 255; const gg = (color >> 8) & 255; const b = color & 255;
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, `rgba(${r},${gg},${b},0.5)`); gr.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  return c;
}
