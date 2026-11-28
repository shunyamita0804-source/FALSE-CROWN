/**
 * 五角形の盤面の描画部品（M08 バリケードと練習で共用）。
 * 中心と 3 重の輪の点、点をつなぐ道、壁、駒、ゴールの旗を SVG で描く。点と道のタップを知らせる。
 * 駒は正式素材をそのまま（等倍率の拡大縮小だけで）置き、持ち主の色は足元の輪で示す。壁は向きが道ごとに違うので、プログラムで描く。
 */
import { assetUrl } from '../assets/registry';
import { ADJ, EDGES, NODES, RINGS, distMap, goalNode, ringOfNode, spokeOfNode, type M08Log } from '../matches/m08';
import { h } from './dom';
import { HEX_COLORS } from './hexboard';

const PAWN = assetUrl('ui/v11/m08/pawn');
/** 壁の正式素材（横向きの棒、256×128 で棒は 250×17）。表示の時だけ道と直角に回す（2026-11-28 本人の許可）。加工はしない */
const WALL = assetUrl('ui/v11/m08/wall');
const WALL_W = 68;
const RADII = [0, 130, 215, 300];
const COS36 = Math.cos(Math.PI / 5);

/** 点の位置（中心が 0,0。偶数番は五角形の角、奇数番は辺の真ん中） */
export function nodeXY(n: number): [number, number] {
  const k = ringOfNode(n);
  if (k === 0) return [0, 0];
  const j = spokeOfNode(n);
  const a = -Math.PI / 2 + (Math.PI / 5) * j;
  const r = RADII[k] * (j % 2 ? COS36 : 1);
  return [r * Math.cos(a), r * Math.sin(a)];
}

export interface RingData {
  seats: number[];
  pos: number[];
  walls: boolean[];
  /** 自分の番号（参加者の並びの中の位置。無ければ -1） */
  me: number;
  mode: 'move' | 'wall' | 'none';
  canMove: number[];
  canWall: number[];
  selNode?: number;
  selEdge?: number;
  /** 自分の最短の道を点線で示す */
  showPath?: boolean;
  last?: M08Log;
  scale?: number;
}

/** from からゴールまでの最短の道（点の並び） */
export function shortestPath(walls: boolean[], from: number, goal: number): number[] {
  const dm = distMap(walls, goal);
  if (from < 0 || dm[from] >= 99) return [];
  const out = [from];
  let c = from;
  while (c !== goal) {
    const next = ADJ[c].find(([n, e]) => !walls[e] && dm[n] === dm[c] - 1);
    if (!next) break;
    c = next[0];
    out.push(c);
  }
  return out;
}

export function ringBoard(d: RingData, onNode?: (n: number) => void, onEdge?: (e: number) => void): HTMLElement {
  const S = 2 * (RADII[RINGS] + 44);
  const scale = d.scale ?? 1;
  const out: string[] = [];
  const walls = d.selEdge !== undefined ? d.walls.map((w, e) => w || e === d.selEdge) : d.walls;
  // 道
  EDGES.forEach(([a, b], e) => {
    const [x1, y1] = nodeXY(a);
    const [x2, y2] = nodeXY(b);
    out.push(`<line class="rb-edge${d.walls[e] ? ' walled' : ''}" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`);
  });
  // 自分の最短の道
  if (d.showPath && d.me >= 0 && d.pos[d.me] >= 0) {
    const path = shortestPath(walls, d.pos[d.me], goalNode(d.seats[d.me]));
    if (path.length > 1) out.push(`<polyline class="rb-path" style="--c:${HEX_COLORS[d.seats[d.me]]}" points="${path.map((n) => nodeXY(n).map((v) => v.toFixed(1)).join(',')).join(' ')}"/>`);
  }
  // 壁（道の真ん中に、道と直角の太い棒）
  const wallBar = (e: number, cls: string) => {
    const [x1, y1] = nodeXY(EDGES[e][0]);
    const [x2, y2] = nodeXY(EDGES[e][1]);
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const ang = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI + 90;
    const body = WALL && cls !== 'ghost'
      ? `<image href="${WALL}" x="${-WALL_W / 2}" y="${-WALL_W / 4}" width="${WALL_W}" height="${WALL_W / 2}" preserveAspectRatio="xMidYMid meet"/>`
      : '<rect x="-26" y="-6.5" width="52" height="13" rx="3"/>';
    return `<g class="rb-wall ${cls}${WALL ? ' art' : ''}" transform="translate(${mx.toFixed(1)} ${my.toFixed(1)}) rotate(${ang.toFixed(1)})">${body}</g>`;
  };
  d.walls.forEach((w, e) => { if (w) out.push(wallBar(e, d.last?.kind === 'wall' && d.last.edge === e ? 'new' : '')); });
  if (d.selEdge !== undefined) out.push(wallBar(d.selEdge, 'ghost'));
  // 壁を置ける道の取っ手
  if (d.mode === 'wall') {
    for (const e of d.canWall) {
      if (e === d.selEdge) continue;
      const [x1, y1] = nodeXY(EDGES[e][0]);
      const [x2, y2] = nodeXY(EDGES[e][1]);
      out.push(`<g class="rb-handle" data-edge="${e}" transform="translate(${((x1 + x2) / 2).toFixed(1)} ${((y1 + y2) / 2).toFixed(1)})"><circle class="hit" r="24"/><rect x="-7" y="-7" width="14" height="14" transform="rotate(45)"/></g>`);
    }
  }
  // 点
  const goals = new Map(d.seats.map((s) => [goalNode(s), s]));
  for (let n = 0; n < NODES; n++) {
    const [x, y] = nodeXY(n);
    const can = d.mode === 'move' && d.canMove.includes(n);
    const g = goals.get(n);
    let inner = `<circle class="rb-dot" r="15"/>`;
    if (g !== undefined) inner += `<g class="rb-goal${d.me >= 0 && g === d.seats[d.me] ? ' mine' : ''}" style="--c:${HEX_COLORS[g]}"><circle r="21"/><path d="M-5 11 V-12 L10 -6 L-5 0"/></g>`;
    if (can) inner += `<circle class="rb-can" r="27"/>`;
    if (d.selNode === n) inner += `<circle class="rb-sel" r="30"/>`;
    out.push(`<g class="rb-node${can ? ' can' : ''}" data-node="${n}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><circle class="hit" r="${ringOfNode(n) <= 1 ? 34 : 38}"/>${inner}</g>`);
  }
  // 駒
  d.pos.forEach((p, i) => {
    if (p < 0) return;
    const [x, y] = nodeXY(p);
    const c = HEX_COLORS[d.seats[i]];
    const moved = d.last?.kind === 'move' && d.last.seat === d.seats[i];
    const img = PAWN ? `<image href="${PAWN}" x="-29" y="-44" width="58" height="58"/>` : `<circle r="14" cy="-10" fill="#ccc"/>`;
    out.push(`<g class="rb-pawn${i === d.me ? ' me' : ''}${moved ? ' moved' : ''}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><ellipse cx="0" cy="8" rx="23" ry="13" fill="${c}"/>${img}</g>`);
  });
  const el = h('div', { class: `rb ${d.mode}`, style: `width:${(S * scale).toFixed(0)}px;height:${(S * scale).toFixed(0)}px` });
  el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-S / 2} ${-S / 2} ${S} ${S}" width="${(S * scale).toFixed(0)}" height="${(S * scale).toFixed(0)}">${out.join('')}</svg>`;
  if (onNode || onEdge) {
    el.addEventListener('click', (ev) => {
      const t = ev.target as Element;
      const e = t.closest('[data-edge]');
      if (e && onEdge) { onEdge(Number(e.getAttribute('data-edge'))); return; }
      const n = t.closest('[data-node]');
      if (n && onNode) onNode(Number(n.getAttribute('data-node')));
    });
  }
  return el;
}
