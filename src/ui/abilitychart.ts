/**
 * 手帳の人物詳細：能力 6 項目の目安（レーダーチャート＋項目名と段階の文字）。
 * 内部の 1〜10 は出さず、5 段階だけを表示する。会っていない人物は「未確認」。
 * 信頼・警戒・恩義・裏切り確率・演技・性格の値は表示しない。主人公のページには出さない（腕前はプレイヤー本人）。
 */
import type { GameState } from '../core/types';
import type { NpcId } from '../data/characters';
import { abilityRows } from '../core/relationview';
import { t } from '../i18n/i18n';
import { h } from './dom';

function radarSvg(rows: { key: string; step: number }[]): string {
  const W = 220;
  const cx = W / 2;
  const cy = 104;
  const R = 70;
  const pt = (r: number, i: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / rows.length;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const poly = (r: (i: number) => number) => rows.map((_, i) => pt(r(i), i).map((v) => v.toFixed(1)).join(',')).join(' ');
  const grid = [1, 2, 3, 4, 5].map((k) => `<polygon points="${poly(() => (R * k) / 5)}" class="ab-grid"/>`).join('');
  const axes = rows.map((_, i) => { const [x, y] = pt(R, i); return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" class="ab-grid"/>`; }).join('');
  const shape = `<polygon points="${poly((i) => (R * rows[i].step) / 5)}" class="ab-shape"/>`;
  const labels = rows.map((r, i) => {
    const [x, y] = pt(R + 16, i);
    const anchor = Math.abs(x - cx) < 4 ? 'middle' : x > cx ? 'start' : 'end';
    return `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="${anchor}" class="ab-label">${t(`ability.${r.key}`)}</text>`;
  }).join('');
  return `<svg viewBox="-40 0 ${W + 80} 210" class="ab-radar" role="img" aria-label="${t('ability.title')}">${grid}${axes}${shape}${labels}</svg>`;
}

export function abilityBlock(s: GameState, id: NpcId): HTMLElement {
  const rows = abilityRows(s, id);
  if (!rows) return h('div', { class: 'note-box' }, h('b', null, t('ability.title')), h('div', { class: 'small dim', style: 'margin-top:4px' }, t('ability.unknown')));
  const chart = h('div', { class: 'ab-chart' });
  chart.innerHTML = radarSvg(rows);
  const table = h('div', { class: 'ab-table' }, ...rows.map((r) => h('div', { class: 'ab-row' },
    h('b', { class: 'ab-name' }, t(`ability.${r.key}`)),
    h('span', { class: 'ab-bar', 'aria-hidden': 'true' }, ...[1, 2, 3, 4, 5].map((n) => h('i', { class: n <= r.step ? 'on' : '' }))),
    h('span', { class: 'ab-step' }, t(`ability.step${r.step}`)),
    h('span', { class: 'ab-desc small dim' }, t(`ability.desc.${r.key}`)))));
  return h('div', { class: 'note-box ab-box' },
    h('b', null, t('ability.title')),
    h('div', { class: 'small dim', style: 'margin:2px 0 6px' }, t('ability.note')),
    h('div', { class: 'ab-wrap' }, chart, table));
}
