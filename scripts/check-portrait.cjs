// 会話の立ち絵の確認：全員に話しかけ、立ち絵と「所持」の札が重ならないこと、表情の画像が読み込めることを調べる。
// npm run build と npx vite preview --port 4173 の後に実行する。 node scripts/check-portrait.cjs [スクリーンショットの保存先]
const { chromium, devices } = require('playwright');
(async () => {
  const out = process.argv[2] || null;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13 landscape'] });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  await page.goto('http://localhost:4173/FALSE-CROWN/'); await page.waitForTimeout(1500);
  await page.getByText('開発者メニュー').tap(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: '生活棟 廊下', exact: true }).tap(); await page.waitForTimeout(900);
  for (const n of ['断る', '何でもない', 'OK']) { const b = page.getByRole('button', { name: n, exact: true }); if (await b.count()) { await b.first().tap(); await page.waitForTimeout(300); } }
  const ids = await page.evaluate(() => Object.keys(window.__fc.G.state.actors).filter((k) => k !== 'hero'));
  for (const K of ids) {
    await page.evaluate((K) => { const { G, sim } = window.__fc; const s = G.state; s.phaseLeft = 250000; for (const [id, a] of Object.entries(s.actors)) { if (id === 'hero') continue; a.talkCd = { hero: 1e15 }; a.goal = undefined; a.path = []; a.route = []; a.step = undefined; a.nextThink = 1e15; if (id !== K) { sim.placeIn(s, id, 'dining'); a.busyUntil = 1e15; } } const h = s.actors.hero; h.step = undefined; h.path = []; sim.placeIn(s, 'hero', 'living_hallway', { x: 14, y: 5 }); h.pos.dir = 'right'; sim.placeIn(s, K, 'living_hallway', { x: 15, y: 5 }); s.actors[K].busyUntil = 0; }, K);
    await page.waitForTimeout(300);
    await page.evaluate((K) => window.__fc.G.interact({ kind: 'npc', id: K }), K);
    await page.waitForTimeout(700);
    const r = await page.evaluate(() => {
      const p = document.querySelector('.dlg-portrait'); const i = document.querySelector('.talk-info');
      if (!p || !i) return null;
      const a = p.getBoundingClientRect(), b = i.getBoundingClientRect();
      return { overlap: !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top), bg: p.style.backgroundImage, pt: Math.round(a.top), ib: Math.round(b.bottom) };
    });
    check(`${K} 立ち絵と所持の札が重ならない`, r && !r.overlap, JSON.stringify(r));
    if (out) await page.screenshot({ path: `${out}/talk_${K}.png` });
    for (const n of ['何でもない', '終了']) { const b = page.getByRole('button', { name: n, exact: true }); if (await b.count()) { await b.first().tap(); await page.waitForTimeout(300); break; } }
    await page.waitForTimeout(300);
  }
  check('画面のエラーがない', errs.length === 0, errs.join(' | '));
  console.log(res.every(Boolean) ? 'ALL OK' : 'SOME FAILED');
  await browser.close();
})();
