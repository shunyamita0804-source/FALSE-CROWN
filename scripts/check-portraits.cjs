// 新しい立ち絵（胸から上）の表情の切り替え確認。npm run build の後に sh scripts/with-preview.sh node scripts/check-portraits.cjs [写真の保存先]
// 会話と同じ枠（.bust.dlg-portrait）で 11 人の 8 表情を順に切り替え、枠の位置・大きさ・絵の位置が変わらないこと、
// 切り替える前に全表情が読み込み済みであること（前の顔が残ったり一瞬消えたりしない）、顔アイコンが出ることを確かめる。
const { chromium, devices } = require('playwright');
const IDS = ['npc_02_kanzaki', 'npc_03_kurose', 'npc_04_mido', 'npc_05_shiraishi', 'npc_06_kiryu', 'npc_07_tachibana', 'npc_08_dojima', 'npc_09_asahina', 'npc_10_kujo', 'npc_11_kisaragi', 'npc_12_kuze'];
const EX = ['normal', 'smile', 'anger', 'sad', 'surprise', 'think', 'smirk', 'wary'];
(async () => {
  const out = process.argv[2] || null;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13 landscape'] });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  await page.goto('http://localhost:4173/FALSE-CROWN/'); await page.waitForTimeout(1500);
  for (const id of IDS) {
    const r = await page.evaluate(async ({ id, EX }) => {
      const fc = window.__fc; const ui = document.getElementById('ui');
      const box = document.createElement('div'); box.className = 'layer open'; box.id = 'pcheck'; box.style.cssText = 'position:absolute;inset:0;background:#141828;z-index:999';
      const el = fc.art.bust(id, 'normal', 'dlg-portrait left'); el.style.display = 'block'; box.appendChild(el);
      const ic = fc.art.face(id, 'lg'); Object.assign(ic.style, { position: 'absolute', right: '40px', top: '40px' }); box.appendChild(ic);
      ui.appendChild(box);
      const urls = []; const rects = []; const css = [];
      // 全表情が読み込まれるのを待つ（preload）
      const all = EX.map((e) => { fc.art.setBust(el, id, e); return getComputedStyle(el).backgroundImage.slice(5, -2); });
      await Promise.all(all.map((u) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i.decode ? i.decode().catch(() => 0) : 0); i.onerror = ok; i.src = u; })));
      for (const e of EX) {
        fc.art.setBust(el, id, e);
        const cs = getComputedStyle(el); const b = el.getBoundingClientRect();
        urls.push(cs.backgroundImage); rects.push([b.x, b.y, b.width, b.height].map(Math.round).join(',')); css.push(`${cs.backgroundSize}|${cs.backgroundPosition}`);
      }
      const loaded = all.every((u) => performance.getEntriesByName(u).length > 0);
      const faceBg = getComputedStyle(ic).backgroundImage;
      return { urls, rects, css, loaded, art: el.classList.contains('bust-art'), faceBg, uniq: new Set(urls).size };
    }, { id, EX });
    check(`${id}：新しい絵の描き方（絞らず全体）`, r.art);
    check(`${id}：8 表情で枠の位置と大きさが同じ`, new Set(r.rects).size === 1, r.rects[0]);
    check(`${id}：8 表情で絵の大きさと位置が同じ`, new Set(r.css).size === 1, r.css[0]);
    check(`${id}：全表情を切り替える前に読み込み済み`, r.loaded);
    check(`${id}：表情の絵が別々（通常の代用を除く）`, r.uniq >= (id === 'npc_06_kiryu' ? 7 : 8), String(r.uniq));
    check(`${id}：顔アイコンは新しい絵から`, /portrait_/.test(r.faceBg), r.faceBg.slice(-40));
    if (out) {
      for (const e of EX) {
        await page.evaluate(({ id, e }) => { const el = document.querySelector('#pcheck .bust'); window.__fc.art.setBust(el, id, e); }, { id, e });
        await page.waitForTimeout(60);
        await page.screenshot({ path: `${out}/${id}_${e}.png` });
      }
    }
    await page.evaluate(() => document.getElementById('pcheck')?.remove());
  }
  check('エラーなし', errs.length === 0, errs.slice(0, 3).join(' / '));
  await browser.close();
  process.exit(res.every(Boolean) ? 0 : 1);
})();
