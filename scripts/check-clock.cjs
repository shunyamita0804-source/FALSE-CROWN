// ゲーム内時計と消灯の確認（v10）。npm run build と npx vite preview --port 4173 の後に実行する。
// node scripts/check-clock.cjs [スクリーンショットの保存先]
const { chromium, devices } = require('playwright');
(async () => {
  const out = process.argv[2] || null;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13 landscape'] });
  const page = await ctx.newPage();
  const errs = []; page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); page.on('pageerror', (e) => errs.push(String(e)));
  const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  const hud = async () => (await page.locator('.hud-band').innerText()).replace(/\s+/g, ' ');
  const st = () => page.evaluate(() => { const s = window.__fc.G.state; return { day: s.day, phase: s.phase, left: Math.round(s.phaseLeft), room: s.actors.hero.pos.room }; });
  const quiet = () => page.evaluate(() => { const s = window.__fc.G.state; for (const [i, a] of Object.entries(s.actors)) if (i !== 'hero') { a.talkCd = { ...(a.talkCd || {}), hero: 1e15 }; if (a.goal && (a.goal.target === 'hero')) a.goal = undefined; } });
  await page.goto('http://localhost:4173/FALSE-CROWN/'); await page.waitForTimeout(1500);
  await page.getByText('開発者メニュー').tap(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'DAY1 夜', exact: true }).tap(); await page.waitForTimeout(3500);
  await quiet();
  let h1 = await hud(); let s1 = await st();
  check('夜は 19:00 台で始まり、次の予定が出る', /19:0\d/.test(h1) && h1.includes('夕食'), h1);
  if (out) await page.screenshot({ path: out + '/clock_hud.png' });
  await page.waitForTimeout(3000);
  const s2 = await st();
  check('時計は実時間 約 1.4 秒で 1 分進む', Math.abs((s1.left - s2.left) - 2100) < 600, `${s1.left - s2.left}ms`);
  // 手帳を開いている間は止まる
  await page.getByRole('button', { name: /手帳/ }).tap(); await page.waitForTimeout(300);
  const a = await st(); await page.waitForTimeout(1500); const b = await st();
  check('手帳を開いている間は時計が止まる', a.left === b.left, `${a.left}/${b.left}`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  if ((await st()).left === b.left) { const c = page.getByRole('button', { name: '閉じる' }); if (await c.count()) await c.first().tap(); await page.waitForTimeout(300); }
  // 21:29 → 30 分前の通知
  await quiet();
  await page.evaluate(() => { window.__fc.G.state.phaseLeft = 31_000; });
  await page.waitForTimeout(1800);
  const toast1 = (await page.locator('.toast').allInnerTexts()).join('|');
  check('消灯 30 分前の通知', toast1.includes('消灯') && toast1.includes('30'), toast1);
  await page.evaluate(() => { window.__fc.G.state.phaseLeft = 9_000; });
  await page.waitForTimeout(700);
  const h2 = await hud();
  check('締切 10 分前から HUD が警告表示', await page.locator('.hud-timer.low').count() === 1, h2);
  await page.evaluate(() => { window.__fc.G.state.phaseLeft = 400; });
  await page.waitForTimeout(3000);
  const dlg = (await page.locator('.layer').allInnerTexts()).join('|').replace(/\s+/g, ' ');
  check('22:00 に消灯の案内が出る', dlg.includes('22:00') && dlg.includes('消灯'), dlg.slice(-120));
  if (out) await page.screenshot({ path: out + '/clock_curfew.png' });
  await page.getByRole('button', { name: '次へ' }).tap(); await page.waitForTimeout(800);
  const s3 = await st();
  // 監獄棟へ送られた日は、監獄棟の個室が割り当てられている
  const home = await page.evaluate(() => (window.__fc.G.state.rooms || {}).hero || 'bedroom_hero');
  check('消灯後は全員が、割り当てられた個室にいる', s3.phase === 'curfew' && await page.evaluate(() => { const s = window.__fc.G.state; return Object.values(s.actors).filter((a) => a.alive).every((a) => a.pos.room === ((s.rooms || {})[a.id] || 'bedroom_' + a.id)); }), JSON.stringify(s3));
  const h3 = await hud();
  check('消灯中の HUD は 22:00 で止まる', h3.includes('22:00'), h3);
  // 扉から出られない
  await page.evaluate(() => { const { G, sim } = window.__fc; const s = G.state; const h = s.actors.hero; const d = window.__fc.rooms[h.pos.room].doors[0]; h.pos.x = d.tiles[0].x; h.pos.y = d.tiles[0].y; h.pos.dir = 'down'; });
  for (let i = 0; i < 6; i++) { await page.keyboard.down('ArrowDown'); await page.waitForTimeout(250); await page.keyboard.up('ArrowDown'); await page.keyboard.press('Enter'); await page.waitForTimeout(150); }
  const s4 = await st();
  check('消灯後は個室から出られない', s4.room === home, s4.room + ' ' + (await page.locator('.toast').allInnerTexts()).join('|'));
  // 寝台で眠る
  await page.evaluate(() => { const { G } = window.__fc; const s = G.state; const h = s.actors.hero; h.step = undefined; h.path = []; });
  // 寝台の調査地点の前へ
  const ok = await page.evaluate(async () => { const { G } = window.__fc; const mod = G; const s = G.state; const h = s.actors.hero; for (let y = 2; y < 13; y++) for (let x = 1; x < 19; x++) { h.pos.x = x; h.pos.y = y; for (const dir of ['up', 'left', 'right', 'down']) { h.pos.dir = dir; const tg = G.field.findTarget(); if (tg && tg.kind === 'inspect' && tg.ins.event === 'rest_bed') { G.interact(tg); return `${x},${y},${dir}`; } } } return null; });
  await page.waitForTimeout(600);
  for (let i = 0; i < 3; i++) { const box = page.locator('.dlg-box'); if (await box.count()) { await box.first().tap(); await page.waitForTimeout(500); } }
  const sl = page.getByRole('button', { name: '眠る', exact: true });
  check('寝台で「眠る」を選べる', await sl.count() > 0, String(ok));
  if (await sl.count()) await sl.tap();
  await page.waitForTimeout(4000);
  for (let i = 0; i < 6; i++) { const box = page.locator('.dlg-box'); if (await box.count()) { await box.first().tap(); await page.waitForTimeout(400); } }
  const s5 = await st(); const h5 = await hud().catch(() => '');
  // v11：DAY 2 の競技は実装済みなので、翌朝はそのまま続く（「開発中」の案内は出ない）
  const wip = (await page.locator('.overlay').last().innerText().catch(() => '')).replace(/\s+/g, ' ');
  check('眠ると翌朝（DAY 2）になり、そのまま続く', s5.day === 2 && s5.phase === 'morning' && !wip.includes('開発中'), JSON.stringify(s5) + ' ' + wip.slice(0, 40));
  if (out) await page.screenshot({ path: out + '/clock_day2.png' });
  console.log(res.every(Boolean) ? `全 ${res.length} 件成功` : `${res.filter((x) => !x).length} 件失敗`, 'errors', errs.length, errs.slice(0, 3));
  await browser.close();
})();
