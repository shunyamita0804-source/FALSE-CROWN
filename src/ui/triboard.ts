/**
 * 三角形の盤面の描画部品（M10 トライアングルと練習で共用）。
 * 15 個の点、点をつなぐ道、旗、兵、宝石を SVG で描く。点と旗のタップを知らせる。
 * 旗、兵、宝石は正式素材をそのまま（等倍率の拡大縮小だけで）置き、持ち主の色は足元の丸で示す。
 */
import { assetUrl } from '../assets/registry';
import { ADJ, FLAGS, GEM_NODES, GEM_USES, NODES, rc, type Board } from '../matches/m10';
import { h } from './dom';
import { HEX_COLORS } from './hexboard';

const FLAG = assetUrl('ui/v11/m10/flag');
const GEM = assetUrl('ui/v11/m10/gem');
const SOLDIER = assetUrl('ui/v11/m10/soldier');
const E = 140;
const H = E * 0.866;

/** 点の位置（頂点 0 が上。左右の中心が x = 0） */
export function triXY(n: number): [number, number] {
  const [r, c] = rc(n);
  return [(c - r / 2) * E, r * H];
}

export const TRI_COLORS = [HEX_COLORS[0], HEX_COLORS[1], HEX_COLORS[2]];

export interface TriData {
  board: Board;
  seats: number[];
  /** 自分の席（無ければ -1） */
  me: number;
  /** 点の番号 → 印（can、cap、sel、chosen、from、to、hit、threat、movable。空白区切りで複数） */
  marks?: Record<number, string>;
  /** 旗の印（席 → deliver、chosen） */
  flagMarks?: Record<number, string>;
  scale?: number;
}

const img = (url: string | null, size: number, dx = 0, dy = 0, cls = '') => (url ? `<image class="${cls}" href="${url}" x="${-size / 2 + dx}" y="${-size / 2 + dy}" width="${size}" height="${size}"/>` : '');

export function triBoard(d: TriData, onNode?: (n: number) => void, onFlag?: (seat: number) => void): HTMLElement {
  const W = 4 * E + 150;
  const HT = 4 * H + 150;
  const scale = d.scale ?? 1;
  const out: string[] = [];
  for (let a = 0; a < NODES; a++) for (const b of ADJ[a]) if (a < b) {
    const [x1, y1] = triXY(a);
    const [x2, y2] = triXY(b);
    out.push(`<line class="tb-edge" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`);
  }
  for (let n = 0; n < NODES; n++) {
    const [x, y] = triXY(n);
    const seat = FLAGS.indexOf(n);
    if (seat >= 0) {
      const used = d.seats.includes(seat);
      const fm = d.flagMarks?.[seat] ?? '';
      out.push(`<g class="tb-flag ${fm}${seat === d.me ? ' me' : ''}${used ? '' : ' unused'}" data-flag="${seat}" style="--c:${TRI_COLORS[seat]}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><circle class="hit" r="46"/><circle class="tb-flagbase" r="34"/>${img(FLAG, 74, 4, -12)}${fm ? '<circle class="tb-ring" r="42"/>' : ''}</g>`);
      continue;
    }
    const mk = d.marks?.[n] ?? '';
    const gi = GEM_NODES.indexOf(n);
    let inner = `<circle class="tb-dot${gi >= 0 ? ' gemhome' : ''}" r="${gi >= 0 ? 22 : 16}"/>`;
    if (/\b(can|cap|sel|chosen|movable|threat)\b/.test(mk)) inner += `<circle class="tb-ring" r="40"/>`;
    out.push(`<g class="tb-node ${mk}" data-node="${n}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><circle class="hit" r="48"/>${inner}</g>`);
    if (gi >= 0) {
      const left = GEM_USES - d.board.delivered[gi];
      out.push(`<text class="tb-left" x="${x.toFixed(1)}" y="${(y + 50).toFixed(1)}" text-anchor="middle">${'◆'.repeat(left)}${'◇'.repeat(GEM_USES - left)}</text>`);
    }
  }
  // 点に落ちている宝石
  for (const g of d.board.ground) {
    if (d.board.soldiers.some((s) => s.pos === g.node)) continue;
    const [x, y] = triXY(g.node);
    out.push(`<g class="tb-gem" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">${img(GEM, 52) || '<circle r="18" fill="#f5b942"/>'}</g>`);
  }
  // 兵（宝石を持つ兵は、右上に宝石を付ける）
  for (const s of d.board.soldiers) {
    const [x, y] = triXY(s.pos);
    const under = d.board.ground.some((g) => g.node === s.pos);
    out.push(`<g class="tb-sol${s.seat === d.me ? ' me' : ''}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><ellipse cx="0" cy="12" rx="30" ry="16" fill="${TRI_COLORS[s.seat]}"/>${img(SOLDIER, 78, 0, -18) || '<circle r="16" cy="-12" fill="#ccc"/>'}${s.gem >= 0 ? `<g transform="translate(27 -34)"><circle r="19" class="tb-carry"/>${img(GEM, 32)}</g>` : ''}${under ? `<g transform="translate(-28 14)">${img(GEM, 26)}</g>` : ''}</g>`);
  }
  const el = h('div', { class: 'tb', style: `width:${(W * scale).toFixed(0)}px;height:${(HT * scale).toFixed(0)}px` });
  el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-W / 2} ${-80} ${W} ${HT}" width="${(W * scale).toFixed(0)}" height="${(HT * scale).toFixed(0)}">${out.join('')}</svg>`;
  if (onNode || onFlag) {
    el.addEventListener('click', (ev) => {
      const t = ev.target as Element;
      const f = t.closest('[data-flag]');
      if (f && onFlag) { onFlag(Number(f.getAttribute('data-flag'))); return; }
      const n = t.closest('[data-node]');
      if (n && onNode) onNode(Number(n.getAttribute('data-node')));
    });
  }
  return el;
}
