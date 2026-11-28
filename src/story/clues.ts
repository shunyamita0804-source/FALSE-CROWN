/**
 * 探索で得られる手掛かり。調査地点の event ID と対応する。
 * NPC も同じ地点を調べて同じ手掛かりを得る（プレイヤーは NPC から買う代替経路を持つ）。
 * 文面は「気づいた人だけが解ける謎かけ」として書き、不穏さや事件性は出さない。大会の裏側に触れる手掛かりは後半（fromDay）に回す。
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
  { id: 'clue_h01_shelf', event: 'h01_shelf', text: '図書室の奥の書棚は、背表紙の番号が不揃いだ。謎かけになっているのかもしれない。', value: 2, tags: ['h01', 'hidden', 'legacy'] },
  { id: 'clue_h01_diary', event: 'h01_diary', text: '図書室の詩集に「王は六つの数を愛した」とある。六桁の数字を指す謎かけらしい。', value: 2, tags: ['h01', 'hidden', 'legacy'] },
  { id: 'clue_h02_clock', event: 'h02_clock', text: '展望室の大時計は、夜になると文字盤の奥で仕掛けが動く。', value: 2, tags: ['h02', 'hidden', 'legacy'], nightOnly: true, fromDay: 2 },
  // 裏ゲーム 2 系統の手掛かり（story/backgames.ts）。NPC も同じ所を調べて知り、雑談や情報交換で話す
  { id: 'bg_live_c', event: 'h03_mirror', text: '浴室の鏡：曇ると左右逆の文字が浮かぶ。読み直すと「太陽は、いちばん最後に昇る」。', value: 1, tags: ['bg', 'bg_living'] },
  { id: 'bg_live_b', event: 'bg_live_b', text: 'リビングの楽譜：音符の代わりに印が並ぶ。余白に「月が鳴ったら、すぐ星が続く」。', value: 1, tags: ['bg', 'bg_living'] },
  { id: 'bg_live_lock', event: 'bg_live_lock', text: 'リビングの本棚：一段だけ、本の代わりに太陽・月・星・王冠の四つの金具が並んでいる。押す順番があるらしい。', value: 1, tags: ['bg', 'bg_living', 'bg_lock'] },
  { id: 'bg_prison_b', event: 'prison_table', text: '監獄マッチ会場の柵：支柱に小さな刻み傷。「● から始めて、▲ で終える」。', value: 1, tags: ['bg', 'bg_prison'] },
  { id: 'bg_prison_c', event: 'bg_prison_c', text: '共同牢の洗面の棚：鏡のふちに、引っかいたような印。「◆ は ■ より先に」。', value: 1, tags: ['bg', 'bg_prison'] },
  { id: 'bg_prison_lock', event: 'bg_prison_lock', text: '共同牢の奥の壁：鉄の銘板に四桁のダイヤル。「合図を知る者は、奥の卓へ」と彫られている。', value: 1, tags: ['bg', 'bg_prison', 'bg_lock'] },
  { id: 'bg_prison_a', event: 'h04_wall', text: '共同牢の石壁：四つの図形の横にローマ数字。「■ III　▲ I　● IV　◆ II」。', value: 1, tags: ['bg', 'bg_prison'] },
  { id: 'clue_h04_letters', event: 'h04_letters', text: '旧書庫に「次の参加者へ」と書かれた古い手紙の束がある。', value: 2, tags: ['h04', 'hidden', 'legacy'], fromDay: 5 },
  { id: 'clue_h05_mech', event: 'h05_mech', text: '地下通路の奥に、数字盤・スライド板・記号歯車の仕掛け扉がある。', value: 2, tags: ['h05', 'hidden', 'legacy'] },
  { id: 'clue_floor_guide', event: 'floor_guide', text: '館内案内図によると、交換所と医務室は 1 階、遊戯室と展望室は 3 階にある。', value: 1, tags: ['facility'] },
  { id: 'clue_entrance', event: 'entrance_lock', text: '玄関の表示板には、大会の残り日数が表示されている。', value: 1, tags: ['facility'] },
  { id: 'clue_garden_coin', event: 'garden_coin', text: '庭園の水盤に、裏に「零」と刻まれた硬貨が沈んでいる。', value: 1, tags: ['facility', 'h04', 'legacy'] },
  { id: 'clue_inf_records', event: 'inf_records', text: '医務室の棚の奥に、過去の大会の健康記録が保管されている。日付は十年前だ。', value: 2, tags: ['story', 'past', 'legacy'], fromDay: 7 },
  { id: 'clue_b1_noise', event: 'b1_noise', text: '監獄棟の配管は、案内図に載っていない下の階へ続いているようだ。', value: 2, tags: ['story', 'isolation', 'legacy'], fromDay: 6 },
  { id: 'clue_arena_judge', event: 'arena_judge', text: '競技場の審判台の裏に、小さな鍵穴がある。', value: 1, tags: ['facility', 'legacy'] },
  { id: 'clue_hall_emblem', event: 'hall_emblem', text: '中央ホールの紋章は、中心の石だけ色が違う。下に何かあるのかもしれない。', value: 1, tags: ['facility', 'legacy'] },
  { id: 'clue_piano', event: 'piano', text: 'ラウンジの飾り棚に、十二音だけで書かれた短い楽譜が挟まっている。', value: 1, tags: ['facility', 'legacy'] },
  { id: 'clue_archive_records', event: 'archive_records', text: '旧書庫には、過去の大会の対戦記録が保管されている。', value: 2, tags: ['story', 'records'] },
  { id: 'bg_live_a', event: 'game_box', text: '遊戯室の王冠の空箱：蓋の裏に「王冠は、いちばん前にも、いちばん後ろにも並ばない」。', value: 1, tags: ['bg', 'bg_living'] },
  // 裏ルートの資料への手掛かり（参加者も調べて知り、会話の「情報交換」や取引で手に入る。資料そのものは記録保管庫にある）
  { id: 'clue_rulebook_vault', event: 'lib_rulebook', text: '過去の大会規則の写本に「全記録は地下の保管庫へ移す」と書き込みがある。', value: 2, tags: ['story', 'vault', 'hidden', 'legacy'], fromDay: 5 },
  { id: 'clue_lounge_lift', event: 'lounge_corner', text: '共用ラウンジの奥の席で、職員が「保守用の昇降機は案内図の脇にある」と話していたらしい。', value: 2, tags: ['story', 'vault', 'hidden', 'legacy'], fromDay: 7 },
  { id: 'clue_nameplates', event: 'nameplates', text: '個室の名札の裏には、参加者ごとの番号が刻まれている。', value: 1, tags: ['facility', 'h07', 'legacy'] },
];

export const CLUE_BY_EVENT: Record<string, ClueDef> = Object.fromEntries(CLUES.map((c) => [c.event, c]));

/**
 * いまの構成で使う手掛かり。旧裏ルートだけの手掛かり（tags に legacy）は、旧裏ルートで遊ぶ時だけ。
 * 2 系統の手掛かり（tags に bg）は、旧裏ルートでは使わない（旧の入口の謎と混ざらないように）。
 */
export function activeClue(flags: Record<string, unknown>, event: string | undefined): ClueDef | undefined {
  const c = event ? CLUE_BY_EVENT[event] : undefined;
  if (!c) return undefined;
  const legacy = flags.hiddenLayout === 'legacy';
  if (c.tags.includes('legacy') && !legacy) return undefined;
  if (c.tags.includes('bg') && legacy) return undefined;
  return c;
}
