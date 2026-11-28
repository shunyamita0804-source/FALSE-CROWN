// 主人公の新しい通常絵の確認。npm run build の後に sh scripts/with-preview.sh node scripts/check-hero-art.cjs [写真の保存先]
// 参加者登録画面（男女の絵）、会話の立ち絵（表情を変えても新しい通常絵のまま。旧デザインの表情と混ざらない）、丸い顔アイコンを iPhone 横画面で見る。
const { chromium, devices } = require('playwright');
(async () => {
  const out = process.argv[2] || null;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13 landscape'] });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  await page.goto('http://localhost:4173/FALSE-CROWN/');
  // タイトルまで進めて「はじめから」
  for (let i = 0; i < 40; i++) {
    const b = page.locator('button', { hasText: /はじめから|New Game/ });
    if (await b.count()) { await b.first().click(); break; }
    await page.mouse.click(400, 200); await page.waitForTimeout(500);
  }
  await page.waitForSelector('.hero-pick', { timeout: 15000 });
  await page.waitForTimeout(1200);
  const picks = await page.evaluate(() => [...document.querySelectorAll('.hero-pick .bust')].map((el) => {
    const b = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return { bg: cs.backgroundImage, art: el.classList.contains('bust-art'), w: b.width, h: b.height, vis: b.bottom <= innerHeight && b.right <= innerWidth && b.top >= 0 };
  }));
  check('登録画面に男女 2 人の絵', picks.length === 2);
  picks.forEach((p, i) => {
    const g = i ? 'hero_f' : 'hero_m';
    check(`${g}：新しい通常絵`, p.bg.includes(`${g}/portrait_normal`), p.bg.slice(-50));
    check(`${g}：胸から上の絵の描き方`, p.art);
    check(`${g}：画面に収まる`, p.vis, `${Math.round(p.w)}×${Math.round(p.h)}`);
  });
  const imgsOk = await page.evaluate(() => Promise.all([...document.querySelectorAll('.hero-pick .bust')].map((el) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i.naturalWidth === 768 && i.naturalHeight === 1024); i.onerror = () => ok(false); i.src = getComputedStyle(el).backgroundImage.slice(5, -2); }))));
  check('絵が読み込める（768×1024）', imgsOk.every(Boolean));
  if (out) await page.screenshot({ path: `${out}/hero-register.png` });
  for (const g of ['m', 'f']) {
    const r = await page.evaluate((g) => {
      const fc = window.__fc; fc.art.setHeroGender(g);
      document.getElementById('herocheck')?.remove();
      const box = document.createElement('div'); box.id = 'herocheck'; box.className = 'layer open'; box.style.cssText = 'position:absolute;inset:0;background:#141828;z-index:999';
      const el = fc.art.bust('hero', 'normal', 'dlg-portrait left'); el.style.display = 'block'; box.appendChild(el);
      const sizes = ['', 'lg'];
      sizes.forEach((c, i) => { const ic = fc.art.face('hero', c); Object.assign(ic.style, { position: 'absolute', right: `${40 + i * 140}px`, top: '40px' }); box.appendChild(ic); });
      document.getElementById('ui').appendChild(box);
      const urls = ['normal', 'smile', 'anger', 'sad', 'surprise', 'think', 'smirk', 'wary'].map((e) => { fc.art.setBust(el, 'hero', e); return getComputedStyle(el).backgroundImage; });
      fc.art.setBust(el, 'hero', 'normal');
      const face = getComputedStyle(box.querySelector('.face')).backgroundImage;
      return { urls, face };
    }, g);
    const folder = `hero_${g}`;
    check(`${folder}：どの表情でも新しい通常絵（旧デザインの表情を出さない）`, r.urls.every((u) => u.includes(`${folder}/portrait_normal`)), String(new Set(r.urls).size));
    check(`${folder}：顔アイコンも新しい通常絵から`, r.face.includes(`${folder}/portrait_normal`));
    await page.waitForTimeout(800);
    if (out) await page.screenshot({ path: `${out}/hero-talk-${g}.png` });
  }
  check('画面のエラーなし', errs.length === 0, errs.slice(0, 3).join(' / '));
  await browser.close();
  console.log(res.every(Boolean) ? 'すべて合格' : '不合格あり');
  process.exit(res.every(Boolean) ? 0 : 1);
})();
