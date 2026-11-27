/**
 * 開発者用テストメニュー（開発版のみ。製品版ビルドには含めない：main.ts が VITE_CHANNEL で読み込みを分ける）。
 * - 競技を単体で試す（本編の状態とは独立）
 * - 任意の日程・フェーズから開始（そこまでを自動対戦で進める）
 * - 監獄マッチ・脱落の検証（開発用の配置変更であることを明示）
 * ここでの操作は検証専用で、通常のプレイには影響しない。
 */
import { G } from '../app/game';
import { autoAdvance } from '../core/autoplay';
import { engineOf, newSlot, resolveTies, runToEnd } from '../core/runner';
import { newGame, rel } from '../core/state';
import type { GameState, Phase } from '../core/types';
import { DEFAULT_HERO_NAMES, NPC_IDS, type CharId } from '../data/characters';
import { CONFIG, scheduleFor } from '../data/config';
import { t } from '../i18n/i18n';
import { phaseDuration } from '../core/clock';
import { CATALOG, isImplemented, isLegacy, MATCHES } from '../matches/registry';
import { saveMeta } from '../save/save';
import { setHeroGender } from '../ui/art';
import { startMorning } from '../core/tournament';
import { ROOMS, ROOM_IDS } from '../world/maps';
import { placeIn } from '../world/sim';
import { alertDialog, button, choose, clear, closeLayer, h, openLayer, panel, toast, type Layer } from '../ui/dom';
import { playMatch } from '../ui/matchui';
import { rankingScreen, rulesScreen } from '../ui/screens';

function fresh(): GameState {
  const s = newGame({ gender: 'm', name: DEFAULT_HERO_NAMES.m, difficulty: G.meta.settings.difficulty });
  setHeroGender('m');
  return s;
}

/** 競技を単体で遊ぶ。独立した状態で行い、本編のセーブには触れない */
async function testMatch(id: string): Promise<void> {
  const eng = MATCHES[id];
  const s = fresh();
  G.state = s;
  const n = Math.min(eng.maxPlayers, id.startsWith('p') ? 4 : 12);
  const players: CharId[] = ['hero', ...NPC_IDS.slice(0, n - 1)];
  await rulesScreen(id, { prison: eng.kind === 'prison' });
  const slot = newSlot(s, id, players, eng.kind === 'prison' ? 'prison' : 'main');
  slot.practice = true;
  await playMatch(slot);
  const notes: string[] = [];
  const ranking = await resolveTies(s, engineOf(id).ranking(slot.state), (tb) => playMatch(tb), (e) => notes.push(e.lottery ? '抽選順位を使用' : `決定戦：${e.result.join(' > ')}`));
  await rankingScreen({ title: `${id.toUpperCase()} ${eng.name}（テスト）`, ranking, scores: engineOf(id).scores(slot.state), cut: eng.kind === 'prison' ? 1 : 4, cutLabel: eng.kind === 'prison' ? t('rank.eliminated') : t('rank.toPrison'), notes, prison: eng.kind === 'prison' });
  G.state = null;
}

/** 開発メニュー。戻り値：本編を開始する状態（null ならタイトルへ戻る） */
export function devMenu(): Promise<GameState | null> {
  return new Promise((resolve) => {
    let layer: Layer;
    const body = h('div', { class: 'col', style: 'gap:12px' });
    const done = (s: GameState | null) => {
      closeLayer(layer);
      resolve(s);
    };
    const startAt = async (day: number, phase: Phase, heroHouse?: 'prison' | 'living') => {
      const s = fresh();
      s.phase = 'morning';
      const ok = await autoAdvance(s, day, phase, { free: true });
      if (!ok) {
        await alertDialog('開始できません', s.actors.hero.alive ? `DAY${day} は未実装の競技を含むため、そこまで進められません。` : '自動対戦の途中で主人公が脱落しました（補正なしのため起こり得ます）。もう一度試してください。');
        return;
      }
      if (heroHouse && s.actors.hero.house && s.actors.hero.house !== heroHouse) {
        // 検証専用：主人公と、反対の棟の最も順位が近い参加者の配置を入れ替える
        const ranking = s.today.mainRanking ?? [];
        const others = ranking.filter((p) => p !== 'hero' && s.actors[p].house === heroHouse);
        const swap = heroHouse === 'prison' ? others[0] : others[others.length - 1];
        if (swap) {
          s.actors[swap].house = s.actors.hero.house;
          s.actors.hero.house = heroHouse;
          s.flags.devSwap = true;
        }
      }
      done(s);
    };
    /** 救いのメダルの検証。DAY1 の順位発表から始め、順位と関係を検証用に並べ替える（報酬は自動対戦の順位のまま） */
    const medalCase = async (kind: 'heroFirst' | 'heroRescued' | 'heroSwapped' | 'npcOnly') => {
      const s = fresh();
      s.phase = 'morning';
      if (!(await autoAdvance(s, 1, 'reward', { free: true }))) return;
      const nPrison = scheduleFor(1).prison;
      const rest = (s.today.mainRanking ?? []).filter((p) => p !== 'hero');
      const nLiving = rest.length + 1 - nPrison;
      const at = kind === 'heroFirst' ? 0 : kind === 'heroRescued' ? rest.length : kind === 'heroSwapped' ? nLiving - 1 : 3;
      const ranking: CharId[] = [...rest.slice(0, at), 'hero', ...rest.slice(at)];
      s.today.mainRanking = ranking;
      ranking.forEach((p, i) => { s.actors[p].house = i < nLiving ? 'living' : 'prison'; });
      const holder = ranking[0];
      const like = (to: CharId) => { const r = rel(s, holder, to); r.like = 90; r.trust = 80; r.debt = 40; };
      if (kind === 'heroRescued') like('hero');
      if (kind === 'heroSwapped' || kind === 'npcOnly') like(ranking[ranking.length - 1]);
      s.flags.devSwap = true;
      done(s);
    };
    /** 任意の施設から開始（DAY1 朝）。検証用に全ての鍵を開けた状態にする */
    const startIn = (roomId: string) => {
      const s = fresh();
      s.phase = 'morning';
      s.flags.phaseKey = '1:morning';
      s.seen.push('S00', 'S01A');
      startMorning(s);
      s.phaseLeft = phaseDuration('morning');
      for (const id of ROOM_IDS) for (const d of ROOMS[id].doors) if (d.lock) s.flags[d.lock] = true;
      s.flags.devUnlockAll = true;
      placeIn(s, 'hero', roomId);
      done(s);
    };
    const render = () => {
      clear(body);
      const groups: [string, string][] = [['main', 'メインマッチ'], ['prison', '監獄マッチ'], ['hidden', '裏ゲーム'], ['sub', 'サブゲーム']];
      body.append(
        h('div', { class: 'note-box' }, '開発版だけの検証用メニューです。製品版には含まれません。ここでの対戦は本編のセーブ・戦績・実績に影響しません。'),
        h('h4', { class: 'gold' }, `競技を単体で試す（実装済み ${CATALOG.filter((c) => isImplemented(c.id)).length} / ${CATALOG.length}）`),
        ...groups.map(([g, label]) => h('div', null, h('div', { class: 'dim small' }, label), h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, CATALOG.filter((c) => c.group === g).map((c) =>
          button(`${c.id.toUpperCase()} ${c.name}`, () => void testMatch(c.id), { small: true, disabled: !isImplemented(c.id), title: isImplemented(c.id) ? '' : '未実装' }))))),
        h('div', null, h('div', { class: 'dim small' }, '旧ルールのまま残っている競技（v11 で置き換えるまで本編では使いません）'), h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, Object.keys(MATCHES).filter(isLegacy).map((id) =>
          button(`${id.toUpperCase()} 旧「${MATCHES[id].name}」`, () => void testMatch(id), { small: true, kind: 'ghost' })))),
        h('div', { class: 'row', style: 'gap:6px' }, button('共通決定戦（同点決着）', async () => {
          const s = fresh();
          G.state = s;
          const slot = newSlot(s, 'tiebreak', ['hero', NPC_IDS[0], NPC_IDS[1]], 'tiebreak');
          await playMatch(slot);
          G.state = null;
        }, { small: true })),
        h('h4', { class: 'gold' }, '任意の時点から開始（そこまでは自動対戦）'),
        h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
          button('DAY1 朝', () => void startAt(1, 'morning'), { small: true }),
          button('DAY1 メインマッチ', () => void startAt(1, 'main'), { small: true }),
          button('DAY1 生活棟の自由時間', () => void startAt(1, 'house', 'living'), { small: true }),
          button('DAY1 監獄棟の自由時間（脱落の検証）', () => void startAt(1, 'house', 'prison'), { small: true }),
          button('DAY1 監獄マッチ（主人公参加）', () => void startAt(1, 'prison', 'prison'), { small: true }),
          button('DAY1 夜', () => void startAt(1, 'night'), { small: true }),
          button('DAY1 消灯', () => void startAt(1, 'curfew'), { small: true }),
        ),
        h('h4', { class: 'gold' }, '救いのメダルの検証（DAY1 の順位発表から。順位と関係は検証用に並べ替え）'),
        h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
          button('主人公が 1 位（選んで使う）', () => void medalCase('heroFirst'), { small: true }),
          button('NPC が主人公を救おうとする', () => void medalCase('heroRescued'), { small: true }),
          button('主人公が入れ替えで監獄棟へ', () => void medalCase('heroSwapped'), { small: true }),
          button('NPC 同士の救済', () => void medalCase('npcOnly'), { small: true }),
        ),
        h('h4', { class: 'gold' }, '任意の施設から開始（DAY1 朝、検証用に全ての鍵を解錠）'),
        ...(['3F', '2F', '1F', 'B1', 'B2'] as const).map((f) => h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;align-items:center' }, h('b', { class: 'gold', style: 'width:36px' }, f),
          ROOM_IDS.filter((id) => ROOMS[id].floor === f && (!id.startsWith('bedroom_') || id === 'bedroom_hero')).map((id) => button(ROOMS[id].name, () => startIn(id), { small: true })))),
        h('div', { class: 'dim small' }, '棟を指定した開始では、自動対戦の結果と異なる場合に限り、検証用に主人公の配置を入れ替えます。'),
        h('h4', { class: 'gold' }, '自由時間の進み方（開発版のみ）'),
        h('div', { class: 'row', style: 'gap:6px' }, [1, 4, 20].map((v) => button(`${v}倍`, () => {
          G.meta.settings.timeScale = v;
          saveMeta(G.meta);
          render();
        }, { small: true, cls: G.meta.settings.timeScale === v ? 'selected' : '' }))),
        h('h4', { class: 'gold' }, '自動対戦（画面なし）'),
        h('div', { class: 'row', style: 'gap:6px' }, button('DAY1 を CPU だけで 20 回実行', async () => {
          const out: Record<string, number> = {};
          let heroOut = 0;
          for (let i = 0; i < 20; i++) {
            const s = fresh();
            s.phase = 'morning';
            await autoAdvance(s, 2, 'morning');
            const e = Object.values(s.actors).find((a) => !a.alive);
            if (e) out[e.id] = (out[e.id] ?? 0) + 1;
            if (!s.actors.hero.alive) heroOut++;
          }
          await alertDialog('結果', h('div', { class: 'small' }, `脱落者の内訳：${Object.entries(out).map(([k, v]) => `${k}×${v}`).join('、')}`, h('br'), `主人公（CPU 操作）の脱落：${heroOut} / 20`));
        }, { small: true })),
      );
    };
    render();
    layer = openLayer(h('div', { class: 'overlay solid' }, panel('開発者メニュー', body, { wide: true, footer: button(t('common.back'), () => done(null), { kind: 'ghost' }) })), { onCancel: () => done(null), name: 'dev' });
    void choose; void toast; void runToEnd; void CONFIG;
  });
}
