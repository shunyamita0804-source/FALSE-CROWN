// 競技会場への集合移動の確認。npm run build の後に
// sh scripts/with-preview.sh node scripts/check-gather.cjs [写真の保存先]
// - 朝の自由時間を締め切り、集合案内 → 集合移動中 → 全員到着 → ルール説明、の流れを確かめる
// - 寄り道の扉で短い案内が出ること、NPC に話しかけると短い一言になること、時計が止まっていることを確かめる
const { chromium } = require('playwright');
const { newPhoneContext } = require('./iphone.cjs');
(async () => {
  const out = process.argv[2] || null;
  const browser = await chromium.launch();
  const ctx = await newPhoneContext(browser);
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const res = []; const check = (n, ok, d = '') => { res.push(!!ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  const shot = async (n) => { if (out) await page.screenshot({ path: `${out}/gather_${n}.png` }); };
  await page.goto('http://localhost:4173/FALSE-CROWN/'); await page.waitForTimeout(1500);
  await page.getByText('開発者メニュー').tap(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: '中央ホール', exact: true }).tap(); await page.waitForTimeout(2500);
  for (const n of ['断る', '何でもない', 'OK']) { const b = page.getByRole('button', { name: n, exact: true }); if (await b.count()) { await b.first().tap(); await page.waitForTimeout(300); } }
  // 主人公はリビング、NPC は館のあちこちに散らばせてから、自由時間を締め切る
  await page.evaluate(() => {
    const { G, sim } = window.__fc; const s = G.state;
    const ids = Object.keys(s.actors).filter((id) => id !== 'hero' && s.actors[id].alive);
    const rooms = ['dining', 'game_room', 'bathroom', 'living_hallway', 'main_hall'];
    ids.forEach((id, i) => { if (i % 3 === 0) sim.placeHome?.(s, id); else sim.placeIn(s, id, rooms[i % rooms.length]); });
    sim.placeIn(s, 'hero', 'dining', { x: 14, y: 15 });
    s.phaseLeft = 200;
  });
  await page.waitForTimeout(1500);
  const notice = page.getByText('集合案内');
  check('集合案内が出る', await notice.count() > 0);
  await shot('01_notice');
  await page.getByRole('button', { name: '会場へ向かう' }).first().tap(); await page.waitForTimeout(1800);
  const st = await page.evaluate(() => { const s = window.__fc.G.state; return { phase: s.phase, left: s.phaseLeft, gather: !!window.__fc.G.gather }; });
  check('集合移動中の状態になる', st.phase === 'gather' && st.gather, JSON.stringify(st));
  check('集合移動中の帯が出る', await page.getByText('集合移動中').count() > 0);
  await shot('02_walking');
  // 寄り道の扉（リビング→遊戯室）を通ろうとする
  const blocked = await page.evaluate(() => {
    const { G } = window.__fc; const s = G.state; const room = window.__fc.rooms.dining;
    const d = room.doors.find((x) => x.to === 'game_room');
    G.interact({ kind: 'door', door: d });
    return s.actors.hero.pos.room;
  });
  await page.waitForTimeout(300);
  check('寄り道の扉は通れず、短い案内が出る', blocked === 'dining' && await page.getByText('今は集合が先だ').count() > 0);
  // 近くの NPC に話しかける
  const talked = await page.evaluate(() => {
    const { G, sim } = window.__fc; const s = G.state;
    const id = Object.keys(s.actors).find((x) => x !== 'hero' && s.actors[x].alive);
    sim.placeIn(s, id, 'dining', { x: 15, y: 15 });
    G.gather.g.depart[id] = 60_000;
    G.interact({ kind: 'npc', id });
    return id;
  });
  await page.waitForTimeout(500);
  const talkShown = await page.locator('.gather-talk').count();
  check('話しかけると短い一言の画面になる（通常の会話メニューではない）', talkShown > 0 && await page.locator('.talk-menu button').count() === 1);
  await shot('03_talk');
  await page.getByRole('button', { name: '会場へ向かう' }).first().tap(); await page.waitForTimeout(300);
  // 主人公を会場まで歩かせる（道順どおり）
  await page.evaluate(() => { const { G, sim } = window.__fc; const s = G.state; G.gather.g.depart = {}; sim.setRouteTo(s, s.actors.hero, 'main_arena'); });
  let hall = false;
  for (let i = 0; i < 220; i++) {
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => { const s = window.__fc.G.state; return { room: s.actors.hero.pos.room, phase: s.phase }; });
    if (r.room === 'main_hall' && !hall) { hall = true; await shot('04_hall'); }
    if (r.phase !== 'gather') break;
    if (r.room === 'main_arena' && i % 4 === 0) await shot('05_arena');
  }
  console.log(await page.evaluate(() => { const g = window.__fc.G.gather?.g; const s = window.__fc.G.state; if (!g) return 'done'; return JSON.stringify(g.ids.filter((id) => id !== 'hero' && !g.arrived.includes(id)).map((id) => { const a = s.actors[id]; return [id, a.pos, a.path.length, a.route, !!a.step, a.busyUntil - s.simTime]; })) + ' left ' + g.left; }));
  const end = await page.evaluate(() => { const s = window.__fc.G.state; const ids = Object.keys(s.actors).filter((id) => s.actors[id].alive); return { phase: s.phase, inArena: ids.filter((id) => s.actors[id].pos.room === 'main_arena').length, n: ids.length, seated: ids.filter((id) => s.actors[id].seat).length, clock: s.phaseLeft }; });
  check('全員が会場に着いて、集合移動が終わる', end.phase !== 'gather' && end.inArena === end.n, JSON.stringify(end));
  await page.waitForTimeout(800);
  await shot('06_rules');
  check('画面のエラーなし', errs.length === 0, errs.slice(0, 3).join(' / '));
  await browser.close();
  process.exit(res.every(Boolean) ? 0 : 1);
})();
