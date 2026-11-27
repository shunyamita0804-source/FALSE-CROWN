/**
 * 調整用の数値テーブル（すべて暫定値。docs/decisions.md に由来を記録）。
 * ゲームロジックはここを参照し、値の変更だけで調整できるようにする。
 */
export const CONFIG = {
  /** 各フェーズの実時間（ミリ秒） */
  phaseTime: {
    morning: 5 * 60_000,
    strategy: 3 * 60_000,
    living: 7 * 60_000,
    prison: 5 * 60_000,
    night: 3 * 60_000,
  },
  /** 時間の倍率（デバッグ・試遊用設定で変更可） */
  economy: {
    initialPieces: 3,
    /** M01 の順位報酬（監獄送りは 0） */
    m01Rewards: [5, 3, 3, 2, 2, 2, 1, 1],
    /** DAY02 以降、生活棟の上位から順に適用 */
    laterRewards: [5, 3, 3, 2, 2, 2, 1, 1],
    infoPrice: [1, 3] as const,
    practicePrice: 1,
    specialKeyPrice: [3, 5] as const,
  },
  /** 日程表：開始人数と監獄人数（DAY11 は決勝） */
  schedule: [
    { day: 1, players: 12, prison: 4, main: 'm01', prisonGame: 'p01' },
    { day: 2, players: 11, prison: 4, main: 'm02', prisonGame: 'p02' },
    { day: 3, players: 10, prison: 4, main: 'm03', prisonGame: 'p03' },
    { day: 4, players: 9, prison: 3, main: 'm04', prisonGame: 'p04' },
    { day: 5, players: 8, prison: 3, main: 'm05', prisonGame: 'p05' },
    { day: 6, players: 7, prison: 3, main: 'm06', prisonGame: 'p06' },
    { day: 7, players: 6, prison: 3, main: 'm07', prisonGame: 'p07' },
    { day: 8, players: 5, prison: 2, main: 'm08', prisonGame: 'p08' },
    { day: 9, players: 4, prison: 2, main: 'm09', prisonGame: 'p09' },
    { day: 10, players: 3, prison: 2, main: 'm10', prisonGame: 'p10' },
    { day: 11, players: 2, prison: 0, main: 'm11', prisonGame: null },
  ] as const,
  npc: {
    /** NPC の思考間隔（シミュレーション時間ミリ秒） */
    thinkInterval: 1500,
    /** 歩行速度（タイル/秒） */
    walkSpeed: 2.1,
    heroWalkSpeed: 4.0,
    /** 会話の最短間隔（同じ相手） */
    talkCooldown: 80_000,
    /** プレイヤーに話しかける最短間隔 */
    approachHeroCooldown: 90_000,
    /** 主人公が近づいた時に立ち止まって待つ時間と、次に待つまでの間隔（ミリ秒） */
    waitForHero: 7000,
    waitForHeroCooldown: 12_000,
  },
  /** 難易度ごとの NPC 思考の深さ・誤差（隠し情報は解禁しない） */
  difficulty: {
    easy: { depth: 0, noise: 1.6, memoryLoss: 0.25 },
    normal: { depth: 1, noise: 1.0, memoryLoss: 0.12 },
    hard: { depth: 2, noise: 0.6, memoryLoss: 0.05 },
    expert: { depth: 3, noise: 0.3, memoryLoss: 0.0 },
  },
};

export type Difficulty = keyof typeof CONFIG.difficulty;
export type MatchId = string;

/** 決勝の日（日程の最後の日）。日程の長さが変わっても、ここから数える */
export const FINAL_DAY: number = CONFIG.schedule[CONFIG.schedule.length - 1].day;

export function scheduleFor(day: number) {
  return CONFIG.schedule.find((s) => s.day === day) ?? CONFIG.schedule[CONFIG.schedule.length - 1];
}
