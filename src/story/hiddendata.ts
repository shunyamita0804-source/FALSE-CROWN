/**
 * 裏ゲーム H01〜H08 の問題と資料（仕様 v04/02_PUZZLE_DATA.json を元にする）。
 * 文面は「大会の記録を調べる」という調子に直してある（事件や被害を強く言う言葉は使わない。変更点は docs/tone_changes.md）。
 * 答えは、画面や手帳には出さない。判定にだけ使う。
 * 参加者の名前は直接書かず {name:<内部ID>}・{short:<内部ID>} で書く（npc_names.json の表示名に置き換わる）。
 */

import { fillNames } from '../data/characters';

// ---- H01 賢者の金庫 ----
export const H01_ANSWER = '642135';
export const H01_CLUES: { text: string; ok: (d: number[]) => boolean }[] = [
  { text: '1 から 6 を 1 回ずつ使う。', ok: (d) => new Set(d).size === 6 && d.every((x) => x >= 1 && x <= 6) },
  { text: '2 桁目は、3 桁目の 2 倍。', ok: (d) => d[1] === d[2] * 2 },
  { text: '1 桁目は、2 桁目より 2 大きい。', ok: (d) => d[0] === d[1] + 2 },
  { text: '4 桁目は 1。', ok: (d) => d[3] === 1 },
  { text: '5 桁目は、4 桁目より 2 大きい。', ok: (d) => d[4] === d[3] + 2 },
  { text: '6 桁目は、5 桁目より 2 大きい。', ok: (d) => d[5] === d[4] + 2 },
];

// ---- H03 鏡の迷宮 ----
export interface MirrorStage { boards: [string[], string[]]; start: [[number, number], [number, number]]; goal: [[number, number], [number, number]]; maxMoves: number }
export const H03_STAGES: MirrorStage[] = [
  {
    boards: [['##...#.', '#.#....', '.......', '.#...#.', '......#', '....#.#', '.....##'], ['.#....#', '...#.##', '.......', '.......', '...#.#.', '#..#..#', '##.....']],
    start: [[0, 6], [6, 6]], goal: [[6, 0], [0, 0]], maxMoves: 30,
  },
  {
    boards: [['.#.....', '......#', '#..#.#.', '#.#...#', '..#...#', '.......', '....#.#'], ['...#.#.', '...#..#', '..##..#', '..#....', '#....##', '.......', '...#...']],
    start: [[0, 6], [6, 6]], goal: [[6, 0], [0, 0]], maxMoves: 30,
  },
  {
    boards: [['.##..#.', '.#.....', '..#....', '.##....', '#..#...', '.....#.', '..#...#'], ['.......', '..#..#.', '....#..', '...#...', '.###..#', '..#...#', '...##..']],
    start: [[0, 6], [6, 6]], goal: [[6, 0], [0, 0]], maxMoves: 30,
  },
];

// ---- H04 囚人の遺言 ----
export const LETTERS: { id: string; title: string; text: string }[] = [
  { id: 'L01', title: '第零牢の配膳控え', text: '第 3 回の大会の終了後、21:10 に、12 人分の食事を B2-I へ運んだ。' },
  { id: 'L02', title: '旧書庫の移送控え', text: '同じ日の 21:00、参加者番号 07 を、競技の区画から B2-I へ案内した。' },
  { id: 'L03', title: '第零牢の私信', text: '私は 07 だ。21:15 に、B2-I で食事を受け取った。大会が終わるまで、ここで待つことになるらしい。' },
  { id: 'L04', title: '旧書庫の公告の写し', text: '同じ日の 20:55 の公告：「07 は競技から外れました。以降、施設の外へ出たものとして扱います。」' },
  { id: 'L05', title: '地下通路の保守メモ', text: 'B2-I は待機用の区画。搬入口は、B2 の保管庫とつながっている。搬入の記録は消さないこと。' },
];
export interface Quiz { prompt: string; options: string[]; answer: number; evidence: string[] }
export const H04_QUESTIONS: Quiz[] = [
  { prompt: '07 が案内された先は？', options: ['玄関', '待機用の区画', '競技場'], answer: 1, evidence: ['L02', 'L05'] },
  { prompt: '公告と食い違う資料は？', options: ['07 本人の食事の記録', '大会の順位', '図書室の貸出表'], answer: 0, evidence: ['L03', 'L04'] },
  { prompt: '食事が運ばれた時刻は？', options: ['20:55', '21:00', '21:10'], answer: 2, evidence: ['L01'] },
  { prompt: '搬入口がつながっている場所は？', options: ['展望室', '保管庫', '食堂'], answer: 1, evidence: ['L05'] },
  { prompt: '資料だけで言い切れることは？', options: ['07 は施設の外へ出た', '全員が施設の外へ出た', '07 は、公告のあとも施設の中にいた'], answer: 2, evidence: ['L01', 'L02', 'L03', 'L04'] },
];
export const H04_PASS = 4;

// ---- H05 時の牢獄 ----
export const H05_SEQ = { prompt: '差が毎回 2 ずつ増える数の列', seq: [2, 5, 10, 17, 26], answer: 37 };
export const H05_ORDER = { glyphs: ['A', 'B', 'C', 'D'], clues: ['B は A のすぐ後', 'D は先頭', 'C は B より後'], answer: ['D', 'A', 'B', 'C'] };

// ---- H07 十二の証明 ----
export interface Evidence { id: string; person: string; subject: string; text: string }
const EVIDENCE_SRC: Evidence[] = [
  { id: 'E01', person: 'hero', subject: '主人公', text: '黒い招待状の受け取りの記録。本人が研究の関係者だという記載は無い。' },
  { id: 'E02', person: 'npc_02_kanzaki', subject: '{short:npc_02_kanzaki}', text: '意思決定モデルの旧版に、{name:npc_02_kanzaki}の署名。' },
  { id: 'E03', person: 'npc_03_kurose', subject: '{short:npc_03_kurose}', text: '過去の大会の参加者から、{name:npc_03_kurose}への調査の委任状。' },
  { id: 'E04', person: 'npc_04_mido', subject: '{short:npc_04_mido}', text: '研究施設への出資の契約書に、{name:npc_04_mido}の署名。' },
  { id: 'E05', person: 'npc_05_shiraishi', subject: '{short:npc_05_shiraishi}', text: '{name:npc_05_shiraishi}の研究計画書。題は「集団の中での約束と裏切り」。' },
  { id: 'E06', person: 'npc_06_kiryu', subject: '{short:npc_06_kiryu}', text: '{name:npc_06_kiryu}が、過去の競技の記録を受け取った控え。' },
  { id: 'E07', person: 'npc_07_tachibana', subject: '{short:npc_07_tachibana}', text: '名前を伏せた診療の引き継ぎ書に、{name:npc_07_tachibana}の担当の記録。' },
  { id: 'E08', person: 'npc_08_dojima', subject: '{short:npc_08_dojima}', text: '{name:npc_08_dojima}が、過去の参加者の行方を調べたメモ。' },
  { id: 'E09', person: 'npc_09_asahina', subject: '{short:npc_09_asahina}', text: '過去の参加名簿と、{name:npc_09_asahina}の家族を照らし合わせた資料。' },
  { id: 'E10', person: 'npc_10_kujo', subject: '{short:npc_10_kujo}', text: '過去の参加者カードに、{name:npc_10_kujo}の名前。' },
  { id: 'E11', person: 'npc_11_kisaragi', subject: '{short:npc_11_kisaragi}', text: 'オブザーバーから{name:npc_11_kisaragi}への、公開されていない依頼書。中身は別の記録にある。' },
  { id: 'E12', person: 'npc_12_kuze', subject: '{short:npc_12_kuze}', text: 'CROWN 計画の発足の文書に、{name:npc_12_kuze}の署名。' },
];
const H07_SRC: Quiz[] = [
  { prompt: '主人公', options: ['行方の調査', '招待状の照合の相手', '研究への出資'], answer: 1, evidence: ['E01'] },
  { prompt: '{short:npc_02_kanzaki}', options: ['過去の参加者の家族', '数理モデルの開発', '約束と裏切りの研究'], answer: 1, evidence: ['E02'] },
  { prompt: '{short:npc_03_kurose}', options: ['過去の参加者の代理人', '過去の競技の記録を持つ', '過去の参加者'], answer: 0, evidence: ['E03'] },
  { prompt: '{short:npc_04_mido}', options: ['主催者からの依頼', '参加者の診療の担当', '研究への出資'], answer: 2, evidence: ['E04'] },
  { prompt: '{short:npc_05_shiraishi}', options: ['約束と裏切りの研究', '行方の調査', '計画の創設者'], answer: 0, evidence: ['E05'] },
  { prompt: '{short:npc_06_kiryu}', options: ['過去の競技の記録を持つ', '過去の参加者の家族', '招待状の照合の相手'], answer: 0, evidence: ['E06'] },
  { prompt: '{short:npc_07_tachibana}', options: ['過去の参加者', '参加者の診療の担当', '数理モデルの開発'], answer: 1, evidence: ['E07'] },
  { prompt: '{short:npc_08_dojima}', options: ['行方の調査', '主催者からの依頼', '過去の参加者の代理人'], answer: 0, evidence: ['E08'] },
  { prompt: '{short:npc_09_asahina}', options: ['過去の参加者の家族', '研究への出資', '計画の創設者'], answer: 0, evidence: ['E09'] },
  { prompt: '{short:npc_10_kujo}', options: ['過去の参加者', '約束と裏切りの研究', '招待状の照合の相手'], answer: 0, evidence: ['E10'] },
  { prompt: '{short:npc_11_kisaragi}', options: ['数理モデルの開発', '過去の競技の記録を持つ', '主催者からの依頼'], answer: 2, evidence: ['E11'] },
  { prompt: '{short:npc_12_kuze}', options: ['過去の参加者の代理人', '参加者の診療の担当', '計画の創設者'], answer: 2, evidence: ['E12'] },
];

export const EVIDENCE: Evidence[] = EVIDENCE_SRC.map((e) => ({ ...e, subject: fillNames(e.subject), text: fillNames(e.text) }));
export const H07_QUESTIONS: Quiz[] = H07_SRC.map((q) => ({ ...q, prompt: fillNames(q.prompt) }));

// ---- H08 神の方程式 ----
export const CORE01 = 'CROWN 計画の最後の試験は、追い詰められた状況での人の決め方と、集団の動きを予測することを目的とする。責任者はオブザーバー。過去の試験で、重大な問題が起きた。';
export const H08_CIPHER = { nums: [3, 18, 15, 23, 14], answer: 'CROWN' };
export const H08_SEQ = { prompt: '前の数に、2、4、8、16、32 を順に足す', seq: [3, 5, 9, 17, 33], answer: 65 };
export const H08_LOGIC = { prompt: '3 つの記録 A、B、C のうち、本当のことを言っているのは 1 つだけ。資料が入っている箱は？', lines: ['A「資料は C の箱ではない」', 'B「資料は A か B の箱にある」', 'C「資料は C の箱にある」'], options: ['A の箱', 'B の箱', 'C の箱'], answer: 2 };
export const H08_FINAL: Quiz = { prompt: 'CROWN 計画の最後の試験が見ているものは？', options: ['賞金の支払いの速さ', '追い詰められた状況での、人の決め方', '参加者の体力'], answer: 1, evidence: ['CORE01'] };
