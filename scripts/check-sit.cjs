// 正式の着席の絵（sit.png）の確認：部屋ごとに全部の席へ人を座らせて写真を撮り、立ち座りで足元の基準が戻ることを調べる。
// npm run build の後、sh scripts/with-preview.sh node scripts/check-sit.cjs [写真の保存先] [部屋 例 dining,main_arena]
const { chromium } = require('playwright');
const { newPhoneContext } = require('./iphone.cjs');
(async () => {
  const out = process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : null;
  const rooms = (process.argv[3] || 'dining,main_arena,game_room,library,common_lounge,prison_cells,bathroom,garden,entrance,infirmary,shop,cell_zero').split(',');
  const browser = await chromium.launch();
  const ctx = await newPhoneContext(browser);
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  const res = []; const check = (n, ok, d = '') => { res.push(!!ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  await page.goto('http://localhost:4173/FALSE-CROWN/'); await page.waitForTimeout(1500);
  await page.getByText('開発者メニュー').tap(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: '生活棟 廊下', exact: true }).tap(); await page.waitForTimeout(900);
  for (const n of ['断る', '何でもない', 'OK']) { const b = page.getByRole('button', { name: n, exact: true }); if (await b.count()) { await b.first().tap(); await page.waitForTimeout(300); } }
  for (const room of rooms) {
    const chunks = await page.evaluate((room) => {
      const { G, sim } = window.__fc; const s = G.state; s.phaseLeft = 1e9;
      for (const a of Object.values(s.actors)) { a.goal = undefined; a.path = []; a.route = []; a.step = undefined; a.busyUntil = 1e15; a.nextThink = 1e15; a.talkCd = { hero: 1e15 }; }
      const seats = sim.furnitureOf(room)?.seats ?? [];
      const out = []; for (let i = 0; i < seats.length; i += 11) out.push(seats.slice(i, i + 11).map((q) => q.id));
      return out;
    }, room);
    for (let c = 0; c < chunks.length; c++) {
      const r = await page.evaluate(([room, ids]) => {
        const { G, sim } = window.__fc; const s = G.state;
        sim.standAll(s);
        const npcs = Object.keys(s.actors).filter((k) => k !== 'hero');
        // 主人公は部屋の外（廊下）に置き、画面は席のまとまりに合わせる
        let sat = 0;
        ids.forEach((id, i) => { const who = npcs[i]; if (!who) return; sim.placeIn(s, who, room); if (sim.seatActor(s, who, room, id)) sat++; });
        sim.placeIn(s, 'hero', room);
        const f = sim.furnitureOf(room); const ss = f.seats.filter((q) => ids.includes(q.id));
        const cx = ss.reduce((n, q) => n + q.hip[0], 0) / ss.length / 64, cy = ss.reduce((n, q) => n + q.hip[1], 0) / ss.length / 64;
        G.camFocus = { x: cx, y: cy };
        return { sat, want: Math.min(ids.length, npcs.length) };
      }, [room, chunks[c]]);
      await page.waitForTimeout(1600);
      check(`${room} ${c + 1}：席に座れる`, r.sat === r.want, JSON.stringify(r));
      if (out) await page.screenshot({ path: `${out}/sit_${room}_${c + 1}.png` });
    }
    // 立つと、足元の基準と立ち絵に戻る
    const back = await page.evaluate((room) => {
      const { G, sim } = window.__fc; const s = G.state; sim.standAll(s);
      return new Promise((res) => setTimeout(() => {
        const F = G.field; const views = F && F.actors ? [...F.actors.values()] : [];
        res(views.filter((v) => v.sprite.visible && v.sprite.texture.key.startsWith('sit')).map((v) => v.id));
      }, 600));
    }, room);
    check(`${room}：立つと着席の絵から立ち絵に戻る`, back.length === 0, back.join(','));
  }
  await page.evaluate(() => { window.__fc.G.camFocus = null; });
  check('画面のエラーがない', errs.length === 0, errs.join(' | '));
  console.log(res.every(Boolean) ? 'ALL OK' : `${res.filter((x) => !x).length} FAILED`);
  await browser.close();
})();
