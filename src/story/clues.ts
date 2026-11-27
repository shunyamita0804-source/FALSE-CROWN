/**
 * 探索で得られる手掛かり。調査地点の event ID と対応する。
 * NPC も同じ地点を調べて同じ手掛かりを得る（プレイヤーは NPC から買う代替経路を持つ）。
 * 隠しゲーム本体（H01〜H08）は後続の工程で実装する。
 */
export interface ClueDef {
  id: string;
  /** 調査地点の event */
  event: string;
  text: string;
  value: number;
  tags: string[];
  /** 出現する最初の日 */
  fromDay?: number;
  /** 夜だけ */
  nightOnly?: boolean;
}

export const CLUES: ClueDef[] = [
  { id: 'clue_h01_shelf', event: 'h01_shelf', text: '図書室の奥の書棚は、背表紙の番号が意図的に入れ替えられている。', value: 2, tags: ['h01', 'hidden'] },
  { id: 'clue_h01_diary', event: 'h01_diary', text: '図書室の日記に「王は六つの数を愛した」とある。六桁の暗証を示すらしい。', value: 2, tags: ['h01', 'hidden'] },
  { id: 'clue_h02_clock', event: 'h02_clock', text: '展望室の壁の大時計は、深夜になると文字盤の裏で何かが動く音がする。', value: 2, tags: ['h02', 'hidden'], nightOnly: true },
  { id: 'clue_h03_mirror', event: 'h03_mirror', text: '浴室の右の鏡に、湯気でだけ浮かぶ左右反転の記号がある。', value: 2, tags: ['h03', 'hidden'] },
  { id: 'clue_h04_wall', event: 'h04_wall', text: '共同牢の壁に、爪で刻んだ数字の列がある。隣の壁の向こうは空洞らしい。', value: 2, tags: ['h04', 'hidden'] },
  { id: 'clue_h04_letters', event: 'h04_letters', text: '旧書庫に「次の参加者へ」と書かれた古い手紙が五通ある。', value: 2, tags: ['h04', 'hidden'] },
  { id: 'clue_h05_mech', event: 'h05_mech', text: '地下通路の奥に、数字盤・スライド板・記号歯車の仕掛け扉がある。', value: 2, tags: ['h05', 'hidden'] },
  { id: 'clue_floor_guide', event: 'floor_guide', text: '館内案内図では、地下へ続く階段の表記だけが塗り潰されている。', value: 1, tags: ['facility'] },
  { id: 'clue_entrance', event: 'entrance_lock', text: '玄関の電子錠は「11」を表示している。大会の日数と同じ数字だ。', value: 1, tags: ['facility'] },
  { id: 'clue_garden_coin', event: 'garden_coin', text: '庭園の水盤に、裏に「零」と刻まれた硬貨が沈んでいる。', value: 1, tags: ['facility', 'h04'] },
  { id: 'clue_inf_records', event: 'inf_records', text: '医務室に十年前で止まったカルテの束がある。患者名は黒く塗られている。', value: 2, tags: ['story', 'past'] },
  { id: 'clue_b1_noise', event: 'b1_noise', text: '監獄棟の配管の向こうから、誰かが規則的に叩く音が聞こえる。', value: 2, tags: ['story', 'isolation'], fromDay: 2 },
  { id: 'clue_arena_judge', event: 'arena_judge', text: '競技場の審判台の裏に、小さな鍵穴がある。', value: 1, tags: ['facility'] },
  { id: 'clue_hall_emblem', event: 'hall_emblem', text: '中央ホールの紋章は、中心の石だけ色が違う。下に何かあるのかもしれない。', value: 1, tags: ['facility'] },
  { id: 'clue_piano', event: 'piano', text: 'ラウンジの飾り棚に、十二音だけで書かれた奇妙な楽譜が挟まっている。', value: 1, tags: ['facility'] },
  { id: 'clue_archive_records', event: 'archive_records', text: '旧書庫には、脱落した参加者の私物や手記が収められる棚がある。', value: 2, tags: ['story', 'records'] },
  { id: 'clue_game_box', event: 'game_box', text: '遊戯室の棚に、王冠の刻印がある空箱が一つだけある。', value: 1, tags: ['facility'] },
  { id: 'clue_nameplates', event: 'nameplates', text: '個室の名札の裏には、参加者ごとの番号が刻まれている。', value: 1, tags: ['facility', 'h07'] },
];

export const CLUE_BY_EVENT: Record<string, ClueDef> = Object.fromEntries(CLUES.map((c) => [c.event, c]));
