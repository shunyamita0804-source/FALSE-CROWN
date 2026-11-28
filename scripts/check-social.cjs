// 同行、個室の密談、関係一覧の確認（v10）。npm run build と npx vite preview --port 4173 の後に実行する。
// node scripts/check-social.cjs [スクリーンショットの保存先]
const { chromium, devices } = require('playwright');
(async () => {
  const out = process.argv[2] || null;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13 landscape'] });
  const page = await ctx.newPage();
  const errs = []; page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); page.on('pageerror', (e) => errs.push(String(e)));
  const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  const shot = async (n) => { if (out) await page.screenshot({ path: `${out}/${n}.png` }); };
  const K = 'npc_02_kanzaki';
  await page.goto('http://localhost:4173/FALSE-CROWN/'); await page.waitForTimeout(1500);
  await page.getByText('開発者メニュー').tap(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: '生活棟 廊下', exact: true }).tap(); await page.waitForTimeout(900);
  // 他の NPC は食堂で動かさない。神崎だけ廊下に置き、信頼を上げておく
  await page.evaluate((K) => { const { G, sim } = window.__fc; const s = G.state; s.phaseLeft = 250000; for (const [id, a] of Object.entries(s.actors)) { if (id === 'hero') continue; a.talkCd = { hero: 1e15 }; a.goal = undefined; a.path = []; a.route = []; a.step = undefined; a.nextThink = 1e15; if (id !== K) { sim.placeIn(s, id, 'dining'); a.busyUntil = 1e15; } } const h = s.actors.hero; h.step = undefined; h.path = []; sim.placeIn(s, 'hero', 'living_hallway', { x: 14, y: 5 }); h.pos.dir = 'right'; sim.placeIn(s, K, 'living_hallway', { x: 15, y: 5 }); s.actors[K].busyUntil = 0; const r = s.actors[K].rel.hero; r.trust = 80; r.like = 40; }, K);
  await page.waitForTimeout(500);
  for (const n of ['断る', '何でもない', 'OK']) { const b = page.getByRole('button', { name: n, exact: true }); if (await b.count()) { await b.first().tap(); await page.waitForTimeout(300); } }
  await page.evaluate((K) => { const { G } = window.__fc; G.interact({ kind: 'npc', id: K }); }, K);
  await page.waitForTimeout(700);
  const menu1 = (await page.locator('.talk-menu').innerText()).replace(/\s+/g, ' ');
  check('公の場の主メニュー', ['雑談', '情報交換', '取引', '同盟を提案', '密談に誘う', '何でもない'].every((x) => menu1.includes(x)) && !menu1.includes('終了'), menu1);
  await shot('social_public');
  await page.getByRole('button', { name: '情報交換' }).tap(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: '秘密の話を聞きたい' }).tap(); await page.waitForTimeout(400);
  const t1 = await page.locator('.dlg-text').innerText();
  check('公の場では秘密の話ができない', t1.includes('個室'), t1);
  await page.getByRole('button', { name: '密談に誘う' }).tap(); await page.waitForTimeout(500);
  const t2 = await page.locator('.dlg-text').innerText();
  const following = await page.evaluate((K) => { const g = window.__fc.G.state.actors[K].goal; return g && g.kind === 'follow' && g.target === 'hero'; }, K);
  check('信頼があれば誘いに応じて同行する', following, t2);
  const menu2 = (await page.locator('.talk-menu').innerText()).replace(/\s+/g, ' ');
  check('同行中は「同行を終える」が出る', menu2.includes('同行を終える'), menu2);
  await page.getByRole('button', { name: '何でもない' }).tap(); await page.waitForTimeout(400);
  // 歩いて離れると付いてくる
  await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(1500); await page.keyboard.up('ArrowLeft'); await page.waitForTimeout(1200);
  const d1 = await page.evaluate((K) => { const s = window.__fc.G.state; const a = s.actors[K].pos, h = s.actors.hero.pos; return { d: Math.abs(a.x - h.x) + Math.abs(a.y - h.y), same: a.room === h.room, hx: h.x }; }, K);
  check('歩くと後ろを付いてくる（重ならない）', d1.same && d1.d >= 1 && d1.d <= 3 && d1.hx < 14, JSON.stringify(d1));
  await shot('social_follow');
  // 自分の個室へ入る（扉の前に移動して上へ歩く）
  await page.evaluate(() => { const { G, sim } = window.__fc; const s = G.state; const R = G.field; const h = s.actors.hero; h.step = undefined; h.path = []; });
  const door = await page.evaluate(() => { const { G } = window.__fc; const s = G.state; const h = s.actors.hero; for (let x = 1; x < 29; x++) for (const y of [4, 5, 6, 7]) for (const dir of ['up', 'down']) { h.pos.x = x; h.pos.y = y; h.pos.dir = dir; const t = G.field.findTarget(); if (t && t.kind === 'door' && t.door.to === 'bedroom_hero') { G.interact(t); return `${x},${y},${dir}`; } } return null; });
  await page.waitForTimeout(800);
  const inRoom = await page.evaluate(() => window.__fc.G.state.actors.hero.pos.room);
  check('自分の個室に入る', inRoom === 'bedroom_hero', String(door));
  let came = false;
  for (let i = 0; i < 40 && !came; i++) { await page.waitForTimeout(300); came = await page.evaluate((K) => window.__fc.G.state.actors[K].pos.room === 'bedroom_hero', K); }
  check('招いた相手が個室に入ってくる', came);
  await page.waitForTimeout(1500);
  // 話しかける
  await page.evaluate((K) => { const { G } = window.__fc; G.interact({ kind: 'npc', id: K }); }, K);
  await page.waitForTimeout(700);
  const menu3 = (await page.locator('.talk-menu').innerText()).replace(/\s+/g, ' ');
  check('個室の主メニュー（密談と終了）', ['雑談', '情報交換', '取引', '同盟を提案', '密談', '終了'].every((x) => menu3.includes(x)) && !menu3.includes('何でもない'), menu3);
  await shot('social_private');
  await page.getByRole('button', { name: '密談', exact: true }).tap(); await page.waitForTimeout(400);
  const sub = (await page.locator('.layer').last().innerText()).replace(/\s+/g, ' ');
  check('密談のサブメニュー', ['秘密の情報を買う', '秘密の情報を売る', '他の参加者の動向を聞く', '個人的な話をする'].every((x) => sub.includes(x)), sub.slice(0, 120));
  await shot('social_secret');
  await page.getByRole('button', { name: '他の参加者の動向を聞く' }).tap(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: /御堂/ }).tap(); await page.waitForTimeout(500);
  const t3 = await page.locator('.dlg-text').innerText();
  check('知らないことは知らないと答える', t3.includes('何も知らない'), t3);
  // 個室で同盟を結ぶと目撃者がいない
  await page.getByRole('button', { name: '同盟を提案' }).tap(); await page.waitForTimeout(400);
  const note = (await page.locator('.layer').last().innerText()).replace(/\s+/g, ' ');
  check('個室では約束が知られない旨が出る', note.includes('2 人しかいません'), note.slice(0, 80));
  await page.getByRole('button', { name: '同盟を持ちかける' }).tap(); await page.waitForTimeout(400);
  for (let i = 0; i < 5; i++) { let hit = false; for (const n of ['決定', '今日いっぱい', 'その条件で合意する']) { const bt = page.locator('.layer:not(.layer-covered):not(.layer-passive)').last().getByRole('button', { name: n, exact: true }); if (await bt.count() && await bt.first().isEnabled()) { await bt.first().tap(); await page.waitForTimeout(450); hit = true; break; } } if (!hit) break; }
  const deal = await page.evaluate((K) => { const s = window.__fc.G.state; const d = s.deals.find((x) => x.kind === 'alliance' && (x.to === K || x.from === K)); return d ? { w: d.witnesses.length, st: d.status } : null; }, K);
  check('個室で結んだ同盟に目撃者がいない', !!deal && deal.w === 0, JSON.stringify(deal) + ' ' + (await page.locator('.dlg-text').innerText()));
  await page.getByRole('button', { name: '終了' }).tap(); await page.waitForTimeout(400);
  // 関係一覧
  await page.getByRole('button', { name: /手帳/ }).tap(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: '人物', exact: true }).tap(); await page.waitForTimeout(400);
  const rel = (await page.locator('.layer').last().innerText()).replace(/\s+/g, ' ');
  check('関係一覧：話した相手は推定の好意、未接触は不明', rel.includes('推定の好意') && rel.includes('不明') && /好意的|ふつう/.test(rel), rel.slice(0, 160));
  await shot('social_relations');
  console.log(res.every(Boolean) ? `全 ${res.length} 件成功` : `${res.filter((x) => !x).length} 件失敗`, 'errors', errs.length, errs.slice(0, 3));
  await browser.close();
})();
