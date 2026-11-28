/**
 * NPC との会話・交渉の画面。
 * 受諾・拒否・対案は npc/negotiation.ts の evaluate が決める（NPC 同士の交渉と同じ関数、プレイヤー専用の補正なし）。
 * ここは提案を組み立て、結果に対応する台詞を表示するだけ。会話中も大会の時計は進む。
 */
import { clockMinutes } from '../core/clock';
import { categoryForLine, playVoice, stopVoice } from '../audio/voice';
import { medalIssued, promiseRescue, promised } from '../core/rescue';
import { G } from '../app/game';
import { Sound } from '../audio/audio';
import { buildCtx, engineOf } from '../core/runner';
import { activeDeals, adjustRel, allied, pledged, aliveIds, learn, nameOf, rel, rngOf, shortName, transfer } from '../core/state';
import type { GameState, Info, MatchSlot, PlanTerm } from '../core/types';
import { NPC_BY_ID, PROFILES, type CharId, type NpcId } from '../data/characters';
import { CONFIG } from '../data/config';
import { t } from '../i18n/i18n';
import type { BrainEvent } from '../npc/brain';
import { say, type LineKey } from '../npc/lines';
import { absorb, accuse, commit, dealLabel, describeDeal, evaluate, noteDeal, type Proposal } from '../npc/negotiation';
import { answerHint, askTip, cancelCooperation, giveTip, newStrategy, talkRule, tipsOf } from '../core/strategy';
import { engagedElsewhere, inviteToRoom } from './strategy';
import { aboutTarget, addInvite, dismissGuest, personalState, INVITE_TIME, inviteVerdict, isPrivate, observeAttitude } from '../npc/social';
import { actorsIn, distance } from '../world/sim';
import { homeOf, isPrivateRoom } from '../world/rooms';
import { ROOMS } from '../world/maps';
import { bust, icon, setBust } from './art';
import { button, choose, clear, closeLayer, confirmDialog, h, openLayer, panel, type Layer } from './dom';
import { pieces } from './screens';

const EXPR: Partial<Record<LineKey, string>> = {
  accept: 'smile', gift_received: 'smile', promise_fulfilled: 'smile', trust_high: 'smile',
  reject_price: 'wary', reject_principle: 'anger', trust_low: 'wary', refuse: 'wary', accuseDoubt: 'wary',
  counter: 'think', info_offer: 'smirk', alliance_offer: 'normal', loan_request: 'sad', accuseBelieve: 'think', noInfo: 'normal',
  smalltalk: 'normal', greeting: 'normal', greetWary: 'wary', info_uncertain: 'think', plan_request: 'think',
};

/** 相手の反応から主人公が読み取れる好意の変化（値、1 日 1 回だけ数えるか）。関係一覧の推定に使う */
const ATTITUDE: Partial<Record<LineKey, [number, boolean]>> = {
  accept: [8, false], gift_received: [6, false], trust_high: [6, false], promise_fulfilled: [8, false], alliance_offer: [6, true], smalltalk: [2, true], accuseBelieve: [2, false],
  reject_price: [-2, false], reject_principle: [-8, false], trust_low: [-8, true], refuse: [-5, false], greetWary: [-4, true], accuseDoubt: [-3, false],
};


/** 数値入力（ピースの数など） */
export function askNumber(title: string, text: string, min: number, max: number, init = min): Promise<number | null> {
  return new Promise((resolve) => {
    let layer: Layer;
    let v = Math.max(min, Math.min(max, init));
    const out = h('b', null, String(v));
    const set = (d: number) => {
      v = Math.max(min, Math.min(max, v + d));
      out.textContent = String(v);
      Sound.se('chip');
    };
    const done = (r: number | null) => {
      closeLayer(layer);
      resolve(r);
    };
    const body = h('div', { class: 'col', style: 'gap:12px;align-items:center' }, h('div', { class: 'text' }, text), h('div', { class: 'stepper' }, button('−', () => set(-1), { small: true }), out, button('＋', () => set(1), { small: true })), h('div', { class: 'dim small' }, t('talk.range', { min, max })));
    layer = openLayer(h('div', { class: 'overlay' }, panel(title, body, { cls: 'dialog', footer: [button(t('common.cancel'), () => done(null), { kind: 'ghost' }), button(t('common.ok'), () => done(v), { kind: 'primary', autofocus: true })] })), { onCancel: () => done(null), name: 'number' });
  });
}

function witnesses(s: GameState, npc: NpcId): CharId[] {
  const a = s.actors[npc];
  // 個室で 2 人きりなら、誰にも見られない（v10）
  if (isPrivate(s, 'hero', npc)) return [];
  return actorsIn(s, a.pos.room).filter((x) => x.id !== npc && x.id !== 'hero' && distance(x, a) <= 7 && NPC_BY_ID[x.id as NpcId].stats.observation >= 7).map((x) => x.id);
}

function infoLabel(i: Info): string {
  return t(i.kind === 'clue' ? 'talk.infoClue' : i.kind === 'betrayal' ? 'talk.infoBetrayal' : 'talk.infoRumor');
}

/** 競技中に話せるか：none＝雑談だけ、ownTurn＝自分の手番なので話さない、ok＝相談できる */
function matchGate(slot: MatchSlot): 'none' | 'ownTurn' | 'ok' {
  const rule = talkRule(slot.id);
  const eng = engineOf(slot.id);
  const st = eng.stage(slot.state);
  if (rule.window === 'none') return 'none';
  if (st.negotiation) return 'ok';
  if (rule.window === 'during' && !eng.pending(slot.state).includes('hero')) return 'ok';
  return 'ownTurn';
}

export function talkTo(npc: NpcId, opts: { event?: BrainEvent; match?: MatchSlot } = {}): Promise<void> {
  const s = G.state!;
  const def = NPC_BY_ID[npc];
  const A = s.actors[npc];
  const hero = s.actors.hero;
  const me = shortName(s, 'hero');
  const inMatch = opts.match;
  return new Promise((resolve) => {
    let layer: Layer;
    let closed = false;
    const portrait = bust(npc, 'normal', 'dlg-portrait left');
    const text = h('div', { class: 'dlg-text' });
    const menu = h('div', { class: 'talk-menu' });
    const info = h('div', { class: 'talk-info hud-box' });
    const priv = () => !inMatch && isPrivate(s, 'hero', npc);
    const hold = () => {
      A.busyUntil = s.simTime + 2500;
      A.path = [];
      A.route = [];
    };
    const timer = setInterval(() => {
      if (!closed && !inMatch) hold();
    }, 400);
    const line = (key: LineKey, vars: { x?: string } = {}, expr?: string) => {
      const seen = ATTITUDE[key];
      if (seen) observeAttitude(s, npc, seen[0], seen[1] ? key : undefined);
      text.textContent = say(s, npc, key, { name: me, ...vars });
      setBust(portrait, npc, expr ?? EXPR[key] ?? 'normal');
      // 汎用ボイス：内容が一致する場面だけ鳴らす（一致しなければ、前の音声を止めるだけ）
      // 初めて話しかけた時の挨拶は、自己紹介の声（持っている人だけ）
      const firstMeet = key === 'greeting' && !opts.event && !s.flags[`voice_intro_${npc}`];
      if (firstMeet && playVoice(npc, 'introduction')) s.flags[`voice_intro_${npc}`] = true;
      else if (!playVoice(npc, categoryForLine(key, { hour: Math.floor(clockMinutes(s) / 60), heroStarted: !opts.event }))) stopVoice();
    };
    const raw = (str: string, expr = 'normal') => {
      stopVoice();
      text.textContent = str;
      setBust(portrait, npc, expr);
    };
    /** いまの場所と、そこで使える話の範囲（生活棟・個室・監獄棟・競技ごと） */
    const whereLabel = () => {
      if (inMatch) return t(`talk.rule.${talkRule(inMatch.id).window}`);
      if (G.strategy) return t('talk.where.strategy');
      if (priv()) return t('talk.where.private');
      const area = ROOMS[s.actors.hero.pos.room]?.area;
      return t(area === 'prison' ? 'talk.where.prison' : area === 'living' ? 'talk.where.living' : 'talk.where.public');
    };
    const refreshInfo = () => {
      clear(info);
      const deals = activeDeals(s, 'hero', npc);
      info.append(h('span', { class: 'tag where' }, whereLabel()), h('span', null, t('talk.myPieces')), pieces(hero.pieces), ...deals.map((d) => h('span', { class: 'tag fact' }, dealLabel(d.kind))));
    };
    const close = () => {
      stopVoice();
      if (closed) return;
      closed = true;
      clearInterval(timer);
      document.body.classList.remove('talking');
      closeLayer(layer);
      G.heroBusy = false;
      // 話し終えても、すぐには立ち去らない（同行中はすぐ付いてくる）
      A.busyUntil = s.simTime + (A.goal?.kind === 'follow' ? 300 : 4000);
      A.talkCd.hero = s.simTime + CONFIG.npc.approachHeroCooldown;
      A.bubble = undefined;
      G.save();
      resolve();
    };

    /** 提案を評価させ、結果を反映する */
    const negotiate = async (p: Proposal): Promise<boolean> => {
      let cur = p;
      let v = evaluate(s, cur);
      if (!v.accept && v.counter) {
        line('counter', { x: v.counterText ?? '' });
        const next: Proposal = { ...cur, ...v.counter };
        const affordable = next.payNow <= hero.pieces;
        const ok = await choose(t('talk.counterTitle'), t('talk.counterText', { name: def.short, x: v.counterText ?? '' }), [
          { label: t('talk.counterAccept'), value: true, kind: 'primary', disabled: !affordable, hint: affordable ? undefined : t('talk.notEnough') },
          { label: t('talk.counterDecline'), value: false },
        ], { cancel: false, pauses: false });
        if (!ok) {
          line('exit');
          return false;
        }
        cur = next;
        v = evaluate(s, cur);
      }
      if (v.accept) {
        const d = commit(s, cur, witnesses(s, npc));
        if (d) {
          noteDeal(s, d);
          if (cur.payNow !== 0) Sound.se('coins');
          else Sound.se('confirm');
          line(cur.kind === 'gift' ? 'gift_received' : 'accept');
          refreshInfo();
          return true;
        }
      }
      Sound.se('back');
      line(v.reason === 'counter' ? 'reject_price' : v.reason);
      return false;
    };

    const proposeTreaty = async (kind: 'alliance' | 'nonaggression') => {
      if (allied(s, 'hero', npc, kind === 'alliance' ? ['alliance'] : ['alliance', 'nonaggression'])) return raw(t('talk.already'));
      const pay = await askNumber(t(`talk.${kind}`), t('talk.payAsk', { name: def.short }), 0, hero.pieces, 0);
      if (pay === null) return;
      let until = s.day;
      if (kind === 'alliance') until = await choose(t('talk.alliance'), t('talk.untilAsk'), [{ label: t('talk.untilToday'), value: s.day }, { label: t('talk.untilTomorrow'), value: s.day + 1 }], { cancel: s.day, pauses: false });
      await negotiate({ kind, from: 'hero', to: npc, payNow: pay, payOnSuccess: 0, untilDay: until });
    };

    const buyInfo = async () => {
      const r = rel(s, npc, 'hero');
      if (r.hostility >= 50 || r.trust < 20) return line('trust_low');
      const list = Object.keys(A.knows).map((k) => s.infos[k]).filter((i): i is Info => !!i && i.source !== 'public' && !hero.knows[i.id] && i.value >= 1 && !i.about.includes(npc) && !i.about.includes('hero'));
      if (!list.length) return line('noInfo');
      const priced = list.slice(0, 5).map((i) => ({ i, price: Math.max(0, Math.min(PROFILES[npc].basePrices.SELL_INFO, i.value) - (r.trust >= 70 ? 1 : 0) - (r.debt >= 40 ? 1 : 0)) }));
      line('info_offer', { x: String(priced[0].price) });
      const pick = await choose(t('talk.buyTitle'), t('talk.buyText'), [...priced.map((x) => ({ label: `${infoLabel(x.i)}（${x.price}${t('unit.piece')}）`, value: x, disabled: x.price > hero.pieces })), { label: t('common.cancel'), value: null }], { cancel: null, pauses: false });
      if (!pick) return;
      const d = commit(s, { kind: 'info_sell', from: npc, to: 'hero', payNow: -pick.price, payOnSuccess: 0, infoId: pick.i.id, untilDay: s.day });
      if (!d) return line('reject_price');
      if (pick.price) Sound.se('coins');
      const conf = A.knows[pick.i.id]?.conf ?? 0.5;
      raw(`${conf < 0.7 ? say(s, npc, 'info_uncertain', { name: me }) + '\n' : ''}「${pick.i.text}」`, 'think');
      refreshInfo();
    };

    const sellInfo = async () => {
      const list = Object.keys(hero.knows).map((k) => s.infos[k]).filter((i): i is Info => !!i && i.source !== 'public' && !A.knows[i.id] && i.kind !== 'result' && !i.about.includes(npc));
      if (!list.length) return raw(t('talk.nothingToSell'));
      const pick = await choose(t('talk.sellTitle'), t('talk.sellText'), [...list.slice(0, 6).map((i) => ({ label: i.text.length > 34 ? i.text.slice(0, 34) + '…' : i.text, value: i })), { label: t('common.cancel'), value: null }], { cancel: null, pauses: false });
      if (!pick) return;
      const price = await askNumber(t('talk.sellTitle'), t('talk.priceAsk'), 0, 5, 1);
      if (price === null) return;
      await negotiate({ kind: 'info_sell', from: 'hero', to: npc, payNow: -price, payOnSuccess: 0, infoId: pick.id, untilDay: s.day });
    };

    const gift = async () => {
      if (hero.pieces < 1) return raw(t('talk.noPieces'));
      const n = await askNumber(t('talk.gift'), t('talk.giftAsk', { name: def.short }), 1, hero.pieces, 1);
      if (n === null) return;
      await negotiate({ kind: 'gift', from: 'hero', to: npc, payNow: n, payOnSuccess: 0, untilDay: s.day });
    };

    const loan = async () => {
      const mine = activeDeals(s, 'hero', npc).find((d) => d.kind === 'loan' && d.from === 'hero');
      if (mine) {
        const ok = hero.pieces >= mine.payOnSuccess && (await choose(t('talk.repayTitle'), t('talk.repayText', { n: mine.payOnSuccess }), [{ label: t('talk.repayYes'), value: true, kind: 'primary' }, { label: t('common.cancel'), value: false }], { cancel: false, pauses: false }));
        if (ok && transfer(s, 'hero', npc, mine.payOnSuccess, '返済')) {
          mine.status = 'fulfilled';
          adjustRel(s, npc, 'hero', { trust: 10, like: 3 });
          Sound.se('coins');
          line('promise_fulfilled');
          refreshInfo();
        } else if (hero.pieces < mine.payOnSuccess) raw(t('talk.notEnough'));
        return;
      }
      const n = await askNumber(t('talk.loan'), t('talk.loanAsk', { name: def.short, day: s.day + 2 }), 1, 3, 1);
      if (n === null) return;
      await negotiate({ kind: 'loan', from: 'hero', to: npc, payNow: -n, payOnSuccess: n, untilDay: s.day + 2 });
    };

    const doAccuse = async () => {
      const targets = aliveIds(s).filter((x) => x !== 'hero' && x !== npc);
      const target = await choose<CharId | null>(t('talk.accuse'), t('talk.accuseAsk'), [...targets.map((x) => ({ label: nameOf(s, x), value: x as CharId | null })), { label: t('common.cancel'), value: null }], { cancel: null, pauses: false });
      if (!target) return;
      const evidence = Object.keys(hero.knows).map((k) => s.infos[k]).find((i) => i && i.kind === 'betrayal' && i.about[0] === target && (hero.knows[i.id]?.conf ?? 0) >= 0.9);
      const v = evaluate(s, { kind: 'accuse', from: 'hero', to: npc, target, payNow: 0, payOnSuccess: 0, untilDay: s.day, infoId: evidence?.id });
      accuse(s, 'hero', npc, target, evidence ? evidence.text : `${nameOf(s, target)}は、約束を守るつもりがないらしい。`, !evidence, v.accept);
      line(v.accept ? 'accuseBelieve' : 'accuseDoubt');
    };

    const smalltalk = async () => {
      const key = `met_${s.day}_${['hero', npc].sort().join('_')}`;
      if (!s.flags[key]) {
        s.flags[key] = true;
        adjustRel(s, npc, 'hero', { like: 2, trust: 1 });
        adjustRel(s, 'hero', npc, { like: 2, trust: 1 });
      }
      line('smalltalk');
    };

    /** 個人的な話（私的な場所だけ）。既存の解放条件（日数と信頼）はそのまま */
    const personal = async () => {
      const st = personalState(s, npc);
      if (st.kind === 'ready') {
        s.seen.push(st.ev.id);
        observeAttitude(s, npc, 6);
        raw(st.ev.lines.map((l) => l.text).join('\n'), 'think');
        return;
      }
      // 「まだ話す気がない（条件を満たしていない）」と「聞ける話を聞き終えた」を分けて伝える。条件の中身（信頼の値）は出さない
      raw(t(st.kind === 'done' ? 'talk.personalDone' : 'talk.personalNone', { name: def.short }));
    };

    /** 公の場で聞ける話：誰でも見て分かることだけ */
    const publicInfo = async () => {
      const alive = aliveIds(s);
      const rich = [...alive].sort((a, b) => s.actors[b].pieces - s.actors[a].pieces)[0];
      const last = s.history[s.history.length - 1];
      const parts = [t('talk.pubRich', { name: rich === 'hero' ? me : shortName(s, rich), n: s.actors[rich].pieces })];
      if (last?.mainRanking?.length) parts.push(t('talk.pubRank', { day: last.day, name: shortName(s, last.mainRanking[0]) }));
      if (last?.eliminated?.length) parts.push(t('talk.pubOut', { day: last.day, name: shortName(s, last.eliminated[0]) }));
      raw(parts.join('\n') + '\n' + t('talk.pubHint'));
    };

    /** 他者の動向（私的な場所だけ）：相手が実際に知っていることだけを聞ける */
    const askAbout = async () => {
      const targets = aliveIds(s).filter((x) => x !== 'hero' && x !== npc);
      const target = await choose<CharId | null>(t('talk.about'), t('talk.aboutAsk'), [...targets.map((x) => ({ label: nameOf(s, x), value: x as CharId | null })), { label: t('common.cancel'), value: null }], { cancel: null, pauses: false });
      if (!target) return;
      const ans = aboutTarget(s, npc, 'hero', target, rngOf(s));
      if (ans.kind === 'refuse') return line('trust_low');
      if (ans.kind === 'none') return raw(t('talk.aboutNone', { name: shortName(s, target) }));
      if (ans.kind === 'price') {
        const ok = await choose(t('talk.about'), t('talk.aboutPrice', { name: def.short, n: ans.price }), [{ label: t('talk.aboutPay', { n: ans.price }), value: true, kind: 'primary', disabled: hero.pieces < ans.price }, { label: t('common.cancel'), value: false }], { cancel: false, pauses: false });
        if (!ok || !transfer(s, 'hero', npc, ans.price, '情報の代金')) return line('exit');
        Sound.se('coins');
        refreshInfo();
      }
      for (const i of ans.infos) absorb(s, 'hero', i.id, npc, Math.min(0.85, (A.knows[i.id]?.conf ?? 0.6) * 0.9));
      raw(ans.infos.map((i) => `「${i.text}」`).join('\n'), 'think');
    };

    /** 密談に誘う：応じたら同行してもらい、自分の個室で話す */
    const invite = async () => {
      if (A.goal?.kind === 'follow' && A.goal.target === 'hero') {
        dismissGuest(s, npc);
        return raw(t(priv() ? 'talk.dismissDone' : 'talk.followEnd', { name: def.short }));
      }
      // 監獄棟の房は格子越しに丸見えで、2 人きりにはなれない（招く先がない）
      if (!isPrivateRoom(homeOf(s, 'hero'))) return raw(t('talk.invite.cell'));
      const v = inviteVerdict(s, 'hero', npc, rngOf(s));
      if (!v.accept || !addInvite(s, 'hero', npc)) {
        observeAttitude(s, npc, v.reason === 'distrust' ? -4 : 0);
        return raw(t(`talk.invite.${v.reason === 'ok' ? 'full' : v.reason}`), v.reason === 'distrust' ? 'wary' : 'normal');
      }
      observeAttitude(s, npc, 3);
      A.goal = { kind: 'follow', target: 'hero', note: 'private', until: s.simTime + INVITE_TIME };
      A.path = [];
      A.route = [];
      Sound.se('confirm');
      raw(t('talk.invite.ok'), 'normal');
    };

    const tradeMenu = async () => {
      const hasLoan = activeDeals(s, 'hero', npc).some((d) => d.kind === 'loan' && d.from === 'hero');
      const pick = await choose<string | null>(t('talk.trade'), t('talk.tradeText'), [
        { label: t('talk.gift'), value: 'gift' }, { label: hasLoan ? t('talk.repayTitle') : t('talk.loan'), value: 'loan' }, { label: t('common.cancel'), value: null },
      ], { cancel: null, pauses: false });
      if (pick === 'gift') await gift();
      else if (pick === 'loan') await loan();
    };

    const treatyMenu = async () => {
      const medal = medalIssued(s.day) && !s.today.mainRanking;
      // 生活中は「次は協力しよう」という緩い約束まで。支払いや具体的な条件の付いた協力は、競技のルール説明の後（本人の決定 2026-11-28）
      const pick = await choose<'pledge' | 'askRescue' | 'offerRescue' | null>(t('talk.treaty'), `${t('talk.pledgeNote')}\n${t(priv() ? 'talk.treatyPrivate' : 'talk.treatyPublic')}`, [
        { label: t('talk.pledge'), value: 'pledge', kind: 'primary' },
        ...(medal ? [{ label: t('talk.rescueAsk'), value: 'askRescue' as const }, { label: t('talk.rescueOffer'), value: 'offerRescue' as const }] : []),
        { label: t('common.cancel'), value: null },
      ], { cancel: null, pauses: false });
      if (pick === 'askRescue') {
        // 救いのメダルの約束（v11）。履行は強制されない
        const r = rel(s, npc, 'hero');
        if (promised(s, npc, 'hero')) raw(t('talk.rescueAlready'), 'normal');
        else if (r.trust >= 35 || r.like >= 20 || allied(s, 'hero', npc)) { promiseRescue(s, npc, 'hero'); Sound.se('confirm'); raw(t('talk.rescueYes'), 'normal'); }
        else raw(t('talk.rescueNo'), 'normal');
      } else if (pick === 'offerRescue') {
        if (!promised(s, 'hero', npc)) { promiseRescue(s, 'hero', npc); adjustRel(s, npc, 'hero', { trust: 4, like: 3 }); Sound.se('confirm'); }
        raw(t('talk.rescueThanks'), 'normal');
      } else if (pick === 'pledge') {
        if (pledged(s, 'hero', npc)) return raw(t('talk.already'));
        if (await negotiate({ kind: 'pledge', from: 'hero', to: npc, payNow: 0, payOnSuccess: 0, untilDay: s.day + 2 })) line('pledge_ok');
      }
    };

    // ---- 作戦時間（ルール説明の後）と、M01 の休憩の会話（競技用コマンド。試作） ----
    const strat = !inMatch ? G.strategy : null;
    const v2 = !!strat || (!!inMatch && !!talkRule(inMatch.id).breakTalk);
    const mslot = inMatch ?? strat?.slot ?? null;
    const stCtx = () => s.strategy ?? newStrategy(s, mslot?.id ?? '');

    const coopOffer = async () => {
      if (allied(s, 'hero', npc)) return raw(t('talk.already'));
      const pay = await askNumber(t('strat.cmdCoop'), t('strat.coopAsk', { name: def.short }), 0, hero.pieces, 0);
      if (pay === null) return;
      await negotiate({ kind: 'alliance', from: 'hero', to: npc, payNow: pay, payOnSuccess: 0, untilDay: s.day });
    };
    const consult = () => {
      const r = inviteToRoom(npc);
      if (r.ok) Sound.se('confirm');
      raw(r.text, r.ok ? 'smile' : 'normal');
    };
    const infoV2 = async () => {
      const results = mslot ? (engineOf(mslot.id).view(mslot.state, 'hero') as { results?: Record<string, { complete: boolean; base: number; speed: number; team: number }[]> }).results : undefined;
      const last = results?.[npc]?.[results[npc].length - 1];
      const pick = await choose<string | null>(t('strat.cmdInfo'), t('strat.infoText'), [
        ...(inMatch && last ? [{ label: t('strat.askHow'), value: 'how' }] : []),
        { label: t('strat.askHint'), value: 'hint' }, { label: t('talk.pubAsk'), value: 'pub' }, { label: t('common.cancel'), value: null },
      ], { cancel: null, pauses: false });
      if (pick === 'how' && last) {
        line(last.complete ? 'stage_good' : 'stage_bad');
        text.textContent += `\n${t('strat.howPublic', { n: results![npc].length, pts: last.base + last.speed + last.team })}`;
      } else if (pick === 'hint') {
        const a = answerHint(s, npc, 'hero', rngOf(s));
        line(a === 'yes' ? 'hint_yes' : a === 'no' ? 'hint_no' : 'hint_vague');
      } else if (pick === 'pub') await publicInfo();
    };
    const tipAsk = () => {
      const a = askTip(s, mslot, stCtx(), npc, 'hero', rngOf(s));
      if (a.kind === 'refuse') return line('tip_refuse');
      raw(`${a.kind === 'again' ? say(s, npc, 'tip_again') + '\n' : say(s, npc, 'tip_give') + '\n'}「${a.text}」`, 'think');
    };
    const tipTeach = async () => {
      const list = tipsOf(stCtx().match);
      if (!list.length) return line('noInfo');
      const pick = await choose<string | null>(t('strat.teachTitle'), t('strat.teachText'), [...list.map((x) => ({ label: x, value: x as string | null })), { label: t('common.cancel'), value: null }], { cancel: null, pauses: false });
      if (!pick) return;
      giveTip(s, stCtx(), 'hero', npc);
      line('tip_thanks');
    };
    const promiseMenu = async () => {
      const deals = activeDeals(s, 'hero', npc);
      const rescueMine = promised(s, 'hero', npc);
      const rescueTheirs = promised(s, npc, 'hero');
      const lines = [...deals.map((d) => describeDeal(s, d)), rescueMine ? t('strat.rescueMine') : '', rescueTheirs ? t('strat.rescueTheirs') : ''].filter(Boolean);
      const medal = medalIssued(s.day) && !s.today.mainRanking;
      const pick = await choose<string | null>(t('strat.cmdPromise'), lines.length ? lines.join('\n') : t('strat.noPromise'), [
        ...(medal && !rescueTheirs ? [{ label: t('talk.rescueAsk'), value: 'askRescue' }] : []),
        ...(medal && !rescueMine ? [{ label: t('talk.rescueOffer'), value: 'offerRescue' }] : []),
        ...(allied(s, 'hero', npc) ? [{ label: t('strat.cancelCoop'), value: 'cancel', kind: 'danger' as const }] : []),
        { label: t('common.close'), value: null },
      ], { cancel: null, pauses: false });
      if (pick === 'askRescue') {
        const r = rel(s, npc, 'hero');
        if (r.trust >= 35 || r.like >= 20 || allied(s, 'hero', npc)) { promiseRescue(s, npc, 'hero'); Sound.se('confirm'); raw(t('talk.rescueYes'), 'normal'); }
        else raw(t('talk.rescueNo'), 'normal');
      } else if (pick === 'offerRescue') {
        promiseRescue(s, 'hero', npc);
        adjustRel(s, npc, 'hero', { trust: 4, like: 3 });
        Sound.se('confirm');
        raw(t('talk.rescueThanks'), 'normal');
      } else if (pick === 'cancel') {
        if (await confirmDialog(t('strat.cancelCoop'), t('strat.cancelText', { name: def.short }), { ok: t('strat.cancelCoop'), cancel: t('common.cancel'), danger: true, pauses: false })) {
          cancelCooperation(s, 'hero', npc);
          line('coop_cancel');
          refreshInfo();
        }
      }
    };

    const infoMenu = async () => {
      if (!priv()) {
        const pick = await choose<string | null>(t('talk.info'), t('talk.infoPublicText'), [
          { label: t('talk.pubAsk'), value: 'pub' }, { label: t('talk.accuse'), value: 'accuse' }, { label: t('talk.secretAsk'), value: 'secret' }, { label: t('common.cancel'), value: null },
        ], { cancel: null, pauses: false });
        if (pick === 'pub') await publicInfo();
        else if (pick === 'accuse') await doAccuse();
        else if (pick === 'secret') raw(t('talk.needPrivate'));
        return;
      }
      const pick = await choose<string | null>(t('talk.info'), t('talk.infoPrivateText'), [
        { label: t('talk.buy'), value: 'buy' }, { label: t('talk.sell'), value: 'sell' }, { label: t('talk.accuse'), value: 'accuse' }, { label: t('talk.pubAsk'), value: 'pub' }, { label: t('common.cancel'), value: null },
      ], { cancel: null, pauses: false });
      if (pick === 'buy') await buyInfo();
      else if (pick === 'sell') await sellInfo();
      else if (pick === 'accuse') await doAccuse();
      else if (pick === 'pub') await publicInfo();
    };

    const secretMenu = async () => {
      const pick = await choose<string | null>(t('talk.secret'), t('talk.secretText'), [
        { label: t('talk.secretInfo'), value: 'buy' }, { label: t('talk.secretSell'), value: 'sell' }, { label: t('talk.about'), value: 'about' }, { label: personalState(s, npc).kind === 'done' ? t('talk.personalDoneTag') : t('talk.personal'), value: 'personal' }, { label: t('common.cancel'), value: null },
      ], { cancel: null, pauses: false });
      if (pick === 'buy') await buyInfo();
      else if (pick === 'sell') await sellInfo();
      else if (pick === 'about') await askAbout();
      else if (pick === 'personal') await personal();
    };

    // ---- 競技中の交渉 ----
    const planMenu = async (performer: 'npc' | 'hero') => {
      const slot = inMatch!;
      const eng = engineOf(slot.id);
      const clauses: PlanTerm[] = eng.clauses?.(slot.state, performer === 'npc' ? npc : 'hero', performer === 'npc' ? 'hero' : npc) ?? [];
      if (!clauses.length) return raw(t('talk.noClause'));
      const plan = await choose<PlanTerm | null>(t(performer === 'npc' ? 'talk.planAsk' : 'talk.planOffer'), t(performer === 'npc' ? 'talk.planAskText' : 'talk.planOfferText', { name: def.short }), [...clauses.map((c) => ({ label: c.label, value: c as PlanTerm | null })), { label: t('common.cancel'), value: null }], { cancel: null, pauses: false });
      if (!plan) return;
      if (performer === 'hero') {
        await negotiate({ kind: 'plan', from: 'hero', to: npc, performer: 'hero', plan, payNow: 0, payOnSuccess: 0, untilDay: s.day });
        return;
      }
      const pay = await askNumber(t('talk.planAsk'), t('talk.planPay'), 0, hero.pieces, 0);
      if (pay === null) return;
      const later = await askNumber(t('talk.planAsk'), t('talk.planLater'), 0, Math.max(0, hero.pieces - pay), 0);
      if (later === null) return;
      const ctx = buildCtx(s, npc, slot.id, rngOf(s));
      const cost = eng.planCost?.(eng.view(slot.state, npc), ctx, plan) ?? 1;
      line('plan_request');
      await negotiate({ kind: 'plan', from: 'hero', to: npc, performer: npc, plan, payNow: pay, payOnSuccess: later, planCost: cost, untilDay: s.day });
    };

    const askIntent = () => {
      const slot = inMatch!;
      const eng = engineOf(slot.id);
      const r = rel(s, npc, 'hero');
      const ctx = buildCtx(s, npc, slot.id, rngOf(s));
      const it = eng.intent?.(eng.view(slot.state, npc), ctx);
      if (!it) return line('noInfo');
      const friendly = !!allied(s, 'hero', npc) || r.trust >= 55 || def.personality.morality >= 75;
      if (friendly) raw(t('talk.intentSay', { x: it.label }), 'normal');
      else if (def.stats.acting >= 7 && def.personality.morality < 50) {
        // 信頼していない相手には、もっともらしい別の手を告げることがある（真偽はプレイヤーには分からない）
        const others = (eng.clauses?.(slot.state, npc, 'hero') ?? []).filter((c) => c.code !== it.code);
        const fake = others.length ? others[(s.counter++ + s.day) % others.length].label.replace(/^R\d+で/, '').replace(/する$/, '') : it.label;
        raw(t('talk.intentSay', { x: fake }), 'smirk');
      } else line('noInfo');
    };

    const buildMenu = () => {
      clear(menu);
      const add = (label: string, fn: () => void | Promise<void>, ic?: string) => menu.append(button([ic ? icon(ic) : null, label], async () => {
        await fn();
        if (!closed) buildMenu();
      }, { small: true }));
      const busy = strat ? engagedElsewhere(npc) : null;
      const gate = inMatch ? matchGate(inMatch) : null;
      if (gate === 'ownTurn') {
        // 自分の手番の間は話さない（自分の操作を会話で妨げない。本人の補足 2026-11-28）
        text.textContent = t('talk.rule.ownTurn');
      } else if (gate === 'none') {
        // 相談できない競技：休憩に話せるのは雑談だけ
        add(t('talk.smalltalk'), smalltalk);
      } else if (busy) {
        // 作戦時間に、ほかの人との相談へ向かっている人とは話せない（NPC 同士と同じ：1 枠に 1 組）
        text.textContent = busy;
      } else if (v2) {
        add(t('strat.cmdCoop'), coopOffer, 'alliance');
        if (strat) add(t('strat.cmdConsult'), consult, 'contract');
        add(t('strat.cmdInfo'), infoV2, 'rumor');
        add(t('strat.cmdTipAsk'), tipAsk, 'help');
        add(t('strat.cmdTeach'), tipTeach);
        add(t('strat.cmdPromise'), promiseMenu, 'contract');
      } else if (inMatch) {
        // 作戦の約束と「次の手」は、競技側にその部品（約束できる行動、本人の予定の手）がある時だけ出す（v11 の競技はまだ無い）
        const eng = engineOf(inMatch.id);
        if (eng.clauses) {
          add(t('talk.planAsk'), () => planMenu('npc'));
          add(t('talk.planOffer'), () => planMenu('hero'));
        }
        if (eng.intent) add(t('talk.intent'), askIntent, 'help');
        add(t('talk.alliance'), () => proposeTreaty('alliance'), 'alliance');
        add(t('talk.nonaggression'), () => proposeTreaty('nonaggression'), 'contract');
        add(t('talk.gift'), gift);
      } else {
        // v10：公の場と個室で主メニューが変わる。個室でも第三者がいれば公の場と同じ扱い
        const following = A.goal?.kind === 'follow' && A.goal.target === 'hero';
        add(t('talk.smalltalk'), smalltalk);
        add(t('talk.info'), infoMenu, 'rumor');
        add(t('talk.trade'), tradeMenu);
        add(t('talk.treaty'), treatyMenu, 'alliance');
        if (priv()) add(t('talk.secret'), secretMenu, 'contract');
        if (!priv() || following) add(following ? t(priv() ? 'talk.dismiss' : 'talk.followStop') : t('talk.inviteAsk'), invite);
      }
      menu.append(button([icon('back'), t(inMatch || strat ? 'talk.leave' : priv() ? 'talk.end' : 'talk.nothing')], () => {
        Sound.se('back');
        close();
      }, { kind: 'ghost', small: true }));
      layer && requestAnimationFrame(() => (menu.querySelector('button') as HTMLElement | null)?.focus({ preventScroll: true }));
    };

    /** NPC から持ちかけられた提案 */
    const incoming = async (p: Proposal) => {
      const priceIn = Math.max(0, -p.payNow);
      const offerOut = Math.max(0, p.payNow);
      if (p.kind === 'pledge') line('pledge_offer');
      else if (p.kind === 'alliance') line('alliance_offer');
      else if (p.kind === 'nonaggression') line('propose_nap');
      else if (p.kind === 'info_sell') line('info_offer', { x: String(priceIn) });
      else if (p.kind === 'loan') line('loan_request', { x: String(priceIn) });
      else line('greeting');
      const terms = [
        t(`offer.${p.kind}`, { name: def.short, day: p.untilDay, n: priceIn, back: p.payOnSuccess, info: p.infoId && s.infos[p.infoId] ? infoLabel(s.infos[p.infoId]) : '' }),
        offerOut ? t('offer.theyPay', { n: offerOut }) : '', priceIn && p.kind !== 'loan' ? t('offer.youPay', { n: priceIn }) : '',
      ].filter(Boolean).join('\n');
      const ok = await choose(t('offer.title', { name: def.name }), terms, [
        { label: t('offer.accept'), value: true, kind: 'primary', disabled: priceIn > hero.pieces, hint: priceIn > hero.pieces ? t('talk.notEnough') : undefined },
        { label: t('offer.decline'), value: false },
      ], { cancel: false, pauses: false });
      if (ok) {
        const d = commit(s, p, witnesses(s, npc));
        if (d) {
          noteDeal(s, d);
          Sound.se(p.payNow ? 'coins' : 'confirm');
          if (p.kind === 'info_sell' && p.infoId) raw(`「${s.infos[p.infoId].text}」`, 'think');
          else line(p.kind === 'loan' ? 'gift_received' : p.kind === 'pledge' ? 'pledge_ok' : 'trust_high');
          refreshInfo();
        } else line('refuse');
      } else line('exit');
    };

    G.heroBusy = true;
    hold();
    s.flags[`heroMet_${npc}`] = true;
    learn(s, 'hero', `profile_${npc}`, 'self', 1);
    const r0 = rel(s, npc, 'hero');
    line(r0.wary > 60 || r0.hostility > 40 ? 'greetWary' : 'greeting');
    refreshInfo();
    const box = h('div', { class: 'dlg-box' }, h('div', { class: 'dlg-name' }, h('b', null, def.name), h('span', null, `${t('intro.age', { n: def.age })}　${def.job}`)), text);
    const el = h('div', { class: `overlay ${inMatch ? '' : 'clear'} dlg-screen` }, portrait, info, menu, box);
    document.body.classList.add('talking');
    layer = openLayer(el, { pausesClock: false, name: 'talk', onCancel: () => close() });
    if (opts.event?.proposal) void incoming(opts.event.proposal).then(() => !closed && buildMenu());
    else buildMenu();
  });
}
