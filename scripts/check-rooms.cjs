// 個室システムの確認（部屋番号と名札、ノックと訪問、監獄棟の房、扉の開閉、就寝）。
// npm run build と npx vite preview --port 4173 の後に実行する。 node scripts/check-rooms.cjs [スクリーンショットの保存先]
const { chromium, devices } = require('playwright');
(async () => {
  const out = process.argv[2] || null;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13 landscape'] });
  const page = await ctx.newPage();
  const errs = []; page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); page.on('pageerror', (e) => errs.push(String(e)));
  const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  const shot = async (n) => { if (out) await page.screenshot({ path: `${out}/${n}.png` }); };
  const K = 'npc_02_kanzaki'; const M = 'npc_04_mido';
  await page.goto('http://localhost:4173/FALSE-CROWN/'); await page.waitForTimeout(1500);
  await page.getByText('開発者メニュー').tap(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: '生活棟 廊下', exact: true }).tap(); await page.waitForTimeout(900);
  const quiet = () => page.evaluate(() => { const { G, sim } = window.__fc; const s = G.state; s.phaseLeft = 250000; for (const [id, a] of Object.entries(s.actors)) { if (id === 'hero') continue; a.talkCd = { hero: 1e15 }; a.goal = undefined; a.path = []; a.route = []; a.step = undefined; a.nextThink = 1e15; sim.placeIn(s, id, 'dining'); a.busyUntil = 1e15; } });
  const labels = () => page.evaluate(() => window.__fc.G.field.marks.filter((m) => m.type === 'Text').map((m) => m.text));
  const atDoor = (room, to) => page.evaluate(([room, to]) => { const { G, sim } = window.__fc; const s = G.state; const h = s.actors.hero; const d = window.__fc.rooms[room].doors.find((x) => x.to === to); sim.placeIn(s, 'hero', room, d.tiles[0]); h.pos.x = d.tiles[0].x; h.pos.y = d.tiles[0].y; h.pos.dir = d.dir; h.step = undefined; return d.id; }, [room, to]);
  const act = () => page.evaluate(() => { const { G } = window.__fc; const t = G.field.findTarget(); if (t) G.interact(t); return t ? t.kind : null; });
  const st = () => page.evaluate(() => { const s = window.__fc.G.state; return { room: s.actors.hero.pos.room, phase: s.phase }; });
  await quiet(); await page.waitForTimeout(600);
  const l1 = await labels();
  check('生活棟の廊下：12 室の扉に部屋番号と持ち主の名前が出る', ['301　自分', '302　神崎', '312　久世'].every((x) => l1.includes(x)) && l1.filter((x) => /^3\d\d　/.test(x)).length === 12, l1.slice(0, 4).join(' / '));
  await shot('rooms_hall');
  // 留守の部屋をノック
  await atDoor('living_hallway', `bedroom_${K}`); await page.waitForTimeout(400);
  const prompt = await page.locator('.touch-act').first().innerText().catch(() => '');
  check('他人の部屋の扉では、行動が「ノック」になる', prompt.includes('ノック'), prompt);
  await act(); await page.waitForTimeout(1500);
  const t1 = (await page.locator('.toast').allInnerTexts()).join('|');
  check('留守の部屋：返事がない', t1.includes('留守') && (await st()).room === 'living_hallway', t1);
  // 在室で、信頼されている相手の部屋
  await page.evaluate((K) => { const { G, sim } = window.__fc; const s = G.state; sim.placeIn(s, K, `bedroom_${K}`); const r = s.actors[K].rel.hero; r.trust = 95; r.like = 60; r.wary = 0; r.hostility = 0; }, K);
  await atDoor('living_hallway', `bedroom_${K}`); await page.waitForTimeout(300);
  await act(); await page.waitForTimeout(2600);
  const s2 = await st();
  check('在室で信頼されている：扉を開けてもらい、部屋へ入る', s2.room === `bedroom_${K}`, s2.room);
  await shot('rooms_visit');
  const hud = await page.locator('.hud-room').first().innerText().catch(() => '');
  check('現在地の表示は部屋番号と持ち主', hud.includes('302') && hud.includes('神崎'), hud.replace(/\s+/g, ' ').slice(0, 60));
  // 敵視されている相手
  await page.evaluate((M) => { const { G, sim } = window.__fc; const s = G.state; sim.placeIn(s, 'hero', 'living_hallway'); sim.placeIn(s, M, `bedroom_${M}`); s.actors[M].rel.hero.hostility = 80; }, M);
  await page.waitForTimeout(600);
  await atDoor('living_hallway', `bedroom_${M}`); await page.waitForTimeout(300);
  await act(); await page.waitForTimeout(1600);
  const t3 = (await page.locator('.toast').allInnerTexts()).join('|');
  check('敵視されている：扉を開けてもらえない', (await st()).room === 'living_hallway' && t3.includes('開けなかった'), t3);
  // 脱落者の部屋は空室
  await page.evaluate(() => { const s = window.__fc.G.state; s.actors.npc_12_kuze.alive = false; });
  await page.waitForTimeout(500);
  const l2 = await labels();
  check('脱落した人の部屋は「空室」になる', l2.includes('312　空室'), l2.filter((x) => x.startsWith('312')).join());
  await atDoor('living_hallway', 'bedroom_npc_12_kuze'); await page.waitForTimeout(300); await act(); await page.waitForTimeout(500);
  const t4 = (await page.locator('.toast').allInnerTexts()).join('|');
  check('空室には入れない', (await st()).room === 'living_hallway' && t4.includes('空室'), t4);
  // 訪ねてくる NPC
  await page.evaluate((K) => { const { G, sim } = window.__fc; const s = G.state; sim.placeIn(s, 'hero', 'bedroom_hero'); sim.placeIn(s, K, 'living_hallway'); const a = s.actors[K]; a.busyUntil = 0; a.talkCd = {}; a.nextThink = 1e15; a.goal = { kind: 'talk', target: 'hero', note: 'visit', until: s.simTime + 600000 }; }, K);
  let asked = false;
  for (let i = 0; i < 40 && !asked; i++) { await page.waitForTimeout(300); asked = (await page.getByRole('button', { name: '部屋へ入れる' }).count()) > 0; }
  check('自室にいると、NPC が訪ねてきて扉を叩く', asked);
  await shot('rooms_knock_in');
  if (asked) await page.getByRole('button', { name: '部屋へ入れる' }).tap();
  let came = false;
  for (let i = 0; i < 40 && !came; i++) { await page.waitForTimeout(300); came = await page.evaluate((K) => window.__fc.G.state.actors[K].pos.room === 'bedroom_hero', K); }
  check('入れると、NPC が部屋へ入ってくる', came);
  for (let i = 0; i < 6; i++) { for (const n of ['何でもない', '断る', '終了', 'OK']) { const b = page.getByRole('button', { name: n, exact: true }); if (await b.count()) { await b.first().tap().catch(() => {}); await page.waitForTimeout(300); } } const box = page.locator('.dlg-box'); if (await box.count()) await box.first().tap().catch(() => {}); await page.waitForTimeout(300); }
  // 監獄棟：割り当ての替わり方と、個室へ入れること
  await page.evaluate(([K, M]) => { const { G, sim } = window.__fc; const s = G.state; for (const [id, a] of Object.entries(s.actors)) a.house = id === 'hero' || id === K ? 'prison' : 'living'; s.phase = 'house'; s.phaseLeft = 200000; sim.placeIn(s, 'hero', 'prison_cells'); sim.placeIn(s, K, 'prison_cells'); s.actors[K].busyUntil = 1e15; }, [K, M]);
  await page.waitForTimeout(900);
  const l3 = await labels();
  check('共同牢：11 室の扉に番号と名前（空室を含む）', l3.filter((x) => /^B\d\d　/.test(x)).length === 11 && l3.includes('B01　自分') && l3.includes('B02　神崎') && l3.includes('B03　空室'), l3.filter((x) => x.startsWith('B0')).slice(0, 4).join(' / '));
  await shot('rooms_cells');
  // 自分の房：寝台の脇に立つと「休む」が出る（房は共同牢の中。別の部屋には移らない）
  await page.evaluate(() => { const { G, sim } = window.__fc; sim.placeHome(G.state, 'hero'); });
  await page.waitForTimeout(500);
  const bed = await page.evaluate(() => { const { G } = window.__fc; return { room: G.state.actors.hero.pos.room, t: G.field.findTarget()?.kind }; });
  check('監獄棟の自分の房の寝台へ行ける', bed.room === 'prison_cells' && bed.t === 'bed', JSON.stringify(bed));
  await shot('rooms_cell_inside');
  await page.evaluate(() => { const { G, sim } = window.__fc; sim.placeIn(G.state, 'hero', 'living_hallway'); G.state.actors.hero.house = null; G.state.phase = 'night'; });
  await page.waitForTimeout(700);
  const l4 = await labels();
  check('生活棟の元の部屋は「閉鎖中」になり、入れない', l4.some((x) => x.startsWith('301') && x.includes('閉鎖中')), l4.filter((x) => x.startsWith('30')).slice(0, 2).join(' / '));
  // 扉の開閉：NPC が通ると明かりが漏れる
  await page.evaluate((M) => { const { G, sim } = window.__fc; const s = G.state; const a = s.actors[M]; sim.placeIn(s, M, 'living_hallway'); a.busyUntil = 0; a.nextThink = 1e15; a.goal = { kind: 'rest', room: `bedroom_${M}`, until: s.simTime + 600000 }; sim.setRouteTo(s, a, `bedroom_${M}`); }, M);
  let glow = false;
  for (let i = 0; i < 60 && !glow; i++) { await page.waitForTimeout(150); glow = await page.evaluate(() => window.__fc.G.field.doorFx.size > 0); }
  check('NPC が扉を通ると、扉が開く表現が出る', glow);
  await shot('rooms_door_open');
  let closed = false;
  for (let i = 0; i < 30 && !closed; i++) { await page.waitForTimeout(150); closed = await page.evaluate(() => window.__fc.G.field.doorFx.size === 0); }
  check('少しして扉が閉じる', closed);
  console.log(res.every(Boolean) ? `全 ${res.length} 件成功` : `${res.filter((x) => !x).length} 件失敗`, 'errors', errs.length, errs.slice(0, 3));
  await browser.close();
})();
