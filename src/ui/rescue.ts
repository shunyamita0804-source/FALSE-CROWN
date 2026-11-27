/**
 * 救いのメダルの画面（v11）。獲得の演出、使う相手の選択、結果と確定配属の発表。
 * 文章は短くし、誰が誰と入れ替わるかを顔と矢印で示す。
 */
import { G } from '../app/game';
import { assetUrl } from '../assets/registry';
import { Sound } from '../audio/audio';
import { playVoice } from '../audio/voice';
import type { CharId, NpcId } from '../data/characters';
import { aliveIds, nameOf, shortName } from '../core/state';
import { applyRescue, declineRescue, forgoRescue, issueMedal, npcAcceptsRescue, provisional, rescueCandidates, resolveNpcRescue } from '../core/rescue';
import { t } from '../i18n/i18n';
import { face } from './art';
import { button, choose, closeLayer, h, openLayer, type Child, type Layer } from './dom';

const img = (path: string, cls: string): HTMLElement | null => {
  const url = assetUrl(path);
  return url ? h('img', { class: cls, src: url, alt: '', draggable: 'false' }) : null;
};

const person = (id: CharId, cls = ''): HTMLElement => h('div', { class: `rs-person ${cls}${id === 'hero' ? ' me' : ''}` }, face(id), h('span', null, shortName(G.state!, id)));

function wings(): HTMLElement {
  const s = G.state!;
  const ranking = s.today.mainRanking ?? aliveIds(s);
  const of = (house: 'living' | 'prison') => ranking.filter((id) => s.actors[id].house === house);
  const r = s.today.rescue;
  const mark = (id: CharId) => (r?.status === 'used' && (id === r.target || id === r.swapped) ? 'moved' : '');
  return h('div', { class: 'rs-wings' },
    h('div', { class: 'rs-wing living' }, h('b', null, t('house.living')), h('div', { class: 'rs-faces' }, of('living').map((id) => person(id, mark(id))))),
    h('div', { class: 'rs-wing prison' }, h('b', null, t('house.prison')), h('div', { class: 'rs-faces' }, of('prison').map((id) => person(id, mark(id))))));
}

function screen(build: (close: (v: unknown) => void) => Child, name: string): Promise<unknown> {
  return new Promise((resolve) => {
    let layer: Layer;
    const close = (v: unknown) => { closeLayer(layer); resolve(v); };
    layer = openLayer(h('div', { class: 'overlay solid result-bg' }, h('div', { class: 'rs' }, build(close))), { pausesClock: true, name });
  });
}

/** 獲得の演出 */
function awarded(holder: CharId): Promise<unknown> {
  Sound.se('result');
  return screen((close) => [
    h('div', { class: 'rs-medal pop' }, img('ui/v11/common/rescue_medal', 'rs-medal-img'), h('div', { class: 'rs-holder' }, face(holder))),
    h('div', { class: 'rs-title' }, t('rescue.awarded', { name: nameOf(G.state!, holder) })),
    h('div', { class: 'rs-text' }, t('rescue.what')),
    h('div', { class: 'rs-foot' }, button(t('common.next'), () => close(null), { kind: 'primary', autofocus: true })),
  ], 'rescue-awarded');
}

/** 主人公が 1 位：誰を救うかを選ぶ。戻り値は指名した相手（使わないなら null） */
function pick(note: string): Promise<CharId | null> {
  const s = G.state!;
  const { lowestLiving } = provisional(s);
  const cands = rescueCandidates(s);
  return screen((close) => {
    let sel: CharId | null = null;
    const row = h('div', { class: 'rs-swap' });
    const use = button(t('rescue.use'), () => close(sel), { kind: 'primary', disabled: true });
    const draw = () => {
      row.replaceChildren(
        h('div', { class: 'rs-col' }, h('small', null, t('rescue.toPrison')), h('div', { class: 'rs-faces' }, cands.map((id) => {
          const b = h('button', { class: `rs-pick${sel === id ? ' on' : ''}`, type: 'button', onclick: () => { sel = id; Sound.se('select'); (use as HTMLButtonElement).disabled = false; draw(); } }, face(id), h('span', null, shortName(s, id)));
          return b;
        }))),
        h('div', { class: 'rs-arrow' }, sel ? '⇄' : '？'),
        h('div', { class: 'rs-col' }, h('small', null, t('rescue.swapWith')), h('div', { class: 'rs-faces' }, lowestLiving ? person(lowestLiving, 'fixed') : null)),
      );
    };
    draw();
    return [
      h('div', { class: 'rs-head' }, img('ui/v11/common/rescue_medal_icon', 'rs-ic'), h('b', null, t('rescue.pickTitle'))),
      row,
      h('div', { class: 'rs-text' }, note || t('rescue.pickText')),
      h('div', { class: 'rs-foot' }, button(t('rescue.forgo'), () => close(null), {}), use),
    ];
  }, 'rescue-pick') as Promise<CharId | null>;
}

/** 結果と確定配属 */
function result(): Promise<unknown> {
  const s = G.state!;
  const r = s.today.rescue!;
  const used = r.status === 'used';
  if (used) Sound.se('result');
  return screen((close) => [
    used
      ? h('div', { class: 'rs-effect pop' }, img('ui/v11/common/rescue_effect', 'rs-effect-img'), h('div', { class: 'rs-effect-in' }, person(r.swapped!, 'down'), h('span', { class: 'rs-arrow' }, '⇄'), person(r.target!, 'up')))
      : h('div', { class: 'rs-head' }, img('ui/v11/common/rescue_medal_icon', 'rs-ic dim'), h('b', null, t('rescue.forgone', { name: shortName(s, r.holder) }))),
    used ? h('div', { class: 'rs-title' }, t('rescue.used', { holder: shortName(s, r.holder), target: shortName(s, r.target!), swapped: shortName(s, r.swapped!) })) : null,
    h('div', { class: 'rs-sub' }, t('rescue.final')),
    wings(),
    h('div', { class: 'rs-foot' }, button(t('common.next'), () => close(null), { kind: 'primary', autofocus: true })),
  ], 'rescue-result');
}

/** 順位発表の後に呼ぶ。メダルの発行から確定配属の発表までを進める。途中で保存して再開しても二重に使われない */
export async function rescueFlow(): Promise<void> {
  const s = G.state!;
  const r = issueMedal(s);
  if (!r) return;
  if (r.status === 'pending') {
    await awarded(r.holder);
    if (r.holder === 'hero') {
      let note = '';
      for (let guard = 0; guard < 6 && r.status === 'pending'; guard++) {
        if (!rescueCandidates(s).length) { forgoRescue(s, 'hero'); break; }
        const target = await pick(note);
        if (!target) { forgoRescue(s, 'hero'); break; }
        if (target !== 'hero' && !npcAcceptsRescue(s, target as NpcId, 'hero')) {
          declineRescue(s, target);
          playVoice(target, 'refuse');
          note = t('rescue.declined', { name: shortName(s, target) });
          Sound.se('error');
          continue;
        }
        applyRescue(s, 'hero', target);
        playVoice(target, 'thanks');
      }
      if (r.status === 'pending') forgoRescue(s, 'hero');
    } else {
      await resolveNpcRescue(s, (holder, swapped) => choose(t('rescue.askTitle'), t('rescue.askText', { holder: shortName(s, holder), swapped: shortName(s, swapped) }), [
        { label: t('rescue.accept'), value: true, kind: 'primary' },
        { label: t('rescue.decline'), value: false },
      ]));
    }
  }
  await result();
}
