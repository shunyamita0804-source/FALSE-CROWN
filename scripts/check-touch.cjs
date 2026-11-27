// 画面上の方向キーの回帰確認。他の参加者が入れない自分の個室で行う。npm run build と npx vite preview --port 4173 の後に実行する。
// node scripts/check-touch.cjs [URL]
const { chromium, devices } = require('playwright');
const url = process.argv[2] || 'http://localhost:4173/FALSE-CROWN/';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13 landscape'] });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await page.goto(url);
  await page.waitForTimeout(1500);
  await page.getByText('開発者メニュー').tap();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: '中央ホール', exact: true }).tap();
  await page.waitForTimeout(3000);
  const center = async (sel) => { const b = await page.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const pos = () => page.evaluate(() => { const p = window.__fc.G.state.actors.hero.pos; return `${p.room}:${p.x},${p.y}`; });
  const held = () => page.evaluate(() => window.__fc.Input.touchHeld().join(','));
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i })) });
  const dismiss = async () => { for (let k = 0; k < 4; k++) { const b = page.getByRole('button', { name: '断る' }); if (await b.count()) { await b.first().tap(); await page.waitForTimeout(300); } const box = page.locator('.dlg-box'); if (await box.count()) { await box.first().tap(); await page.waitForTimeout(300); } } };
  const place = async () => { await dismiss(); await place0(); };
  const place0 = () => page.evaluate(() => { const h = window.__fc.G.state.actors.hero; h.step = undefined; h.path = []; h.route = []; h.pos = { room: 'bedroom_hero', x: 9, y: 11, dir: 'down' }; });
  const results = [];
  const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' (' + detail + ')' : ''}`); };
  // 離したあと歩行が止まるか。歩き終わりの1歩ぶんを待ってから、位置が動かないことを見る
  const stopped = async () => { await page.waitForTimeout(500); const a = await pos(); await page.waitForTimeout(900); const b = await pos(); return { ok: a === b, detail: `${a} / ${b}` }; };
  const R = await center('.touch-pad .right'), L = await center('.touch-pad .left'), U = await center('.touch-pad .up');

  await place(); await page.waitForTimeout(300); if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  let p0 = await pos();
  await touch('touchStart', [R]); await page.waitForTimeout(900);
  check('押している間は歩く', (await pos()) !== p0 && (await held()) === 'right', `${p0} から ${await pos()}`);
  await touch('touchEnd', []);
  let s = await stopped(); check('指を離すと止まる', s.ok && (await held()) === '', s.detail);

  await place(); await touch('touchStart', [L]); await page.waitForTimeout(500);
  await touch('touchCancel', []);
  s = await stopped(); check('タッチが中断されると止まる', s.ok && (await held()) === '', s.detail);

  await place(); await touch('touchStart', [R]); await page.waitForTimeout(500);
  await touch('touchMove', [{ x: R.x + 260, y: R.y - 200 }]);
  s = await stopped(); check('指がボタンの外へ出ると止まる', s.ok && (await held()) === '', s.detail);
  await touch('touchEnd', []);

  await place(); await touch('touchStart', [R]); await page.waitForTimeout(200);
  await touch('touchMove', [U]); await page.waitForTimeout(200);
  check('別の方向へ滑らせると切り替わる', (await held()) === 'up');
  await touch('touchEnd', []);
  s = await stopped(); check('滑らせたあと離すと止まる', s.ok && (await held()) === '', s.detail);

  await place(); await touch('touchStart', [R]); await page.waitForTimeout(500);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  s = await stopped(); check('アプリが背面に回ると止まる', s.ok && (await held()) === '', s.detail);
  await touch('touchEnd', []);

  await place(); await touch('touchStart', [R]); await page.waitForTimeout(500);
  await page.evaluate(() => { document.querySelector('.touch-pad').style.display = 'none'; });
  s = await stopped(); check('ボタンが画面から消えると止まる', s.ok && (await held()) === '', s.detail);
  await page.evaluate(() => { document.querySelector('.touch-pad').style.display = ''; });
  await touch('touchEnd', []);

  await place(); await touch('touchStart', [R]); await page.waitForTimeout(500);
  await page.evaluate(() => window.__fc.G.openMenu());
  await page.waitForTimeout(300);
  check('メニューを開くと解除される', (await held()) === '');
  await touch('touchEnd', []);

  await browser.close();
  const bad = results.filter((x) => !x).length;
  console.log(bad ? `${bad} 件失敗` : `全 ${results.length} 件成功`);
  process.exit(bad ? 1 : 0);
})();
