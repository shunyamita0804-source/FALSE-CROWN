// 全競技の最初の画面（説明の 1 枚目と、説明を飛ばした後の本番）を開き、ボタンや盤面が画面の外にはみ出していないか調べる。
// IPHONE=1 でノッチのある iPhone を再現する。npm run build の後、sh scripts/with-preview.sh node scripts/check-fit.cjs [写真の保存先]
const { chromium } = require('playwright');
const { newPhoneContext, offscreen } = require('./iphone.cjs');
(async () => {
  const out = process.argv[2] || null;
  const browser = await chromium.launch();
  const res = []; const check = (n, ok, d = '') => { res.push(!!ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  const ctx0 = await newPhoneContext(browser); const p0 = await ctx0.newPage();
  await p0.goto('http://localhost:4173/FALSE-CROWN/'); await p0.waitForTimeout(1500);
  await p0.getByText('開発者メニュー').tap(); await p0.waitForTimeout(400);
  const names = (await p0.locator('button').allInnerTexts()).map((s) => s.trim()).filter((s) => /^[MP]\d\d\s/.test(s));
  await ctx0.close();
  const SEL = '.match-main .btn, .match-main .pb-board, .match-main .face, .match-main input, .match-main canvas, .match-main .card, .vt .btn, .vt-fig .btn, .mhud .btn';
  for (const name of [...new Set(names)]) {
    const id = name.slice(0, 3).toLowerCase();
    const ctx = await newPhoneContext(browser); const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto('http://localhost:4173/FALSE-CROWN/'); await page.waitForTimeout(1200);
    await page.evaluate(() => localStorage.removeItem('false-crown/tutorial-seen'));
    await page.getByText('開発者メニュー').tap(); await page.waitForTimeout(400);
    await page.getByRole('button', { name, exact: true }).first().tap(); await page.waitForTimeout(1500);
    const bad1 = await offscreen(page, SEL);
    if (out) await page.screenshot({ path: `${out}/${id}_a.png` });
    for (const n of ['説明を飛ばす', '練習を飛ばして本番へ', '本番へ', 'はじめる', '始める']) { const b = page.getByRole('button', { name: n, exact: true }); if (await b.count()) { await b.first().tap().catch(() => {}); await page.waitForTimeout(900); } }
    await page.waitForTimeout(1200);
    const bad2 = await offscreen(page, SEL);
    if (out) await page.screenshot({ path: `${out}/${id}_b.png` });
    check(`${name}：説明と本番の画面が画面の中に収まる`, !bad1.length && !bad2.length && !errs.length, [...bad1, '/', ...bad2, ...errs].join(' | ').slice(0, 400));
    await ctx.close();
  }
  console.log(res.every(Boolean) ? 'ALL OK' : `${res.filter((x) => !x).length} FAILED`);
  await browser.close();
})();
