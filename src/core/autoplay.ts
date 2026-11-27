/**
 * 画面なしで大会を進める（自動対戦テスト、バランス検証、開発者用の「任意の日程から開始」に使う）。
 * プレイヤーも NPC と同じ AI（平均的な能力値）で動かす。勝敗の補正や結果の固定は行わない。
 */
import { autoRescue } from './rescue';
import { isImplemented } from '../matches/registry';
import { fastForward } from '../npc/brain';
import { settlePlans } from '../npc/negotiation';
import { phaseDuration } from './clock';
import type { CharId } from '../data/characters';
import { engineOf, newSlot, resolveTies, runToEnd } from './runner';
import { aliveIds } from './state';
import { applyMainResult, applyPrisonResult, endDay, gatherAt, mainMatchId, moveToHouses, prisonMatchId, startMorning } from './tournament';
import type { GameState, Phase } from './types';
import { placeIn } from '../world/sim';

export interface AutoOpts {
  /** 自由時間の NPC 行動を再現する（false なら省略して高速化） */
  free?: boolean;
}

async function rank(s: GameState, id: string, players: CharId[], kind: 'main' | 'prison'): Promise<{ ranking: CharId[]; scores: Partial<Record<CharId, number>> }> {
  const slot = newSlot(s, id, players, kind);
  runToEnd(s, slot);
  const engine = engineOf(id);
  const ranking = await resolveTies(s, engine.ranking(slot.state), async (tb) => runToEnd(s, tb));
  settlePlans(s, id, (plan, actor, obs) => engine.checkPlan?.(slot.state, plan, actor, obs) ?? 'unknown');
  return { ranking, scores: engine.scores(slot.state) };
}

const ORDER: Phase[] = ['morning', 'rules', 'main', 'reward', 'house', 'prison', 'elimination', 'night', 'curfew'];

/**
 * 現在のフェーズから、指定のフェーズ（の開始時点）まで自動で進める。
 * 戻り値：到達できたか（プレイヤーが脱落した、未実装の競技に達した場合は false）。
 */
export async function autoAdvance(s: GameState, untilDay: number, untilPhase: Phase, opts: AutoOpts = {}): Promise<boolean> {
  const free = (ms: number) => {
    if (opts.free) fastForward(s, ms);
  };
  for (let guard = 0; guard < 400; guard++) {
    if (!s.actors.hero.alive) return false;
    if (s.day === untilDay && s.phase === untilPhase) return true;
    if (s.day > untilDay) return false;
    switch (s.phase) {
      case 'prologue':
        s.phase = 'morning';
        break;
      case 'morning':
        if (!isImplemented(mainMatchId(s.day))) return false;
        startMorning(s);
        free(phaseDuration('morning'));
        s.phase = 'rules';
        break;
      case 'rules':
        gatherAt(s, 'main_arena');
        s.phase = 'main';
        break;
      case 'strategy':
        s.phase = 'main';
        break;
      case 'main': {
        const r = await rank(s, mainMatchId(s.day), aliveIds(s), 'main');
        applyMainResult(s, r.ranking, r.scores);
        s.phase = 'reward';
        break;
      }
      case 'reward':
        autoRescue(s);
        moveToHouses(s);
        s.phase = 'house';
        break;
      case 'house':
        free(phaseDuration('house'));
        s.phase = 'prison';
        break;
      case 'prison': {
        const id = prisonMatchId(s.day);
        const prisoners = aliveIds(s).filter((p) => s.actors[p].house === 'prison');
        if (id && prisoners.length >= 2) {
          if (!isImplemented(id)) return false;
          const r = await rank(s, id, prisoners, 'prison');
          applyPrisonResult(s, r.ranking, r.scores);
        }
        s.phase = 'elimination';
        break;
      }
      case 'elimination':
        s.phase = 'night';
        break;
      case 'night':
        for (const id of aliveIds(s)) s.actors[id].house = null;
        free(phaseDuration('night'));
        s.phase = 'curfew';
        break;
      case 'curfew':
        for (const id of aliveIds(s)) placeIn(s, id, `bedroom_${id}`);
        endDay(s);
        s.phase = 'morning';
        break;
      default:
        return false;
    }
    s.phaseLeft = 0;
    delete s.flags.phaseKey;
  }
  return false;
}

export const PHASE_ORDER = ORDER;
