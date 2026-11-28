import type { CharId } from '../data/characters';
import type { Difficulty } from '../data/config';
import type { RngState } from './rng';

export type Dir = 'down' | 'up' | 'left' | 'right';

export type Phase =
  | 'prologue'
  | 'morning'
  | 'gather'
  | 'rules'
  | 'strategy'
  | 'main'
  | 'reward'
  | 'house'
  | 'gatherPrison'
  | 'prison'
  | 'elimination'
  | 'night'
  | 'curfew'
  | 'final'
  | 'ending';

export type House = 'living' | 'prison';

/** A→B の関係（方向付き、内部値は非公開） */
export interface Relation {
  like: number; // -100..100
  trust: number; // 0..100
  wary: number; // 0..100
  debt: number; // 恩義 0..100
  hostility: number; // 0..100
  threat: number; // 0..100
}

export interface Known {
  conf: number; // 0..1 確度
  from: CharId | 'self' | 'public';
  day: number;
}

export interface Pos {
  room: string;
  x: number;
  y: number;
  dir: Dir;
}

export type NpcGoalKind = 'wander' | 'goto' | 'talk' | 'explore' | 'rest' | 'shop' | 'approachHero' | 'follow' | 'idle';

export interface NpcGoal {
  kind: NpcGoalKind;
  room?: string;
  target?: CharId;
  spot?: { x: number; y: number };
  until: number; // simTime
  note?: string;
  /** 向かっている席、座っている席の id（world/seats.ts）。'-' は「席を使わない」と決めた印 */
  seat?: string;
  /** 席へ歩き直した回数 */
  tries?: number;
  /** 目当ての部屋に着いたあと、入口から部屋の中の目当ての地点（spot）まで歩き終えた印 */
  inside?: boolean;
  /** 目当ての部屋に入った時刻（simTime）。人にふさがれて席や地点へ着けない時、待つのをやめる目安 */
  since?: number;
}

export interface Actor {
  /** 移動の入力に近い 4 方向（向き。主人公のみ、毎フレーム設定。保存しても読み込み直後に上書きされる） */
  intent?: Dir;
  /** 押している移動の入力（スティックかキーボード、斜めを含む。主人公のみ、毎フレーム設定。保存しても読み込み直後に上書きされる） */
  intentV?: { x: number; y: number };
  id: CharId;
  alive: boolean;
  eliminatedDay?: number;
  pieces: number;
  silver: number;
  house: House | null;
  pos: Pos;
  /** 経路（同じ部屋内のタイル列） */
  path: { x: number; y: number }[];
  /** 部屋をまたぐ経路（部屋IDの列） */
  route: string[];
  moving: boolean;
  /** 移動中の1歩（次のタイルと進捗 0..1） */
  step?: { x: number; y: number; p: number };
  rel: Partial<Record<CharId, Relation>>;
  knows: Record<string, Known>;
  items: Record<string, number>;
  goal?: NpcGoal;
  nextThink: number;
  talkCd: Partial<Record<CharId, number>>;
  /** 調べた地点（探索の重複防止） */
  searched: string[];
  /** 表示用の吹き出し */
  bubble?: { text: string; until: number };
  busyUntil?: number;
  /** 主人公が近づいてきたので立ち止まって待つ時刻まで（NPC のみ） */
  waitUntil?: number;
  /** 次に立ち止まって待てる時刻（待ち続けないための間隔） */
  waitCd?: number;
  /** 座っている席（建物改修の家具。world/furniture.ts の席。座っている間は pos がその席の立つ位置のマス） */
  seat?: { room: string; id: string };
}

export type DealKind =
  | 'info_sell' // 情報販売
  | 'info_swap' // 情報交換
  | 'alliance' // 同盟
  | 'nonaggression' // 不可侵
  | 'plan' // 作戦提示（競技内の具体的行動）
  | 'poach' // 引抜き
  | 'loan' // 貸借
  | 'gift' // 贈与
  | 'pledge'; // 緩い約束「次は協力しよう」（生活中。支払いも行動の条件もない。破っても約束破りにならない）

export type DealStatus = 'active' | 'fulfilled' | 'broken' | 'refused' | 'expired' | 'cancelled';

export interface PlanTerm {
  /** 競技ID */
  match: string;
  /** 競技固有の行動コード（例: m01 の "attack:t3"） */
  code: string;
  label: string;
  /** 対象ラウンド（指定なしは試合全体） */
  round?: number;
}

export interface Deal {
  id: string;
  day: number;
  from: CharId;
  to: CharId;
  kind: DealKind;
  /** 合意時に from→to へ移動する数（負なら to→from） */
  payNow: number;
  /** 条件成立後に from→to へ支払う約束 */
  payOnSuccess: number;
  plan?: PlanTerm;
  /** plan を実行する側 */
  performer?: CharId;
  /** 見返りとして相手側が実行する作戦 */
  planBack?: PlanTerm;
  infoId?: string;
  infoBackId?: string;
  target?: CharId; // 引抜き・告発の対象
  /** 期限（この日のこのフェーズ終了まで） */
  untilDay: number;
  status: DealStatus;
  witnesses: CharId[];
  createdAt: number;
  note?: string;
  paidLater?: boolean;
}

export interface Info {
  id: string;
  kind: 'rumor' | 'fact' | 'clue' | 'result' | 'deal' | 'betrayal' | 'profile';
  text: string;
  /** 内部のみ：真偽 */
  truth: boolean;
  about: CharId[];
  day: number;
  source: CharId | 'public' | 'host' | 'world';
  /** 情報の価値（売買の基準） */
  value: number;
  tags: string[];
  data?: Record<string, unknown>;
}

export interface Fact {
  t: number;
  day: number;
  phase: Phase;
  type: string;
  actors: CharId[];
  text: string;
  data?: Record<string, unknown>;
}

export interface DayRecord {
  day: number;
  main: string;
  mainRanking: CharId[];
  mainScores: Partial<Record<CharId, number>>;
  prisonGame: string | null;
  prisonRanking: CharId[];
  prisonScores: Partial<Record<CharId, number>>;
  eliminated: CharId[];
  rewards: Partial<Record<CharId, number>>;
  /** 救いのメダルの結果（v11） */
  rescue?: import('./rescue').RescueState;
}

export interface MatchSlot {
  id: string;
  day: number;
  kind: 'main' | 'prison' | 'hidden' | 'sub' | 'final' | 'tiebreak' | 'free';
  players: CharId[];
  state: unknown;
  /** 競技内の残り時間（交渉など） */
  stageLeft: number;
  practice?: boolean;
}

export interface GameState {
  version: number;
  seed: number;
  rng: RngState;
  difficulty: Difficulty;
  hero: { gender: 'm' | 'f'; name: string };
  day: number;
  phase: Phase;
  phaseLeft: number;
  simTime: number;
  actors: Record<CharId, Actor>;
  deals: Deal[];
  infos: Record<string, Info>;
  facts: Fact[];
  flags: Record<string, number | boolean | string>;
  /** 既読イベント */
  seen: string[];
  /** 取得済み報酬（二重取り防止） */
  claimed: string[];
  history: DayRecord[];
  match: MatchSlot | null;
  /** 競技会場への集合移動（集合案内から会場に着くまで。core/gather.ts） */
  gather?: import('./gather').GatherState;
  /** 当日のメイン結果（棟分けまで） */
  today: { mainRanking?: CharId[]; mainScores?: Partial<Record<CharId, number>>; prisonRanking?: CharId[]; prisonScores?: Partial<Record<CharId, number>>; teams?: Record<string, CharId[]>; rescue?: import('./rescue').RescueState; rescuePromises?: import('./rescue').RescuePromise[] };
  counter: number;
  /** 台詞の使用履歴（直近を避ける） */
  lineHist: Record<string, string[]>;
  /** 関係変動の適用済みイベントID（二重適用防止） */
  relEvents: string[];
  ending?: string;
  /** 掲示板 */
  board: { day: number; text: string }[];
  /** プレイヤー向けの通知ログ */
  log: { t: number; day: number; text: string; kind?: string }[];
  /** 席の予約（world/seats.ts。鍵は seatKey(部屋, 席)、値は取っている人）。古いセーブには無い */
  seatsTaken?: Record<string, CharId>;
  /** 競技の作戦時間（ルール説明の後、開始前の相談。core/strategy.ts）。古いセーブには無い */
  strategy?: import('./strategy').StrategyState;
  /** 監獄棟の房の割り当て（world/cells.ts。人物 → cellKey(部屋, 房)）。古いセーブには無い */
  cells?: Partial<Record<CharId, string>>;
  /** 個室の割り当て（world/rooms.ts。人物 → 寝起きする部屋）。古いセーブには無い */
  rooms?: Partial<Record<CharId, string>>;
}
