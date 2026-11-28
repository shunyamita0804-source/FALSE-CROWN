// 主人公男女の歩行・待機・着席の絵（2 倍の新しい絵）の確認。npm run build の後に
// sh scripts/with-preview.sh node scripts/check-hero-sprites.cjs [写真の保存先]
// - 2 倍の絵（1 コマ 192×256）を読み、旧素材用の位置補正（stand_align.json）を使っていない
// - 待機 ⇔ 歩行、方向転換で、描く位置・基準点・表示の大きさが変わらない
// - NPC と並べた写真、4 方向の歩行コマの写真、食堂・競技場の席に座った写真を撮る（目で確かめる）
const { chromium } = require('playwright');
const { newPhoneContext } = require('./iphone.cjs');
(async () => {
  const out = process.argv[2] || null;
  const browser = await chromium.launch();
  const ctx = await newPhoneContext(browser);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const res = []; const check = (n, ok, d = '') => { res.push(!!ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  await page.goto('http://localhost:4173/FALSE-CROWN/'); await page.waitForTimeout(1500);
  await page.getByText('開発者メニュー').tap(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: '中央ホール', exact: true }).tap(); await page.waitForTimeout(2500);
  for (const n of ['断る', '何でもない', 'OK']) { const b = page.getByRole('button', { name: n, exact: true }); if (await b.count()) { await b.first().tap(); await page.waitForTimeout(300); } }
  const center = async (sel) => { const b = await page.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const btn = { right: await center('.touch-pad .right'), left: await center('.touch-pad .left'), up: await center('.touch-pad .up'), down: await center('.touch-pad .down') };
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i })) });
  const quiet = () => page.evaluate(() => { const s = window.__fc.G.state; s.phaseLeft = 1e9; for (const [id, a] of Object.entries(s.actors)) if (id !== 'hero') { a.goal = undefined; a.path = []; a.route = []; a.step = undefined; a.busyUntil = 1e15; a.nextThink = 1e15; a.talkCd = { ...(a.talkCd || {}), hero: 1e15 }; } });
  const view = () => page.evaluate(() => { const v = window.__fc.G.field.actors.get('hero'); const sp = v.sprite; return { key: sp.texture.key, fw: sp.frame.width, frame: Number(sp.frame.name), ox: sp.originX, oy: sp.originY, w: sp.displayWidth, h: sp.displayHeight, x: sp.x, y: sp.y }; });
  for (const g of ['m', 'f']) {
    const folder = `hero_${g}`;
    await page.evaluate((g) => { const s = window.__fc.G.state; s.hero.gender = g; window.__fc.sim.standAll(s); const h = s.actors.hero; h.step = undefined; h.path = []; h.route = []; h.pos = { room: 'main_hall', x: 14, y: 9, dir: 'down' }; }, g);
    await page.waitForTimeout(1200); await quiet();
    const tex = await page.evaluate((f) => { const T = window.__fc.G.field.textures; return ['char', 'stand', 'sit'].map((k) => { const t = T.get(`${k}:${f}`); return `${k}:${t.source[0].width}x${t.source[0].height}/${t.get(0).width}`; }); }, folder);
    check(`${folder}：2 倍の絵（1 コマ 192 幅）を読む`, tex.every((t) => /1024|256/.test(t) && t.endsWith('/192')), tex.join(' '));
    const st0 = await view();
    check(`${folder}：待機は足元を基準に描く（旧素材用の補正なし）`, st0.key === `stand:${folder}` && Math.abs(st0.ox - 0.5) < 1e-6 && Math.abs(st0.oy - 120 / 128) < 1e-6, JSON.stringify(st0));
    const shots = [];
    for (const dir of ['left', 'up', 'right', 'down']) {
      await touch('touchStart', [btn[dir]]);
      const walk = [];
      for (let i = 0; i < 14; i++) { await page.waitForTimeout(70); walk.push(await view()); }
      await touch('touchEnd', []);
      await page.waitForTimeout(700);
      const st = await view();
      const w = walk.filter((v) => v.key === `char:${folder}`);
      const same = (a, b) => Math.abs(a.ox - b.ox) < 1e-6 && Math.abs(a.oy - b.oy) < 1e-6 && Math.abs(a.w - b.w) < 1e-6 && Math.abs(a.h - b.h) < 1e-6;
      check(`${folder} ${dir}：歩行と待機で基準点と大きさが同じ`, w.length > 3 && w.every((v) => same(v, st)), `${w.length} コマ ${st.w.toFixed(1)}×${st.h.toFixed(1)}`);
      check(`${folder} ${dir}：コマが順に進む`, new Set(w.map((v) => v.frame % 4)).size >= 3, w.map((v) => v.frame).join(','));
      check(`${folder} ${dir}：止まると同じ向きの待機`, st.key === `stand:${folder}` && st.frame === { down: 0, up: 1, left: 2, right: 3 }[dir], `${st.key}#${st.frame}`);
    }
    // NPC と並べる（全員こちらを向いて立つ）
    await page.evaluate(() => {
      const s = window.__fc.G.state; const ids = Object.keys(s.actors).filter((k) => k !== 'hero');
      ids.forEach((id, i) => { const a = s.actors[id]; a.step = undefined; a.path = []; a.pos = { room: 'main_hall', x: 8 + i + (i >= 6 ? 1 : 0), y: 9, dir: 'down' }; });
      const h = s.actors.hero; h.pos = { room: 'main_hall', x: 14, y: 9, dir: 'down' };
      window.__fc.G.camFocus = { x: 14.5, y: 8 };
    });
    await page.waitForTimeout(1500);
    if (out) await page.screenshot({ path: `${out}/${folder}_lineup.png` });
    // 席に座る（食堂と競技場）
    for (const room of ['dining', 'main_arena']) {
      const r = await page.evaluate((room) => {
        const { G, sim } = window.__fc; const s = G.state; sim.standAll(s);
        const seats = sim.furnitureOf(room).seats;
        const ids = Object.keys(s.actors);
        let sat = 0; const used = [];
        ids.slice(0, 8).forEach((id, i) => { const q = seats[i]; if (!q) return; sim.placeIn(s, id, room); if (sim.seatActor(s, id, room, q.id)) { sat++; used.push(q); } });
        const cx = used.reduce((n, q) => n + q.hip[0], 0) / used.length / 64, cy = used.reduce((n, q) => n + q.hip[1], 0) / used.length / 64;
        G.camFocus = { x: cx, y: cy };
        return { sat, hero: !!s.actors.hero.seat };
      }, room);
      await page.waitForTimeout(1600);
      const v = await view();
      check(`${folder} ${room}：着席の絵（腰が基準）で座る`, r.hero && v.key === `sit:${folder}` && Math.abs(v.oy - 90 / 128) < 1e-6, `${v.key} oy ${v.oy.toFixed(3)}`);
      if (out) await page.screenshot({ path: `${out}/${folder}_sit_${room}.png` });
    }
    await page.evaluate(() => { const { G, sim } = window.__fc; sim.standAll(G.state); sim.placeIn(G.state, 'hero', 'main_hall'); G.camFocus = null; });
    await page.waitForTimeout(800);
  }
  check('画面のエラーがない', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
  process.exit(res.every(Boolean) ? 0 : 1);
})();
