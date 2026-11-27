/**
 * 参加者の定義（仕様書 01_GAME_CORE.md「NPC一覧」）。
 * 能力値は仕様の確定値、人格値（0〜100）と配色は暫定（docs/decisions.md）。
 */
import profilesJson from './npc_profiles.json';

export type HeroId = 'hero';
export type NpcId =
  | 'npc_02_kanzaki'
  | 'npc_03_kurose'
  | 'npc_04_mido'
  | 'npc_05_shiraishi'
  | 'npc_06_kiryu'
  | 'npc_07_tachibana'
  | 'npc_08_dojima'
  | 'npc_09_asahina'
  | 'npc_10_kujo'
  | 'npc_11_kisaragi'
  | 'npc_12_kuze';
export type CharId = HeroId | NpcId;

export interface Stats {
  logic: number;
  strategy: number;
  memory: number;
  negotiation: number;
  acting: number;
  observation: number;
}

export interface Personality {
  greed: number;
  loyalty: number;
  ambition: number;
  morality: number;
  risk: number;
  explore: number;
}

export interface Palette {
  hair: string;
  skin: string;
  coat: string;
  accent: string;
  pants: string;
}

export interface CharacterDef {
  id: NpcId;
  name: string;
  short: string;
  kana: string;
  gender: 'm' | 'f';
  age: number;
  job: string;
  stats: Stats;
  personality: Personality;
  profile: string;
  /** 物語上の秘密（ストーリー用、NPC の推論には使わない） */
  secret: string;
  palette: Palette;
  /** 好む場所（自律行動の重み） */
  favoriteRooms: string[];
  /** 交渉の固有ルール */
  rules: { refuseBetrayFriends?: boolean; requireRational?: boolean; profitFirst?: boolean; keepsContracts?: boolean };
}

const st = (logic: number, strategy: number, memory: number, negotiation: number, acting: number, observation: number): Stats => ({
  logic,
  strategy,
  memory,
  negotiation,
  acting,
  observation,
});
const pe = (greed: number, loyalty: number, ambition: number, morality: number, risk: number, explore: number): Personality => ({
  greed,
  loyalty,
  ambition,
  morality,
  risk,
  explore,
});

export const NPCS: CharacterDef[] = [
  {
    id: 'npc_02_kanzaki', name: '神崎 怜', short: '神崎', kana: 'かんざき れい', gender: 'm', age: 28, job: '数学者',
    stats: st(10, 9, 8, 4, 3, 7), personality: pe(30, 55, 60, 60, 35, 55),
    profile: '合理性を何より重んじる若き数学者。買収や情に訴える話には乗らない。',
    secret: 'CROWN計画の数理モデル開発に関与していた。',
    palette: { hair: '#1d1f2a', skin: '#f0d3bc', coat: '#3b4a6b', accent: '#c9d4e8', pants: '#22283a' },
    favoriteRooms: ['library', 'game_room', 'observatory'],
    rules: { requireRational: true },
  },
  {
    id: 'npc_03_kurose', name: '黒瀬 美琴', short: '黒瀬', kana: 'くろせ みこと', gender: 'f', age: 32, job: '弁護士',
    stats: st(9, 8, 7, 10, 7, 8), personality: pe(50, 70, 65, 55, 45, 50),
    profile: '契約は必ず守るが、条文の抜け穴は躊躇なく使う弁護士。',
    secret: '過去の被害者から真相究明の依頼を受けている。',
    palette: { hair: '#14141a', skin: '#f2d6c4', coat: '#1d1d26', accent: '#b8293d', pants: '#16161e' },
    favoriteRooms: ['common_lounge', 'library', 'main_hall'],
    rules: { keepsContracts: true },
  },
  {
    id: 'npc_04_mido', name: '御堂 隆臣', short: '御堂', kana: 'みどう たかおみ', gender: 'm', age: 45, job: '経営者',
    stats: st(6, 9, 5, 10, 8, 7), personality: pe(95, 35, 90, 25, 60, 30),
    profile: '強欲な経営者。派閥を作り、高額の取引で人を動かす。',
    secret: 'CROWN計画の研究に出資していた。',
    palette: { hair: '#3a2c22', skin: '#e8c6a8', coat: '#5a1f24', accent: '#d8b25a', pants: '#2a1a1a' },
    favoriteRooms: ['living_lounge', 'common_lounge', 'shop'],
    rules: { profitFirst: true },
  },
  {
    id: 'npc_05_shiraishi', name: '白石 紗夜', short: '白石', kana: 'しらいし さや', gender: 'f', age: 24, job: '心理学研究者',
    stats: st(8, 8, 7, 9, 9, 10), personality: pe(55, 20, 70, 35, 60, 55),
    profile: '誰にでも親しげに話しかける心理学研究者。複数の同盟を同時に結ぶ。',
    secret: '「裏切り」の研究をしている。',
    palette: { hair: '#e6e2dc', skin: '#f6e0d2', coat: '#dfe6ee', accent: '#7aa0c8', pants: '#8c96a8' },
    favoriteRooms: ['common_lounge', 'dining', 'garden'],
    rules: {},
  },
  {
    id: 'npc_06_kiryu', name: '桐生 颯', short: '桐生', kana: 'きりゅう はやて', gender: 'm', age: 21, job: 'プロゲーマー',
    stats: st(8, 10, 7, 5, 4, 8), personality: pe(40, 90, 85, 60, 55, 40),
    profile: '負けず嫌いのプロゲーマー。一度仲間と認めた相手には忠実。',
    secret: '過去の大会のゲーム資料を持っている。',
    palette: { hair: '#2b2b33', skin: '#f0d0b8', coat: '#202a24', accent: '#4fd08a', pants: '#1a1f1c' },
    favoriteRooms: ['game_room', 'main_arena', 'dining'],
    rules: {},
  },
  {
    id: 'npc_07_tachibana', name: '橘 香織', short: '橘', kana: 'たちばな かおり', gender: 'f', age: 38, job: '医師',
    stats: st(7, 5, 8, 6, 3, 8), personality: pe(15, 85, 30, 95, 25, 40),
    profile: '弱い立場の人を放っておけない医師。仲間を売る取引は大金でも断る。',
    secret: '過去の被害者の担当医だった。',
    palette: { hair: '#5a3a2a', skin: '#f2d8c6', coat: '#eef0f2', accent: '#6fa8a0', pants: '#4a5058' },
    favoriteRooms: ['infirmary', 'garden', 'dining'],
    rules: { refuseBetrayFriends: true },
  },
  {
    id: 'npc_08_dojima', name: '堂島 誠司', short: '堂島', kana: 'どうじま せいじ', gender: 'm', age: 52, job: '元刑事',
    stats: st(8, 7, 7, 7, 5, 10), personality: pe(30, 70, 45, 75, 30, 90),
    profile: '慎重で観察眼の鋭い元刑事。施設のあちこちを調べて回る。',
    secret: '過去の失踪事件を追っている。',
    palette: { hair: '#6a6660', skin: '#deb898', coat: '#4a4038', accent: '#a89878', pants: '#2e2a26' },
    favoriteRooms: ['entrance', 'main_hall', 'bathroom'],
    rules: {},
  },
  {
    id: 'npc_09_asahina', name: '朝比奈 ひまり', short: '朝比奈', kana: 'あさひな ひまり', gender: 'f', age: 19, job: '大学生',
    stats: st(5, 5, 10, 8, 5, 7), personality: pe(45, 60, 50, 65, 40, 70),
    profile: '人懐っこい大学生。一度聞いた話は決して忘れない。',
    secret: '兄が過去の大会に参加していた。',
    palette: { hair: '#b8743a', skin: '#f8e0cc', coat: '#e8b8b0', accent: '#f0e0a0', pants: '#5a4a6a' },
    favoriteRooms: ['dining', 'garden', 'living_lounge'],
    rules: {},
  },
  {
    id: 'npc_10_kujo', name: '九条 蓮司', short: '九条', kana: 'くじょう れんじ', gender: 'm', age: 35, job: 'プロ雀士',
    stats: st(8, 9, 7, 8, 10, 9), personality: pe(60, 45, 70, 40, 95, 50),
    profile: 'ブラフを好むプロ雀士。危険な賭けほど楽しむ。',
    secret: '過去の大会の参加者だった。',
    palette: { hair: '#101014', skin: '#e8ccb4', coat: '#2a2440', accent: '#9a6ad0', pants: '#18161e' },
    favoriteRooms: ['game_room', 'common_lounge', 'observatory'],
    rules: {},
  },
  {
    id: 'npc_11_kisaragi', name: '如月 麗華', short: '如月', kana: 'きさらぎ れいか', gender: 'f', age: 29, job: '俳優',
    stats: st(6, 6, 8, 9, 10, 8), personality: pe(80, 30, 75, 30, 55, 45),
    profile: '華やかな俳優。演技で本心を隠し、利益を優先する。',
    secret: '主催者から秘密の依頼を受けている。',
    palette: { hair: '#4a1a2a', skin: '#f8dccc', coat: '#6a1a38', accent: '#e8c0d0', pants: '#2a1020' },
    favoriteRooms: ['living_lounge', 'bathroom', 'common_lounge'],
    rules: { profitFirst: true },
  },
  {
    id: 'npc_12_kuze', name: '久世 宗一郎', short: '久世', kana: 'くぜ そういちろう', gender: 'm', age: 62, job: '元教授',
    stats: st(10, 8, 9, 6, 6, 8), personality: pe(25, 60, 40, 70, 30, 95),
    profile: '博識な元教授。古い書物や建物の構造に強い興味を示す。',
    secret: 'CROWN計画の創設者の一人。',
    palette: { hair: '#d8d4cc', skin: '#e8ccb0', coat: '#3a3a30', accent: '#b8a878', pants: '#2a2a24' },
    favoriteRooms: ['library', 'observatory', 'main_hall'],
    rules: {},
  },
];

// 仕様 v03 の 02_NPC_PROFILES.json を正とし、人格値・基準価格・秘密の解放条件を上書きする
interface ProfileJson {
  id: string;
  personality: { greed: number; loyalty: number; ambition: number; morality: number; risk: number; exploration: number };
  basePrices: { ALLIANCE: number; SELL_INFO: number; RECRUIT: number; PLAN: number };
  secretDay: number;
  secretTrust: number;
  secretEvidenceKey: string;
  goal: string;
  utilityWeights: Record<'survival' | 'futureAdvantage' | 'pieceValue' | 'relationship' | 'personalGoal' | 'exploration' | 'risk' | 'time', number>;
  reputationWeight: number;
}
export const PROFILE_VERSION = (profilesJson as { version: number }).version;
export const PROFILES: Record<string, ProfileJson> = Object.fromEntries((profilesJson as unknown as { profiles: ProfileJson[] }).profiles.map((p) => [p.id, p]));
for (const n of NPCS) {
  const p = PROFILES[n.id];
  if (!p) continue;
  n.personality = { greed: p.personality.greed, loyalty: p.personality.loyalty, ambition: p.personality.ambition, morality: p.personality.morality, risk: p.personality.risk, explore: p.personality.exploration };
}

export const NPC_BY_ID: Record<NpcId, CharacterDef> = Object.fromEntries(NPCS.map((n) => [n.id, n])) as Record<NpcId, CharacterDef>;
export const NPC_IDS = NPCS.map((n) => n.id);
export const ALL_IDS: CharId[] = ['hero', ...NPC_IDS];

export const HOST = {
  id: 'host_observer',
  name: 'オブザーバー',
  profile: '白い仮面に黒い正装。大会の公平な審判であり、CROWN計画の責任者。',
};

export const HERO_PALETTES: Record<'m' | 'f', Palette> = {
  m: { hair: '#2a2420', skin: '#f0d2b8', coat: '#20263a', accent: '#d8b25a', pants: '#1a1d28' },
  f: { hair: '#2e1f1c', skin: '#f6dac8', coat: '#2a2236', accent: '#d8b25a', pants: '#1c1826' },
};

export const DEFAULT_HERO_NAMES = { m: '天城 湊', f: '天城 葵' };
