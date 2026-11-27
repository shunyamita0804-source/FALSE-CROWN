/**
 * 説明を出す場面（第何競技か、誰が出るか）。音声付きの説明が、収録の前提と合うかを比べるのに使う。
 * 順番は日程から数える（2 周目以降に競技の並びが変わっても、その日の並びで決まる）。
 */
import { G } from '../app/game';
import { aliveIds } from '../core/state';
import { isFinalDay } from '../core/tournament';
import { scheduleFor } from '../data/config';
import type { TutCtx } from './voicetut';

export function sceneFor(matchId: string, players?: string[]): TutCtx {
  const s = G.state;
  if (!s) return {};
  const who = players ?? aliveIds(s);
  if (scheduleFor(s.day).main !== matchId) return { players: who };
  if (isFinalDay(s.day)) return { order: 'final', players: who };
  // メインマッチの順番：DAY 1 から今日までに、メインマッチがある日の数
  let n = 0;
  for (let d = 1; d <= s.day; d++) if (scheduleFor(d).main) n++;
  return { order: n, players: who };
}
