import type { MatchEngine } from './types';
import { M01 } from './m01';
import { M02 } from './m02';
import { P01 } from './p01';
import { P02 } from './p02';
import { M03 } from './m03';
import { P03 } from './p03';
import { M04 } from './m04';
import { P04 } from './p04';
import { M05 } from './m05';
import { P05 } from './p05';
import { M06 } from './m06';
import { P06 } from './p06';
import { P07 } from './p07';
import { M08 } from './m08';
import { P08 } from './p08';
import { M09 } from './m09';
import { P09 } from './p09';
import { M07 } from './m07';

/** 実装済みの競技。未実装の競技は IMPLEMENTED に含めない（完成扱いしない）。 */
export const MATCHES: Record<string, MatchEngine> = {
  m01: M01,
  m02: M02,
  m03: M03,
  m04: M04,
  p01: P01,
  p02: P02,
  p03: P03,
  p04: P04,
  m05: M05,
  p05: P05,
  m06: M06,
  p06: P06,
  m07: M07,
  p07: P07,
  m08: M08,
  p08: P08,
  m09: M09,
  p09: P09,
};

export interface CatalogEntry {
  id: string;
  name: string;
  group: 'main' | 'prison' | 'hidden' | 'sub';
  players: string;
}

/** 全35競技の一覧（v11 の ID と名称。docs/specs/v11/matches.csv と一致させる） */
export const CATALOG: CatalogEntry[] = [
  { id: 'm01', name: 'ピース・アセンブル', group: 'main', players: '12人' },
  { id: 'm02', name: 'フラッグ・フラッシュ', group: 'main', players: '11人' },
  { id: 'm03', name: 'ツイン・リンク', group: 'main', players: '10人' },
  { id: 'm04', name: '鉄道王国・改', group: 'main', players: '9人' },
  { id: 'm05', name: 'ナンバー・リレー', group: 'main', players: '8人' },
  { id: 'm06', name: 'クロス・カード', group: 'main', players: '7人' },
  { id: 'm07', name: '六角領域', group: 'main', players: '6人' },
  { id: 'm08', name: 'バリケード', group: 'main', players: '5人' },
  { id: 'm09', name: '四王の戦場・改', group: 'main', players: '4人' },
  { id: 'm10', name: 'トライアングル', group: 'main', players: '3人' },
  { id: 'm11', name: '最後の王座', group: 'main', players: '2人' },
  { id: 'p01', name: '数字の鎖', group: 'prison', players: '4人' },
  { id: 'p02', name: '瞬間記憶', group: 'prison', players: '4人' },
  { id: 'p03', name: 'スピードカード', group: 'prison', players: '4人' },
  { id: 'p04', name: '消えた図形', group: 'prison', players: '3人' },
  { id: 'p05', name: '21の攻防', group: 'prison', players: '3人' },
  { id: 'p06', name: '一筆の迷宮', group: 'prison', players: '3人' },
  { id: 'p07', name: 'ブラック＆ホワイト', group: 'prison', players: '3人' },
  { id: 'p08', name: '数字の天秤', group: 'prison', players: '2人' },
  { id: 'p09', name: '鏡の決闘', group: 'prison', players: '2人' },
  { id: 'p10', name: '最後の一手', group: 'prison', players: '2人' },
  { id: 'h01', name: '賢者の金庫', group: 'hidden', players: '1人' },
  { id: 'h02', name: '月下の賭場', group: 'hidden', players: '2人' },
  { id: 'h03', name: '鏡の迷宮', group: 'hidden', players: '1人' },
  { id: 'h04', name: '囚人の遺言', group: 'hidden', players: '1人' },
  { id: 'h05', name: '時の牢獄', group: 'hidden', players: '1人' },
  { id: 'h06', name: '影の対戦者', group: 'hidden', players: '2人' },
  { id: 'h07', name: '十二の証明', group: 'hidden', players: '1人' },
  { id: 'h08', name: '神の方程式', group: 'hidden', players: '1人' },
  { id: 's01', name: '数字当て', group: 'sub', players: '2人' },
  { id: 's02', name: '五目並べ', group: 'sub', players: '2人' },
  { id: 's03', name: 'ミニリバーシ', group: 'sub', players: '2人' },
  { id: 's04', name: '記憶カード', group: 'sub', players: '2人' },
  { id: 's05', name: 'ダイスパズル', group: 'sub', players: '2人' },
  { id: 's06', name: 'ミニジグソー', group: 'sub', players: '1〜2人' },
];

/**
 * 画面の確認が済んでいない競技。確認が済むまで本編の日程には使わない（完成扱いにしない）。
 */
export const LEGACY = new Set<string>([]);
export const isLegacy = (id: string) => LEGACY.has(id) && id in MATCHES;

/** v11 のルールで遊べる競技か */
export const isImplemented = (id: string) => id in MATCHES && !LEGACY.has(id);
