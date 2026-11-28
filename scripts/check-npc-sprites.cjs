// 参加者（NPC）の新しい歩行・待機・着席の絵（2 倍）の確認。npm run build の後に
// sh scripts/with-preview.sh node scripts/check-npc-sprites.cjs [写真の保存先]
// - walk@2x.png のある人は 2 倍の絵を読み、旧素材用の位置補正（stand_align.json）を使わない
// - 4 方向に歩かせ、歩行と待機で基準点（足元）と表示の大きさが同じ、コマが順に進む、止まると同じ向きの待機
// - 主人公と並べた写真、食堂・競技場の席（正面・後ろ・横）に座った写真を撮る（目で確かめる）
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
  const ids = await page.evaluate(() => {
    const s = window.__fc.G.state; s.phaseLeft = 1e9;
    for (const a of Object.values(s.actors)) { a.goal = undefined; a.path = []; a.route = []; a.step = undefined; a.busyUntil = 1e15; a.nextThink = 1e15; a.talkCd = { hero: 1e15 }; }
    const T = window.__fc.G.field.textures;
    return Object.keys(s.actors).filter((id) => id !== 'hero' && T.exists(`char:${id}`) && T.get(`char:${id}`).get(0).width === 192);
  });
  console.log('2 倍の新しい絵の人:', ids.join(', '));
  const view = (id) => page.evaluate((id) => { const v = window.__fc.G.field.actors.get(id); if (!v) return null; const sp = v.sprite; return { key: sp.texture.key, frame: Number(sp.frame.name), ox: sp.originX, oy: sp.originY, w: sp.displayWidth, h: sp.displayHeight }; }, id);
  const same = (a, b) => Math.abs(a.ox - b.ox) < 1e-6 && Math.abs(a.oy - b.oy) < 1e-6 && Math.abs(a.w - b.w) < 1e-6 && Math.abs(a.h - b.h) < 1e-6;
  for (const id of ids) {
    await page.evaluate((id) => { const s = window.__fc.G.state; window.__fc.sim.standAll(s); for (const [k, a] of Object.entries(s.actors)) { a.step = undefined; a.path = []; a.pos = k === id ? { room: 'main_hall', x: 14, y: 9, dir: 'down' } : { room: 'main_hall', x: 2 + (k.length % 3), y: 14, dir: 'down' }; } window.__fc.G.camFocus = { x: 14.5, y: 8 }; }, id);
    await page.waitForTimeout(700);
    const st0 = await view(id);
    check(`${id}：待機は足元を基準に描く（旧素材用の補正なし）`, st0 && st0.key === `stand:${id}` && Math.abs(st0.ox - 0.5) < 1e-6 && Math.abs(st0.oy - 120 / 128) < 1e-6, st0 && `${st0.key} ${st0.oy}`);
    for (const [dir, dx, dy] of [['left', -3, 0], ['up', 0, -3], ['right', 3, 0], ['down', 0, 3]]) {
      await page.evaluate(([id, dx, dy]) => { const s = window.__fc.G.state; const a = s.actors[id]; a.busyUntil = 0; a.nextThink = 1e15; a.goal = undefined; window.__fc.sim.setPathTo(s, a, a.pos.x + dx, a.pos.y + dy); }, [id, dx, dy]);
      const walk = [];
      for (let i = 0; i < 12; i++) { await page.waitForTimeout(70); const v = await view(id); if (v.key === `char:${id}`) walk.push(v); }
      await page.waitForTimeout(1200);
      const st = await view(id);
      check(`${id} ${dir}：歩行と待機で基準点と大きさが同じ`, walk.length > 3 && walk.every((v) => same(v, st)), `${walk.length} コマ ${st.w.toFixed(1)}×${st.h.toFixed(1)}`);
      check(`${id} ${dir}：歩行のコマが進み、止まると同じ向きの待機`, new Set(walk.map((v) => v.frame % 4)).size >= 3 && st.key === `stand:${id}` && st.frame === { down: 0, up: 1, left: 2, right: 3 }[dir], `${walk.map((v) => v.frame).join(',')} → ${st.key}#${st.frame}`);
    }
  }
  // 主人公と並べる
  for (const g of ['m', 'f']) {
    await page.evaluate((g) => {
      const s = window.__fc.G.state; s.hero.gender = g; window.__fc.sim.standAll(s);
      const all = Object.keys(s.actors).filter((k) => k !== 'hero');
      all.forEach((id, i) => { const a = s.actors[id]; a.step = undefined; a.path = []; a.pos = { room: 'main_hall', x: 8 + i + (i >= 6 ? 1 : 0), y: 9, dir: 'down' }; });
      const h = s.actors.hero; h.step = undefined; h.path = []; h.pos = { room: 'main_hall', x: 14, y: 9, dir: 'down' };
      window.__fc.G.camFocus = { x: 14.5, y: 8 };
    }, g);
    await page.waitForTimeout(1500);
    if (out) await page.screenshot({ path: `${out}/lineup_${g}.png` });
  }
  // 席に座る（主人公と 2 倍の絵の NPC を、正面・後ろ・横の席へ）
  for (const room of ['dining', 'main_arena', 'library']) {
    const r = await page.evaluate(([room, ids]) => {
      const { G, sim } = window.__fc; const s = G.state; sim.standAll(s);
      for (const a of Object.values(s.actors)) { a.goal = undefined; a.path = []; a.route = []; a.step = undefined; a.busyUntil = 1e15; a.nextThink = 1e15; }
      const seats = sim.furnitureOf(room)?.seats ?? []; const who = ['hero', ...ids];
      let sat = 0; const used = [];
      who.forEach((id, i) => { const q = seats[i]; if (!q) return; sim.placeIn(s, id, room); if (sim.seatActor(s, id, room, q.id)) { sat++; used.push(q); } });
      if (!used.length) return { sat: 0 };
      G.camFocus = { x: used.reduce((n, q) => n + q.hip[0], 0) / used.length / 64, y: used.reduce((n, q) => n + q.hip[1], 0) / used.length / 64 };
      return { sat, n: Math.min(who.length, seats.length), facings: [...new Set(used.map((q) => q.facing))].join('') };
    }, [room, ids]);
    await page.waitForTimeout(1600);
    const bad = await page.evaluate(() => [...window.__fc.G.field.actors.values()].filter((v) => v.sprite.visible && window.__fc.G.state.actors[v.id]?.seat && !v.sprite.texture.key.startsWith('sit')).map((v) => v.id));
    check(`${room}：全員が着席の絵で座る`, r.sat === r.n && bad.length === 0, `${r.sat}/${r.n} 向き ${r.facings} ${bad.join(',')}`);
    if (out) await page.screenshot({ path: `${out}/sit_${room}.png` });
  }
  await page.evaluate(() => { const { G, sim } = window.__fc; sim.standAll(G.state); G.camFocus = null; });
  check('画面のエラーがない', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
  process.exit(res.every(Boolean) ? 0 : 1);
})();
