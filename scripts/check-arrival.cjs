// 部屋に着いた NPC が入口に固まらないことの確認。npm run build の後に
// sh scripts/with-preview.sh node scripts/check-arrival.cjs [写真の保存先]
// - 廊下にいる NPC 全員をそろって食堂へ食事に向かわせ、入口に固まらずに席へ散って座ることを確かめる
// - 途中と最後の写真を撮る（目で確かめる）
const { chromium } = require('playwright');
const { newPhoneContext } = require('./iphone.cjs');
(async () => {
  const out = process.argv[2] || null;
  const browser = await chromium.launch();
  const ctx = await newPhoneContext(browser);
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const res = []; const check = (n, ok, d = '') => { res.push(!!ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  await page.goto('http://localhost:4173/FALSE-CROWN/'); await page.waitForTimeout(1500);
  await page.getByText('開発者メニュー').tap(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: '中央ホール', exact: true }).tap(); await page.waitForTimeout(2500);
  for (const n of ['断る', '何でもない', 'OK']) { const b = page.getByRole('button', { name: n, exact: true }); if (await b.count()) { await b.first().tap(); await page.waitForTimeout(300); } }
  const npcs = await page.evaluate(() => {
    const { G, sim } = window.__fc; const s = G.state; s.phaseLeft = 1e9; sim.standAll(s);
    const ids = Object.keys(s.actors).filter((id) => id !== 'hero' && s.actors[id].alive);
    const h = s.actors.hero; h.step = undefined; h.path = []; h.route = []; h.pos = { room: 'dining', x: 3, y: 17, dir: 'up' };
    ids.forEach((id, i) => {
      const a = s.actors[id]; a.step = undefined; a.path = []; a.route = []; a.busyUntil = 0; a.nextThink = 1e15; a.talkCd = { hero: 1e15 }; a.waitCd = 1e15;
      sim.placeIn(s, id, 'common_hall', { x: 10 + (i % 6), y: 6 + Math.floor(i / 6) });
      a.goal = { kind: 'goto', room: 'dining', spot: { x: 8 + (i % 8) * 2, y: 9 }, note: 'meal', until: s.simTime + 600_000 };
      sim.setRouteTo(s, a, 'dining');
    });
    return ids;
  });
  // 食べ始めた時の位置と、座っていたかを記録する
  const ate = {};
  const shots = [6, 12, 20];
  for (let t = 0; t < 30_000; t += 500) {
    await page.waitForTimeout(500);
    const now = await page.evaluate((ids) => { const s = window.__fc.G.state; return ids.map((id) => { const a = s.actors[id]; return { id, room: a.pos.room, x: a.pos.x, y: a.pos.y, seat: !!a.seat, eat: a.bubble?.text === '🍽' }; }); }, npcs);
    for (const a of now) if (a.eat && !ate[a.id]) ate[a.id] = { ...a, d: Math.min(Math.abs(a.x - 14), Math.abs(a.x - 15)) + Math.abs(a.y - 19) };
    if (out && shots.includes((t + 500) / 1000)) await page.screenshot({ path: `${out}/arrival_${String((t + 500) / 1000).padStart(2, '0')}s.png` });
    if (Object.keys(ate).length === npcs.length) break;
  }
  if (out) await page.screenshot({ path: `${out}/arrival_end.png` });
  const end = Object.values(ate);
  console.log(JSON.stringify(end.map(({ id, x, y, seat }) => `${id}@${x},${y}${seat ? '席' : '立'}`)));
  check('全員が食堂で食べ始めた', end.length === npcs.length && end.every((x) => x.room === 'dining'), `${end.length}/${npcs.length}`);
  check('全員が席に座って食べた（入口で立ち止まって食べる人がいない）', end.every((x) => x.seat), end.filter((x) => !x.seat).map((x) => x.id).join(','));
  check('入口から 2 マス以内で食べ始めた人がいない', end.every((x) => x.d > 2));
  check('画面のエラーなし', errs.length === 0, errs.slice(0, 3).join(' / '));
  await browser.close();
  process.exit(res.every(Boolean) ? 0 : 1);
})();
