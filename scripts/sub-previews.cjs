// 遊戯室の卓の「ゲームを選ぶ」画面に出す、各ゲームの画面の見本（縮小写真）を作る。
// 開発版の画面で各ゲームを開き、CPU と同じ考え方で数手進めた盤面を撮って public/assets/ui/sub_preview/<id>.webp に保存する。
// 遊び方の画面を変えた時に撮り直す。npm run build の後、sh scripts/with-preview.sh node scripts/sub-previews.cjs
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
(async () => {
  const dir = path.join(__dirname, '..', 'public', 'assets', 'ui', 'sub_preview');
  fs.mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const W = (ms) => page.waitForTimeout(ms);
  const games = { s01: [/S01 /, 3], s02: [/S02 /, 6], s03: [/S03 /, 5], s04: [/S04 /, 3], s05: [/S05 /, 0], s06: [/S06 /, 0] };
  for (const [id, [label, moves]] of Object.entries(games)) {
    await page.goto('http://localhost:4173/FALSE-CROWN/'); await W(1500);
    await page.evaluate(() => localStorage.setItem('false-crown/tutorial-seen', JSON.stringify(['s01', 's02', 's03', 's04', 's05', 's06'])));
    await page.getByText('開発者メニュー').tap(); await W(400);
    await page.getByRole('button', { name: label }).first().tap(); await W(800);
    for (let i = 0; i < 4; i++) { const b = page.getByRole('button', { name: /説明を飛ばす|練習を飛ばす|本番へ|飛ばす/ }); if (await b.count()) { await b.first().tap(); await W(600); } }
    for (let i = 0; i < moves; i++) { await page.evaluate(() => window.__fcAuto && window.__fcAuto()); await W(500); }
    await W(600);
    const el = page.locator('.match-main');
    if (!(await el.count())) { console.log(`FAIL ${id}：画面が開けない`); continue; }
    // 縮小して webp にする（画面では幅 300px ほどで出す）
    const png = path.join(dir, `${id}.png`);
    await el.screenshot({ path: png });
    require('child_process').execFileSync('python3', ['-c', 'import sys;from PIL import Image;im=Image.open(sys.argv[1]).convert("RGB");im.thumbnail((640,330));im.save(sys.argv[2],quality=82)', png, png.replace(/\.png$/, '.webp')]);
    fs.unlinkSync(png);
    console.log(`OK   ${id}`);
  }
  await browser.close();
})();
