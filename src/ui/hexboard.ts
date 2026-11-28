/**
 * 六角形の盤面の描画部品（M07 六角領域、P07 ブラック＆ホワイトで共用）。
 * マスごとに色、印、中身を指定して SVG を作る。マスには data-cell を付けるので、タップした位置からマス番号が分かる。
 * 正式素材のマスの絵は、加工せずに等倍率の拡大縮小と位置合わせだけで下地に敷き、色はプログラムで重ねる。
 */
import { assetUrl } from '../assets/registry';
import { hexXY, hexXYFlat, rot60, type HexGrid } from '../matches/hex';
import { h } from './dom';

export const HEX_COLORS = ['#e6b84f', '#5fb8e6', '#e67a6a', '#7ed48a', '#c59be8', '#f29ac2'];
/**
 * 頂点が上の向きのマスの絵（2026-11-28 受領）があれば、盤面も頂点が上の向きで組む（同じ高さで約 1 割大きく見える）。
 * 無ければ従来の平らな辺が上の向き。図形タイルの小さな絵も盤面と同じ向きにそろえる。
 */
const POINTY_ART = assetUrl('ui/v11/m07/hex_tile_surface_pointy');
export const POINTY = !!POINTY_ART;
const SURFACE = POINTY_ART ?? assetUrl('ui/v11/m07/hex_tile_surface');
const MARKER = assetUrl('ui/v11/m07/central_marker');
const BEACON = assetUrl('ui/v11/m07/beacon_ring');
/** 素材の中での六角形の中心と半径（頂点までの距離、px） */
const ART = POINTY ? { cx: 128, cy: 128.5, r: 120.5, size: 256 } : { cx: 128, cy: 127.5, r: 121, size: 256 };
const xyOf = (q: number, r: number): [number, number] => (POINTY ? hexXY(q, r) : hexXYFlat(q, r));

export interface HexCell { cls?: string; fill?: string; inner?: string; bare?: boolean }

const corners = (s: number) => [0, 1, 2, 3, 4, 5].map((i) => { const a = (Math.PI / 3) * i + (POINTY ? Math.PI / 6 : 0); return `${(s * Math.cos(a)).toFixed(2)},${(s * Math.sin(a)).toFixed(2)}`; }).join(' ');

export function hexBoard(g: HexGrid, size: number, draw: (c: number) => HexCell, opts: { cls?: string; surface?: boolean } = {}): HTMLElement {
  const w = (POINTY ? Math.sqrt(3) * (g.radius * 2 + 1) : 1.5 * g.radius * 2 + 2) * size + 6;
  const hh = (POINTY ? 1.5 * g.radius * 2 + 2 : Math.sqrt(3) * (g.radius * 2 + 1)) * size + 6;
  const pts = corners(size * 0.95);
  const k = size / ART.r;
  const parts: string[] = [];
  g.cells.forEach(([q, r], c) => {
    const [x, y] = xyOf(q, r);
    const d = draw(c);
    const img = opts.surface !== false && !d.bare && SURFACE ? `<image href="${SURFACE}" x="${(-ART.cx * k).toFixed(2)}" y="${(-ART.cy * k).toFixed(2)}" width="${(ART.size * k).toFixed(2)}" height="${(ART.size * k).toFixed(2)}"/>` : '';
    parts.push(`<g class="hx ${d.cls ?? ''}" data-cell="${c}" transform="translate(${(x * size).toFixed(2)} ${(y * size).toFixed(2)})"${d.fill ? ` style="--c:${d.fill}"` : ''}>${img}<polygon class="hx-f" points="${pts}"/>${d.inner ?? ''}</g>`);
  });
  const el = h('div', { class: `hxb ${opts.cls ?? ''}`, style: `width:${w.toFixed(0)}px;height:${hh.toFixed(0)}px` });
  el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${(-w / 2).toFixed(1)} ${(-hh / 2).toFixed(1)} ${w.toFixed(1)} ${hh.toFixed(1)}" width="${w.toFixed(0)}" height="${hh.toFixed(0)}">${parts.join('')}</svg>`;
  return el;
}

/** 中央の印（正式素材。無い時は星形を描く） */
export const markerInner = (size: number) => (MARKER ? `<image href="${MARKER}" x="${-size * 0.7}" y="${-size * 0.7}" width="${size * 1.4}" height="${size * 1.4}"/>` : `<circle r="${size * 0.4}" fill="#e6b84f"/>`);

/** 連結目標の目印（正式素材の白い輪をプレイヤー色に染める。無い時は色の輪を描く） */
export function beaconInner(size: number, color: string, mine: boolean): string {
  if (!BEACON) return `<circle class="hx-beacon${mine ? ' mine' : ''}" r="${size * 0.5}" stroke="${color}"/>`;
  const id = `bc${color.replace('#', '')}`;
  const s = size * 1.25;
  return `<filter id="${id}"><feFlood flood-color="${color}"/><feComposite in2="SourceAlpha" operator="in"/></filter><image class="hx-beacon-art${mine ? ' mine' : ''}" href="${BEACON}" x="${(-s / 2).toFixed(1)}" y="${(-s / 2).toFixed(1)}" width="${s.toFixed(1)}" height="${s.toFixed(1)}" filter="url(#${id})"/>`;
}

/** 指の位置にあるマス番号（無ければ -1） */
export function cellFromPoint(root: HTMLElement, x: number, y: number): number {
  const el = document.elementFromPoint(x, y);
  if (!el || !root.contains(el)) return -1;
  const cell = (el as Element).closest('[data-cell]');
  return cell ? Number(cell.getAttribute('data-cell')) : -1;
}

/** 図形タイルの小さな絵 */
export function shapeSvg(cells: [number, number][], rot: number, color: string, size = 8): string {
  const xy = cells.map(([q, r]) => xyOf(...rot60(q, r, rot)).map((v) => v * size) as [number, number]);
  const xs = xy.map((p) => p[0]);
  const ys = xy.map((p) => p[1]);
  const minX = Math.min(...xs) - size;
  const maxX = Math.max(...xs) + size;
  const minY = Math.min(...ys) - size;
  const maxY = Math.max(...ys) + size;
  const pts = corners(size * 0.92);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX.toFixed(1)} ${minY.toFixed(1)} ${(maxX - minX).toFixed(1)} ${(maxY - minY).toFixed(1)}" width="${(maxX - minX).toFixed(0)}" height="${(maxY - minY).toFixed(0)}">${xy.map(([x, y]) => `<polygon points="${pts}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})" fill="${color}" stroke="rgba(0,0,0,0.45)" stroke-width="1"/>`).join('')}</svg>`;
}
