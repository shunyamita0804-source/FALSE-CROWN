/**
 * M01 ピース・アセンブルの画面。盤面とピースを中央に大きく置き、文字は最小限にする。
 * 完成した瞬間に自動で提出する（速さが得点になるため）。時間切れの時は、その時点の配置で採点する。
 */
import { Sound } from '../../audio/audio';
import { transfer } from '../../core/state';
import type { CharId, NpcId } from '../../data/characters';
import { t } from '../../i18n/i18n';
import { HINT_COST, STAGE_MS, type M01Move, type M01Result, type M01View } from '../../matches/m01';
import { freeCount } from '../../matches/poly';
import { face } from '../art';
import { button, confirmDialog, h, type Child } from '../dom';
import type { MatchUi } from '../matchui';
import { PolyBoard } from '../polyboard';

interface Local { board?: PolyBoard; mates?: HTMLElement; timer?: ReturnType<typeof setInterval>; fill?: HTMLElement }

const pts = (r: M01Result) => r.base + r.speed + r.team;

/** 順位の小さな一覧（合計点の高い順） */
function standings(v: M01View, ui: MatchUi, limit = 12): HTMLElement {
  const order = [...v.players].sort((a, b) => v.totals[b] - v.totals[a]);
  const me = v.self as CharId;
  return h('div', { class: 'm01-rank' }, order.slice(0, limit).map((p, i) => h('div', { class: `m01-rankrow${p === me ? ' me' : ''}${v.myGroup.includes(p) ? ' mate' : ''}` },
    h('span', { class: 'no' }, String(i + 1)), face(p), h('span', { class: 'nm' }, ui.name(p)), h('b', null, String(v.totals[p])))));
}

function resultLine(r: M01Result | undefined): Child {
  if (!r) return null;
  return h('span', { class: 'm01-res' }, h('b', { class: r.complete ? 'good' : 'bad' }, r.complete ? t('m01.done') : t('m01.notDone')), ` ${r.base}`, r.speed ? h('span', { class: 'gold' }, ` +${r.speed}`) : null, r.team ? h('span', { class: 'good' }, ` +${r.team}`) : null);
}

export function renderM01(v: M01View, ui: MatchUi): { main: Child; side: Child } {
  const me = v.self as CharId;
  const L = ui.local as Local;
  const playing = v.phase === 'solve' && v.self !== 'spectator' && !v.submitted;

  if (!playing) {
    // 休憩と終了：このステージの結果を図と点数で見せる
    const stageNo = v.phase === 'done' ? v.stages : v.stage + 1;
    const mine = v.results[me]?.[stageNo - 1];
    const allDone = v.myGroup.every((p) => v.results[p]?.[stageNo - 1]?.complete);
    const main = [
      h('div', { class: 'm01-break' },
        h('div', { class: 'm01-big' }, t('m01.stageResult', { n: stageNo })),
        mine ? h('div', { class: 'm01-score' },
          h('div', { class: `m01-chip${mine.complete ? ' on' : ''}` }, h('small', null, t(mine.complete ? 'm01.done' : 'm01.cover', { n: mine.covered, max: freeCount(v.puzzle) })), h('b', null, String(mine.base))),
          h('span', { class: 'plus' }, '+'),
          h('div', { class: `m01-chip${mine.speed ? ' on' : ''}` }, h('small', null, mine.complete ? t('m01.speedAt', { s: Math.round(mine.ms / 1000) }) : t('m01.speed')), h('b', null, String(mine.speed))),
          h('span', { class: 'plus' }, '+'),
          h('div', { class: `m01-chip${mine.team ? ' on' : ''}` }, h('small', null, t('m01.team')), h('b', null, String(mine.team))),
          h('span', { class: 'plus' }, '='),
          h('div', { class: 'm01-chip total' }, h('small', null, t('m01.stagePts')), h('b', null, String(pts(mine))))) : null,
        h('div', { class: 'm01-group' }, h('h4', null, t(allDone ? 'm01.groupAll' : 'm01.groupSome')),
          h('div', { class: 'm01-mates' }, v.myGroup.map((p) => h('div', { class: `m01-mate${p === me ? ' me' : ''}` }, face(p), h('span', { class: 'nm' }, ui.name(p)), resultLine(v.results[p]?.[stageNo - 1]),
            p !== me && v.phase === 'break' && v.self !== 'spectator' ? button(t('m01.talk'), () => ui.talk(p as NpcId), { small: true }) : null)))),
        v.phase === 'break' && v.self !== 'spectator' && !v.ready[me]
          ? h('div', { class: 'row', style: 'justify-content:center;gap:12px' }, stageNo === Math.floor(v.stages / 2) ? h('span', { class: 'gold' }, t('m01.regroup')) : null, button(t('m01.next', { n: v.stage + 2 }), () => ui.submit({ t: 'ready' } satisfies M01Move), { kind: 'primary', autofocus: true }))
          : null),
    ];
    return { main, side: [h('div', { class: 'box scroll grow' }, h('h4', null, t('m01.rank')), standings(v, ui))] };
  }

  if (!L.board) {
    const board = new PolyBoard(v.puzzle, {
      onChange: () => { if (L.fill) L.fill.textContent = ''; },
      onComplete: (placed) => {
        board.lock();
        ui.timeoutMove = undefined;
        // 完成の演出を一瞬見せてから提出する（時間は完成した瞬間のもの）
        const ms = Math.min(STAGE_MS, ui.elapsed());
        setTimeout(() => ui.submit({ t: 'solve', placed, ms } satisfies M01Move), 450);
      },
    });
    L.board = board;
    ui.timeoutMove = () => ({ t: 'solve', placed: board.placed, ms: STAGE_MS } satisfies M01Move);
    // 同じ組の人が完成した時刻になったら表示する
    L.mates = h('div', { class: 'm01-mates live' });
    const tick = () => {
      if (!L.mates || !L.mates.isConnected) {
        if (L.timer && !L.board?.el.isConnected) clearInterval(L.timer);
        return;
      }
      const el = ui.elapsed();
      for (const row of L.mates.querySelectorAll<HTMLElement>('[data-ms]')) {
        const done = Number(row.dataset.ms) <= el && row.dataset.ok === '1';
        if (done && !row.classList.contains('done')) {
          row.classList.add('done');
          row.querySelector('.st')!.textContent = t('m01.mateDone', { s: Math.round(Number(row.dataset.ms) / 1000) });
          Sound.se('chip');
        }
      }
    };
    L.timer = setInterval(tick, 400);
  }
  L.board.setHint(v.hint);
  if (L.mates) {
    L.mates.replaceChildren(...v.myGroup.filter((p) => p !== me).map((p) => {
      const m = v.mates.find((x) => x.id === p);
      return h('div', { class: 'm01-mate', 'data-ms': String(m?.ms ?? 1e9), 'data-ok': m?.complete ? '1' : '0' }, face(p), h('span', { class: 'nm' }, ui.name(p)), h('span', { class: 'st dim' }, t('m01.mateWorking')));
    }));
  }
  const hero = ui.state.actors.hero;
  const hintBtn = button(t('m01.hint', { n: HINT_COST }), async () => {
    if (!(await confirmDialog(t('m01.hintTitle'), t('m01.hintText', { n: HINT_COST, have: hero.pieces }), { ok: t('m01.hintOk', { n: HINT_COST }), cancel: t('common.cancel'), pauses: false }))) return;
    // 使う直前に残高を確かめる
    if (v.hintUsed || hero.pieces < HINT_COST || !transfer(ui.state, 'hero', 'host', HINT_COST, 'M01 ヒント')) return;
    Sound.se('coins');
    ui.submit({ t: 'hint' } satisfies M01Move);
  }, { small: true, disabled: v.hintUsed || hero.pieces < HINT_COST, title: t('m01.hintOnce') });
  const side = [
    h('div', { class: 'box' }, h('h4', null, t('m01.myGroup')), L.mates, h('div', { class: 'small dim', style: 'margin-top:4px' }, t('m01.teamNote'))),
    h('div', { class: 'box' }, h('h4', null, t('m01.aid')), hintBtn, h('div', { class: 'small dim', style: 'margin-top:4px' }, v.hintUsed ? t('m01.hintUsed') : t('m01.hintOnce'))),
    h('div', { class: 'box scroll grow' }, h('h4', null, t('m01.rank')), standings(v, ui, 5)),
  ];
  return { main: [h('div', { class: 'm01-play' }, L.board.el)], side };
}
