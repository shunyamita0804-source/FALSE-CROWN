import { ALL_IDS, type CharId } from '../src/data/characters';
import { engineOf, newSlot, runToEnd } from '../src/core/runner';
import { newGame } from '../src/core/state';
import type { GameState } from '../src/core/types';

export function freshState(seed: number): GameState {
  return newGame({ gender: 'm', name: '試験 太郎', seed });
}

/** CPU のみで 1 試合を実行し、得点と順位を返す（hero も NPC と同じ AI で動かす） */
export function simulate(id: string, seed: number, players: CharId[] = ALL_IDS, opts?: Record<string, unknown>) {
  const state = freshState(seed);
  const slot = newSlot(state, id, players, 'free', opts);
  runToEnd(state, slot);
  const engine = engineOf(id);
  return { state, slot, scores: engine.scores(slot.state), ranking: engine.ranking(slot.state) };
}
