// 市場予測（試作）を画面の操作で最後まで遊ぶ確認。npm run build の後に
// sh scripts/with-preview.sh node scripts/check-mk.cjs [写真の保存先]
// 開発者メニュー → DAY1（12 人）で市場予測 → 説明と練習 → 作戦時間 → 6 期（相談・注文）→ 結果
const { chromium } = require('playwright');
const { newPhoneContext, offscreen } = require('./iphone.cjs');
(async () => {
  const out = process.argv[2] || null;
  const browser = await chromium.launch();
  const ctx = await newPhoneContext(browser);
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  const shot = async (n) => { if (out) await page.screenshot({ path: `${out}/mk_${n}.png` }); };
  const tapBtn = async (name, exact = true) => { const b = page.getByRole('button', { name, exact }).first(); if (!(await b.count())) return false; await b.tap(); await page.waitForTimeout(300); return true; };
  const st = () => page.evaluate(() => { const s = window.__fcSlot && window.__fcSlot.state; return s && s.prices ? { phase: s.phase, period: s.period, hold: [...s.holdings.hero], coins: s.coins.hero, shown: s.shown.hero.length, offers: s.offers.length } : null; });
  await page.goto('http://localhost:4173/FALSE-CROWN/'); await page.waitForTimeout(1500);
  await page.getByText('開発者メニュー').tap(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'DAY1（12 人）で市場予測' }).tap(); await page.waitForTimeout(1200);
  await tapBtn('次へ');
  // 説明 4 画面と練習
  let maxLen = 0;
  for (let i = 0; i < 4; i++) { maxLen = Math.max(maxLen, (await page.locator('.tut-text').innerText()).length); await shot(`tut${i + 1}`); await page.getByRole('button', { name: /次へ|練習へ/ }).tap(); await page.waitForTimeout(300); }
  check('説明は 4 画面、1 画面の文は 80 文字以内', maxLen > 0 && maxLen <= 80, String(maxLen));
  await tapBtn('売る'); await page.waitForTimeout(200);
  const retry = (await page.locator('.fb-note').innerText()).includes('もう一度');
  await tapBtn('買う'); await page.waitForTimeout(1700);
  await shot('tut_practice');
  await tapBtn('売る'); await page.waitForTimeout(1700);
  check('練習：違う答えは「もう一度」、正しく選ぶと本番へ進める', retry && (await page.getByRole('button', { name: '本番へ', exact: true }).count()) === 1);
  await tapBtn('本番へ'); await page.waitForTimeout(800);
  // 作戦時間（中身の相談は tests/mk.test.ts で確認。ここでは始めて、準備完了で競技へ）
  check('説明の後に作戦時間が来る', await tapBtn('作戦時間を始める'));
  await page.waitForTimeout(600); await shot('strategy');
  await tapBtn('準備完了'); await tapBtn('競技を始める'); await page.waitForTimeout(1200);
  let swapped = false, accepted = false, ordered = false, layoutTalk = null, layoutOrder = null, lastBox = false;
  for (let guard = 0; guard < 400; guard++) {
    const s = await st();
    if (!s || s.phase === 'done') break;
    if (s.phase === 'talk') {
      if (await page.getByRole('button', { name: '準備完了', exact: true }).count() === 0) { await page.waitForTimeout(300); continue; }
      if (layoutTalk === null) {
        await shot(`talk${s.period + 1}`);
        const bad = await offscreen(page, '.mk-row, .mk-ready, .mk-talk, .mk-extra');
        layoutTalk = bad.length === 0;
        check('相談：値段の表、相談の欄、準備完了が画面の中に収まる', layoutTalk, bad.join(' | '));
      }
      // 届いた見せ合いの誘いを 1 回受ける
      const swapOffer = page.locator('.mk-offer').filter({ has: page.getByRole('button', { name: '受ける', exact: true }) });
      if (!accepted && await swapOffer.count()) {
        const before = s.shown;
        await swapOffer.first().getByRole('button', { name: '受ける', exact: true }).tap(); await page.waitForTimeout(400);
        const a = await st();
        accepted = true;
        check('届いた誘いを受けると、相手の札が見える', a.shown > before || (await page.locator('.mk-chip.shown').count()) > 0, `${before}→${a.shown}`);
      }
      // 自分から見せ合いを持ちかける（期ごとに相手を変える）
      if (!swapped || s.period === 1) {
        await page.locator('.mk-face').nth(s.period % 11).tap(); await page.waitForTimeout(200);
        await tapBtn('見せ合う'); await page.waitForTimeout(150);
        await page.locator('.mk-talk').evaluate((e) => { e.scrollTop = e.scrollHeight; });
        const before = (await st()).offers;
        await page.getByRole('button', { name: /見せ合いを申し込む|2 枚ずつで申し込む/ }).first().tap().catch(() => {}); await page.waitForTimeout(400);
        const a = await st();
        if (!swapped) { await shot('talk_reply'); check('見せ合いを申し込むと、すぐ返事が来る', a.offers > before && (await page.locator('.mk-talk .mk-say').count()) > 0); }
        swapped = true;
      }
      await tapBtn('準備完了'); await page.waitForTimeout(600);
      continue;
    }
    if (s.phase === 'order') {
      if (await page.getByRole('button', { name: '注文する', exact: true }).count() === 0) { await page.waitForTimeout(300); continue; }
      if (layoutOrder === null) {
        await shot(`order${s.period + 1}`);
        const bad = await offscreen(page, '.mk-row, .mk-send, .mk-step .btn, .match-side .box');
        layoutOrder = bad.length === 0;
        check('注文：表と ＋− の押し場所が画面の中に収まる', layoutOrder, bad.join(' | '));
      }
      if (s.period >= 1 && !lastBox) { lastBox = (await page.locator('.mk-last').count()) === 1; check('前の期の要因が公開されている', lastBox); await shot('last'); }
      // 1 番目の銘柄を 2 個買う（持っていれば 1 個売る）
      const before = s.hold.reduce((a, b) => a + b, 0);
      if (s.hold[0] > 0) await page.locator('.mk-row[data-good="0"] .mk-minus').tap();
      else { await page.locator('.mk-row[data-good="1"] .mk-plus').tap(); await page.waitForTimeout(80); await page.locator('.mk-row[data-good="1"] .mk-plus').tap(); }
      await page.waitForTimeout(150);
      await tapBtn('注文する'); await page.waitForTimeout(900);
      const a = await st();
      if (!ordered) { ordered = true; check('注文すると、持ち数が変わる', a.hold.reduce((x, y) => x + y, 0) !== before || a.period > s.period, JSON.stringify(a.hold)); }
      continue;
    }
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(800);
  await shot('end');
  const fin = await st();
  check('NPC から見せ合いの誘いが届く', accepted);
  check('6 期の後に終わる', fin && fin.phase === 'done', JSON.stringify(fin));
  console.log(res.every(Boolean) ? `全 ${res.length} 件成功` : `${res.filter((x) => !x).length} 件失敗`, 'errors', errs.length, errs.slice(0, 3));
  await browser.close();
  process.exit(res.every(Boolean) && !errs.length ? 0 : 1);
})();
