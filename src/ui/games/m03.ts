/**
 * M03 ツイン・リンクの画面。盤面を中央に大きく置き、4 問は左の札で切り替える。
 * 準備の段階：組の相手と、相手の 4 問目について自分だけが持つ手掛かりを見せ、教えるかどうかを選ぶ。
 * 解く段階：完成した問題は固定され、次の未完成の問題へ移る。4 問とも完成した瞬間に自動で提出する。時間切れの時は、その時点の経路で採点する。
 */
import { Sound } from '../../audio/audio';
import { transfer } from '../../core/state';
import type { CharId, NpcId } from '../../data/characters';
import { t } from '../../i18n/i18n';
import { AID_COST, PAIR_BONUS, PAIR_NEED, POINTS, PUZZLES, ROUND_MS, type M03Move, type M03Result, type M03View } from '../../matches/m03';
import { face } from '../art';
import { button, confirmDialog, h, type Child } from '../dom';
import { LinkBoard } from '../linkboard';
import type { MatchUi } from '../matchui';

interface Local {
  boards?: LinkBoard[];
  ms?: number[];
  cur?: number;
  timer?: ReturnType<typeof setInterval>;
  mate?: HTMLElement;
  share?: boolean;
  sent?: boolean;
}

function standings(v: M03View, ui: MatchUi, limit = 12): HTMLElement {
  const order = [...v.players].sort((a, b) => v.totals[b] - v.totals[a]);
  const me = v.self as CharId;
  return h('div', { class: 'm01-rank' }, order.slice(0, limit).map((p, i) => h('div', { class: `m01-rankrow${p === me ? ' me' : ''}${p === v.partner ? ' mate' : ''}` },
    h('span', { class: 'no' }, String(i + 1)), face(p), h('span', { class: 'nm' }, ui.name(p)), h('b', null, String(v.totals[p])))));
}

/** 完成した問題の数を、4 つの印で示す */
const pips = (done: number) => h('span', { class: 'm03-pips' }, Array.from({ length: PUZZLES }, (_, i) => h('i', { class: i < done ? 'on' : '' })));

function resultBox(v: M03View, ui: MatchUi, r: M03Result, roundNo: number): Child {
  const me = v.self as CharId;
  const mate = r.partner ? v.results[r.partner]?.[roundNo - 1] : undefined;
  return [
    h('div', { class: 'm01-big' }, t('m03.roundResult', { n: roundNo })),
    h('div', { class: 'm01-score' },
      h('div', { class: `m01-chip${r.done ? ' on' : ''}` }, h('small', null, t('m03.solved', { n: r.done })), h('b', null, String(r.points))),
      h('span', { class: 'plus' }, '+'),
      h('div', { class: `m01-chip${r.bonus ? ' on' : ''}` }, h('small', null, t('m03.pairBonus')), h('b', null, String(r.bonus))),
      h('span', { class: 'plus' }, '='),
      h('div', { class: 'm01-chip total' }, h('small', null, t('m03.roundPts')), h('b', null, String(r.points + r.bonus)))),
    h('div', { class: 'm03-pair' },
      h('div', { class: 'm03-who me' }, face(me), h('span', { class: 'nm' }, ui.name(me)), pips(r.done), r.gave ? h('span', { class: 'm03-tag' }, t('m03.gave')) : null),
      r.partner && mate ? h('div', { class: 'm03-who' }, face(r.partner), h('span', { class: 'nm' }, ui.name(r.partner)), pips(mate.done), h('span', { class: `m03-tag${r.got ? '' : ' off'}` }, t(r.got ? 'm03.got' : 'm03.notGot'))) : null),
  ];
}

export function renderM03(v: M03View, ui: MatchUi): { main: Child; side: Child } {
  const me = v.self as CharId;
  const L = ui.local as Local;
  const watching = v.self === 'spectator';
  const rank = h('div', { class: 'box scroll grow' }, h('h4', null, t('m01.rank')), standings(v, ui));

  if (v.phase === 'done' || watching) {
    const last = v.results[me]?.[v.rounds - 1];
    return { main: [h('div', { class: 'm01-break' }, last && !watching ? resultBox(v, ui, last, v.rounds) : h('div', { class: 'm01-big' }, t('m03.watching')))], side: [rank] };
  }

  if (v.phase === 'prep') {
    const prev = v.round > 0 ? v.results[me]?.[v.round - 1] : undefined;
    const waiting = !!v.ready[me];
    const hold = v.holding && v.holdingBoard ? new LinkBoard(v.holdingBoard, { readonly: true, cell: Math.floor(210 / v.holdingBoard.size) }) : null;
    hold?.setMarks({ color: v.holding!.color, cells: [v.holding!.cell] }, null);
    const choose = (share: boolean) => {
      L.share = share;
      ui.submit({ t: 'ready', share } satisfies M03Move);
    };
    const main = [
      h('div', { class: 'm03-prep' },
        prev ? h('div', { class: 'm03-prev' }, resultBox(v, ui, prev, v.round)) : null,
        h('div', { class: 'm03-next' },
          h('div', { class: 'm01-big' }, t('m03.roundTitle', { n: v.round + 1, max: v.rounds })),
          v.partner
            ? h('div', { class: 'm03-partner' }, face(v.partner), h('div', { class: 'col' }, h('small', { class: 'dim' }, t('m03.partner')), h('b', null, ui.name(v.partner))),
              waiting ? null : button(t('m01.talk'), () => ui.talk(v.partner as NpcId), { small: true }))
            : h('div', { class: 'dim' }, t('m03.noPartner')),
          hold ? h('div', { class: 'm03-hold' }, hold.el, h('div', { class: 'col', style: 'gap:8px' },
            h('div', { class: 'small' }, t('m03.holdText', { name: ui.name(v.partner!) })),
            waiting
              ? h('div', { class: 'gold' }, t(L.share ?? v.sharing ? 'm03.choseShare' : 'm03.choseKeep'))
              : h('div', { class: 'row', style: 'gap:10px' }, button(t('m03.share'), () => choose(true), { kind: 'primary' }), button(t('m03.keep'), () => choose(false))),
            h('div', { class: 'small dim' }, t('m03.holdNote', { n: PAIR_NEED, b: PAIR_BONUS })))) : (!waiting ? button(t('m03.start'), () => choose(false), { kind: 'primary', autofocus: true }) : null))),
    ];
    return { main, side: [rank] };
  }

  // 解く段階
  if (v.submitted) {
    return { main: [h('div', { class: 'm01-break' }, h('div', { class: 'm01-big' }, t('m03.waiting')))], side: [rank] };
  }
  if (!L.boards) {
    L.ms = new Array<number>(PUZZLES).fill(-1);
    L.cur = 0;
    const submit = () => {
      if (L.sent) return;
      L.sent = true;
      ui.timeoutMove = undefined;
      ui.submit({ t: 'solve', sols: L.boards!.map((b) => b.paths.map((p) => [...p])), ms: [...L.ms!] } satisfies M03Move);
    };
    L.boards = v.puzzles.map((pz, i) => new LinkBoard(pz, {
      onChange: () => ui.rerender(),
      onComplete: () => {
        const b = L.boards![i];
        b.lock();
        L.ms![i] = Math.min(ROUND_MS, Math.max(1, ui.elapsed()));
        Sound.se('result');
        const next = L.boards!.findIndex((x) => !x.complete);
        // 完成の演出を一瞬見せてから、次の問題へ移る（全問完成なら提出する）
        setTimeout(() => {
          if (next < 0) submit();
          else if (L.cur === i) { L.cur = next; ui.rerender(); }
        }, 500);
      },
    }));
    ui.timeoutMove = () => ({ t: 'solve', sols: L.boards!.map((b) => b.paths.map((p) => [...p])), ms: [...L.ms!] } satisfies M03Move);
    L.mate = h('div', { class: 'm03-mate' });
    const tick = () => {
      if (!L.mate || !L.mate.isConnected) {
        if (L.timer && !L.boards?.[L.cur ?? 0]?.el.isConnected) clearInterval(L.timer);
        return;
      }
      const el = ui.elapsed();
      const times = (L.mate.dataset.times ?? '').split(',').filter(Boolean).map(Number);
      const done = times.filter((x) => x >= 0 && x <= el).length;
      if (String(done) !== L.mate.dataset.done) {
        if (L.mate.dataset.done !== undefined && done > Number(L.mate.dataset.done)) Sound.se('chip', { volume: 0.5 });
        L.mate.dataset.done = String(done);
        L.mate.querySelector('.m03-pips')?.replaceWith(pips(done));
      }
    };
    L.timer = setInterval(tick, 400);
  }
  const boards = L.boards;
  const cur = L.cur ?? 0;
  boards.forEach((b, i) => b.setMarks(v.clue && v.clue.puzzle === i ? { color: v.clue.color, cells: [v.clue.cell] } : null, v.aid && v.aid.puzzle === i ? { color: v.aid.color, cells: v.aid.cells } : null));
  if (L.mate && v.partner) {
    L.mate.dataset.times = (v.mate?.times ?? []).join(',');
    const done = Number(L.mate.dataset.done ?? 0);
    L.mate.replaceChildren(face(v.partner), h('span', { class: 'nm' }, ui.name(v.partner)), pips(done));
  }
  const tabs = h('div', { class: 'm03-tabs' }, boards.map((b, i) => {
    const el = h('button', { class: `m03-tab${i === cur ? ' sel' : ''}${b.complete ? ' done' : ''}`, type: 'button', 'data-tab': String(i) },
      h('b', null, String(i + 1)), h('small', null, b.complete ? t('m01.done') : `${b.connected} / ${b.puzzle.ends.length}`),
      v.clue && v.clue.puzzle === i ? h('i', { class: 'm03-dot', title: t('m03.clueTag') }, '◆') : null);
    el.addEventListener('click', () => { L.cur = i; ui.rerender(); });
    return el;
  }), button(t('m03.clear'), () => boards[cur].reset(), { small: true, kind: 'ghost', disabled: boards[cur].complete }));
  const hero = ui.state.actors.hero;
  const aidBtn = button(t('m03.aid', { n: AID_COST }), async () => {
    if (!(await confirmDialog(t('m01.hintTitle'), t('m03.aidText', { n: AID_COST, have: hero.pieces, q: cur + 1 }), { ok: t('m01.hintOk', { n: AID_COST }), cancel: t('common.cancel'), pauses: false }))) return;
    if (v.aidUsed || hero.pieces < AID_COST || !transfer(ui.state, 'hero', 'host', AID_COST, 'M03 補助')) return;
    Sound.se('coins');
    ui.submit({ t: 'aid', puzzle: L.cur ?? 0 } satisfies M03Move);
  }, { small: true, disabled: v.aidUsed || hero.pieces < AID_COST || boards[cur].complete, title: t('m03.aidOnce') });
  const solved = boards.filter((b) => b.complete).length;
  const side = [
    h('div', { class: 'box' }, h('h4', null, t('m03.partner')), v.partner ? L.mate : h('div', { class: 'dim small' }, t('m03.noPartner')),
      h('div', { class: 'small dim', style: 'margin-top:4px' }, t('m03.pairNote', { n: PAIR_NEED, b: PAIR_BONUS })),
      h('div', { class: 'small', style: 'margin-top:4px' }, v.clue ? h('span', { class: 'gold' }, t('m03.clueGot', { q: v.clue.puzzle + 1 })) : h('span', { class: 'dim' }, t('m03.clueNone')))),
    h('div', { class: 'box' }, h('h4', null, t('m03.mine')), h('div', { class: 'row', style: 'gap:8px;align-items:center' }, pips(solved), h('b', null, `${solved * POINTS}`))),
    h('div', { class: 'box' }, h('h4', null, t('m01.aid')), aidBtn, h('div', { class: 'small dim', style: 'margin-top:4px' }, v.aidUsed ? t('m01.hintUsed') : t('m03.aidOnce'))),
    h('div', { class: 'box scroll grow' }, h('h4', null, t('m01.rank')), standings(v, ui, 4)),
  ];
  return { main: [h('div', { class: 'm03-play' }, tabs, boards[cur].el)], side };
}
