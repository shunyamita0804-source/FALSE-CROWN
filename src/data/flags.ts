/**
 * M02 フラッグ・フラッシュで使う国旗。画像ファイルは使わず、各国が公表している国旗の仕様（配色と図形の配置）を
 * もとにプログラムで描く。小さい表示で見分けやすいよう、縦横比はすべて 3:2 にそろえ（スイスだけは正方形）、
 * 紋章の入る旗は採用していない。色は公表されている色の近似値。帰属に争いのある地域の旗は入れていない。
 */

type Op =
  | { t: 'h'; c: string[]; w?: number[] } // 横じま（上から）
  | { t: 'v'; c: string[]; w?: number[] } // 縦じま（左から）
  | { t: 'r'; x: number; y: number; w: number; h: number; c: string }
  | { t: 'o'; x: number; y: number; r: number; c: string } // 円
  | { t: 's'; x: number; y: number; r: number; c: string } // 五角の星
  | { t: 'p'; pts: string; c: string } // 多角形
  | { t: 'x'; c: string; w: number }; // 北欧十字（縦の帯は左寄り）

export interface FlagDef {
  id: string;
  name: string;
  ops: Op[];
}

const H = (c: string[], w?: number[]): Op => ({ t: 'h', c, w });
const V = (c: string[], w?: number[]): Op => ({ t: 'v', c, w });
const R = (x: number, y: number, w: number, h: number, c: string): Op => ({ t: 'r', x, y, w, h, c });
const O = (x: number, y: number, r: number, c: string): Op => ({ t: 'o', x, y, r, c });
const ST = (x: number, y: number, r: number, c: string): Op => ({ t: 's', x, y, r, c });
const X = (c: string, w: number): Op => ({ t: 'x', c, w });

export const FLAGS: FlagDef[] = [
  { id: 'jp', name: '日本', ops: [H(['#ffffff']), O(15, 10, 6, '#bc002d')] },
  { id: 'bd', name: 'バングラデシュ', ops: [H(['#006a4e']), O(13.5, 10, 6, '#f42a41')] },
  { id: 'pw', name: 'パラオ', ops: [H(['#4aadd6']), O(13, 10, 6, '#ffde00')] },
  { id: 'fr', name: 'フランス', ops: [V(['#0055a4', '#ffffff', '#ef4135'])] },
  { id: 'it', name: 'イタリア', ops: [V(['#009246', '#ffffff', '#ce2b37'])] },
  { id: 'ie', name: 'アイルランド', ops: [V(['#169b62', '#ffffff', '#ff883e'])] },
  { id: 'be', name: 'ベルギー', ops: [V(['#000000', '#fdda24', '#ef3340'])] },
  { id: 'ro', name: 'ルーマニア', ops: [V(['#002b7f', '#fcd116', '#ce1126'])] },
  { id: 'ng', name: 'ナイジェリア', ops: [V(['#008751', '#ffffff', '#008751'])] },
  { id: 'pe', name: 'ペルー', ops: [V(['#d91023', '#ffffff', '#d91023'])] },
  { id: 'ml', name: 'マリ', ops: [V(['#14b53a', '#fcd116', '#ce1126'])] },
  { id: 'de', name: 'ドイツ', ops: [H(['#000000', '#dd0000', '#ffce00'])] },
  { id: 'nl', name: 'オランダ', ops: [H(['#ae1c28', '#ffffff', '#21468b'])] },
  { id: 'at', name: 'オーストリア', ops: [H(['#ed2939', '#ffffff', '#ed2939'])] },
  { id: 'hu', name: 'ハンガリー', ops: [H(['#ce2939', '#ffffff', '#477050'])] },
  { id: 'bg', name: 'ブルガリア', ops: [H(['#ffffff', '#00966e', '#d62612'])] },
  { id: 'lt', name: 'リトアニア', ops: [H(['#fdb913', '#006a44', '#c1272d'])] },
  { id: 'ee', name: 'エストニア', ops: [H(['#0072ce', '#000000', '#ffffff'])] },
  { id: 'am', name: 'アルメニア', ops: [H(['#d90012', '#0033a0', '#f2a800'])] },
  { id: 'ga', name: 'ガボン', ops: [H(['#009e60', '#fcd116', '#3a75c4'])] },
  { id: 'sl', name: 'シエラレオネ', ops: [H(['#1eb53a', '#ffffff', '#0072c6'])] },
  { id: 'ye', name: 'イエメン', ops: [H(['#ce1126', '#ffffff', '#000000'])] },
  { id: 'co', name: 'コロンビア', ops: [H(['#fcd116', '#003893', '#ce1126'], [2, 1, 1])] },
  { id: 'lv', name: 'ラトビア', ops: [H(['#9e3039', '#ffffff', '#9e3039'], [2, 1, 2])] },
  { id: 'pl', name: 'ポーランド', ops: [H(['#ffffff', '#dc143c'])] },
  { id: 'id', name: 'インドネシア', ops: [H(['#ff0000', '#ffffff'])] },
  { id: 'ua', name: 'ウクライナ', ops: [H(['#0057b7', '#ffd700'])] },
  { id: 'th', name: 'タイ', ops: [H(['#a51931', '#f4f5f8', '#2d2a4a', '#f4f5f8', '#a51931'], [1, 1, 2, 1, 1])] },
  { id: 'cr', name: 'コスタリカ', ops: [H(['#002b7f', '#ffffff', '#ce1126', '#ffffff', '#002b7f'], [1, 1, 2, 1, 1])] },
  { id: 'mu', name: 'モーリシャス', ops: [H(['#ea2839', '#1a206d', '#ffd500', '#00a551'])] },
  { id: 'gm', name: 'ガンビア', ops: [H(['#ce1126', '#ffffff', '#0c1c8c', '#ffffff', '#3a7728'], [6, 1, 4, 1, 6])] },
  { id: 'bw', name: 'ボツワナ', ops: [H(['#75aadb', '#ffffff', '#000000', '#ffffff', '#75aadb'], [9, 1, 4, 1, 9])] },
  { id: 'se', name: 'スウェーデン', ops: [H(['#006aa7']), X('#fecc00', 4)] },
  { id: 'dk', name: 'デンマーク', ops: [H(['#c8102e']), X('#ffffff', 3.4)] },
  { id: 'fi', name: 'フィンランド', ops: [H(['#ffffff']), X('#003580', 5)] },
  { id: 'no', name: 'ノルウェー', ops: [H(['#ba0c2f']), X('#ffffff', 5), X('#00205b', 2.5)] },
  { id: 'is', name: 'アイスランド', ops: [H(['#02529c']), X('#ffffff', 5), X('#dc1e35', 2.5)] },
  { id: 'ch', name: 'スイス', ops: [R(5, 0, 20, 20, '#da291c'), R(13, 4, 4, 12, '#ffffff'), R(9, 8, 12, 4, '#ffffff')] },
  { id: 'vn', name: 'ベトナム', ops: [H(['#da251d']), ST(15, 10.4, 6, '#ffff00')] },
  { id: 'so', name: 'ソマリア', ops: [H(['#4189dd']), ST(15, 10.4, 5, '#ffffff')] },
  { id: 'gh', name: 'ガーナ', ops: [H(['#ce1126', '#fcd116', '#006b3f']), ST(15, 10.3, 3.4, '#000000')] },
  { id: 'la', name: 'ラオス', ops: [H(['#ce1126', '#002868', '#ce1126'], [1, 2, 1]), O(15, 10, 4, '#ffffff')] },
  { id: 'ae', name: 'アラブ首長国連邦', ops: [H(['#00732f', '#ffffff', '#000000']), R(0, 0, 7.5, 20, '#ff0000')] },
  { id: 'mg', name: 'マダガスカル', ops: [H(['#fc3d32', '#007e3a']), R(0, 0, 10, 20, '#ffffff')] },
  { id: 'bj', name: 'ベナン', ops: [H(['#fcd116', '#e8112d']), R(0, 0, 12, 20, '#008751')] },
  { id: 'cz', name: 'チェコ', ops: [H(['#ffffff', '#d7141a']), { t: 'p', pts: '0,0 15,10 0,20', c: '#11457e' }] },
  { id: 'cl', name: 'チリ', ops: [H(['#ffffff', '#d52b1e']), R(0, 0, 10, 10, '#0039a6'), ST(5, 5.3, 3.2, '#ffffff')] },
];

export const FLAG_BY_ID: Record<string, FlagDef> = Object.fromEntries(FLAGS.map((f) => [f.id, f]));

function stripes(c: string[], w: number[] | undefined, horizontal: boolean): string {
  const ws = w ?? c.map(() => 1);
  const total = ws.reduce((a, b) => a + b, 0);
  let at = 0;
  let out = '';
  c.forEach((col, i) => {
    const len = (ws[i] / total) * (horizontal ? 20 : 30);
    out += horizontal ? `<rect x="0" y="${at.toFixed(3)}" width="30" height="${(len + 0.05).toFixed(3)}" fill="${col}"/>` : `<rect x="${at.toFixed(3)}" y="0" width="${(len + 0.05).toFixed(3)}" height="20" fill="${col}"/>`;
    at += len;
  });
  return out;
}

function star(x: number, y: number, r: number, c: string): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.382;
    pts.push(`${(x + Math.cos(a) * rr).toFixed(2)},${(y + Math.sin(a) * rr).toFixed(2)}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="${c}"/>`;
}

/** 国旗の SVG（viewBox 30×20）。外枠は細い線で囲み、白地の旗も背景に溶けないようにする */
export function flagSvg(id: string): string {
  const f = FLAG_BY_ID[id];
  if (!f) return '';
  let body = '';
  for (const op of f.ops) {
    if (op.t === 'h') body += stripes(op.c, op.w, true);
    else if (op.t === 'v') body += stripes(op.c, op.w, false);
    else if (op.t === 'r') body += `<rect x="${op.x}" y="${op.y}" width="${op.w}" height="${op.h}" fill="${op.c}"/>`;
    else if (op.t === 'o') body += `<circle cx="${op.x}" cy="${op.y}" r="${op.r}" fill="${op.c}"/>`;
    else if (op.t === 's') body += star(op.x, op.y, op.r, op.c);
    else if (op.t === 'p') body += `<polygon points="${op.pts}" fill="${op.c}"/>`;
    else body += `<rect x="${(10.5 - op.w / 2).toFixed(2)}" y="0" width="${op.w}" height="20" fill="${op.c}"/><rect x="0" y="${(10 - op.w / 2).toFixed(2)}" width="30" height="${op.w}" fill="${op.c}"/>`;
  }
  const square = id === 'ch';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20" class="flag-svg" aria-label="${f.name}">${body}<rect x="${square ? 5.25 : 0.25}" y="0.25" width="${square ? 19.5 : 29.5}" height="19.5" fill="none" stroke="rgba(0,0,0,0.45)" stroke-width="0.5"/></svg>`;
}
