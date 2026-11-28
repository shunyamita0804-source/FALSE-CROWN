// 丸い顔アイコンの確認。npm run build の後に sh scripts/with-preview.sh node scripts/check-faces.cjs [写真の保存先]
// 11 人と主人公の男女を、使っている大きさ（28〜92px）で並べ、全員が portraits.json の face の箱で切り抜かれていること、
// 枠の大きさに関係なく同じ切り抜き（拡大率と位置が%で同じ）であること、絵が読み込めることを確かめる。顔の収まりは写真で目視する。
const { chromium, devices } = require('playwright');
const IDS = ['npc_02_kanzaki', 'npc_03_kurose', 'npc_04_mido', 'npc_05_shiraishi', 'npc_06_kiryu', 'npc_07_tachibana', 'npc_08_dojima', 'npc_09_asahina', 'npc_10_kujo', 'npc_11_kisaragi', 'npc_12_kuze', 'hero:m', 'hero:f'];
const SIZES = [28, 34, 44, 68, 92];
(async () => {
  const out = process.argv[2] || null;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13 landscape'], deviceScaleFactor: 3 });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  await page.goto('http://localhost:4173/FALSE-CROWN/'); await page.waitForTimeout(1500);
  const r = await page.evaluate(async ({ IDS, SIZES }) => {
    const fc = window.__fc; const ui = document.getElementById('ui');
    const box = document.createElement('div'); box.className = 'layer open'; box.id = 'fcheck';
    box.style.cssText = 'position:absolute;inset:0;background:#141828;z-index:999;display:grid;grid-template-columns:repeat(7,1fr);gap:4px;padding:6px;overflow:auto';
    ui.appendChild(box);
    const rows = {};
    for (const key of IDS) {
      const [id, g] = key.split(':');
      if (g) fc.art.setHeroGender(g);
      const cell = document.createElement('div'); cell.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:3px;color:#ccc;font-size:9px';
      cell.append(key.replace('npc_', ''));
      const list = [];
      for (const s of SIZES) { const f = fc.art.face(id); f.style.width = f.style.height = `${s}px`; cell.appendChild(f); list.push(f); }
      box.appendChild(cell);
      const cs = list.map((f) => getComputedStyle(f));
      const url = cs[0].backgroundImage.slice(5, -2);
      const ok = await new Promise((done) => { const i = new Image(); i.onload = () => done(true); i.onerror = () => done(false); i.src = url; });
      rows[key] = { crop: list.every((f) => f.classList.contains('face-crop')), same: new Set(list.map((f) => f.style.backgroundSize + '|' + f.style.backgroundPosition)).size === 1, round: cs[0].borderRadius, url, ok };
    }
    fc.art.setHeroGender('m');
    return rows;
  }, { IDS, SIZES });
  for (const key of IDS) {
    const x = r[key];
    check(`${key}：顔の切り抜きで表示`, x.crop);
    check(`${key}：大きさが違っても同じ切り抜き`, x.same);
    check(`${key}：丸い枠`, x.round === '50%', x.round);
    check(`${key}：絵が読み込める`, x.ok, x.url.slice(-40));
  }
  if (out) await page.screenshot({ path: `${out}/faces.png` });
  check('画面のエラーなし', errs.length === 0, errs.join(' / '));
  await browser.close();
  const bad = res.filter((x) => !x).length; console.log(bad ? `${bad} 件の不合格` : 'すべて合格'); process.exit(bad ? 1 : 0);
})();
