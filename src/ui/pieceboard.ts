/**
 * マス目の盤面に駒を置く描画部品（M09 四王の戦場・改、P10 最後の一手で共用）。
 * 駒は正式素材をそのまま（等倍率の拡大縮小だけで）置き、持ち主の色は足元の丸で示す。マスには印（動ける、取れる、選択中など）を付けられる。
 */
import { assetUrl } from '../assets/registry';
import { h } from './dom';

const ART: Record<string, string | null> = {
  king: assetUrl('ui/v11/m09/king'),
  soldier: assetUrl('ui/v11/m09/soldier'),
  pawn: assetUrl('ui/v11/m08/pawn'),
};

export interface BoardPiece { pos: number; seat: number; kind: 'king' | 'soldier' | 'pawn' }

export interface PieceBoardOpts {
  n: number;
  cell: number;
  pieces: BoardPiece[];
  colors: string[];
  /** 自分の席（自分の駒に白い縁を付ける） */
  me?: number;
  /** マス番号 → 印（can、cap、sel、from、to、danger、center など。空白区切りで複数） */
  marks?: Record<number, string>;
  onCell?: (c: number) => void;
}

export function pieceEl(kind: BoardPiece['kind'], color: string, size: number, mine = false): HTMLElement {
  const el = h('span', { class: `pz ${kind}${mine ? ' me' : ''}`, style: `--c:${color};width:${size}px;height:${size}px` }, h('i', { class: 'pz-base' }));
  const url = ART[kind];
  if (url) el.append(h('img', { src: url, alt: '', draggable: 'false' }));
  else el.append(h('b', null, kind === 'king' ? '王' : '兵'));
  return el;
}

export function pieceBoard(o: PieceBoardOpts): HTMLElement {
  const el = h('div', { class: `pzb${o.onCell ? ' active' : ''}`, style: `--pz-cell:${o.cell}px;grid-template-columns:repeat(${o.n}, ${o.cell}px)` });
  const byPos = new Map(o.pieces.map((p) => [p.pos, p]));
  for (let c = 0; c < o.n * o.n; c++) {
    const p = byPos.get(c);
    const cell = h('button', { class: `pzb-cell ${(c % o.n + Math.floor(c / o.n)) % 2 ? 'odd' : 'even'} ${o.marks?.[c] ?? ''}`, type: 'button', 'data-cell': String(c), disabled: !o.onCell },
      p ? pieceEl(p.kind, o.colors[p.seat], Math.round(o.cell * 0.92), p.seat === o.me) : null);
    el.append(cell);
  }
  if (o.onCell) {
    el.addEventListener('click', (e) => {
      const t = (e.target as Element).closest<HTMLElement>('[data-cell]');
      if (t) o.onCell!(Number(t.dataset.cell));
    });
  }
  return el;
}
