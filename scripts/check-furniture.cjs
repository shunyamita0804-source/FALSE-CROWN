// 建物改修の家具と席の確認（食堂の 12 席、競技場の参加者席、主人公の「座る」「立つ」、房の格子）。
// npm run build のあと: sh scripts/with-preview.sh node scripts/check-furniture.cjs [スクリーンショットの保存先]
const { chromium, devices } = require('playwright');
(async () => {
  const out = process.argv[2] || null;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13 landscape'] });
  const page = await ctx.newPage();
  const errs = []; page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); page.on('pageerror', (e) => errs.push(String(e)));
  const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  const shot = async (n) => { if (out) await page.screenshot({ path: `${out}/${n}.png` }); };
  await page.goto('http://localhost:4173/FALSE-CROWN/'); await page.waitForTimeout(1500);
  await page.getByText('開発者メニュー').tap(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: '生活棟 廊下', exact: true }).tap(); await page.waitForTimeout(900);
  const seated = (room) => page.evaluate((room) => Object.values(window.__fc.G.state.actors).filter((a) => a.seat && a.seat.room === room).map((a) => a.seat.id), room);
  // 食堂：食事に来た NPC が空いた席に座る
  await page.evaluate(() => {
    const { G, sim } = window.__fc; const s = G.state; s.phase = 'morning'; s.phaseLeft = 250000;
    const h = s.actors.hero; sim.placeIn(s, 'hero', 'dining', { x: 14, y: 15 });
    Object.entries(s.actors).filter(([id]) => id !== 'hero').forEach(([id, a], i) => { a.talkCd = { hero: 1e15 }; a.busyUntil = 0; a.nextThink = 1e15; sim.placeIn(s, id, 'dining', { x: 2 + ((i * 5) % 26), y: 12 + (i % 2) }); a.goal = { kind: 'goto', room: 'dining', note: 'meal', until: s.simTime + 600000 }; });
  });
  let n = 0;
  for (let i = 0; i < 60 && n < 8; i++) { await page.waitForTimeout(500); n = (await seated('dining')).length; }
  const ids = await seated('dining');
  check('食堂：食事に来た NPC が 12 人掛けの席に座る（同じ席に 2 人座らない）', ids.length >= 8 && new Set(ids).size === ids.length, ids.join(','));
  await page.waitForTimeout(800); await shot('furniture_dining');
  // 主人公：空いた席の前で「座る」、座ると「立つ」
  const sit = await page.evaluate(() => {
    const { G } = window.__fc; const s = G.state; const h = s.actors.hero;
    const F = window.__fc.G.field; const taken = new Set(Object.values(s.actors).filter((a) => a.seat).map((a) => a.seat.id));
    for (let x = 1; x < 29; x++) for (let y = 1; y < 19; y++) for (const dir of ['up', 'down', 'left', 'right']) {
      h.pos = { room: 'dining', x, y, dir }; const t = F.findTarget();
      if (t && t.kind === 'sit' && !taken.has(t.seat.id)) { G.interact(t); return { seat: t.seat.id, sat: !!h.seat, next: F.findTarget()?.kind }; }
    }
    return null;
  });
  check('主人公：空いた椅子の前で「座る」と座り、次は「立つ」になる', !!sit && sit.sat && sit.next === 'stand', JSON.stringify(sit));
  await page.waitForTimeout(800); await shot('furniture_hero_sit');
  // 競技場：参加者が参加者席に座る
  await page.evaluate(() => { const { G, sim } = window.__fc; const s = G.state; for (const a of Object.values(s.actors)) { a.goal = undefined; a.busyUntil = 1e15; a.nextThink = 1e15; } sim.gatherAt(s, 'main_arena'); s.actors.hero.busyUntil = 0; });
  await page.waitForTimeout(1500);
  const ar = await seated('main_arena');
  check('競技場：参加者全員が参加者席に 1 人 1 席で座る', ar.length === 12 && new Set(ar).size === 12, ar.join(','));
  await shot('furniture_arena');
  // 共同牢：消灯の間、人の入っている房の格子が閉まる
  const gate = await page.evaluate(() => {
    const { G, sim } = window.__fc; const s = G.state; const K = 'npc_02_kanzaki';
    for (const [id, a] of Object.entries(s.actors)) a.house = id === 'hero' || id === K ? 'prison' : 'living';
    sim.assignCell(s, 'hero'); sim.assignCell(s, K);
    s.phase = 'curfew'; s.phaseLeft = 200000; sim.placeHome(s, 'hero'); sim.placeHome(s, K); s.actors[K].busyUntil = 1e15;
    return s.cells;
  });
  await page.waitForTimeout(1200);
  const labels = await page.evaluate(() => window.__fc.G.field.marks.filter((m) => m.type === 'Text').map((m) => m.text));
  check('共同牢：11 房の番号と持ち主の札', labels.filter((x) => /^B\d\d　/.test(x)).length === 11, labels.filter((x) => x.startsWith('B')).slice(0, 3).join(' / ') + ' ' + JSON.stringify(gate));
  const stuck = await page.evaluate(() => { const { G, sim } = window.__fc; const s = G.state; const h = s.actors.hero; return sim.setPathTo(s, h, 13, 10); });
  check('消灯の間は、自分の房の外へ歩けない', stuck === false);
  await shot('furniture_cells_curfew');
  console.log(res.every(Boolean) ? `全 ${res.length} 件成功` : `${res.filter((x) => !x).length} 件失敗`, 'errors', errs.length, errs.slice(0, 3));
  await browser.close();
})();
