/**
 * 開発者用テストメニュー（開発版のみ。製品版ビルドには含めない：main.ts が VITE_CHANNEL で読み込みを分ける）。
 * - 競技を単体で試す（本編の状態とは独立）
 * - 任意の日程・フェーズから開始（そこまでを自動対戦で進める）
 * - 監獄マッチ・脱落の検証（開発用の配置変更であることを明示）
 * ここでの操作は検証専用で、通常のプレイには影響しない。
 */
import { strategyEnabled } from '../core/strategy';
import { isPrivateRoom } from '../world/rooms';
import { G } from '../app/game';
import { autoAdvance } from '../core/autoplay';
import { engineOf, newSlot, resolveTies, runToEnd } from '../core/runner';
import { addInfo, learn, newGame, rel } from '../core/state';
import { BG_DEFS, CLUE_KEYS, openLock, recOf, syncClues, type BgWing } from '../story/backgames';
import { CLUES } from '../story/clues';
import type { GameState, Phase } from '../core/types';
import { DEFAULT_HERO_NAMES, NPC_IDS, type CharId } from '../data/characters';
import { CONFIG, scheduleFor } from '../data/config';
import { t } from '../i18n/i18n';
import { phaseDuration } from '../core/clock';
import { CATALOG, isImplemented, MATCHES } from '../matches/registry';
import { saveMeta } from '../save/save';
import { setHeroGender } from '../ui/art';
import { ENDING_RULE, startMorning } from '../core/tournament';
import { ROOMS, ROOM_IDS } from '../world/maps';
import { placeIn } from '../world/sim';
import { alertDialog, button, choose, clear, closeLayer, h, openLayer, panel, toast, type Layer } from '../ui/dom';
import { playMatch } from '../ui/matchui';
import { rankingScreen, rulesScreen } from '../ui/screens';

function fresh(): GameState {
  const s = newGame({ gender: 'm', name: DEFAULT_HERO_NAMES.m, difficulty: G.meta.settings.difficulty });
  setHeroGender('m');
  // 途中から始める検証では、DAY 1 の自己紹介は済んだことにする（自己紹介は専用のボタンから）
  s.flags.introDone = true;
  return s;
}

/** 競技を単体で遊ぶ。独立した状態で行い、本編のセーブには触れない */
async function testMatch(id: string): Promise<void> {
  const eng = MATCHES[id];
  const s = fresh();
  G.state = s;
  const n = Math.min(eng.maxPlayers, id.startsWith('p') ? 4 : 12);
  const players: CharId[] = id === 'h02' ? ['hero', 'dealer' as CharId] : id === 'h06' ? ['hero', 'mask' as CharId] : ['hero', ...NPC_IDS.slice(0, n - 1)];
  await rulesScreen(id, { prison: eng.kind === 'prison' });
  const slot = newSlot(s, id, players, eng.kind === 'prison' ? 'prison' : 'main');
  slot.practice = true;
  await playMatch(slot);
  if (eng.kind === 'hidden') { G.state = null; return; }
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
    const startAt = async (day: number, phase: Phase, heroHouse?: 'prison' | 'living', mainOverride?: string) => {
      // 試作の競技を、その日のメインマッチに差し替えて試す（その大会の割り当てだけを変える）
      const fresh2 = () => { const x = fresh(); if (mainOverride && x.lineup) x.lineup.main[day - 1] = mainOverride; return x; };
      let s = fresh2();
      s.phase = 'morning';
      let ok = await autoAdvance(s, day, phase, { free: day < 8 });
      // 終盤の日は、主人公が自動対戦で残っている大会が出るまで作り直す（補正なし。残れた大会を選ぶだけ）
      for (let i = 0; !ok && day >= 8 && i < 80; i++) {
        s = fresh2();
        s.phase = 'morning';
        ok = await autoAdvance(s, day, phase, { free: false });
      }
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
    /** 決勝の結末の検証。DAY11 の順位発表から始め、順位と約束の記録を検証用に置き換える */
    const finalCase = async (kind: 'win' | 'lone' | 'bond' | 'lose' | 'true' | 'loseReady') => {
      let s = fresh();
      for (let i = 0; i < 80; i++) {
        s = fresh();
        s.phase = 'morning';
        if (await autoAdvance(s, 11, 'reward', { free: false })) break;
      }
      if (s.day !== 11 || s.phase !== 'reward') { await alertDialog('開始できません', '主人公が決勝まで残る大会を作れませんでした。もう一度試してください。'); return; }
      const other = (s.today.mainRanking ?? []).find((p) => p !== 'hero')!;
      s.today.mainRanking = kind === 'lose' || kind === 'loseReady' ? [other, 'hero'] : ['hero', other];
      if (kind === 'true' || kind === 'loseReady') { s.flags.hiddenLayout = 'legacy'; s.flags.h08_cleared = true; s.flags.RESCUE_READY = true; s.actors.hero.items.RELEASE_AUTH = 1; }
      s.deals = s.deals.filter((d) => d.from !== 'hero' && d.to !== 'hero');
      s.flags.betrayals_hero = kind === 'lone' ? ENDING_RULE.loneBetrayals : 0;
      for (const id of NPC_IDS) rel(s, id, 'hero').trust = kind === 'bond' ? 80 : 40;
      if (kind === 'bond') for (let i = 0; i < ENDING_RULE.bondDeals; i++) s.deals.push({ id: `dev_${i}`, day: 1, from: 'hero', to: NPC_IDS[i], kind: 'plan', payNow: 0, payOnSuccess: 0, untilDay: 10, status: 'fulfilled', witnesses: [], createdAt: 0 });
      s.flags.devSwap = true;
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
    /** 裏ルートの検証：指定の日の朝、指定の部屋から始める（日付と持ち物は検証用に作る。そこまでの競技は行わない） */
    const hiddenCase = (day: number, roomId: string, setup: (s: GameState) => void, phase: Phase = 'morning') => {
      const s = fresh();
      s.day = day;
      s.phase = phase;
      s.flags.phaseKey = `${day}:${phase}`;
      s.seen.push('S00', 'S01A', `S${String(day).padStart(2, '0')}A`);
      startMorning(s);
      s.phase = phase;
      s.phaseLeft = phaseDuration(phase);
      for (const a of Object.values(s.actors)) a.house = null;
      // 終盤の日は、脱落した参加者がいる状態にする（人数は日程のとおりではない。検証用）
      if (day >= 8) NPC_IDS.slice(-4).forEach((id) => { s.actors[id].alive = false; });
      setup(s);
      s.flags.devSwap = true;
      placeIn(s, 'hero', roomId);
      done(s);
    };
    /** 旧裏ルートで遊ぶ検証 */
    const legacyCase = (day: number, roomId: string, setup: (s: GameState) => void, phase: Phase = 'morning') => hiddenCase(day, roomId, (s) => { s.flags.hiddenLayout = 'legacy'; setup(s); }, phase);
    /** 裏ゲームの手掛かりを 3 つとも、自分で確かめた形で持たせる */
    const giveBgClues = (s: GameState, wing: BgWing) => {
      for (const k of CLUE_KEYS) {
        const id = BG_DEFS[wing].clues[k];
        const c = CLUES.find((x) => x.id === id)!;
        if (!s.infos[id]) addInfo(s, { id, kind: 'clue', text: c.text, truth: true, about: [], source: 'world', value: c.value, tags: c.tags });
        learn(s, 'hero', id, 'self', 1);
      }
      syncClues(s);
    };
    const render = () => {
      clear(body);
      const groups: [string, string][] = [['main', 'メインマッチ'], ['prison', '監獄マッチ'], ['hidden', '裏ゲーム'], ['sub', 'サブゲーム']];
      body.append(
        h('div', { class: 'note-box' }, '開発版だけの検証用メニューです。製品版には含まれません。ここでの対戦は本編のセーブ・戦績・実績に影響しません。'),
        h('h4', { class: 'gold' }, `競技を単体で試す（実装済み ${CATALOG.filter((c) => isImplemented(c.id)).length} / ${CATALOG.length}）`),
        ...groups.map(([g, label]) => h('div', null, h('div', { class: 'dim small' }, label), h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, CATALOG.filter((c) => c.group === g).map((c) =>
          button(`${c.id.toUpperCase()} ${c.name}`, () => void testMatch(c.id), { small: true, disabled: !isImplemented(c.id), title: isImplemented(c.id) ? '' : '未実装' }))))),
        h('div', { class: 'row', style: 'gap:6px' }, button('共通決定戦（同点決着）', async () => {
          const s = fresh();
          G.state = s;
          const slot = newSlot(s, 'tiebreak', ['hero', NPC_IDS[0], NPC_IDS[1]], 'tiebreak');
          await playMatch(slot);
          G.state = null;
        }, { small: true })),
        h('h4', { class: 'gold' }, '開会式と自己紹介'),
        h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
          button('開会式から（本編の始まり）', () => { const s = fresh(); delete s.flags.introDone; done(s); }, { small: true }),
          button('自己紹介から（開会式の後）', () => {
            const s = fresh();
            delete s.flags.introDone;
            s.phase = 'morning';
            done(s);
          }, { small: true }),
        ),
        h('h4', { class: 'gold' }, '新しいメインマッチの試作：市場予測（その日のメインを差し替え。ルール説明 → 作戦時間 → 競技）'),
        h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, [[1, 12], [3, 10], [5, 8], [7, 6], [9, 4], [10, 3]].map(([d, n]) => button(`DAY${d}（${n} 人）で市場予測`, () => void startAt(d, 'rules', undefined, 'mk'), { small: true }))),
        h('h4', { class: 'gold' }, '任意の時点から開始（そこまでは自動対戦）'),
        ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].filter((d) => isImplemented(scheduleFor(d).main) && (!scheduleFor(d).prisonGame || isImplemented(scheduleFor(d).prisonGame!))).map((d) =>
          h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
            button(`DAY${d} 朝`, () => void startAt(d, 'morning'), { small: true }),
            button(`DAY${d} メインマッチ`, () => void startAt(d, 'main'), { small: true }),
            ...(strategyEnabled(scheduleFor(d).main) ? [button(`DAY${d} ルール説明と作戦時間（試作）`, () => void startAt(d, 'rules'), { small: true })] : []),
            ...(d === 11 ? [] : [
            button(`DAY${d} 生活棟の自由時間`, () => void startAt(d, 'house', 'living'), { small: true }),
            button(`DAY${d} 監獄棟の自由時間`, () => void startAt(d, 'house', 'prison'), { small: true }),
            button(`DAY${d} 監獄マッチ（主人公参加）`, () => void startAt(d, 'prison', 'prison'), { small: true }),
            button(`DAY${d} 夜`, () => void startAt(d, 'night'), { small: true }),
            button(`DAY${d} 消灯`, () => void startAt(d, 'curfew'), { small: true }),
            ]),
          )),
        h('h4', { class: 'gold' }, '決勝の結末の検証（DAY11 の順位発表から。順位と約束の記録は検証用に置き換え）'),
        h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
          button('主人公が優勝（王者）', () => void finalCase('win'), { small: true }),
          button('主人公が優勝（孤独な王）', () => void finalCase('lone'), { small: true }),
          button('主人公が優勝（信頼の証）', () => void finalCase('bond'), { small: true }),
          button('主人公が決勝で敗北（敗者）', () => void finalCase('lose'), { small: true }),
        ),
        h('h4', { class: 'gold' }, '裏ゲーム 2 系統の検証（生活棟：賢者の金庫、監獄棟：影の対戦者）'),
        h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
          button('DAY1 朝・遊戯室（手掛かり無し）', () => hiddenCase(1, 'game_room', () => {}), { small: true }),
          button('DAY2 朝・リビング（生活棟の手掛かり 3 つ）', () => hiddenCase(2, 'dining', (s) => giveBgClues(s, 'living')), { small: true }),
          button('DAY2 朝・リビング（解放済み）', () => hiddenCase(2, 'dining', (s) => { giveBgClues(s, 'living'); recOf(s, 'living').unlockedDay = 2; }), { small: true }),
          button('DAY3 朝・共同牢（監獄棟の手掛かり 3 つ）', () => hiddenCase(3, 'prison_cells', (s) => giveBgClues(s, 'prison')), { small: true }),
          button('DAY3 朝・第零牢（壁を開けた）', () => hiddenCase(3, 'cell_zero', (s) => { giveBgClues(s, 'prison'); recOf(s, 'prison').unlockedDay = 3; openLock(s, 'prison'); }), { small: true }),
          button('DAY4 朝・第零牢（報酬受領済み、腕試し）', () => hiddenCase(4, 'cell_zero', (s) => { giveBgClues(s, 'prison'); const r = recOf(s, 'prison'); r.unlockedDay = 3; openLock(s, 'prison'); r.rewardDay = 3; s.claimed.push('bg:prison:reward'); }), { small: true }),
        ),
        h('h4', { class: 'gold' }, '旧裏ルートの検証（通常の構成から外した地下探索・真相ルート。開くと旧裏ルートで遊ぶ）'),
        h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
          button('DAY1 朝・図書室（入口から）', () => legacyCase(1, 'library', () => {}), { small: true }),
          button('DAY3 夜・展望室（ピース 6）', () => legacyCase(3, 'observatory', (s) => { s.actors.hero.pieces = 6; }, 'night'), { small: true }),
          button('DAY5 朝・旧書庫（H04、H05）', () => legacyCase(5, 'old_archive', (s) => { s.flags.h04_open = true; }), { small: true }),
          button('DAY8 朝・共用廊下（閲覧の許可あり）', () => legacyCase(8, 'common_hall', (s) => { s.flags.v04_maintenance_notice = true; s.flags.svc_permit = true; }), { small: true }),
          button('DAY9 朝・最深部（H08 の条件あり）', () => legacyCase(9, 'core', (s) => { for (const k of ['KEY_SERVICE', 'DOC_CROWN', 'CORE01']) s.actors.hero.items[k] = 1; s.flags.ISOLATION_CONFIRMED = true; s.flags.h07_cleared = true; s.flags.svc_permit = true; }), { small: true }),
          button('DAY10 朝・隔離区域（H08 済み）', () => legacyCase(10, 'isolation', (s) => { for (const k of ['KEY_SERVICE', 'DOC_CROWN', 'CORE01', 'RELEASE_AUTH']) s.actors.hero.items[k] = 1; s.flags.ISOLATION_CONFIRMED = true; s.flags.h07_cleared = true; s.flags.h08_cleared = true; s.flags.h08_stage = 5; s.flags.svc_permit = true; }), { small: true }),
          button('主人公が優勝（偽りの王冠）', () => void finalCase('true'), { small: true }),
          button('決勝で敗北（解放の準備あり）', () => void finalCase('loseReady'), { small: true }),
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
          ROOM_IDS.filter((id) => ROOMS[id].floor === f && (!isPrivateRoom(id) || id === 'bedroom_hero' || id === 'cell_p01')).map((id) => button(ROOMS[id].name, () => startIn(id), { small: true })))),
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
