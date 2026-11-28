// 同行、個室の密談、部屋を出る時の 3 択（解散／同行を続ける／部屋に残る）と約束の保持、関係一覧の確認（v10、v0.29.3 の会話コマンドに合わせて更新）。
// npm run build と npx vite preview --port 4173 の後に実行する。
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
  check('公の場の主メニュー', ['雑談', '情報交換', '取引', '協力の約束', '密談に誘う', '何でもない'].every((x) => menu1.includes(x)) && !menu1.includes('終了'), menu1);
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
  check('個室の主メニュー（密談・解散・終了）', ['雑談', '情報交換', '取引', '協力の約束', '密談', '相談を終えて解散する', '終了'].every((x) => menu3.includes(x)) && !menu3.includes('何でもない'), menu3);
  await shot('social_private');
  await page.getByRole('button', { name: '密談', exact: true }).tap(); await page.waitForTimeout(400);
  const sub = (await page.locator('.layer').last().innerText()).replace(/\s+/g, ' ');
  check('密談のサブメニュー', ['秘密の情報を買う', '秘密の情報を売る', '他の参加者の動向を聞く', '個人的な話をする'].every((x) => sub.includes(x)), sub.slice(0, 120));
  await shot('social_secret');
  await page.getByRole('button', { name: '他の参加者の動向を聞く' }).tap(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: /リチャード/ }).first().tap(); await page.waitForTimeout(500);
  const t3 = await page.locator('.dlg-text').last().innerText();
  check('動向を聞くと答えが返る（知らなければ知らないと言う）', t3.length > 4, t3);
  for (const n of ['やめる', '終了']) { const b = page.getByRole('button', { name: n, exact: true }); if (await b.count()) { await b.last().tap(); await page.waitForTimeout(400); } }
  // 協力の約束を結ぶ（画面のボタンで）
  await page.evaluate((K) => { window.__fc.G.interact({ kind: 'npc', id: K }); }, K); await page.waitForTimeout(600);
  await page.getByRole('button', { name: '協力の約束', exact: true }).tap(); await page.waitForTimeout(500);
  for (let i = 0; i < 6; i++) { const L = page.locator('.layer').last(); const bs = (await L.getByRole('button').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ')); console.log('  約束の画面', bs.join(' / ')); const pick = bs.find((x) => /約束する|持ちかける|合意|決定|お願い|頼む|結ぶ/.test(x)); if (!pick) break; await L.getByRole('button', { name: pick, exact: true }).first().tap(); await page.waitForTimeout(500); }
  console.log('  返事', (await page.locator('.dlg-text').last().innerText().catch(() => '')).slice(0, 80));
  for (const n of ['終了', '閉じる']) { const b = page.getByRole('button', { name: n, exact: true }); if (await b.count()) { await b.last().tap(); await page.waitForTimeout(400); } }
  // 約束（緩い約束）を 1 つ持たせておき、部屋を出る時のどの選択でも残ることを確かめる
  const deals0 = await page.evaluate(() => JSON.stringify(window.__fc.G.state.deals.map((d) => [d.id, d.kind, d.status])));
  // 部屋を出る：扉を調べると 3 択が出る
  const leave = async () => page.evaluate(() => { const { G } = window.__fc; const s = G.state; const h = s.actors.hero; const room = window.__fc.rooms[h.pos.room]; const d = room.doors.find((x) => x.to !== h.pos.room); G.interact({ kind: 'door', door: d }); return d.to; });
  const choice = async () => (await page.locator('.layer').last().innerText()).replace(/\s+/g, ' ');
  await leave(); await page.waitForTimeout(500);
  const c1 = await choice();
  check('個室を出る時に 3 択（解散／同行を続ける／部屋に残る）と「約束は取り消されない」', ['相談を終えて解散する', '同行を続ける', '部屋に残る', '取り消されません'].every((x) => c1.includes(x)), c1.slice(0, 120));
  await shot('social_leave_choice');
  await page.getByRole('button', { name: '部屋に残る' }).tap(); await page.waitForTimeout(600);
  const r1 = await page.evaluate((K) => { const s = window.__fc.G.state; return { hero: s.actors.hero.pos.room, k: s.actors[K].pos.room }; }, K);
  check('「部屋に残る」：主人公も相手も個室に残る', r1.hero === 'bedroom_hero' && r1.k === 'bedroom_hero', JSON.stringify(r1));
  await leave(); await page.waitForTimeout(500);
  await page.getByRole('button', { name: /同行を続ける/ }).tap(); await page.waitForTimeout(800);
  let r2 = null;
  for (let i = 0; i < 20; i++) { await page.waitForTimeout(300); r2 = await page.evaluate((K) => { const s = window.__fc.G.state; const g = s.actors[K].goal; return { hero: s.actors.hero.pos.room, k: s.actors[K].pos.room, follow: !!g && g.kind === 'follow' && g.target === 'hero' }; }, K); if (r2.k === r2.hero && r2.hero !== 'bedroom_hero') break; }
  check('「同行を続ける」：主人公が部屋を出ると、相手もついて出てくる', r2.hero !== 'bedroom_hero' && r2.k === r2.hero && r2.follow, JSON.stringify(r2));
  // もう一度部屋へ戻って「解散」
  console.log('  再入室', await page.evaluate(() => { const { G } = window.__fc; const s = G.state; const h = s.actors.hero; const d = window.__fc.rooms[h.pos.room].doors.find((x) => x.to === 'bedroom_hero'); if (!d) return 'no door'; G.interact({ kind: 'door', door: d }); return d.id; }));
  for (let i = 0; i < 30; i++) { await page.waitForTimeout(300); if (await page.evaluate((K) => window.__fc.G.state.actors[K].pos.room === 'bedroom_hero', K)) break; }
  await page.waitForTimeout(800);
  const r25 = await page.evaluate((K) => { const s = window.__fc.G.state; return { hero: s.actors.hero.pos.room, k: s.actors[K].pos.room, hold: window.__fc.G.doorHold, busy: window.__fc.G.heroBusy }; }, K);
  check('もう一度個室へ戻ると、相手も一緒に入る', r25.hero === 'bedroom_hero' && r25.k === 'bedroom_hero', JSON.stringify(r25));
  await leave(); await page.waitForTimeout(500);
  await page.getByRole('button', { name: '相談を終えて解散する' }).tap(); await page.waitForTimeout(1500);
  const r3 = await page.evaluate((K) => { const s = window.__fc.G.state; const g = s.actors[K].goal; return { hero: s.actors.hero.pos.room, follow: !!g && g.kind === 'follow' && g.target === 'hero' }; }, K);
  check('「解散する」：主人公は部屋を出て、相手はもうついてこない', r3.hero !== 'bedroom_hero' && !r3.follow, JSON.stringify(r3));
  const deals1 = await page.evaluate(() => JSON.stringify(window.__fc.G.state.deals.map((d) => [d.id, d.kind, d.status])));
  check('部屋を出る選択のあとも、結んだ約束はそのまま', deals0 === deals1, deals1.slice(0, 120));
  check('同行中・解散の操作で画面のエラーなし', errs.length === 0, errs.slice(0, 2).join(' / '));
  // 関係一覧
  await page.getByRole('button', { name: /手帳/ }).tap(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: '人物', exact: true }).tap(); await page.waitForTimeout(400);
  const rel = (await page.locator('.layer').last().innerText()).replace(/\s+/g, ' ');
  check('人物一覧が開く', rel.length > 20, rel.slice(0, 160));
  await shot('social_relations');
  console.log(res.every(Boolean) ? `全 ${res.length} 件成功` : `${res.filter((x) => !x).length} 件失敗`, 'errors', errs.length, errs.slice(0, 3));
  await browser.close();
})();
