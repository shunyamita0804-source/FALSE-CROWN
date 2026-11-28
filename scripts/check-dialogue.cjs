// 会話表示の統一の確認（2026-11-28 本人の指示）。npm run build の後に sh scripts/with-preview.sh node scripts/check-dialogue.cjs [写真の保存先]
// 物語の場面と NPC との会話で、名札（名前｜年齢 職業を 1 行、縦幅は小さく）が台詞の枠の上の縁に半分かかり、
// 台詞は名札の下から始まり、人物の絵は枠の後ろから上に出ている（枠が手前）ことを iPhone 横画面で確かめる。
const { chromium } = require('playwright');
const { newPhoneContext } = require('./iphone.cjs');
(async () => {
  const out = process.argv[2] || null;
  const browser = await chromium.launch();
  const ctx = await newPhoneContext(browser);
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  await page.goto('http://localhost:4173/FALSE-CROWN/'); await page.waitForTimeout(1500);
  await page.getByText('開発者メニュー').tap(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: '生活棟 廊下', exact: true }).tap(); await page.waitForTimeout(900);
  for (const n of ['断る', '何でもない', 'OK']) { const b = page.getByRole('button', { name: n, exact: true }); if (await b.count()) { await b.first().tap(); await page.waitForTimeout(300); } }
  const measure = () => page.evaluate(() => {
    const r = (el) => el && el.getBoundingClientRect();
    const box = document.querySelector('.layer:last-child .dlg-box') || [...document.querySelectorAll('.dlg-box')].pop();
    const name = box.querySelector('.dlg-name'); const text = box.querySelector('.dlg-text');
    const por = [...document.querySelectorAll('.dlg-portrait')].pop();
    const b = r(box), n = r(name), t = r(text), p = r(por);
    const hit = (x, y) => document.elementFromPoint(x, y);
    const nameTop = !!hit(n.x + n.width / 2, n.y + n.height * 0.75)?.closest('.dlg-name');
    const boxOverPortrait = p && p.width ? !!hit(p.x + p.width / 2, b.y + 20)?.closest('.dlg-box') : true;
    return { b, n, t, p, nameTop, boxOverPortrait, nameText: name.textContent };
  });
  const verify = (label, m) => {
    check(`${label}：名札が枠の上の縁に半分かかる`, m.n.y < m.b.y && m.n.y + m.n.height > m.b.y && m.nameTop, `${Math.round(m.n.y)}〜${Math.round(m.n.y + m.n.height)} / 枠 ${Math.round(m.b.y)}`);
    check(`${label}：名札は 1 行で縦幅が小さい`, m.n.height < 46, String(Math.round(m.n.height)));
    check(`${label}：台詞は名札の下から`, m.t.y >= m.n.y + m.n.height - 1, `${Math.round(m.t.y)}`);
    check(`${label}：人物の絵は枠の後ろから上に出る`, !m.p || !m.p.width || (m.p.y + m.p.height > m.b.y + 10 && m.p.y < m.b.y - 100 && m.boxOverPortrait));
  };
  // 物語の場面（NPC が話す）
  void page.evaluate(() => window.__fc.G.ui.playStory([{ speaker: 'npc_05_shiraishi', text: '物語の場面の台詞。名札は枠の上の縁にかかり、台詞はその下から始まる。' }, { speaker: 'narrator', text: '地の文。' }]));
  await page.waitForTimeout(900);
  verify('物語', await measure());
  if (out) await page.screenshot({ path: `${out}/dialogue_story.png` });
  await page.locator('.dlg-box').last().tap(); await page.waitForTimeout(300);
  await page.locator('.dlg-box').last().tap(); await page.waitForTimeout(500);
  // NPC との会話
  const K = 'npc_02_kanzaki';
  await page.evaluate((K) => { const { G, sim } = window.__fc; const s = G.state; for (const [id, a] of Object.entries(s.actors)) { if (id === 'hero') continue; a.talkCd = { hero: 1e15 }; a.goal = undefined; a.path = []; a.route = []; a.step = undefined; a.nextThink = 1e15; if (id !== K) { sim.placeIn(s, id, 'dining'); a.busyUntil = 1e15; } } const h = s.actors.hero; h.step = undefined; h.path = []; sim.placeIn(s, 'hero', 'living_hallway', { x: 14, y: 5 }); h.pos.dir = 'right'; sim.placeIn(s, K, 'living_hallway', { x: 15, y: 5 }); s.actors[K].busyUntil = 0; }, K);
  await page.waitForTimeout(300);
  await page.evaluate((K) => window.__fc.G.interact({ kind: 'npc', id: K }), K);
  await page.waitForTimeout(800);
  if (await page.locator('.talk-menu').count()) {
    const m = await measure();
    verify('会話', m);
    check('会話：名札に名前と年齢・職業', /歳/.test(m.nameText), m.nameText);
    if (out) await page.screenshot({ path: `${out}/dialogue_talk.png` });
  } else check('会話の画面が開く', false);
  check('画面のエラーなし', errs.length === 0, errs.slice(0, 2).join(' / '));
  await browser.close();
  console.log(res.every(Boolean) ? 'すべて合格' : '不合格あり');
  process.exit(res.every(Boolean) ? 0 : 1);
})();
