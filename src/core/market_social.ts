/**
 * 市場予測（試作）の会話の後始末：台詞を選び、競技の中の出来事（見せ合い、嘘が分かった、約束を破った）を関係に反映する。
 * 関係が上がるのは、同じ相手と同じ競技で 1 回だけ（同じ会話を繰り返して関係を上げ続けられない）。
 * 下がる方（嘘、約束破り）は、起きた分だけ。主人公も NPC も同じ決まり。
 */
import LINES from '../data/market_lines.json';
import type { CharId } from '../data/characters';
import type { MkState } from '../matches/mk';
import { adjustRel } from './state';
import type { GameState } from './types';

type LineKey = keyof (typeof LINES)['generic'];
const TABLE = LINES as unknown as Record<string, Partial<Record<LineKey, string[]>>>;

/** 人物の台詞（無ければ共通の台詞）。vars で {good} などを埋める */
export function mkLine(who: CharId, key: LineKey, vars: Record<string, string | number> = {}, pick = 0): string {
  const list = TABLE[who]?.[key] ?? TABLE.generic[key] ?? [''];
  const raw = list[Math.abs(pick) % list.length];
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}

/** 競技の出来事を関係へ反映する（何度呼んでも、同じ出来事は 1 回だけ） */
export function applyMarketSocial(state: GameState, s: MkState & { socialDone?: number; bonded?: string[] }): void {
  const from = s.socialDone ?? 0;
  const bonded = (s.bonded ??= []);
  const alive = (id: CharId) => !!state.actors[id];
  for (let i = from; i < s.events.length; i++) {
    const e = s.events[i];
    if (!alive(e.a) || !alive(e.b)) continue;
    const once = (k: string) => { if (bonded.includes(k)) return false; bonded.push(k); return true; };
    switch (e.kind) {
      case 'swap':
        if (once(`swap|${[e.a, e.b].sort().join('|')}`)) { adjustRel(state, e.a, e.b, { trust: 2, like: 1 }); adjustRel(state, e.b, e.a, { trust: 2, like: 1 }); }
        break;
      case 'honest':
        // 言われた側（b）が、言った側（a）を少し信じるようになる
        if (once(`honest|${e.b}|${e.a}`)) adjustRel(state, e.b, e.a, { trust: 2 });
        break;
      case 'lie_found':
        adjustRel(state, e.b, e.a, { trust: -8, hostility: 3, wary: 4 });
        break;
      case 'broken':
        // a が約束を破った側
        adjustRel(state, e.b, e.a, { trust: -6, hostility: 2 });
        break;
      default:
        break;
    }
  }
  s.socialDone = s.events.length;
}
