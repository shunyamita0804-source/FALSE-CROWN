// 音声付きの競技説明を、競技ごとに最初から最後まで通して確かめる（M02 以降、同じ作りの競技に使う）。
// npm run build の後、sh scripts/with-preview.sh node scripts/check-voicetut-match.cjs m02 [写真の保存先]
// IPHONE=1 で、ノッチのある iPhone（932×430、左右 59・下 21 の余白）を再現する。
// 確かめること：段階ごとに収録の声が鳴る、字幕が台本の全文、図が枠と説明の板からはみ出さず字幕と重ならない、
// 操作の段階が動く、練習へ進む、本番が始まる、画面のエラーが無い。
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const id = process.argv[2];
  const out = process.argv[3] || null;
  const table = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'data', 'tutorial_voice.json'), 'utf8'));
  const mv = table.matches[id];
  if (!mv) throw new Error(`tutorial_voice.json に ${id} がありません`);
  const scripts = Object.values(mv.steps).map((s) => s.text);
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const notch = !!process.env.IPHONE;
  const ctx = await browser.newContext({ viewport: notch ? { width: 932, height: 430 } : { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  if (notch) await page.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '#safe-probe{padding:0 59px 21px 59px !important}'; document.head.append(st); setTimeout(() => window.dispatchEvent(new Event('resize')), 50); }); });
  const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const res = []; const check = (n, ok, d = '') => { res.push(!!ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  const W = (ms) => page.waitForTimeout(ms);
  const title = () => page.locator('.vt-title').innerText();
  const subShown = () => page.locator('.vt-subtext').innerText();
  const voicePlaying = () => page.evaluate(() => window.__fc.Sound.voicePlaying);
  const lastVoice = () => page.evaluate(() => window.__fc.Sound.lastVoice || '');
  // 図の中身が図の枠の中に収まり、字幕と人物に重ならないか
  const layout = () => page.evaluate(() => {
    const r = (q) => document.querySelector(q)?.getBoundingClientRect();
    const fig = r('.vt-fig'); const sub = r('.vt-sub'); const panel = document.querySelector('.vt-fig')?.parentElement?.getBoundingClientRect();
    const inner = document.querySelector('.vt-fig')?.firstElementChild?.getBoundingClientRect();
    if (!fig || !inner) return 'no-fig';
    const pad = 2;
    if (inner.left < fig.left - pad || inner.right > fig.right + pad || inner.top < fig.top - pad || inner.bottom > fig.bottom + pad) return `fig-overflow ${Math.round(inner.left)},${Math.round(inner.top)},${Math.round(inner.right)},${Math.round(inner.bottom)} in ${Math.round(fig.left)},${Math.round(fig.top)},${Math.round(fig.right)},${Math.round(fig.bottom)}`;
    const hit = (a, b) => a && b && a.left < b.right - pad && b.left < a.right - pad && a.top < b.bottom - pad && b.top < a.bottom - pad;
    if (hit(inner, sub)) return 'over-subtitle';
    // 人物の絵は透明な余白を含むので、図が説明の板（人物の右）からはみ出さないかで見る
    if (panel && (inner.left < panel.left - pad || inner.right > panel.right + pad)) return 'out-of-panel';
    if (inner.width < 40 || inner.height < 30) return 'too-small';
    return 'ok';
  });

  await page.goto('http://localhost:4173/FALSE-CROWN/'); await W(1500);
  await page.evaluate(() => localStorage.removeItem('false-crown/tutorial-seen'));
  await page.getByText('開発者メニュー').tap(); await W(400);
  await page.getByRole('button', { name: new RegExp(`^${id.toUpperCase()} `) }).first().tap(); await W(800);
  check('説明の枠とゲームマスターが出る', await page.locator('.vt').count() === 1 && await page.locator('.vt-gm').count() === 1);

  const seen = [];
  for (let n = 0; n < 20; n++) {
    const tt = await title();
    if (tt === '練習') break;
    await W(500);
    const playing = await voicePlaying();
    const lv = await lastVoice();
    const text = await subShown();
    const recorded = scripts.includes(text);
    const lay = await layout();
    seen.push(tt);
    check(`「${tt}」字幕は全文を最初から出す`, text.length > 0 && text === (await page.locator('.vt-line').innerText()), text.slice(0, 24));
    if (recorded) check(`「${tt}」収録の声が鳴る`, playing && lv.includes(`/gm/${id}/`), lv.split('/').pop());
    else check(`「${tt}」収録が合わない段階は、声を鳴らさず字幕で説明する`, !playing, text.slice(0, 30));
    check(`「${tt}」図が枠に収まり、字幕・人物と重ならない`, lay === 'ok', lay);
    if (out) await page.screenshot({ path: `${out}/${id}_${String(n + 1).padStart(2, '0')}.png` });
    // 操作の段階（M03 の線を引く）
    if (id === 'm03' && (await page.locator('.vt-prompt.on').count()) && (await page.locator('.vt-fig .lb:not(.readonly)').count())) {
      const bb = await page.locator('.vt-fig .lb-board').boundingBox();
      const c = (i) => [bb.x + ((i % 4) + 0.5) * bb.width / 4, bb.y + (Math.floor(i / 4) + 0.5) * bb.height / 4];
      for (const p of [[0, 4, 8, 12], [1, 2, 3, 7], [5, 6, 10, 14]]) {
        await page.mouse.move(...c(p[0])); await page.mouse.down();
        for (const q of p.slice(1)) { await page.mouse.move(...c(q), { steps: 4 }); }
        await page.mouse.up(); await W(150);
      }
      await page.waitForFunction((t0) => document.querySelector('.vt-title')?.textContent !== t0, tt, { timeout: 20000 }).catch(() => null);
      check('線を全部結ぶと、声が終わったあと自動で次へ進む', (await title()) !== tt);
      continue;
    }
    if (await page.locator('.vt-prompt.on').count()) {
      // 操作を求める段階：操作が済むまで「次へ」は光らない。声が終わるのを待ち、「次へ」で飛ばせるかを見る
      await page.waitForFunction(() => !window.__fc.Sound.voicePlaying, null, { timeout: 40000 }).catch(() => null);
      check(`「${tt}」操作の段階は、やることを一言で出す`, (await page.locator('.vt-prompt.on').innerText()).length > 0);
    } else {
      await page.locator('.vt-next.ready').waitFor({ timeout: 40000 }).catch(() => null);
      check(`「${tt}」声と読む時間が終わると「次へ」が光る`, await page.locator('.vt-next.ready').count() === 1);
    }
    await page.locator('.vt-next').tap(); await W(400);
  }
  check('練習へ進む', (await title()) === '練習', seen.join(' / '));
  const lay = await layout();
  check('練習の盤面が枠に収まる', lay === 'ok', lay);
  check('練習の字幕が出る', (await subShown()).length > 0);
  if (out) await page.screenshot({ path: `${out}/${id}_99_practice.png` });
  await page.getByRole('button', { name: '練習を飛ばして本番へ' }).tap(); await W(1500);
  check('説明を閉じると声が止まり、本番が始まる', await page.locator('.vt').count() === 0 && await page.locator('.match').count() === 1, (await lastVoice()).split('/').pop());
  check('画面のエラーなし', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(res.every(Boolean) ? 'ALL OK' : 'SOME FAILED');
  await browser.close();
})();
