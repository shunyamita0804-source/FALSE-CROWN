// 手帳の人物詳細「能力の目安」の確認。npm run build の後に sh scripts/with-preview.sh node scripts/check-abilities.cjs [写真の保存先]
const { chromium, devices } = require('playwright');
(async () => {
  const out = process.argv[2] || null;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13 landscape'] });
  const page = await ctx.newPage();
  const errs = []; page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); page.on('pageerror', (e) => errs.push(String(e)));
  const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  const K = 'npc_02_kanzaki', M = 'npc_04_mido';
  await page.goto('http://localhost:4173/FALSE-CROWN/'); await page.waitForTimeout(1500);
  await page.getByText('開発者メニュー').tap(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: '生活棟 廊下', exact: true }).tap(); await page.waitForTimeout(900);
  for (const n of ['断る', '何でもない', 'OK']) { const b = page.getByRole('button', { name: n, exact: true }); if (await b.count()) { await b.first().tap(); await page.waitForTimeout(300); } }
  await page.evaluate(({ K, M }) => {
    const { G, sim } = window.__fc; const s = G.state;
    for (const [id, a] of Object.entries(s.actors)) { if (id === 'hero') continue; a.talkCd = { hero: 1e15 }; a.nextThink = 1e15; a.busyUntil = 1e15; }
    sim.placeIn(s, 'hero', 'bedroom_hero');
    for (const id of Object.keys(s.flags)) if (id.startsWith('heroMet_')) delete s.flags[id];
    s.flags[`heroMet_${K}`] = true;
    void M;
  }, { K, M });
  await page.getByRole('button', { name: /手帳/ }).tap(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: '関係一覧', exact: true }).tap(); await page.waitForTimeout(500);
  await page.locator('.rl-row', { hasText: 'レオン' }).tap(); await page.waitForTimeout(500);
  const det = (await page.locator('.rl-dialog').innerText()).replace(/\s+/g, ' ');
  check('能力の目安と注意書き', det.includes('能力の目安') && det.includes('本番の出来は日によって変わります'), det.slice(0, 160));
  check('6 項目の名前', ['論理力', '記憶力', '観察力', '戦略力', '交渉力', '運'].every((x) => det.includes(x)));
  check('段階の文字', det.includes('とても得意') && det.includes('普通'));
  check('運の説明', det.includes('カードなどの引きに影響'));
  check('内部の値は出ない', !/演技|信頼度|警戒|裏切り確率|支配欲|追従性/.test(det));
  check('チャートが描かれている', (await page.locator('.ab-radar .ab-shape').count()) === 1);
  const box = await page.locator('.ab-box').boundingBox();
  check('横画面で読める大きさ', !!box && box.width > 400, JSON.stringify(box));
  if (out) { await page.locator('.ab-box').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${out}/ability_detail.png` }); }
  await page.getByRole('button', { name: '閉じる', exact: true }).last().tap(); await page.waitForTimeout(300);
  await page.locator('.rl-row', { hasText: 'リチャード' }).tap(); await page.waitForTimeout(500);
  const det2 = (await page.locator('.rl-dialog').innerText()).replace(/\s+/g, ' ');
  check('会っていない人は未確認', det2.includes('未確認（話すと分かる）') && (await page.locator('.ab-radar').count()) === 0);
  console.log(res.every(Boolean) ? `全 ${res.length} 件成功` : `${res.filter((x) => !x).length} 件失敗`, 'errors', errs.length, errs.slice(0, 3));
  await browser.close();
  process.exit(res.every(Boolean) ? 0 : 1);
})();
