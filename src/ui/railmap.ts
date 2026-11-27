/**
 * 鉄道の地図（M04 と練習で共用）。都市と区間を SVG で描き、区間のタップを知らせる。
 * 空いている区間は破線と建設費、敷かれた区間は持ち主の色の実線と持ち主の印で示す（色だけに頼らない）。
 */
import { assetUrl } from '../assets/registry';
import { CITY_NAMES, CITY_POS, EDGES } from '../matches/m04';
import { h } from './dom';

export const SEAT_COLORS = ['#e6b84f', '#5fb8e6', '#e67a6a', '#7ed48a'];
const STATION = assetUrl('ui/v11/m04/station');
const W = 520;
const H = 460;
const px = (c: number): [number, number] => [60 + CITY_POS[c][0] * 200, 50 + CITY_POS[c][1] * 180];

export interface RailMapData {
  costs: number[];
  owner: number[];
  /** 席ごとの印（名前の 1 文字など） */
  marks: string[];
  /** 選択中の区間 */
  sel?: number;
  /** 強調する経路（任務の計画や、輸送で通る道） */
  route?: number[];
  /** 強調する都市（任務の出発地と目的地） */
  cities?: number[];
  /** 直前に敷かれた区間 */
  fresh?: number[];
}

export class RailMap {
  readonly el: HTMLElement;
  constructor(private readonly onEdge?: (edge: number) => void, scale = 1) {
    this.el = h('div', { class: 'rm', style: `width:${W * scale}px;height:${H * scale}px` });
    if (onEdge) {
      this.el.addEventListener('click', (e) => {
        const t = (e.target as Element).closest('[data-edge]');
        if (t) onEdge(Number(t.getAttribute('data-edge')));
      });
    }
  }

  draw(d: RailMapData): void {
    const out: string[] = [];
    EDGES.forEach(([a, b], e) => {
      const [x1, y1] = px(a);
      const [x2, y2] = px(b);
      const own = d.owner[e];
      const inRoute = d.route?.includes(e);
      if (inRoute) out.push(`<line class="rm-route" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`);
      if (d.sel === e) out.push(`<line class="rm-sel" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`);
      if (own >= 0) out.push(`<line class="rm-rail${d.fresh?.includes(e) ? ' fresh' : ''}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${SEAT_COLORS[own % SEAT_COLORS.length]}"/><line class="rm-tie" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`);
      else out.push(`<line class="rm-free" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`);
    });
    // 区間の中央の札：空きは建設費、敷設済みは持ち主の印
    EDGES.forEach(([a, b], e) => {
      const [x1, y1] = px(a);
      const [x2, y2] = px(b);
      // 斜めの区間どうしは中央で重ならないが、札が都市に近づきすぎないよう中点に置く
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const own = d.owner[e];
      out.push(own >= 0
        ? `<g class="rm-badge own"><circle cx="${mx}" cy="${my}" r="15" fill="${SEAT_COLORS[own % SEAT_COLORS.length]}"/><text x="${mx}" y="${my}">${d.marks[own] ?? ''}</text></g>`
        : `<g class="rm-badge"><circle cx="${mx}" cy="${my}" r="15"/><text x="${mx}" y="${my}">${d.costs[e]}</text></g>`);
    });
    CITY_NAMES.forEach((name, c) => {
      const [x, y] = px(c);
      if (d.cities?.includes(c)) out.push(`<circle class="rm-ring" cx="${x}" cy="${y}" r="40"/>`);
      out.push(STATION ? `<image href="${STATION}" x="${x - 34}" y="${y - 34}" width="68" height="68"/>` : `<circle class="rm-city" cx="${x}" cy="${y}" r="24"/>`);
      out.push(`<g class="rm-name"><circle cx="${x - 26}" cy="${y - 26}" r="13"/><text x="${x - 26}" y="${y - 26}">${name}</text></g>`);
    });
    // タップ用の太い透明な線（指で押しやすい幅）。空いている区間だけ
    if (this.onEdge) EDGES.forEach(([a, b], e) => {
      if (d.owner[e] >= 0) return;
      const [x1, y1] = px(a);
      const [x2, y2] = px(b);
      out.push(`<line class="rm-hit" data-edge="${e}" x1="${x1 + (x2 - x1) * 0.2}" y1="${y1 + (y2 - y1) * 0.2}" x2="${x1 + (x2 - x1) * 0.8}" y2="${y1 + (y2 - y1) * 0.8}"/>`);
    });
    this.el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="100%">${out.join('')}</svg>`;
  }
}
