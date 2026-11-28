/**
 * 参加者の定義（仕様書 01_GAME_CORE.md「NPC一覧」）。
 * 能力値は仕様の確定値、人格値（0〜100）と配色は暫定（docs/decisions.md）。
 * 表示名（姓名・呼び名・読み）は npc_names.json に分けてある。内部ID は名前を変えても変えない（docs/npc_rename.md）。
 */
import profilesJson from './npc_profiles.json';
import namesJson from './npc_names.json';
import { getLang } from '../i18n/i18n';

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

/**
 * 能力（1〜10）。npc_profiles.json の ability が唯一の出所。
 * 手帳に出すのは論理・記憶・観察・戦略・交渉・運の 6 つ（段階表示）。acting（本心を隠す力）は表示しない内部の値。
 * 通常の NPC は 5 能力（論理・記憶・観察・戦略・交渉）の合計 35・運 5。強者（tier: strong）はこれを超えてよい。
 */
export interface Stats {
  logic: number;
  strategy: number;
  memory: number;
  negotiation: number;
  acting: number;
  observation: number;
  luck: number;
}

export interface Personality {
  greed: number;
  loyalty: number;
  ambition: number;
  morality: number;
  risk: number;
  explore: number;
  /** 支配欲：自分を中心とした集団を作りたがる */
  dominance: number;
  /** 自立志向：集団に依存せず、必要な協力だけ選ぶ */
  independence: number;
  /** 主導性：自分から勧誘、提案、役割分担を行う */
  initiative: number;
  /** 追従性：信頼や実績のある相手の提案に乗りやすい */
  followership: number;
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
  /** 表示用の姓名（npc_names.json から、言語ごと） */
  readonly name: string;
  /** 呼び名（会話・ログ・部屋の札・名簿） */
  readonly short: string;
  /** 読み（自己紹介の字幕） */
  readonly kana: string;
  gender: 'm' | 'f';
  age: number;
  /** 通常の参加者か、将来追加する強者か（調整基準が違う） */
  tier: 'normal' | 'strong';
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


type CharacterBase = Omit<CharacterDef, 'name' | 'short' | 'kana' | 'stats' | 'personality' | 'tier'>;

const BASE: CharacterBase[] = [
  {
    id: 'npc_02_kanzaki', gender: 'm', age: 28, job: '数学者',
    profile: '合理性を何より重んじる若き数学者。買収や情に訴える話には乗らない。',
    secret: 'CROWN計画の数理モデル開発に関与していた。',
    palette: { hair: '#1d1f2a', skin: '#f0d3bc', coat: '#3b4a6b', accent: '#c9d4e8', pants: '#22283a' },
    favoriteRooms: ['library', 'game_room', 'observatory'],
    rules: { requireRational: true },
  },
  {
    id: 'npc_03_kurose', gender: 'f', age: 32, job: '弁護士',
    profile: '契約は必ず守るが、条文の抜け穴は躊躇なく使う弁護士。',
    secret: '過去の被害者から真相究明の依頼を受けている。',
    palette: { hair: '#14141a', skin: '#f2d6c4', coat: '#1d1d26', accent: '#b8293d', pants: '#16161e' },
    favoriteRooms: ['common_lounge', 'library', 'main_hall'],
    rules: { keepsContracts: true },
  },
  {
    id: 'npc_04_mido', gender: 'm', age: 45, job: '経営者',
    profile: '強欲な経営者。派閥を作り、高額の取引で人を動かす。',
    secret: 'CROWN計画の研究に出資していた。',
    palette: { hair: '#3a2c22', skin: '#e8c6a8', coat: '#5a1f24', accent: '#d8b25a', pants: '#2a1a1a' },
    favoriteRooms: ['living_lounge', 'common_lounge', 'shop'],
    rules: { profitFirst: true },
  },
  {
    id: 'npc_05_shiraishi', gender: 'f', age: 24, job: '心理学研究者',
    profile: '誰にでも親しげに話しかける心理学研究者。複数の同盟を同時に結ぶ。',
    secret: '「裏切り」の研究をしている。',
    palette: { hair: '#e6e2dc', skin: '#f6e0d2', coat: '#dfe6ee', accent: '#7aa0c8', pants: '#8c96a8' },
    favoriteRooms: ['common_lounge', 'dining', 'garden'],
    rules: {},
  },
  {
    id: 'npc_06_kiryu', gender: 'm', age: 21, job: 'プロゲーマー',
    profile: '負けず嫌いのプロゲーマー。一度仲間と認めた相手には忠実。',
    secret: '過去の大会のゲーム資料を持っている。',
    palette: { hair: '#2b2b33', skin: '#f0d0b8', coat: '#202a24', accent: '#4fd08a', pants: '#1a1f1c' },
    favoriteRooms: ['game_room', 'main_arena', 'dining'],
    rules: {},
  },
  {
    id: 'npc_07_tachibana', gender: 'f', age: 38, job: '医師',
    profile: '弱い立場の人を放っておけない医師。仲間を売る取引は大金でも断る。',
    secret: '過去の被害者の担当医だった。',
    palette: { hair: '#5a3a2a', skin: '#f2d8c6', coat: '#eef0f2', accent: '#6fa8a0', pants: '#4a5058' },
    favoriteRooms: ['infirmary', 'garden', 'dining'],
    rules: { refuseBetrayFriends: true },
  },
  {
    id: 'npc_08_dojima', gender: 'm', age: 52, job: '元刑事',
    profile: '慎重で観察眼の鋭い元刑事。施設のあちこちを調べて回る。',
    secret: '過去の失踪事件を追っている。',
    palette: { hair: '#6a6660', skin: '#deb898', coat: '#4a4038', accent: '#a89878', pants: '#2e2a26' },
    favoriteRooms: ['entrance', 'main_hall', 'bathroom'],
    rules: {},
  },
  {
    id: 'npc_09_asahina', gender: 'f', age: 19, job: '大学生',
    profile: '人懐っこい大学生。一度聞いた話は決して忘れない。',
    secret: '兄が過去の大会に参加していた。',
    palette: { hair: '#b8743a', skin: '#f8e0cc', coat: '#e8b8b0', accent: '#f0e0a0', pants: '#5a4a6a' },
    favoriteRooms: ['dining', 'garden', 'living_lounge'],
    rules: {},
  },
  {
    id: 'npc_10_kujo', gender: 'm', age: 35, job: 'ギャンブラー',
    profile: 'ブラフを好むギャンブラー。元はプロ雀士。危険な賭けほど楽しむ。',
    secret: '過去の大会の参加者だった。',
    palette: { hair: '#101014', skin: '#e8ccb4', coat: '#2a2440', accent: '#9a6ad0', pants: '#18161e' },
    favoriteRooms: ['game_room', 'common_lounge', 'observatory'],
    rules: {},
  },
  {
    id: 'npc_11_kisaragi', gender: 'f', age: 29, job: '俳優',
    profile: '華やかな俳優。演技で本心を隠し、利益を優先する。',
    secret: '主催者から秘密の依頼を受けている。',
    palette: { hair: '#4a1a2a', skin: '#f8dccc', coat: '#6a1a38', accent: '#e8c0d0', pants: '#2a1020' },
    favoriteRooms: ['living_lounge', 'bathroom', 'common_lounge'],
    rules: { profitFirst: true },
  },
  {
    id: 'npc_12_kuze', gender: 'm', age: 62, job: '元大学教授',
    profile: '大学を退職した博識な元教授。古い書物や建物の構造に強い興味を示す。',
    secret: 'CROWN計画の創設者の一人。',
    palette: { hair: '#d8d4cc', skin: '#e8ccb0', coat: '#3a3a30', accent: '#b8a878', pants: '#2a2a24' },
    favoriteRooms: ['library', 'observatory', 'main_hall'],
    rules: {},
  },
];

// ---- 表示名（内部ID → 名前）。改名は npc_names.json だけで行う ----
export interface DisplayName { name: string; short: string; kana: string }
type NameEntry = { status?: string; [lang: string]: Partial<DisplayName> | string | undefined };
interface NamesJson { hero: Record<string, Partial<Record<'m' | 'f', string>>>; characters: Record<string, NameEntry> }
const NAMES = namesJson as unknown as NamesJson;

/** その言語での表示名。未設定の項目は日本語の表示名を使う */
export function displayName(id: string, lang: string = getLang()): DisplayName {
  const e = NAMES.characters[id];
  const ja = (e?.ja ?? {}) as Partial<DisplayName>;
  const lo = (e?.[lang] ?? {}) as Partial<DisplayName>;
  const name = lo.name || ja.name || id;
  return { name, short: lo.short || ja.short || name, kana: lo.kana ?? (lang === 'ja' ? ja.kana ?? '' : '') };
}

/** 改名の状態（original＝旧名のまま、renamed＝差し替え済み） */
export function nameStatus(id: string): string {
  return NAMES.characters[id]?.status ?? 'original';
}

export const NAMED_IDS = Object.keys(NAMES.characters);

/**
 * 文中の名前の差し込み。{name:npc_02_kanzaki}（姓名）、{short:…}（呼び名）、{kana:…}（読み）を、いまの表示名に置き換える。
 * 名前を文に直接書くと改名の時に漏れるので、データの文章ではこの書き方を使う。
 * 日本語の文中の {name:…} は空白を詰める（画面の名札など .name は空白入りのまま）。
 */
export function fillNames(text: string, lang: string = getLang()): string {
  return text.replace(/\{(name|short|kana):([a-z0-9_]+)\}/g, (all, k: keyof DisplayName, id: string) => {
    if (!(id in NAMES.characters)) return all;
    const v = displayName(id, lang)[k];
    // 日本語の文中では姓と名の間の空白を詰める（「神崎 怜」→「神崎怜」）。カタカナの名前は表に「・」で書く
    return k === 'name' && lang === 'ja' ? v.replace(/[\s\u3000]+/g, '') : v;
  });
}

/** 音声で名乗っている名前が、いまの表示名（日本語、空白を詰めた姓名）と同じか。違えば録り直し前の古い音声 */
export function saysCurrentName(id: string, spokenName: string): boolean {
  if (!(id in NAMES.characters)) return true;
  const strip = (x: string) => x.replace(/[\s\u3000・]+/g, '');
  return strip(displayName(id, 'ja').name) === strip(spokenName);
}

// 仕様 v03 の 02_NPC_PROFILES.json を正とし、能力・人格値・基準価格・秘密の解放条件はここから読む（能力と性格の出所は 1 か所）
interface ProfileJson {
  id: string;
  tier?: 'normal' | 'strong';
  ability: Stats;
  personality: { greed: number; loyalty: number; ambition: number; morality: number; risk: number; exploration: number; dominance: number; independence: number; initiative: number; followership: number };
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

export const NPCS: CharacterDef[] = BASE.map((b) => {
  const p = PROFILES[b.id];
  if (!p) throw new Error(`npc_profiles.json に ${b.id} がない`);
  const { exploration, ...per } = p.personality;
  const def = { ...b, tier: p.tier ?? 'normal', stats: { ...p.ability }, personality: { ...per, explore: exploration } } as CharacterDef;
  for (const k of ['name', 'short', 'kana'] as const) {
    Object.defineProperty(def, k, { get: () => displayName(b.id)[k], enumerable: true });
  }
  return def;
});

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

/** 主人公の名前の初期値（名前の入力欄に入る。npc_names.json の hero） */
export const DEFAULT_HERO_NAMES = {
  get m(): string {
    return NAMES.hero[getLang()]?.m || NAMES.hero.ja?.m || '';
  },
  get f(): string {
    return NAMES.hero[getLang()]?.f || NAMES.hero.ja?.f || '';
  },
};
