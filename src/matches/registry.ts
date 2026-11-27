import type { MatchEngine } from './types';
import { M01 } from './m01';
import { M02 } from './m02';
import { P01 } from './p01';
import { P02 } from './p02';

/** 実装済みの競技。未実装の競技は IMPLEMENTED に含めない（完成扱いしない）。 */
export const MATCHES: Record<string, MatchEngine> = {
  m01: M01,
  m02: M02,
  p01: P01,
  p02: P02,
};

export interface CatalogEntry {
  id: string;
  name: string;
  group: 'main' | 'prison' | 'hidden' | 'sub';
  players: string;
}

/** 全35競技の一覧（仕様書の ID と名称） */
export const CATALOG: CatalogEntry[] = [
  { id: 'm01', name: '三国の盟約', group: 'main', players: '12人' },
  { id: 'm02', name: '黄金の競売', group: 'main', players: '11人' },
  { id: 'm03', name: '仮面の議会', group: 'main', players: '10人' },
  { id: 'm04', name: '鉄道王国', group: 'main', players: '9人' },
  { id: 'm05', name: '運命の契約', group: 'main', players: '8人' },
  { id: 'm06', name: '七つの塔', group: 'main', players: '7人' },
  { id: 'm07', name: '均衡の崩壊', group: 'main', players: '6人' },
  { id: 'm08', name: '五人の暗号', group: 'main', players: '5人' },
  { id: 'm09', name: '四王の戦場', group: 'main', players: '4人' },
  { id: 'm10', name: '裏切りの三角形', group: 'main', players: '3人' },
  { id: 'm11', name: '最後の王座', group: 'main', players: '2人' },
  { id: 'p01', name: '偽りの数字', group: 'prison', players: '4人' },
  { id: 'p02', name: '四つの金庫', group: 'prison', players: '4人' },
  { id: 'p03', name: '禁断の合計', group: 'prison', players: '4人' },
  { id: 'p04', name: '真実の証言', group: 'prison', players: '3人' },
  { id: 'p05', name: '毒杯の選択', group: 'prison', players: '3人' },
  { id: 'p06', name: '記憶回廊', group: 'prison', players: '3人' },
  { id: 'p07', name: '最後の硬貨', group: 'prison', players: '3人' },
  { id: 'p08', name: '双対の天秤', group: 'prison', players: '2人' },
  { id: 'p09', name: '鏡の決闘', group: 'prison', players: '2人' },
  { id: 'p10', name: '黒と白', group: 'prison', players: '2人' },
  { id: 'h01', name: '賢者の金庫', group: 'hidden', players: '1人' },
  { id: 'h02', name: '月下の賭場', group: 'hidden', players: '対NPC' },
  { id: 'h03', name: '鏡の迷宮', group: 'hidden', players: '1人' },
  { id: 'h04', name: '囚人の遺言', group: 'hidden', players: '1人' },
  { id: 'h05', name: '時の牢獄', group: 'hidden', players: '1人' },
  { id: 'h06', name: '影の対戦者', group: 'hidden', players: '対NPC' },
  { id: 'h07', name: '十二の証明', group: 'hidden', players: '1人' },
  { id: 'h08', name: '神の方程式', group: 'hidden', players: '1人' },
  { id: 's01', name: '数字当て', group: 'sub', players: '対NPC' },
  { id: 's02', name: '五目並べ', group: 'sub', players: '対NPC' },
  { id: 's03', name: 'ミニリバーシ', group: 'sub', players: '対NPC' },
  { id: 's04', name: '記憶カード', group: 'sub', players: '対NPC' },
  { id: 's05', name: '金貨の読み合い', group: 'sub', players: '対NPC' },
  { id: 's06', name: '暗号書庫', group: 'sub', players: '1人' },
];

export const isImplemented = (id: string) => id in MATCHES;
