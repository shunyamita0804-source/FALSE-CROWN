/**
 * 開会式（ゲーム開始時の導入）。中央ホールに 12 人が集まり、進行役が大会の仕組みを 7 段階で説明する。
 * 1 段階に 1 つのことだけを、図と短い言葉で示す。参加者の反応や質問を挟む。開いている間、大会の時計は止まる。
 * 手帳の「ルール」からいつでも見返せる（見返しでは参加者の反応を省く）。2 周目以降は飛ばせる。
 */
import { assetUrl } from '../assets/registry';
import { Sound } from '../audio/audio';
import { HOST, NPC_BY_ID, type NpcId } from '../data/characters';
import { CONFIG } from '../data/config';
import { t } from '../i18n/i18n';
import { bgUrl, bust, emblemUrl, icon } from './art';
import { button, clear, closeLayer, h, openLayer, type Child, type Layer } from './dom';

interface Line { who: 'host' | NpcId; text: string }
interface Stage { title: string; figure: () => Child; lines: Line[] }

const art = (path: string, cls: string): HTMLElement | null => {
  const url = assetUrl(path);
  return url ? h('img', { class: cls, src: url, alt: '', draggable: 'false' }) : null;
};
const big = (n: string, label: string, cls = '') => h('div', { class: `cer-big ${cls}` }, h('b', null, n), h('small', null, label));
const arrow = (s = '→') => h('span', { class: 'cer-arrow' }, s);
const box = (cls: string, ...c: Child[]) => h('div', { class: `cer-box ${cls}` }, ...c);

function stages(): Stage[] {
  const days = CONFIG.schedule.filter((d) => d.day <= 11);
  return [
    {
      title: t('cer.t1'),
      figure: () => h('div', { class: 'cer-row' }, big('12', t('cer.people')), arrow(), h('img', { class: 'cer-emblem', src: emblemUrl(), alt: '' }), arrow('＝'), big(t('cer.prizeN'), t('cer.prize'), 'gold')),
      lines: [
        { who: 'host', text: t('cer.h1') },
        { who: 'npc_09_asahina', text: t('cer.r1a') },
        { who: 'npc_04_mido', text: t('cer.r1b') },
      ],
    },
    {
      title: t('cer.t2'),
      figure: () => h('div', { class: 'cer-days' }, days.map((d) => h('div', { class: `cer-day${d.day === 11 ? ' final' : ''}` }, h('small', null, `DAY ${d.day}`), h('b', null, String(d.players)), h('i', null, d.day === 11 ? t('cer.final') : '−1')))),
      lines: [
        { who: 'host', text: t('cer.h2') },
        { who: 'npc_06_kiryu', text: t('cer.r2a') },
      ],
    },
    {
      title: t('cer.t3'),
      figure: () => h('div', { class: 'cer-row' },
        box('', h('small', null, '12:00'), h('b', null, t('cer.main')), h('span', null, t('cer.everyone'))), arrow(),
        h('div', { class: 'cer-split' }, box('living', h('b', null, t('house.living')), h('span', null, t('cer.upper'))), box('prison', h('b', null, t('house.prison')), h('span', null, t('cer.lower')))), arrow(),
        box('prison', h('small', null, '18:00'), h('b', null, t('cer.prisonMatch')), h('span', null, t('cer.prisonOnly'))), arrow(),
        box('out', icon('eliminated'), h('b', null, t('cer.out1')))),
      lines: [
        { who: 'host', text: t('cer.h3') },
        { who: 'npc_08_dojima', text: t('cer.r3a') },
        { who: 'host', text: t('cer.h3b') },
      ],
    },
    {
      title: t('cer.t4'),
      figure: () => h('div', { class: 'cer-col' },
        h('div', { class: 'cer-row' }, big('12', t('cer.day1')), arrow(), big('8', t('house.living'), 'living'), h('span', { class: 'cer-plus' }, '＋'), big('4', t('house.prison'), 'prison'), arrow(), big('1', t('cer.outLabel'), 'out')),
        h('div', { class: 'cer-note' }, t('cer.n4'))),
      lines: [
        { who: 'host', text: t('cer.h4') },
        { who: 'npc_03_kurose', text: t('cer.r4a') },
        { who: 'host', text: t('cer.h4b') },
      ],
    },
    {
      title: t('cer.t5'),
      figure: () => h('div', { class: 'cer-col' },
        h('div', { class: 'cer-row' }, h('div', { class: 'cer-piece' }, icon('piece_gold'), h('b', null, '× 3')), arrow(),
          box('ok', h('b', null, t('cer.use1'))), box('ok', h('b', null, t('cer.use2'))), box('ok', h('b', null, t('cer.use3')))),
        h('div', { class: 'cer-row' }, box('ng', h('b', null, `✕ ${t('cer.ban1')}`)), box('ng', h('b', null, `✕ ${t('cer.ban2')}`)), box('ng', h('b', null, `✕ ${t('cer.ban3')}`)))),
      lines: [
        { who: 'host', text: t('cer.h5') },
        { who: 'npc_10_kujo', text: t('cer.r5a') },
        { who: 'host', text: t('cer.h5b') },
      ],
    },
    {
      title: t('cer.t6'),
      figure: () => h('div', { class: 'cer-row' }, art('ui/v11/common/rescue_medal', 'cer-medal'), h('div', { class: 'cer-col' },
        h('div', { class: 'cer-row' }, box('', icon('trophy'), h('b', null, t('cer.first'))), arrow(), box('prison', h('b', null, t('cer.save1'))), arrow('⇄'), box('living', h('b', null, t('cer.swap1')))),
        h('div', { class: 'cer-note' }, t('cer.n6')))),
      lines: [
        { who: 'host', text: t('cer.h6') },
        { who: 'npc_05_shiraishi', text: t('cer.r6a') },
        { who: 'npc_12_kuze', text: t('cer.r6b') },
      ],
    },
    {
      title: t('cer.t7'),
      figure: () => h('div', { class: 'cer-col' },
        h('div', { class: 'cer-time' }, ([['07:00', 'cer.tm1'], ['12:00', 'cer.tm2'], ['14:00', 'cer.tm3'], ['18:00', 'cer.tm4'], ['20:00', 'cer.tm5'], ['21:00', 'cer.tm6'], ['22:00', 'cer.tm7']] as const).map(([tm, k]) => h('div', { class: `cer-tm${k === 'cer.tm2' || k === 'cer.tm4' ? ' hl' : ''}` }, h('b', null, tm), h('span', null, t(k))))),
        h('div', { class: 'cer-row' }, box('', icon('key_gold'), h('span', null, t('cer.life1'))), box('', icon('alliance'), h('span', null, t('cer.life2'))), box('', icon('lock'), h('span', null, t('cer.life3'))))),
      lines: [
        { who: 'host', text: t('cer.h7') },
        { who: 'npc_07_tachibana', text: t('cer.r7a') },
        { who: 'npc_11_kisaragi', text: t('cer.r7b') },
        { who: 'host', text: t('cer.h7b') },
      ],
    },
  ];
}

/** 開会式を再生する。review は手帳からの見返し（進行役の説明だけ）。skippable なら飛ばせる */
export function ceremonyScreen(opts: { review?: boolean; skippable?: boolean } = {}): Promise<void> {
  const all = stages().map((s) => (opts.review ? { ...s, lines: s.lines.filter((l) => l.who === 'host').slice(0, 1) } : s));
  return new Promise((resolve) => {
    let layer: Layer;
    let si = 0;
    let li = 0;
    const head = h('div', { class: 'tut-head' });
    const fig = h('div', { class: 'tut-fig cer-fig' });
    const say = h('div', { class: 'cer-say' });
    const foot = h('div', { class: 'tut-foot' });
    const done = () => { closeLayer(layer); resolve(); };
    const next = () => {
      const st = all[si];
      if (li < st.lines.length - 1) { li++; Sound.se('page'); drawLine(); return; }
      if (si < all.length - 1) { si++; li = 0; Sound.se('page'); draw(); return; }
      done();
    };
    const back = () => { if (si > 0) { si--; li = 0; draw(); } };
    const drawLine = () => {
      const l = all[si].lines[li];
      const isHost = l.who === 'host';
      clear(say);
      say.className = `cer-say${isHost ? ' host' : ''}`;
      say.append(
        bust(isHost ? 'host_observer' : l.who, 'normal', 'cer-bust'),
        h('div', { class: 'cer-bubble' }, h('b', null, isHost ? HOST.name : NPC_BY_ID[l.who as NpcId].name), h('p', null, l.text)));
      clear(foot);
      const last = si === all.length - 1 && li === all[si].lines.length - 1;
      foot.append(
        opts.skippable || opts.review ? button(t(opts.review ? 'common.close' : 'cer.skip'), done, { kind: 'ghost', small: true }) : h('span', null),
        h('span', { class: 'spacer' }),
        si > 0 ? button(t('common.back'), back, { small: true }) : h('span', null),
        button(t(last ? (opts.review ? 'common.close' : 'cer.end') : 'common.next'), next, { kind: 'primary', autofocus: true }));
    };
    const draw = () => {
      clear(head);
      head.append(h('span', { class: 'tut-id' }, t('cer.title')), h('b', { class: 'tut-title' }, all[si].title),
        h('span', { class: 'tut-dots' }, all.map((_, i) => h('i', { class: i === si ? 'on' : i < si ? 'past' : '' }))));
      clear(fig);
      const f = all[si].figure();
      fig.append(...(Array.isArray(f) ? (f as Node[]) : [f as Node]));
      drawLine();
    };
    draw();
    const bg = bgUrl('opening');
    layer = openLayer(h('div', { class: 'overlay solid cer-bg', style: bg ? `background-image:url("${bg}")` : '' }, h('div', { class: 'tut cer' }, head, fig, say, foot)), { pausesClock: true, name: 'ceremony' });
  });
}

/** 開会式の後：初期ピースと個室の割り当てを 1 画面で伝える */
export function handoutScreen(): Promise<void> {
  return new Promise((resolve) => {
    let layer: Layer;
    const done = () => { closeLayer(layer); resolve(); };
    Sound.se('coins');
    layer = openLayer(h('div', { class: 'overlay solid cer-bg', style: bgUrl('opening') ? `background-image:url("${bgUrl('opening')}")` : '' }, h('div', { class: 'rs' },
      h('div', { class: 'cer-row pop' }, box('', h('div', { class: 'cer-piece' }, icon('piece_gold'), h('b', null, '× 3')), h('span', null, t('cer.give1'))), box('', icon('key_gold'), h('b', null, t('cer.give2t')), h('span', null, t('cer.give2')))),
      h('div', { class: 'rs-title' }, t('cer.free')),
      h('div', { class: 'rs-text' }, t('cer.freeText')),
      h('div', { class: 'rs-foot' }, button(t('cer.go'), done, { kind: 'primary', autofocus: true })))), { pausesClock: true, name: 'handout' });
  });
}
