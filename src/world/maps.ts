/**
 * 施設マップ定義（タイル 64px 基準、旧manifestのピクセル÷16 をタイル数とする）。
 * 衝突・入口・家具・調査地点は画像から独立したデータ。正式素材が届いたら座標を合わせて修正する。
 *
 * 壁の扱い: 上壁は 0〜1 行（見下ろしの壁面）、左右壁は 0 列と w-1 列、下壁は h-1 行。
 * 歩行可能な床は x=1..w-2, y=2..h-2。
 */
import { PROPS } from './props';

export type Theme = 'living' | 'common' | 'arena' | 'prison' | 'secret' | 'garden';
export type Side = 'top' | 'bottom' | 'left' | 'right';
export type Area = 'living' | 'common' | 'ground' | 'prison' | 'secret';

export interface DoorDef {
  id: string;
  side: Side;
  /** 上下の扉は x（左端）、左右の扉は y（上端） */
  at: number;
  /** 幅（タイル） */
  size: number;
  to: string;
  toDoor: string;
  kind: 'door' | 'double' | 'stairs_up' | 'stairs_down' | 'iron' | 'hidden' | 'black' | 'open';
  label: string;
  /** 通行条件のフラグ名（hidden の解錠など） */
  lock?: string;
}

export interface PlacedProp {
  type: string;
  x: number;
  y: number;
  id?: string;
  /** 表示条件 */
  showIf?: string;
  hideIf?: string;
}

export interface InspectDef {
  id: string;
  x: number;
  y: number;
  /** 調べた時の説明 */
  text: string;
  /** 探索イベントID（story/explore.ts） */
  event?: string;
}

export interface RoomDef {
  id: string;
  name: string;
  floor: '3F' | '2F' | '1F' | 'B1' | 'B2';
  area: Area;
  theme: Theme;
  w: number;
  h: number;
  /** 正式背景画像（manifest のパス） */
  image: string;
  /** 解錠差分オーバーレイ */
  overlay?: { image: string; flag: string };
  doors: DoorDef[];
  props: PlacedProp[];
  inspects: InspectDef[];
  /** 環境光（0..1、小さいほど暗い） */
  ambient: number;
  /** NPC がたむろする地点 */
  spots: { x: number; y: number }[];
  /** 床の模様 */
  floorStyle?: 'marble' | 'wood' | 'stone' | 'carpet' | 'concrete' | 'grass' | 'tile';
}

const D = (id: string, side: Side, at: number, to: string, toDoor: string, kind: DoorDef['kind'], label: string, size = 2, lock?: string): DoorDef => ({
  id, side, at, size, to, toDoor, kind, label, lock,
});

export const BEDROOM_OWNERS = [
  'hero', 'npc_02_kanzaki', 'npc_03_kurose', 'npc_04_mido', 'npc_05_shiraishi', 'npc_06_kiryu',
  'npc_07_tachibana', 'npc_08_dojima', 'npc_09_asahina', 'npc_10_kujo', 'npc_11_kisaragi', 'npc_12_kuze',
] as const;

/** 生活棟廊下の個室扉の x 座標 */
const BEDROOM_DOOR_X = (i: number) => 2 + i * 2 + (i >= 6 ? 4 : 0);

function bedroom(owner: string, i: number): RoomDef {
  return {
    id: `bedroom_${owner}`,
    name: owner === 'hero' ? '自分の個室' : '個室',
    floor: '3F', area: 'living', theme: 'living', w: 20, h: 14, image: 'maps/3f/living_bedroom',
    doors: [D('out', 'bottom', 9, 'living_hallway', `room${i}`, 'door', '廊下')],
    props: [
      { type: 'bed_luxury', x: 2, y: 3 }, { type: 'desk', x: 14, y: 3 }, { type: 'chair', x: 15, y: 4 },
      { type: 'window', x: 8, y: 0 }, { type: 'wardrobe', x: 5, y: 2 }, { type: 'wall_lamp', x: 4, y: 0 },
      { type: 'wall_lamp', x: 15, y: 0 }, { type: 'small_table', x: 2, y: 9 }, { type: 'plant', x: 17, y: 10 },
      { type: 'painting', x: 12, y: 0 },
    ],
    inspects: [
      { id: `bed_${owner}`, x: 3, y: 6, text: '上質な寝台。シーツは糊が利いていて、誰かが毎日整えているらしい。', event: owner === 'hero' ? 'rest_bed' : undefined },
      { id: `desk_${owner}`, x: 15, y: 5, text: '机の引き出しには、施設の簡易な見取り図が入っていた。', event: owner === 'hero' ? 'desk_map' : undefined },
    ],
    ambient: 0.82, spots: [{ x: 10, y: 8 }, { x: 6, y: 7 }], floorStyle: 'carpet',
  };
}

const ROOMS_LIST: RoomDef[] = [
  // ---------------- 3F 生活棟 ----------------
  {
    id: 'living_hallway', name: '生活棟 廊下', floor: '3F', area: 'living', theme: 'living', w: 34, h: 12, image: 'maps/3f/living_hallway',
    doors: [
      ...BEDROOM_OWNERS.map((o, i) => D(`room${i}`, 'top', BEDROOM_DOOR_X(i), `bedroom_${o}`, 'out', 'door', o === 'hero' ? '自分の個室' : '個室', 1)),
      D('to_library', 'left', 5, 'library', 'to_hall', 'door', '図書室'),
      D('to_lounge', 'right', 5, 'living_lounge', 'to_hall', 'door', '生活棟ラウンジ'),
      D('to_game', 'bottom', 6, 'game_room', 'to_hall', 'door', '遊戯室'),
      D('to_obs', 'bottom', 25, 'observatory', 'to_hall', 'door', '展望室'),
      D('stairs', 'bottom', 15, 'common_hall', 'stairs_up', 'stairs_down', '2F 共用棟', 3),
    ],
    props: [
      { type: 'wall_lamp', x: 15, y: 0 }, { type: 'wall_lamp', x: 17, y: 0 }, { type: 'carpet', x: 3, y: 4 }, { type: 'carpet', x: 21, y: 4 },
      { type: 'plant', x: 1, y: 8 }, { type: 'plant', x: 32, y: 8 }, { type: 'painting', x: 15, y: 0 },
    ],
    inspects: [{ id: 'hall_plate', x: 16, y: 2, text: '各扉には参加者の名札。名札の裏に小さく番号が刻まれている。', event: 'nameplates' }],
    ambient: 0.78, spots: [{ x: 10, y: 6 }, { x: 22, y: 7 }, { x: 16, y: 5 }], floorStyle: 'wood',
  },
  {
    id: 'library', name: '図書室', floor: '3F', area: 'living', theme: 'living', w: 26, h: 18, image: 'maps/3f/library',
    overlay: { image: 'maps/3f/library_unlocked_overlay', flag: 'h01_open' },
    doors: [D('to_hall', 'right', 7, 'living_hallway', 'to_library', 'door', '廊下'), D('secret', 'top', 2, 'secret_study', 'from_library', 'hidden', '隠し書斎', 3, 'h01_open')],
    props: [
      { type: 'bookshelf', x: 2, y: 0, hideIf: 'h01_open' }, { type: 'bookshelf_secret', x: 2, y: 0, showIf: 'h01_open' },
      { type: 'bookshelf', x: 5, y: 0 }, { type: 'bookshelf', x: 8, y: 0 }, { type: 'bookshelf', x: 14, y: 0 },
      { type: 'bookshelf', x: 17, y: 0 }, { type: 'bookshelf', x: 20, y: 0 }, { type: 'window', x: 11, y: 0 },
      { type: 'bookshelf', x: 2, y: 9 }, { type: 'bookshelf', x: 5, y: 9 }, { type: 'bookshelf', x: 2, y: 13 },
      { type: 'desk', x: 13, y: 7 }, { type: 'chair', x: 14, y: 9 }, { type: 'desk', x: 18, y: 11 }, { type: 'chair', x: 19, y: 13 },
      { type: 'wall_lamp', x: 12, y: 0 }, { type: 'chandelier', x: 15, y: 5 },
    ],
    inspects: [
      { id: 'lib_shelf_order', x: 3, y: 3, text: '背表紙の番号が不揃いに並んでいる。誰かが意図的に順番を入れ替えたようだ。', event: 'h01_shelf' },
      { id: 'lib_diary', x: 14, y: 9, text: '机の上に古い日記。「王は六つの数を愛した」とだけ読める。', event: 'h01_diary' },
      { id: 'lib_rules', x: 19, y: 13, text: '過去の大会規則の写本。頭脳戦の歴史が綴られている。', event: 'lib_rulebook' },
    ],
    ambient: 0.68, spots: [{ x: 15, y: 12 }, { x: 10, y: 6 }], floorStyle: 'wood',
  },
  {
    id: 'game_room', name: '遊戯室', floor: '3F', area: 'living', theme: 'living', w: 24, h: 16, image: 'maps/3f/game_room',
    doors: [D('to_hall', 'top', 11, 'living_hallway', 'to_game', 'door', '廊下')],
    props: [
      { type: 'game_table', x: 4, y: 5 }, { type: 'game_table', x: 15, y: 5 }, { type: 'game_table', x: 9, y: 10 },
      { type: 'chair', x: 5, y: 9 }, { type: 'chair', x: 16, y: 9 }, { type: 'shelf', x: 1, y: 0 }, { type: 'shelf', x: 20, y: 0 },
      { type: 'wall_lamp', x: 8, y: 0 }, { type: 'wall_lamp', x: 15, y: 0 }, { type: 'chandelier', x: 10, y: 4 },
    ],
    inspects: [
      { id: 'game_sub', x: 6, y: 9, text: '盤と駒が揃った卓。誰かと対局できそうだ。', event: 'sub_games' },
      { id: 'game_shelf', x: 2, y: 3, text: '棚には各国のボードゲーム。一つだけ、王冠の刻印がある箱が空だった。', event: 'game_box' },
    ],
    ambient: 0.75, spots: [{ x: 8, y: 9 }, { x: 18, y: 10 }], floorStyle: 'wood',
  },
  {
    id: 'observatory', name: '展望室', floor: '3F', area: 'living', theme: 'living', w: 24, h: 16, image: 'maps/3f/observatory',
    overlay: { image: 'maps/3f/observatory_unlocked_overlay', flag: 'h02_open' },
    doors: [D('to_hall', 'top', 11, 'living_hallway', 'to_obs', 'door', '廊下'), D('secret', 'right', 10, 'moon_casino', 'from_obs', 'hidden', '月下の賭場', 2, 'h02_open')],
    props: [
      { type: 'big_window', x: 3, y: 0 }, { type: 'big_window', x: 15, y: 0 }, { type: 'telescope', x: 11, y: 4 },
      { type: 'grand_clock', x: 21, y: 7 }, { type: 'sofa', x: 4, y: 10 }, { type: 'sofa', x: 14, y: 10 }, { type: 'plant', x: 1, y: 12 },
    ],
    inspects: [
      { id: 'obs_clock', x: 21, y: 10, text: '大きな振り子時計。夜になると針の音が妙に大きく響く。', event: 'h02_clock' },
      { id: 'obs_scope', x: 11, y: 6, text: '望遠鏡の先は真っ暗な森。灯りはどこにも見えない。', event: 'obs_scope' },
    ],
    ambient: 0.58, spots: [{ x: 8, y: 8 }, { x: 16, y: 8 }], floorStyle: 'marble',
  },
  {
    id: 'living_lounge', name: '生活棟ラウンジ', floor: '3F', area: 'living', theme: 'living', w: 28, h: 18, image: 'maps/3f/living_lounge',
    doors: [D('to_hall', 'left', 7, 'living_hallway', 'to_lounge', 'door', '廊下')],
    props: [
      { type: 'sofa', x: 6, y: 5 }, { type: 'sofa', x: 6, y: 10 }, { type: 'small_table', x: 7, y: 7 }, { type: 'sofa', x: 18, y: 5 },
      { type: 'sofa', x: 18, y: 10 }, { type: 'small_table', x: 19, y: 7 }, { type: 'piano', x: 22, y: 2 }, { type: 'window', x: 12, y: 0 },
      { type: 'chandelier', x: 12, y: 6 }, { type: 'wall_lamp', x: 4, y: 0 }, { type: 'wall_lamp', x: 24, y: 0 }, { type: 'plant', x: 26, y: 14 },
    ],
    inspects: [{ id: 'lounge_piano', x: 23, y: 5, text: 'グランドピアノ。譜面台に十二音の奇妙な楽譜が置かれている。', event: 'piano' }],
    ambient: 0.8, spots: [{ x: 10, y: 8 }, { x: 16, y: 9 }, { x: 13, y: 13 }], floorStyle: 'carpet',
  },
  // ---------------- 2F 共用棟 ----------------
  {
    id: 'common_hall', name: '2F 共用廊下', floor: '2F', area: 'common', theme: 'common', w: 28, h: 12, image: 'maps/2f/common_hall',
    doors: [
      D('stairs_up', 'top', 3, 'living_hallway', 'stairs', 'stairs_up', '3F 生活棟', 3),
      D('to_dining', 'top', 10, 'dining', 'to_hall', 'double', '食堂'),
      D('to_garden', 'top', 17, 'garden', 'to_hall', 'double', '庭園'),
      D('stairs_down', 'top', 23, 'main_hall', 'stairs_up', 'stairs_down', '1F 中央ホール', 3),
      D('to_lounge', 'bottom', 8, 'common_lounge', 'to_hall', 'door', '共用ラウンジ'),
      D('to_bath', 'bottom', 19, 'bathroom', 'to_hall', 'door', '浴室'),
    ],
    props: [{ type: 'wall_lamp', x: 7, y: 0 }, { type: 'wall_lamp', x: 14, y: 0 }, { type: 'wall_lamp', x: 21, y: 0 }, { type: 'plant', x: 1, y: 8 }, { type: 'plant', x: 26, y: 8 }, { type: 'painting', x: 13, y: 0 }],
    inspects: [{ id: 'common_map', x: 14, y: 2, text: '館内案内図。地下へ続く階段の表記だけが塗り潰されている。', event: 'floor_guide' }],
    ambient: 0.72, spots: [{ x: 14, y: 6 }], floorStyle: 'stone',
  },
  {
    id: 'dining', name: '食堂', floor: '2F', area: 'common', theme: 'common', w: 30, h: 20, image: 'maps/2f/dining',
    doors: [D('to_hall', 'bottom', 14, 'common_hall', 'to_dining', 'double', '廊下')],
    props: [
      { type: 'dining_table', x: 4, y: 5 }, { type: 'dining_table', x: 13, y: 5 }, { type: 'dining_table', x: 22, y: 5 },
      { type: 'dining_table', x: 4, y: 12 }, { type: 'dining_table', x: 13, y: 12 }, { type: 'dining_table', x: 22, y: 12 },
      { type: 'buffet', x: 12, y: 2 }, { type: 'chandelier', x: 7, y: 4 }, { type: 'chandelier', x: 20, y: 4 }, { type: 'window', x: 3, y: 0 }, { type: 'window', x: 24, y: 0 },
    ],
    inspects: [{ id: 'dining_buffet', x: 14, y: 4, text: '配膳台には温かい料理が並ぶ。人数分きっちり、一皿も余らない。', event: 'dining_meal' }],
    ambient: 0.85, spots: [{ x: 9, y: 9 }, { x: 18, y: 9 }, { x: 9, y: 16 }, { x: 20, y: 16 }], floorStyle: 'wood',
  },
  {
    id: 'garden', name: '屋内庭園', floor: '2F', area: 'common', theme: 'garden', w: 28, h: 20, image: 'maps/2f/garden',
    doors: [D('to_hall', 'bottom', 13, 'common_hall', 'to_garden', 'double', '廊下')],
    props: [
      { type: 'fountain', x: 12, y: 7 }, { type: 'tree', x: 3, y: 2 }, { type: 'tree', x: 22, y: 2 }, { type: 'tree', x: 3, y: 12 }, { type: 'tree', x: 22, y: 12 },
      { type: 'hedge', x: 8, y: 4 }, { type: 'hedge', x: 18, y: 4 }, { type: 'hedge', x: 8, y: 13 }, { type: 'hedge', x: 18, y: 13 },
      { type: 'bench', x: 12, y: 14 }, { type: 'big_window', x: 11, y: 0 },
    ],
    inspects: [{ id: 'garden_fountain', x: 14, y: 11, text: '水盤の底に硬貨が一枚沈んでいる。表には王冠、裏には「零」の刻印。', event: 'garden_coin' }],
    ambient: 0.88, spots: [{ x: 7, y: 10 }, { x: 20, y: 10 }, { x: 13, y: 16 }], floorStyle: 'grass',
  },
  {
    id: 'common_lounge', name: '共用ラウンジ', floor: '2F', area: 'common', theme: 'common', w: 28, h: 18, image: 'maps/2f/common_lounge',
    doors: [D('to_hall', 'top', 13, 'common_hall', 'to_lounge', 'door', '廊下')],
    props: [
      { type: 'sofa', x: 3, y: 4 }, { type: 'small_table', x: 4, y: 6 }, { type: 'sofa', x: 3, y: 8 }, { type: 'sofa', x: 22, y: 4 }, { type: 'small_table', x: 23, y: 6 },
      { type: 'sofa', x: 22, y: 8 }, { type: 'sofa', x: 12, y: 12 }, { type: 'small_table', x: 13, y: 14 }, { type: 'wall_lamp', x: 6, y: 0 },
      { type: 'wall_lamp', x: 21, y: 0 }, { type: 'plant', x: 1, y: 15 }, { type: 'plant', x: 26, y: 15 }, { type: 'painting', x: 10, y: 0 },
    ],
    inspects: [{ id: 'lounge_corner', x: 24, y: 11, text: '奥の席は柱の陰になっていて、密談にちょうどよい。', event: 'lounge_corner' }],
    ambient: 0.66, spots: [{ x: 7, y: 6 }, { x: 20, y: 6 }, { x: 15, y: 10 }], floorStyle: 'carpet',
  },
  {
    id: 'bathroom', name: '浴室', floor: '2F', area: 'common', theme: 'common', w: 22, h: 16, image: 'maps/2f/bathroom',
    overlay: { image: 'maps/2f/bathroom_unlocked_overlay', flag: 'h03_open' },
    doors: [D('to_hall', 'top', 3, 'common_hall', 'to_bath', 'door', '廊下'), D('secret', 'top', 14, 'mirror_room', 'from_bath', 'hidden', '鏡の間', 2, 'h03_open')],
    props: [
      { type: 'mirror', x: 14, y: 0, hideIf: 'h03_open' }, { type: 'mirror_open', x: 14, y: 0, showIf: 'h03_open' }, { type: 'mirror', x: 10, y: 0 },
      { type: 'sink', x: 10, y: 2 }, { type: 'sink', x: 14, y: 2, hideIf: 'h03_open' }, { type: 'bathtub', x: 3, y: 9 }, { type: 'bathtub', x: 15, y: 9 }, { type: 'cold_lamp', x: 7, y: 0 },
    ],
    inspects: [{ id: 'bath_mirror', x: 15, y: 3, text: '曇った鏡に、指でなぞったような記号が浮かんでいる。', event: 'h03_mirror' }],
    ambient: 0.7, spots: [{ x: 11, y: 7 }], floorStyle: 'tile',
  },
  // ---------------- 1F ----------------
  {
    id: 'main_hall', name: '中央ホール', floor: '1F', area: 'ground', theme: 'arena', w: 32, h: 22, image: 'maps/1f/main_hall',
    doors: [
      D('stairs_up', 'top', 3, 'common_hall', 'stairs_down', 'stairs_up', '2F 共用棟', 3),
      D('to_arena', 'top', 14, 'main_arena', 'to_hall', 'double', '大会競技場', 4),
      D('to_entrance', 'bottom', 15, 'entrance', 'to_hall', 'double', '玄関'),
      D('to_shop', 'left', 10, 'shop', 'to_hall', 'door', '交換所'),
      D('to_infirmary', 'right', 10, 'infirmary', 'to_hall', 'door', '医務室'),
      D('to_b1', 'top', 26, 'prison_hallway', 'stairs_up', 'iron', '地下 監獄棟', 3),
    ],
    props: [
      { type: 'emblem_floor', x: 13, y: 9 }, { type: 'noticeboard', x: 8, y: 0 }, { type: 'chandelier', x: 9, y: 6 }, { type: 'chandelier', x: 20, y: 6 },
      { type: 'wall_lamp', x: 12, y: 0 }, { type: 'wall_lamp', x: 19, y: 0 }, { type: 'plant', x: 1, y: 3 }, { type: 'plant', x: 30, y: 3 },
      { type: 'plant', x: 1, y: 18 }, { type: 'plant', x: 30, y: 18 }, { type: 'bench', x: 5, y: 15 }, { type: 'bench', x: 24, y: 15 },
    ],
    inspects: [
      { id: 'hall_board', x: 9, y: 2, text: '大会の掲示板。', event: 'board' },
      { id: 'hall_emblem', x: 16, y: 13, text: '床に描かれた王冠の紋章。中心だけ、石の色がわずかに違う。', event: 'hall_emblem' },
    ],
    ambient: 0.8, spots: [{ x: 10, y: 12 }, { x: 22, y: 12 }, { x: 16, y: 17 }, { x: 8, y: 5 }], floorStyle: 'marble',
  },
  {
    id: 'main_arena', name: '大会競技場', floor: '1F', area: 'ground', theme: 'arena', w: 32, h: 22, image: 'maps/1f/main_arena',
    doors: [D('to_hall', 'bottom', 14, 'main_hall', 'to_arena', 'double', '中央ホール', 4)],
    props: [
      { type: 'judge_stand', x: 14, y: 2 }, { type: 'arena_table', x: 12, y: 8 }, { type: 'chandelier', x: 15, y: 7 },
      ...[4, 7, 10, 20, 23, 26].map((x) => ({ type: 'chair', x, y: 6 })), ...[4, 7, 10, 20, 23, 26].map((x) => ({ type: 'chair', x, y: 15 })),
      { type: 'wall_lamp', x: 6, y: 0 }, { type: 'wall_lamp', x: 25, y: 0 },
    ],
    inspects: [{ id: 'arena_judge', x: 16, y: 5, text: '審判台。仮面の主催者がいつもここに立つ。台の裏に小さな鍵穴がある。', event: 'arena_judge' }],
    ambient: 0.62, spots: [{ x: 8, y: 11 }, { x: 24, y: 11 }], floorStyle: 'marble',
  },
  {
    id: 'shop', name: '交換所', floor: '1F', area: 'ground', theme: 'arena', w: 20, h: 14, image: 'maps/1f/shop',
    doors: [D('to_hall', 'right', 6, 'main_hall', 'to_shop', 'door', '中央ホール')],
    props: [{ type: 'counter', x: 8, y: 3 }, { type: 'shelf', x: 1, y: 0 }, { type: 'shelf', x: 15, y: 0 }, { type: 'wall_lamp', x: 7, y: 0 }, { type: 'wall_lamp', x: 12, y: 0 }],
    inspects: [{ id: 'shop_counter', x: 10, y: 5, text: '交換所のカウンター。ピースと引き換えに品物を受け取れる。', event: 'shop' }],
    ambient: 0.82, spots: [{ x: 6, y: 9 }], floorStyle: 'marble',
  },
  {
    id: 'infirmary', name: '医務室', floor: '1F', area: 'ground', theme: 'common', w: 20, h: 14, image: 'maps/1f/infirmary',
    doors: [D('to_hall', 'left', 6, 'main_hall', 'to_infirmary', 'door', '中央ホール')],
    props: [{ type: 'medical_bed', x: 3, y: 3 }, { type: 'medical_bed', x: 7, y: 3 }, { type: 'shelf', x: 15, y: 0 }, { type: 'desk', x: 13, y: 8 }, { type: 'cold_lamp', x: 10, y: 0 }],
    inspects: [{ id: 'inf_records', x: 16, y: 3, text: '薬品棚の奥に古いカルテの束。日付は十年前で止まっている。', event: 'inf_records' }],
    ambient: 0.9, spots: [{ x: 10, y: 9 }], floorStyle: 'tile',
  },
  {
    id: 'entrance', name: '玄関', floor: '1F', area: 'ground', theme: 'arena', w: 24, h: 16, image: 'maps/1f/entrance',
    doors: [D('to_hall', 'top', 11, 'main_hall', 'to_entrance', 'double', '中央ホール')],
    props: [{ type: 'sealed_door', x: 10, y: 11 }, { type: 'plant', x: 2, y: 3 }, { type: 'plant', x: 21, y: 3 }, { type: 'wall_lamp', x: 6, y: 0 }, { type: 'wall_lamp', x: 17, y: 0 }, { type: 'bench', x: 3, y: 8 }],
    inspects: [{ id: 'entrance_door', x: 12, y: 13, text: '外へ続く扉は鋼鉄の閂で封鎖されている。電子錠の表示は「11」。', event: 'entrance_lock' }],
    ambient: 0.6, spots: [{ x: 12, y: 7 }], floorStyle: 'marble',
  },
  // ---------------- B1 監獄棟 ----------------
  {
    id: 'prison_hallway', name: '監獄棟 通路', floor: 'B1', area: 'prison', theme: 'prison', w: 28, h: 12, image: 'maps/b1/prison_hallway',
    doors: [
      D('stairs_up', 'top', 3, 'main_hall', 'to_b1', 'stairs_up', '1F 中央ホール', 3),
      D('to_cells', 'top', 11, 'prison_cells', 'to_hall', 'iron', '共同牢'),
      D('to_arena', 'top', 19, 'prison_arena', 'to_hall', 'iron', '監獄マッチ会場'),
      D('to_archive', 'left', 5, 'old_archive', 'to_hall', 'door', '旧書庫'),
      D('to_passage', 'right', 5, 'underground_passage', 'to_hall', 'iron', '地下通路', 2, 'passage_open'),
    ],
    props: [{ type: 'cold_lamp', x: 8, y: 0 }, { type: 'cold_lamp', x: 16, y: 0 }, { type: 'cold_lamp', x: 24, y: 0 }, { type: 'crate', x: 24, y: 8 }],
    inspects: [{ id: 'b1_pipe', x: 14, y: 2, text: '壁の配管から、規則的な金属音。誰かが向こう側で叩いている…？', event: 'b1_noise' }],
    ambient: 0.48, spots: [{ x: 12, y: 6 }], floorStyle: 'stone',
  },
  {
    id: 'prison_cells', name: '共同牢', floor: 'B1', area: 'prison', theme: 'prison', w: 28, h: 18, image: 'maps/b1/prison_cells',
    overlay: { image: 'maps/b1/prison_cells_unlocked_overlay', flag: 'h04_open' },
    doors: [D('to_hall', 'bottom', 13, 'prison_hallway', 'to_cells', 'iron', '通路'), D('secret', 'left', 4, 'cell_zero', 'from_cells', 'hidden', '第零牢', 2, 'h04_open')],
    props: [
      { type: 'bed_prison', x: 3, y: 2 }, { type: 'bed_prison', x: 8, y: 2 }, { type: 'bed_prison', x: 18, y: 2 }, { type: 'bed_prison', x: 23, y: 2 },
      { type: 'prison_bars', x: 2, y: 6 }, { type: 'prison_bars', x: 7, y: 6 }, { type: 'prison_bars', x: 18, y: 6 }, { type: 'prison_bars', x: 23, y: 6 },
      { type: 'cold_lamp', x: 13, y: 0 }, { type: 'bench', x: 12, y: 13 },
    ],
    inspects: [{ id: 'cells_wall', x: 1, y: 5, text: '石壁に刻まれた数字の列。爪で刻んだように浅い。', event: 'h04_wall' }],
    ambient: 0.42, spots: [{ x: 13, y: 11 }, { x: 6, y: 12 }], floorStyle: 'stone',
  },
  {
    id: 'prison_arena', name: '監獄マッチ会場', floor: 'B1', area: 'prison', theme: 'prison', w: 24, h: 18, image: 'maps/b1/prison_arena',
    doors: [D('to_hall', 'bottom', 11, 'prison_hallway', 'to_arena', 'iron', '通路')],
    props: [{ type: 'judge_stand', x: 10, y: 2 }, { type: 'game_table', x: 10, y: 8 }, { type: 'chair', x: 8, y: 9 }, { type: 'chair', x: 15, y: 9 }, { type: 'cold_lamp', x: 5, y: 0 }, { type: 'cold_lamp', x: 18, y: 0 }],
    inspects: [{ id: 'parena_table', x: 12, y: 12, text: '傷だらけの競技卓。ここで何人が去っていったのだろう。', event: 'prison_table' }],
    ambient: 0.45, spots: [{ x: 6, y: 12 }, { x: 18, y: 12 }], floorStyle: 'stone',
  },
  {
    id: 'old_archive', name: '旧書庫', floor: 'B1', area: 'prison', theme: 'prison', w: 22, h: 16, image: 'maps/b1/old_archive',
    doors: [D('to_hall', 'right', 6, 'prison_hallway', 'to_archive', 'door', '通路')],
    props: [{ type: 'shelf', x: 2, y: 0 }, { type: 'shelf', x: 6, y: 0 }, { type: 'shelf', x: 12, y: 0 }, { type: 'shelf', x: 16, y: 0 }, { type: 'desk', x: 8, y: 8 }, { type: 'crate', x: 3, y: 11 }, { type: 'cold_lamp', x: 10, y: 0 }],
    inspects: [
      { id: 'archive_letters', x: 9, y: 10, text: '机に古い手紙が五通。宛名はすべて「次の参加者へ」。', event: 'h04_letters' },
      { id: 'archive_records', x: 3, y: 3, text: '棚には参加者の記録。脱落した人の私物や手記もここに収められるらしい。', event: 'archive_records' },
    ],
    ambient: 0.4, spots: [{ x: 12, y: 10 }], floorStyle: 'stone',
  },
  {
    id: 'underground_passage', name: '地下通路', floor: 'B1', area: 'prison', theme: 'prison', w: 30, h: 16, image: 'maps/b1/underground_passage',
    doors: [D('to_hall', 'left', 6, 'prison_hallway', 'to_passage', 'iron', '通路'), D('to_maze', 'right', 6, 'maze_entry', 'from_passage', 'iron', '地下迷宮', 2, 'h05_cleared')],
    props: [{ type: 'crate', x: 6, y: 3 }, { type: 'crate', x: 20, y: 11 }, { type: 'cold_lamp', x: 12, y: 0 }, { type: 'cold_lamp', x: 22, y: 0 }],
    inspects: [{ id: 'passage_mech', x: 27, y: 7, text: '古い仕掛け扉。数字盤とスライド式の板、記号の歯車が組み込まれている。', event: 'h05_mech' }],
    ambient: 0.34, spots: [{ x: 14, y: 8 }], floorStyle: 'stone',
  },
  // ---------------- B2 秘密区画 ----------------
  {
    id: 'secret_study', name: '秘密の書斎', floor: 'B2', area: 'secret', theme: 'secret', w: 20, h: 14, image: 'maps/b2/secret_study',
    doors: [D('from_library', 'bottom', 9, 'library', 'secret', 'hidden', '図書室', 2)],
    props: [{ type: 'safe', x: 9, y: 2 }, { type: 'desk', x: 3, y: 5 }, { type: 'bookshelf', x: 15, y: 0 }, { type: 'wall_lamp', x: 6, y: 0 }],
    inspects: [{ id: 'study_safe', x: 10, y: 4, text: '六桁のダイヤル式金庫。', event: 'h01_safe' }],
    ambient: 0.5, spots: [{ x: 9, y: 8 }], floorStyle: 'wood',
  },
  {
    id: 'moon_casino', name: '月下の賭場', floor: 'B2', area: 'secret', theme: 'secret', w: 24, h: 16, image: 'maps/b2/moon_casino',
    doors: [D('from_obs', 'left', 7, 'observatory', 'secret', 'hidden', '展望室')],
    props: [{ type: 'game_table', x: 10, y: 5 }, { type: 'chandelier', x: 11, y: 3 }, { type: 'big_window', x: 9, y: 0 }],
    inspects: [{ id: 'casino_table', x: 12, y: 9, text: '黒金の卓。仮面のディーラーが無言で札を揃えている。', event: 'h02_table' }],
    ambient: 0.4, spots: [{ x: 6, y: 10 }], floorStyle: 'carpet',
  },
  {
    id: 'mirror_room', name: '鏡の間', floor: 'B2', area: 'secret', theme: 'secret', w: 24, h: 18, image: 'maps/b2/mirror_room',
    doors: [D('from_bath', 'bottom', 11, 'bathroom', 'secret', 'hidden', '浴室')],
    props: [{ type: 'mirror', x: 4, y: 0 }, { type: 'mirror', x: 11, y: 0 }, { type: 'mirror', x: 18, y: 0 }, { type: 'cold_lamp', x: 8, y: 0 }, { type: 'cold_lamp', x: 15, y: 0 }],
    inspects: [{ id: 'mirror_center', x: 12, y: 8, text: '床に七×七の格子。鏡に映る自分が、逆の方向へ歩き出しそうだ。', event: 'h03_maze' }],
    ambient: 0.55, spots: [{ x: 12, y: 12 }], floorStyle: 'marble',
  },
  {
    id: 'cell_zero', name: '第零牢', floor: 'B2', area: 'secret', theme: 'prison', w: 18, h: 14, image: 'maps/b2/cell_zero',
    doors: [D('from_cells', 'right', 5, 'prison_cells', 'secret', 'hidden', '共同牢')],
    props: [{ type: 'bed_prison', x: 3, y: 2 }, { type: 'desk', x: 10, y: 3 }, { type: 'cold_lamp', x: 8, y: 0 }],
    inspects: [{ id: 'zero_letters', x: 11, y: 6, text: '囚人の遺言と書かれた封筒の束。', event: 'h04_game' }],
    ambient: 0.32, spots: [{ x: 8, y: 9 }], floorStyle: 'stone',
  },
  {
    id: 'maze_entry', name: '地下迷宮の入口', floor: 'B2', area: 'secret', theme: 'secret', w: 24, h: 18, image: 'maps/b2/maze_entry',
    doors: [D('from_passage', 'left', 7, 'underground_passage', 'to_maze', 'iron', '地下通路'), D('to_black', 'top', 11, 'black_door', 'from_maze', 'iron', '黒い扉の部屋')],
    props: [{ type: 'cold_lamp', x: 6, y: 0 }, { type: 'cold_lamp', x: 17, y: 0 }, { type: 'crate', x: 18, y: 12 }],
    inspects: [{ id: 'maze_note', x: 6, y: 12, text: '壁に古い落書き。「影は七枚の札しか持たない」', event: 'maze_note' }],
    ambient: 0.36, spots: [{ x: 12, y: 10 }], floorStyle: 'concrete',
  },
  {
    id: 'black_door', name: '黒い扉の部屋', floor: 'B2', area: 'secret', theme: 'secret', w: 20, h: 14, image: 'maps/b2/black_door',
    overlay: { image: 'maps/b2/black_door_unlocked_overlay', flag: 'h06_open' },
    doors: [D('from_maze', 'bottom', 9, 'maze_entry', 'to_black', 'iron', '迷宮入口'), D('to_lab', 'top', 9, 'research_lab', 'from_black', 'black', '黒い扉', 2, 'h06_open')],
    props: [{ type: 'cold_lamp', x: 5, y: 0 }, { type: 'cold_lamp', x: 14, y: 0 }],
    inspects: [{ id: 'black_keyhole', x: 10, y: 3, text: '黒い扉。六角形の鍵穴の横に、仮面の対戦者が立っている。', event: 'h06_door' }],
    ambient: 0.3, spots: [{ x: 10, y: 9 }], floorStyle: 'concrete',
  },
  {
    id: 'research_lab', name: '研究室', floor: 'B2', area: 'secret', theme: 'secret', w: 30, h: 20, image: 'maps/b2/research_lab',
    doors: [
      D('from_black', 'bottom', 14, 'black_door', 'to_lab', 'black', '黒い扉'),
      D('to_surv', 'left', 8, 'surveillance', 'from_lab', 'door', '監視室'),
      D('to_vault', 'right', 8, 'records_vault', 'from_lab', 'door', '記録保管庫'),
      D('to_iso', 'top', 6, 'isolation', 'from_lab', 'iron', '隔離区域'),
      D('to_core', 'top', 21, 'core', 'from_lab', 'black', '最深部', 2, 'h07_cleared'),
    ],
    props: [{ type: 'lab_equipment', x: 4, y: 4 }, { type: 'lab_equipment', x: 22, y: 4 }, { type: 'desk', x: 12, y: 8 }, { type: 'control_console', x: 13, y: 13 }, { type: 'cold_lamp', x: 14, y: 0 }],
    inspects: [{ id: 'lab_desk', x: 13, y: 10, text: '研究机。「十二の証明」と題された分厚い資料。', event: 'h07_proofs' }],
    ambient: 0.4, spots: [{ x: 9, y: 14 }], floorStyle: 'concrete',
  },
  {
    id: 'surveillance', name: '監視室', floor: 'B2', area: 'secret', theme: 'secret', w: 22, h: 16, image: 'maps/b2/surveillance',
    doors: [D('from_lab', 'right', 6, 'research_lab', 'to_surv', 'door', '研究室')],
    props: [{ type: 'monitor', x: 3, y: 0 }, { type: 'monitor', x: 6, y: 0 }, { type: 'monitor', x: 9, y: 0 }, { type: 'monitor', x: 12, y: 0 }, { type: 'control_console', x: 6, y: 4 }],
    inspects: [{ id: 'surv_console', x: 8, y: 8, text: 'モニターには施設中の映像。参加者全員の行動が記録されている。', event: 'surv_console' }],
    ambient: 0.3, spots: [{ x: 14, y: 10 }], floorStyle: 'concrete',
  },
  {
    id: 'records_vault', name: '記録保管庫', floor: 'B2', area: 'secret', theme: 'secret', w: 22, h: 16, image: 'maps/b2/records_vault',
    doors: [D('from_lab', 'left', 6, 'research_lab', 'to_vault', 'door', '研究室')],
    props: [{ type: 'shelf', x: 4, y: 0 }, { type: 'shelf', x: 8, y: 0 }, { type: 'shelf', x: 12, y: 0 }, { type: 'shelf', x: 16, y: 0 }, { type: 'safe', x: 10, y: 9 }],
    inspects: [{ id: 'vault_docs', x: 11, y: 12, text: '機密文書の棚。CROWN計画の全記録がここにある。', event: 'vault_docs' }],
    ambient: 0.35, spots: [{ x: 6, y: 10 }], floorStyle: 'concrete',
  },
  {
    id: 'isolation', name: '隔離区域', floor: 'B2', area: 'secret', theme: 'secret', w: 28, h: 18, image: 'maps/b2/isolation',
    doors: [D('from_lab', 'bottom', 13, 'research_lab', 'to_iso', 'iron', '研究室')],
    props: [{ type: 'medical_bed', x: 3, y: 3 }, { type: 'medical_bed', x: 8, y: 3 }, { type: 'medical_bed', x: 18, y: 3 }, { type: 'medical_bed', x: 23, y: 3 }, { type: 'cold_lamp', x: 13, y: 0 }],
    inspects: [{ id: 'iso_beds', x: 13, y: 9, text: '眠る人々。脱落した参加者たちが、ここで生かされている。', event: 'iso_found' }],
    ambient: 0.45, spots: [{ x: 13, y: 12 }], floorStyle: 'tile',
  },
  {
    id: 'core', name: '最深部', floor: 'B2', area: 'secret', theme: 'secret', w: 28, h: 20, image: 'maps/b2/core',
    doors: [D('from_lab', 'bottom', 13, 'research_lab', 'to_core', 'black', '研究室')],
    props: [{ type: 'control_console', x: 12, y: 5 }, { type: 'emblem_floor', x: 11, y: 10 }, { type: 'lab_equipment', x: 3, y: 3 }, { type: 'lab_equipment', x: 22, y: 3 }],
    inspects: [{ id: 'core_terminal', x: 14, y: 8, text: '観測端末。画面に「神の方程式」と表示されている。', event: 'h08_terminal' }],
    ambient: 0.38, spots: [{ x: 14, y: 14 }], floorStyle: 'concrete',
  },
  ...BEDROOM_OWNERS.map((o, i) => bedroom(o, i)),
];

export const ROOMS: Record<string, RoomDef> = Object.fromEntries(ROOMS_LIST.map((r) => [r.id, r]));
export const ROOM_IDS = ROOMS_LIST.map((r) => r.id);

/** 部屋ごとの衝突グリッド（true = 通行不可）。フラグに依存する家具を考慮。 */
export function buildCollision(room: RoomDef, flags: Record<string, unknown>): boolean[][] {
  const g: boolean[][] = [];
  for (let y = 0; y < room.h; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < room.w; x++) {
      const wall = y <= 1 || y === room.h - 1 || x === 0 || x === room.w - 1;
      row.push(wall);
    }
    g.push(row);
  }
  for (const p of room.props) {
    if (!propVisible(p, flags)) continue;
    const def = PROPS[p.type];
    if (!def || def.wall || def.ceiling || !def.solid) continue;
    for (let y = p.y + def.solid.y; y < p.y + def.solid.y + def.solid.h; y++) {
      for (let x = p.x + def.solid.x; x < p.x + def.solid.x + def.solid.w; x++) {
        if (y >= 0 && y < room.h && x >= 0 && x < room.w) g[y][x] = true;
      }
    }
  }
  return g;
}

export function propVisible(p: PlacedProp, flags: Record<string, unknown>): boolean {
  if (p.showIf && !flags[p.showIf]) return false;
  if (p.hideIf && flags[p.hideIf]) return false;
  return true;
}

/** 扉の手前（部屋の内側の床）のタイル一覧 */
export function doorApproach(room: RoomDef, d: DoorDef): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < d.size; i++) {
    if (d.side === 'top') out.push({ x: d.at + i, y: 2 });
    if (d.side === 'bottom') out.push({ x: d.at + i, y: room.h - 2 });
    if (d.side === 'left') out.push({ x: 1, y: d.at + i });
    if (d.side === 'right') out.push({ x: room.w - 2, y: d.at + i });
  }
  return out;
}

/** 扉に入る方向 */
export function doorDir(d: DoorDef): 'up' | 'down' | 'left' | 'right' {
  return d.side === 'top' ? 'up' : d.side === 'bottom' ? 'down' : d.side === 'left' ? 'left' : 'right';
}

export function findDoor(room: RoomDef, id: string): DoorDef | undefined {
  return room.doors.find((d) => d.id === id);
}

/** タイル (x,y) から dir 方向へ進むと入る扉 */
export function doorAt(room: RoomDef, x: number, y: number, dir: string): DoorDef | undefined {
  return room.doors.find((d) => doorDir(d) === dir && doorApproach(room, d).some((t) => t.x === x && t.y === y));
}
