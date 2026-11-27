/**
 * 施設マップ定義（タイル 64px）。背景は正式素材の一枚絵（家具込み）で、
 * 歩行可能範囲・扉・調査地点は絵に合わせてここでデータとして持つ（画像には手を加えない）。
 *
 * - walk: 歩ける床の矩形 [x0, y0, x1, y1]（両端を含む）
 * - block: 床の上にある家具など、歩けない矩形
 * - doors: 出入口。tiles は扉の手前の床、dir はそこから進む向き
 * 接続関係は正式素材に描かれた出入口（下中央の出口、上中央の通路、階段、昇降機、廊下の両端）に合わせている。
 */
export type Theme = 'living' | 'common' | 'arena' | 'prison' | 'secret' | 'garden';
export type Side = 'top' | 'bottom' | 'left' | 'right';
export type DoorDir = 'up' | 'down' | 'left' | 'right';
export type Area = 'living' | 'common' | 'ground' | 'prison' | 'secret';
export type Rect = [number, number, number, number];

export interface DoorDef {
  id: string;
  dir: DoorDir;
  /** 扉の手前の床タイル */
  tiles: { x: number; y: number }[];
  side: Side;
  /** 仮素材描画用（上下の扉は x の左端、左右の扉は y の上端） */
  at: number;
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
  showIf?: string;
  hideIf?: string;
}

export interface InspectDef {
  id: string;
  /** 調べる時に立つ床タイル */
  x: number;
  y: number;
  text: string;
  /** 探索イベントID */
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
  /** 正式背景画像（拡張子なしのパス） */
  image: string;
  /** 解錠差分オーバーレイ */
  overlay?: { image: string; flag: string };
  walk: Rect[];
  block: Rect[];
  doors: DoorDef[];
  /** 仮素材描画用の家具（正式背景では使わない） */
  props: PlacedProp[];
  inspects: InspectDef[];
  /** 環境光（仮素材描画用） */
  ambient: number;
  /** NPC がたむろする地点 */
  spots: { x: number; y: number }[];
  floorStyle?: 'marble' | 'wood' | 'stone' | 'carpet' | 'concrete' | 'grass' | 'tile';
}

const SIDE: Record<DoorDir, Side> = { up: 'top', down: 'bottom', left: 'left', right: 'right' };

/** 扉。上下向きは (x..x+n-1, y)、左右向きは (x, y..y+n-1) が手前の床 */
function D(id: string, dir: DoorDir, x: number, y: number, n: number, to: string, toDoor: string, kind: DoorDef['kind'], label: string, lock?: string): DoorDef {
  const vertical = dir === 'up' || dir === 'down';
  const tiles = Array.from({ length: n }, (_, i) => (vertical ? { x: x + i, y } : { x, y: y + i }));
  return { id, dir, tiles, side: SIDE[dir], at: vertical ? x : y, size: n, to, toDoor, kind, label, lock };
}

const S = (pts: number[][]) => pts.map(([x, y]) => ({ x, y }));

export const BEDROOM_OWNERS = [
  'hero', 'npc_02_kanzaki', 'npc_03_kurose', 'npc_04_mido', 'npc_05_shiraishi', 'npc_06_kiryu',
  'npc_07_tachibana', 'npc_08_dojima', 'npc_09_asahina', 'npc_10_kujo', 'npc_11_kisaragi', 'npc_12_kuze',
] as const;

/** 生活棟廊下の個室扉（上の壁に 6、下の壁に 6）の x 座標 */
const BEDROOM_DOOR_X = [3, 7, 12, 17, 21, 26];

type RoomSrc = Omit<RoomDef, 'props' | 'ambient'>;

function bedroom(owner: string, i: number): RoomSrc {
  const mine = owner === 'hero';
  return {
    id: `bedroom_${owner}`, name: mine ? '自分の個室' : '個室', floor: '3F', area: 'living', theme: 'living', w: 20, h: 14, image: 'maps/3f/living_bedroom',
    walk: [[1, 4, 18, 11], [9, 12, 10, 12]],
    block: [[1, 4, 4, 9], [5, 5, 5, 7], [14, 7, 17, 10], [18, 4, 18, 11], [1, 10, 1, 11]],
    doors: [D('out', 'down', 9, 12, 2, 'living_hallway', `room${i}`, 'door', '廊下')],
    inspects: [
      { id: `bed_${owner}`, x: 5, y: 8, text: '上質な寝台。シーツは糊が利いていて、誰かが毎日整えているらしい。', event: mine ? 'rest_bed' : undefined },
      { id: `desk_${owner}`, x: 13, y: 8, text: '机の引き出しには、施設の簡易な見取り図が入っていた。', event: mine ? 'desk_map' : undefined },
    ],
    spots: S([[10, 7], [8, 10], [12, 10]]),
  };
}

const ROOMS_SRC: RoomSrc[] = [
  {
    id: 'living_hallway', name: '生活棟 廊下', floor: '3F', area: 'living', theme: 'living', w: 30, h: 12, image: 'maps/3f/living_hallway',
    walk: [[0,4,29,7]],
    block: [],
    doors: [...BEDROOM_OWNERS.map((o, i) => D(`room${i}`, i < 6 ? 'up' : 'down', BEDROOM_DOOR_X[i % 6], i < 6 ? 4 : 7, 2, `bedroom_${o}`, 'out', 'door', o === 'hero' ? '自分の個室' : '個室')),D('to_library','left',0,4,4,'library','to_hall','open','図書室'),D('to_lounge','right',29,4,4,'living_lounge','to_hall','open','生活棟ラウンジ')],
    inspects: [{id:'hall_plate',x:5,y:4,text:'各扉には参加者の名札。名札の裏に小さく番号が刻まれている。',event:'nameplates'}],
    spots: S([[10,5],[20,6],[15,6],[6,6],[24,5]]),
  },
  {
    id: 'library', name: '図書室', floor: '3F', area: 'living', theme: 'living', w: 26, h: 18, image: 'maps/3f/library',
    overlay: { image: 'maps/3f/library_unlocked_overlay', flag: 'h01_open' },
    walk: [[1,4,24,16],[12,17,13,17]],
    block: [[3,4,4,4],[6,4,9,5],[16,4,19,5],[22,4,23,4],[1,6,2,8],[1,9,2,12],[4,6,8,8],[4,9,8,11],[11,6,14,8],[17,6,21,8],[17,9,21,11],[23,6,24,8],[23,9,24,12],[11,12,14,14],[9,13,10,14],[15,13,16,14],[3,14,6,15],[1,14,1,15],[20,14,22,15],[24,14,24,15],[10,16,11,16],[14,16,15,16]],
    doors: [D('to_hall','down',12,17,2,'living_hallway','to_library','door','廊下'),D('secret','up',12,4,2,'secret_study','from_library','hidden','隠し書斎','h01_open')],
    inspects: [{id:'lib_shelf_order',x:10,y:4,text:'背表紙の番号が不揃いに並んでいる。誰かが意図的に順番を入れ替えたようだ。',event:'h01_shelf'},{id:'lib_diary',x:12,y:9,text:'机の上に古い日記。「王は六つの数を愛した」とだけ読める。',event:'h01_diary'},{id:'lib_rules',x:19,y:14,text:'過去の大会規則の写本。頭脳戦の歴史が綴られている。',event:'lib_rulebook'}],
    spots: S([[12,10],[10,5],[15,10],[9,12],[16,12]]),
  },
  {
    id: 'living_lounge', name: '生活棟ラウンジ', floor: '3F', area: 'living', theme: 'living', w: 28, h: 18, image: 'maps/3f/living_lounge',
    walk: [[1,4,26,16],[13,2,14,3],[13,17,14,17]],
    block: [[3,4,7,6],[2,4,2,4],[20,4,25,6],[26,4,26,4],[2,11,7,16],[1,13,1,15],[21,11,25,16],[26,13,26,15],[11,16,12,16],[15,16,16,16],[1,16,1,16],[26,16,26,16]],
    doors: [D('to_hall','up',13,2,2,'living_hallway','to_lounge','open','廊下'),D('stairs','down',13,17,2,'common_hall','stairs_up','stairs_down','2F 共用棟')],
    inspects: [{id:'lounge_piano',x:9,y:4,text:'飾り棚の本の間に、十二音だけで書かれた奇妙な楽譜が挟まっている。',event:'piano'}],
    spots: S([[13,8],[10,10],[17,7],[9,13],[18,13],[13,12]]),
  },
  {
    id: 'game_room', name: '遊戯室', floor: '3F', area: 'living', theme: 'living', w: 24, h: 16, image: 'maps/3f/game_room',
    walk: [[1,4,22,14],[11,2,12,3],[11,15,12,15]],
    block: [[3,4,6,5],[1,4,2,4],[17,4,21,5],[22,4,22,4],[3,7,6,9],[17,7,21,9],[4,11,7,12],[5,13,6,13],[10,11,13,12],[17,11,19,12],[2,13,3,13],[1,12,1,13],[20,13,21,13],[22,12,22,13],[9,14,10,14],[13,14,14,14]],
    doors: [D('to_hall','down',11,15,2,'common_hall','to_game','open','昇降機（2F 共用棟）'),D('to_obs','up',11,2,2,'observatory','to_game','open','展望室')],
    inspects: [{id:'game_sub',x:12,y:13,text:'盤と駒が揃った卓。誰かと対局できそうだ。',event:'sub_games'},{id:'game_shelf',x:8,y:4,text:'棚には各国のボードゲーム。一つだけ、王冠の刻印がある箱が空だった。',event:'game_box'}],
    spots: S([[12,8],[9,9],[15,9],[8,6],[15,6]]),
  },
  {
    id: 'observatory', name: '展望室', floor: '3F', area: 'living', theme: 'living', w: 24, h: 16, image: 'maps/3f/observatory',
    overlay: { image: 'maps/3f/observatory_unlocked_overlay', flag: 'h02_open' },
    walk: [[1,4,22,14],[11,15,12,15]],
    block: [[5,4,7,4],[3,4,3,4],[10,4,13,4],[16,4,18,4],[20,4,20,4],[11,6,13,8],[2,6,4,9],[19,6,21,8],[2,11,6,12],[1,11,1,13],[18,11,21,12],[22,11,22,13],[9,14,10,14],[13,14,14,14]],
    doors: [D('to_game','down',11,15,2,'game_room','to_obs','door','遊戯室'),D('secret','up',17,5,1,'moon_casino','from_obs','hidden','月下の賭場','h02_open')],
    inspects: [{id:'obs_clock',x:12,y:5,text:'壁一面の大時計。夜になると歯車の音が妙に大きく響く。',event:'h02_clock'},{id:'obs_scope',x:12,y:9,text:'望遠鏡の先は真っ暗な森。灯りはどこにも見えない。',event:'obs_scope'}],
    spots: S([[8,8],[15,10],[12,11],[7,6],[16,6]]),
  },
  {
    id: 'common_hall', name: '2F 共用廊下', floor: '2F', area: 'common', theme: 'common', w: 28, h: 12, image: 'maps/2f/common_hall',
    walk: [[1,4,26,9],[7,3,8,3],[13,2,14,3],[13,10,14,11]],
    block: [[1,8,6,9],[21,8,26,9]],
    doors: [D('stairs_up','up',7,3,2,'living_lounge','stairs','stairs_up','3F 生活棟'),D('to_dining','up',13,2,2,'dining','to_hall','open','食堂'),D('to_game','up',19,4,4,'game_room','to_hall','door','昇降機（3F 遊戯室）'),D('stairs_down','down',13,11,2,'main_hall','stairs_l','stairs_down','1F 中央ホール')],
    inspects: [{id:'common_map',x:17,y:4,text:'昇降機の脇の館内案内図。地下へ続く階段の表記だけが塗り潰されている。',event:'floor_guide'}],
    spots: S([[13,6],[9,6],[18,6],[10,8],[17,8]]),
  },
  {
    id: 'dining', name: '食堂', floor: '2F', area: 'common', theme: 'common', w: 30, h: 20, image: 'maps/2f/dining',
    walk: [[1,4,28,17],[1,1,2,3],[28,1,28,3],[14,18,15,19]],
    block: [[10,4,19,5],[8,4,8,4],[21,4,21,4],[5,4,7,4],[4,4,4,4],[22,4,24,4],[25,4,26,4],[4,5,6,7],[4,9,6,11],[24,5,26,7],[24,9,26,11],[10,8,13,11],[16,8,19,11],[3,14,8,16],[21,14,26,16],[1,15,1,17],[28,15,28,17],[12,17,13,17],[16,17,18,17]],
    doors: [D('to_hall','down',14,19,2,'common_hall','to_dining','double','廊下'),D('to_lounge','up',1,1,2,'common_lounge','to_dining','open','共用ラウンジ'),D('to_garden','up',28,1,1,'garden','to_dining','open','庭園')],
    inspects: [{id:'dining_buffet',x:14,y:6,text:'配膳台には温かい料理が並ぶ。人数分きっちり、一皿も余らない。',event:'dining_meal'}],
    spots: S([[15,13],[8,12],[21,12],[15,7],[9,8],[20,8],[15,15]]),
  },
  {
    id: 'garden', name: '屋内庭園', floor: '2F', area: 'common', theme: 'garden', w: 28, h: 20, image: 'maps/2f/garden',
    walk: [[1,4,26,17],[13,2,14,3],[13,18,14,19]],
    block: [[5,5,10,7],[18,5,22,7],[5,13,10,15],[18,13,22,15],[10,8,17,11],[4,8,6,11],[21,8,23,11],[1,4,2,4],[25,4,26,4],[3,17,6,17],[1,16,1,17],[21,17,24,17],[26,16,26,17],[11,17,12,17],[15,17,17,17]],
    doors: [D('to_dining','down',13,19,2,'dining','to_garden','open','食堂'),D('to_bath','up',13,2,2,'bathroom','to_garden','open','浴室')],
    inspects: [{id:'garden_fountain',x:14,y:12,text:'水盤の底に硬貨が一枚沈んでいる。表には王冠、裏には「零」の刻印。',event:'garden_coin'}],
    spots: S([[14,6],[12,13],[3,12],[24,12],[14,15]]),
  },
  {
    id: 'common_lounge', name: '共用ラウンジ', floor: '2F', area: 'common', theme: 'common', w: 28, h: 18, image: 'maps/2f/common_lounge',
    walk: [[1,4,26,16],[13,17,14,17]],
    block: [[3,4,7,6],[1,4,2,4],[21,4,25,6],[26,4,26,4],[3,8,6,9],[22,8,24,9],[2,12,7,15],[1,13,1,15],[21,12,25,15],[20,14,20,15],[26,13,26,15],[11,16,12,16],[15,16,16,16]],
    doors: [D('to_dining','down',13,17,2,'dining','to_lounge','door','食堂')],
    inspects: [{id:'lounge_corner',x:20,y:13,text:'奥の席は柱の陰になっていて、密談にちょうどよい。',event:'lounge_corner'}],
    spots: S([[13,8],[10,11],[17,11],[9,7],[18,7]]),
  },
  {
    id: 'bathroom', name: '浴室', floor: '2F', area: 'common', theme: 'common', w: 22, h: 16, image: 'maps/2f/bathroom',
    overlay: { image: 'maps/2f/bathroom_unlocked_overlay', flag: 'h03_open' },
    walk: [[1,4,20,14],[10,15,11,15]],
    block: [[8,6,13,9],[1,10,3,13],[4,11,4,13],[16,10,20,13],[1,4,1,4],[20,4,20,4],[8,14,9,14],[12,14,13,14]],
    doors: [D('to_garden','down',10,15,2,'garden','to_bath','door','庭園'),D('secret','up',18,4,2,'mirror_room','from_bath','hidden','鏡の間','h03_open')],
    inspects: [{id:'bath_mirror',x:16,y:4,text:'曇った鏡に、指でなぞったような記号が浮かんでいる。',event:'h03_mirror'}],
    spots: S([[10,11],[6,7],[15,7],[10,5],[7,12]]),
  },
  {
    id: 'main_hall', name: '中央ホール', floor: '1F', area: 'ground', theme: 'arena', w: 32, h: 22, image: 'maps/1f/main_hall',
    walk: [[1,7,30,18],[15,19,16,21]],
    block: [[1,9,1,12],[30,9,30,12],[4,8,7,11],[24,8,27,11],[3,14,8,18],[1,16,2,18],[24,14,29,18],[30,16,30,18]],
    doors: [D('stairs_l','up',2,7,2,'common_hall','stairs_down','stairs_up','2F 共用棟'),D('stairs_r','up',28,7,2,'common_hall','stairs_down','stairs_up','2F 共用棟'),D('to_shop','left',1,7,2,'shop','to_hall','open','交換所'),D('to_infirmary','right',30,7,2,'infirmary','to_hall','open','医務室'),D('to_arena','left',1,13,2,'main_arena','to_hall','open','大会競技場'),D('to_b1','right',30,13,2,'prison_hallway','stairs_up','iron','地下 監獄棟'),D('to_entrance','down',15,21,2,'entrance','to_hall','double','玄関')],
    inspects: [{id:'hall_board',x:23,y:7,text:'大会の掲示台。',event:'board'},{id:'hall_emblem',x:16,y:12,text:'床に描かれた王冠の紋章。中心だけ、石の色がわずかに違う。',event:'hall_emblem'}],
    spots: S([[16,9],[11,13],[20,13],[16,15],[10,9],[21,9],[13,17],[18,17],[9,13],[22,13],[16,17],[12,8]]),
  },
  {
    id: 'main_arena', name: '大会競技場', floor: '1F', area: 'ground', theme: 'arena', w: 32, h: 22, image: 'maps/1f/main_arena',
    walk: [[1,5,30,19],[15,20,16,21]],
    block: [[12,5,19,6],[3,5,5,5],[26,5,28,5],[24,5,24,5],[10,8,22,13],[9,10,9,11],[2,16,7,18],[1,18,1,19],[4,19,5,19],[24,16,29,18],[26,19,27,19],[30,18,30,19],[1,19,14,19],[17,19,30,19]],
    doors: [D('to_hall','down',15,21,2,'main_hall','to_arena','double','中央ホール')],
    inspects: [{id:'arena_judge',x:16,y:7,text:'審判台。仮面の主催者がいつもここに立つ。台の裏に小さな鍵穴がある。',event:'arena_judge'}],
    spots: S([[11,14],[13,14],[15,14],[17,14],[19,14],[21,14],[11,7],[13,7],[15,7],[17,7],[19,7],[21,7]]),
  },
  {
    id: 'shop', name: '交換所', floor: '1F', area: 'ground', theme: 'arena', w: 20, h: 14, image: 'maps/1f/shop',
    walk: [[1,4,18,11],[9,12,10,12]],
    block: [[10,4,18,4],[3,4,5,4],[3,6,5,7],[14,6,16,7],[5,9,8,10],[12,9,14,10],[1,5,1,8],[18,5,18,8],[1,9,3,11],[16,9,18,11]],
    doors: [D('to_hall','down',9,12,2,'main_hall','to_shop','door','中央ホール')],
    inspects: [{id:'shop_counter',x:13,y:5,text:'交換所のカウンター。ピースと引き換えに品物を受け取れる。',event:'shop'}],
    spots: S([[10,7],[7,5],[11,7],[9,10]]),
  },
  {
    id: 'infirmary', name: '医務室', floor: '1F', area: 'ground', theme: 'common', w: 20, h: 14, image: 'maps/1f/infirmary',
    walk: [[1,3,18,11],[9,12,10,12]],
    block: [[2,4,4,6],[2,7,4,9],[15,4,18,6],[15,7,18,9],[8,6,11,7],[1,11,5,11],[14,11,18,11]],
    doors: [D('to_hall','down',9,12,2,'main_hall','to_infirmary','door','中央ホール')],
    inspects: [{id:'inf_records',x:3,y:3,text:'薬品棚の奥に古いカルテの束。日付は十年前で止まっている。',event:'inf_records'}],
    spots: S([[10,9],[6,5],[13,5],[10,4],[7,9]]),
  },
  {
    id: 'entrance', name: '玄関', floor: '1F', area: 'ground', theme: 'arena', w: 24, h: 16, image: 'maps/1f/entrance',
    walk: [[1,4,22,14],[11,15,12,15]],
    block: [[3,5,7,6],[3,4,3,4],[16,5,20,6],[20,4,20,4],[1,4,1,4],[22,4,22,4],[3,10,6,12],[18,10,20,12],[1,12,1,14],[22,12,22,14],[9,14,10,14],[13,14,14,14]],
    doors: [D('to_hall','down',11,15,2,'main_hall','to_entrance','double','中央ホール')],
    inspects: [{id:'entrance_door',x:12,y:4,text:'外へ続く扉は鋼鉄の閂で封鎖されている。電子錠の表示は「11」。',event:'entrance_lock'}],
    spots: S([[12,8],[9,9],[15,9],[12,11]]),
  },
  {
    id: 'prison_hallway', name: '監獄棟 通路', floor: 'B1', area: 'prison', theme: 'prison', w: 28, h: 12, image: 'maps/b1/prison_hallway',
    walk: [[0,3,27,7],[13,1,14,2],[13,8,14,10]],
    block: [],
    doors: [D('stairs_up','up',13,1,2,'main_hall','to_b1','iron','1F 中央ホール'),D('to_cells','down',13,10,2,'prison_cells','to_hall','iron','共同牢'),D('to_archive','left',0,3,5,'old_archive','to_hall','open','旧書庫'),D('to_arena','right',27,3,5,'prison_arena','to_hall','open','監獄マッチ会場')],
    inspects: [{id:'b1_pipe',x:20,y:3,text:'壁の配管から、規則的な金属音。誰かが向こう側で叩いている…？',event:'b1_noise'}],
    spots: S([[9,5],[18,5],[14,5],[5,6],[22,4]]),
  },
  {
    id: 'prison_cells', name: '共同牢', floor: 'B1', area: 'prison', theme: 'prison', w: 28, h: 18, image: 'maps/b1/prison_cells',
    overlay: { image: 'maps/b1/prison_cells_unlocked_overlay', flag: 'h04_open' },
    walk: [[1,5,26,12],[13,13,14,17]],
    block: [[1,5,1,5],[1,6,1,8],[1,9,1,11],[2,10,3,11],[26,5,26,6],[25,7,26,8],[26,9,26,12]],
    doors: [D('to_hall','down',13,17,2,'prison_hallway','to_cells','iron','通路'),D('secret','up',13,5,2,'cell_zero','from_cells','hidden','第零牢','h04_open')],
    inspects: [{id:'cells_wall',x:12,y:5,text:'通路脇の石壁に刻まれた数字の列。爪で刻んだように浅い。',event:'h04_wall'}],
    spots: S([[8,8],[19,8],[14,9],[6,11],[21,6],[10,6],[17,11]]),
  },
  {
    id: 'prison_arena', name: '監獄マッチ会場', floor: 'B1', area: 'prison', theme: 'prison', w: 24, h: 18, image: 'maps/b1/prison_arena',
    walk: [[1,4,22,15],[11,16,12,17]],
    block: [[9,4,14,4],[7,6,16,6],[7,7,7,12],[16,7,16,12],[8,12,10,12],[13,12,15,12],[2,6,4,7],[2,12,4,13],[19,6,21,7],[20,12,21,13],[9,15,10,15],[13,15,14,15]],
    doors: [D('to_hall','down',11,17,2,'prison_hallway','to_arena','iron','通路')],
    inspects: [{id:'parena_table',x:11,y:11,text:'鉄柵に囲まれた競技区画。床は無数の傷で曇っている。ここで何人が去っていったのだろう。',event:'prison_table'}],
    spots: S([[9,8],[14,8],[9,10],[14,10],[5,9],[18,9],[12,14]]),
  },
  {
    id: 'old_archive', name: '旧書庫', floor: 'B1', area: 'prison', theme: 'prison', w: 22, h: 16, image: 'maps/b1/old_archive',
    walk: [[1,4,20,14],[10,15,11,15]],
    block: [[2,5,6,6],[2,8,6,9],[15,5,19,6],[15,8,19,9],[9,8,12,10],[3,11,6,13],[15,11,18,13],[1,11,1,12],[20,11,20,13],[8,14,9,14],[12,14,13,14]],
    doors: [D('to_hall','down',10,15,2,'prison_hallway','to_archive','door','通路'),D('to_passage','up',10,4,2,'underground_passage','to_archive','iron','地下通路','passage_open')],
    inspects: [{id:'archive_letters',x:11,y:11,text:'机に古い手紙が五通。宛名はすべて「次の参加者へ」。',event:'h04_letters'},{id:'archive_records',x:4,y:7,text:'棚には参加者の記録。脱落した人の私物や手記もここに収められるらしい。',event:'archive_records'}],
    spots: S([[8,6],[13,6],[10,12],[8,12],[13,12]]),
  },
  {
    id: 'underground_passage', name: '地下通路', floor: 'B1', area: 'prison', theme: 'prison', w: 30, h: 16, image: 'maps/b1/underground_passage',
    walk: [[1,5,28,10],[14,11,15,14]],
    block: [],
    doors: [D('to_archive','down',14,14,2,'old_archive','to_passage','iron','旧書庫'),D('to_maze','up',21,5,2,'maze_entry','from_passage','iron','地下迷宮','h05_cleared')],
    inspects: [{id:'passage_mech',x:20,y:5,text:'古い仕掛け扉。数字盤とスライド式の板、記号の歯車が組み込まれている。',event:'h05_mech'}],
    spots: S([[10,7],[20,8],[15,6]]),
  },
  {
    id: 'secret_study', name: '秘密の書斎', floor: 'B2', area: 'secret', theme: 'secret', w: 20, h: 14, image: 'maps/b2/secret_study',
    walk: [[1,4,18,11],[9,12,10,12]],
    block: [[1,5,3,8],[7,5,12,8],[16,5,18,9],[1,11,4,11],[15,11,18,11]],
    doors: [D('from_library','down',9,12,2,'library','secret','hidden','図書室')],
    inspects: [{id:'study_safe',x:10,y:4,text:'六桁のダイヤル式金庫。',event:'h01_safe'}],
    spots: S([[6,10],[13,10],[14,5]]),
  },
  {
    id: 'moon_casino', name: '月下の賭場', floor: 'B2', area: 'secret', theme: 'secret', w: 24, h: 16, image: 'maps/b2/moon_casino',
    walk: [[1,4,22,14],[11,15,12,15]],
    block: [[3,4,6,5],[17,4,21,5],[2,7,6,9],[18,7,21,9],[10,10,14,12],[3,11,5,12],[18,11,21,12],[1,12,1,13],[22,12,22,13],[9,14,10,14],[13,14,14,14]],
    doors: [D('from_obs','down',11,15,2,'observatory','secret','hidden','展望室')],
    inspects: [{id:'casino_table',x:12,y:13,text:'黒金の卓。仮面のディーラーが無言で札を揃えている。',event:'h02_table'}],
    spots: S([[12,7],[8,8],[16,8]]),
  },
  {
    id: 'mirror_room', name: '鏡の間', floor: 'B2', area: 'secret', theme: 'secret', w: 24, h: 18, image: 'maps/b2/mirror_room',
    walk: [[1,4,22,16],[11,17,12,17]],
    block: [[4,4,7,7],[16,4,19,7],[4,10,7,13],[16,10,19,13],[9,16,10,16],[13,16,14,16]],
    doors: [D('from_bath','down',11,17,2,'bathroom','secret','hidden','浴室')],
    inspects: [{id:'mirror_center',x:11,y:9,text:'床に七×七の格子。鏡に映る自分が、逆の方向へ歩き出しそうだ。',event:'h03_maze'}],
    spots: S([[12,12],[9,8],[14,8]]),
  },
  {
    id: 'cell_zero', name: '第零牢', floor: 'B2', area: 'secret', theme: 'prison', w: 18, h: 14, image: 'maps/b2/cell_zero',
    walk: [[1,4,16,11],[8,12,9,12]],
    block: [[2,6,4,8],[13,6,16,8],[1,10,1,11],[2,11,3,11],[16,10,16,11],[16,4,16,5]],
    doors: [D('from_cells','down',8,12,2,'prison_cells','secret','hidden','共同牢')],
    inspects: [{id:'zero_letters',x:5,y:7,text:'囚人の遺言と書かれた封筒の束。',event:'h04_game'}],
    spots: S([[9,6],[9,9],[11,5]]),
  },
  {
    id: 'maze_entry', name: '地下迷宮の入口', floor: 'B2', area: 'secret', theme: 'secret', w: 24, h: 18, image: 'maps/b2/maze_entry',
    walk: [[1,5,22,15],[11,3,12,4],[11,16,12,17]],
    block: [[1,6,3,8],[20,6,22,8],[3,12,7,14],[17,12,20,14],[9,15,10,15],[13,15,14,15]],
    doors: [D('from_passage','down',11,17,2,'underground_passage','to_maze','iron','地下通路'),D('to_black','up',11,3,2,'black_door','from_maze','stairs_up','黒い扉の部屋')],
    inspects: [{id:'maze_note',x:4,y:10,text:'壁に古い落書き。「影は七枚の札しか持たない」',event:'maze_note'}],
    spots: S([[12,11],[8,7],[16,7]]),
  },
  {
    id: 'black_door', name: '黒い扉の部屋', floor: 'B2', area: 'secret', theme: 'secret', w: 20, h: 14, image: 'maps/b2/black_door',
    overlay: { image: 'maps/b2/black_door_unlocked_overlay', flag: 'h06_open' },
    walk: [[1,4,18,11],[9,12,10,12]],
    block: [[3,6,5,8],[15,6,17,8],[1,10,1,11],[18,10,18,11]],
    doors: [D('from_maze','down',9,12,2,'maze_entry','to_black','iron','迷宮入口'),D('to_lab','up',9,4,3,'research_lab','from_black','black','黒い扉','h06_open')],
    inspects: [{id:'black_keyhole',x:8,y:5,text:'黒い扉。六角形の鍵穴の横に、仮面の対戦者が立っている。',event:'h06_door'}],
    spots: S([[10,8],[7,10],[13,10]]),
  },
  {
    id: 'research_lab', name: '研究室', floor: 'B2', area: 'secret', theme: 'secret', w: 30, h: 20, image: 'maps/b2/research_lab',
    walk: [[1,5,28,17],[14,2,15,4],[14,18,15,19]],
    block: [[2,5,9,6],[1,5,1,5],[20,5,27,6],[28,5,28,5],[1,8,5,10],[7,8,11,10],[13,9,16,10],[18,8,22,10],[25,8,28,10],[2,13,9,15],[21,13,27,15],[1,17,13,17],[16,17,28,17]],
    doors: [D('from_black','down',14,19,2,'black_door','to_lab','black','黒い扉'),D('to_surv','left',1,6,2,'surveillance','from_lab','open','監視室'),D('to_vault','right',28,6,2,'records_vault','from_lab','open','記録保管庫'),D('to_iso','up',14,2,2,'isolation','from_lab','open','隔離区域')],
    inspects: [{id:'lab_desk',x:15,y:11,text:'研究机。「十二の証明」と題された分厚い資料。',event:'h07_proofs'}],
    spots: S([[15,7],[12,12],[17,12],[15,14]]),
  },
  {
    id: 'surveillance', name: '監視室', floor: 'B2', area: 'secret', theme: 'secret', w: 22, h: 16, image: 'maps/b2/surveillance',
    walk: [[1,5,20,14],[10,15,11,15]],
    block: [[1,5,17,5],[18,5,20,5],[1,6,5,11],[16,6,20,11],[2,13,6,14],[16,13,19,14],[1,12,1,14],[20,12,20,14],[8,14,9,14],[12,14,13,14]],
    doors: [D('from_lab','down',10,15,2,'research_lab','to_surv','door','研究室')],
    inspects: [{id:'surv_console',x:11,y:6,text:'モニターには施設中の映像。参加者全員の行動が記録されている。',event:'surv_console'}],
    spots: S([[11,9],[8,8],[13,11]]),
  },
  {
    id: 'records_vault', name: '記録保管庫', floor: 'B2', area: 'secret', theme: 'secret', w: 22, h: 16, image: 'maps/b2/records_vault',
    walk: [[1,4,20,14],[10,15,11,15]],
    block: [[4,4,6,10],[10,4,12,10],[16,4,18,10],[3,12,7,14],[15,12,19,14],[1,12,2,14],[20,12,20,14],[8,14,9,14],[12,14,13,14]],
    doors: [D('from_lab','down',10,15,2,'research_lab','to_vault','door','研究室')],
    inspects: [{id:'vault_docs',x:11,y:11,text:'機密文書の棚。CROWN計画の全記録がここにある。',event:'vault_docs'}],
    spots: S([[8,7],[13,7],[11,12]]),
  },
  {
    id: 'isolation', name: '隔離区域', floor: 'B2', area: 'secret', theme: 'secret', w: 28, h: 18, image: 'maps/b2/isolation',
    walk: [[1,4,26,13],[13,14,14,17]],
    block: [[7,6,20,9],[10,10,17,10],[1,6,3,10],[24,6,26,10]],
    doors: [D('from_lab','down',13,17,2,'research_lab','to_iso','iron','研究室'),D('to_core','up',15,4,2,'core','from_lab','black','最深部','h07_cleared')],
    inspects: [{id:'iso_beds',x:11,y:4,text:'扉の小窓の向こうに、眠る人々。脱落した参加者たちが、ここで生かされている。',event:'iso_found'}],
    spots: S([[13,12],[6,12],[21,12],[13,5]]),
  },
  {
    id: 'core', name: '最深部', floor: 'B2', area: 'secret', theme: 'secret', w: 28, h: 20, image: 'maps/b2/core',
    walk: [[1,6,26,17],[13,18,14,19]],
    block: [[9,6,18,6],[3,8,6,11],[21,8,24,11],[3,14,7,16],[20,14,24,16],[1,14,1,16],[26,14,26,16],[11,17,12,17],[15,17,16,17]],
    doors: [D('from_lab','down',13,19,2,'isolation','to_core','black','隔離区域')],
    inspects: [{id:'core_terminal',x:14,y:7,text:'観測端末。画面に「神の方程式」と表示されている。',event:'h08_terminal'}],
    spots: S([[14,10],[10,12],[17,12]]),
  },
  ...BEDROOM_OWNERS.map((o, i) => bedroom(o, i)),
];

const ROOMS_LIST: RoomDef[] = ROOMS_SRC.map((r) => ({ ...r, props: [], ambient: 1 }));

export const ROOMS: Record<string, RoomDef> = Object.fromEntries(ROOMS_LIST.map((r) => [r.id, r]));
export const ROOM_IDS = ROOMS_LIST.map((r) => r.id);

/** 部屋ごとの衝突グリッド（true = 通行不可） */
export function buildCollision(room: RoomDef, _flags?: Record<string, unknown>): boolean[][] {
  const g: boolean[][] = Array.from({ length: room.h }, () => Array.from({ length: room.w }, () => true));
  const fill = (r: Rect, v: boolean) => {
    for (let y = Math.max(0, r[1]); y <= Math.min(room.h - 1, r[3]); y++) for (let x = Math.max(0, r[0]); x <= Math.min(room.w - 1, r[2]); x++) g[y][x] = v;
  };
  for (const r of room.walk) fill(r, false);
  for (const r of room.block) fill(r, true);
  return g;
}

export function propVisible(p: PlacedProp, flags: Record<string, unknown>): boolean {
  if (p.showIf && !flags[p.showIf]) return false;
  if (p.hideIf && flags[p.hideIf]) return false;
  return true;
}

/** 扉の手前（部屋の内側の床）のタイル一覧 */
export function doorApproach(_room: RoomDef, d: DoorDef): { x: number; y: number }[] {
  return d.tiles;
}

/** 扉に入る方向 */
export function doorDir(d: DoorDef): DoorDir {
  return d.dir;
}

export function findDoor(room: RoomDef, id: string): DoorDef | undefined {
  return room.doors.find((d) => d.id === id);
}

/** タイル (x,y) から dir 方向へ進むと入る扉 */
export function doorAt(room: RoomDef, x: number, y: number, dir: string): DoorDef | undefined {
  return room.doors.find((d) => d.dir === dir && d.tiles.some((t) => t.x === x && t.y === y));
}
