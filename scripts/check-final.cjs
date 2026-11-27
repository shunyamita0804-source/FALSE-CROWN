// DAY 11（決勝の日）の流れと結末の確認。npm run build の後、sh scripts/with-preview.sh node scripts/check-final.cjs [写真の保存先]
// 開発者メニューの「決勝の結末の検証」から、順位発表、優勝者の発表、4 つの結末（王者、孤独な王、信頼の証、敗者）を指の操作で進める。
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2] || null;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  const cases = [['主人公が優勝（王者）', '王者', 'win'], ['主人公が優勝（孤独な王）', '孤独な王', 'lone'], ['主人公が優勝（信頼の証）', '信頼の証', 'bond'], ['主人公が決勝で敗北（敗者）', '敗者', 'lose']];
  for (const [btn, title, key] of cases) {
    await page.goto('http://localhost:4173/FALSE-CROWN/'); await page.waitForTimeout(1500);
    await page.getByText('開発者メニュー').tap(); await page.waitForTimeout(400);
    await page.getByRole('button', { name: btn }).tap();
    await page.getByText('DAY 11　決勝の結果').waitFor({ timeout: 120000 });
    await page.waitForTimeout(500);
    const ranks = await page.locator('.rank').count();
    const prisonTag = await page.locator('.rank.prison').count();
    if (out) await page.screenshot({ path: `${out}/final_${key}_rank.png` });
    check(`${title}：決勝の順位発表は 2 人で、監獄棟行きの印がない`, ranks === 2 && prisonTag === 0, `${ranks}/${prisonTag}`);
    let ending = '';
    let sawCrown = false;
    for (let i = 0; i < 40; i++) {
      const txt = await page.locator('body').innerText();
      if (txt.includes('優勝者が決まりました')) sawCrown = true;
      const m = txt.match(/エンディング　(\S+)/);
      if (m) { ending = m[1]; break; }
      const b = page.getByRole('button', { name: /^(次へ|閉じる|OK|進む)$/ });
      if (await b.count()) await b.last().tap();
      else await page.touchscreen.tap(422, 300);
      await page.waitForTimeout(450);
    }
    if (out) await page.screenshot({ path: `${out}/final_${key}_end.png` });
    check(`${title}：優勝者の発表のあと、結末「${title}」に着く`, sawCrown && ending === title, ending);
    await page.getByRole('button', { name: 'タイトルへ' }).tap(); await page.waitForTimeout(800);
    check(`${title}：結末のあとはタイトルへ戻る`, await page.getByText('開発者メニュー').count() > 0);
  }
  check('エラーなし', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(res.every(Boolean) ? 'ALL OK' : 'SOME FAILED');
  await browser.close();
  process.exit(res.every(Boolean) ? 0 : 1);
})();
