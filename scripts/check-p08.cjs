// P08（数字の天秤）を画面の操作だけで最後まで遊ぶ確認。npm run build の後、sh scripts/with-preview.sh node scripts/check-p08.cjs [写真の保存先]
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2] || null;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  const shot = async (n) => { if (out) await page.screenshot({ path: `${out}/p08_${n}.png` }); };
  // 画面に出ている数字（タイル、固定の重り、条件）だけから答えを探す
  const read = (root) => page.evaluate((r) => {
    const q = (s) => [...document.querySelectorAll(`${r} ${s}`)];
    const tiles = q('.sb-tile').map((e) => ({ i: Number(e.dataset.tile), v: Number(e.querySelector('b').textContent), must: e.querySelector('i') ? e.querySelector('i').textContent : '' })).sort((a, b) => a.i - b.i);
    const fix = (side) => { const e = document.querySelector(`${r} .sb-pan.${side} .sb-fix b`); return e ? Number(e.textContent) : 0; };
    const conds = q('.sb-cond span').map((e) => e.textContent);
    const sums = q('.sb-sum b').map((e) => Number(e.textContent));
    return { tiles, fixL: fix('l'), fixR: fix('r'), conds, sums, okConds: q('.sb-cond.ok').length, nConds: q('.sb-cond').length };
  }, root);
  const solve = (d) => {
    const n = d.tiles.length; let minUse = 1;
    for (const c of d.conds) { const m = c.match(/(\d+) 枚以上使う/); if (m) minUse = Number(m[1]); if (/すべて使う/.test(c)) minUse = n; }
    for (let code = 0; code < 3 ** n; code++) {
      let c = code, L = d.fixL, R = d.fixR, nL = 0, nR = 0; const pl = [];
      for (let i = 0; i < n; i++) { const p = c % 3; c = Math.floor(c / 3); pl.push(p); if (p === 1) { L += d.tiles[i].v; nL++; } if (p === 2) { R += d.tiles[i].v; nR++; } }
      if (L !== R || nL + nR < minUse || nL + nR === 0 || nL > 4 || nR > 4) continue;
      if (d.tiles.some((tl, i) => (tl.must === '左' && pl[i] !== 1) || (tl.must === '右' && pl[i] !== 2))) continue;
      return pl;
    }
    return null;
  };
  const place = async (root, i, side) => { await page.locator(`${root} .sb-tile[data-tile="${i}"]`).tap(); await page.waitForTimeout(50); await page.locator(`${root} .sb-pan.${side === 1 ? 'l' : 'r'} .sb-sum`).tap(); await page.waitForTimeout(60); };
  await page.goto('http://localhost:4173/FALSE-CROWN/'); await page.waitForTimeout(1500);
  await page.getByText('開発者メニュー').tap(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: /P08 数字の天秤/ }).tap(); await page.waitForTimeout(600);
  let maxLen = 0;
  for (let i = 0; i < 4; i++) { maxLen = Math.max(maxLen, (await page.locator('.tut-text').innerText()).length); await shot(`tut${i + 1}`); await page.getByRole('button', { name: /次へ|練習へ/ }).tap(); await page.waitForTimeout(250); }
  check('説明は段階表示で、1 画面の文は 80 文字以内', maxLen > 0 && maxLen <= 80, String(maxLen));
  const dp = await read('.tut'); const sp = solve(dp);
  for (let i = 0; i < sp.length; i++) if (sp[i]) await place('.tut', i, sp[i]);
  await shot('practice');
  check('練習：条件を満たしてつり合わせると、本番へ進める', await page.getByRole('button', { name: '本番へ', exact: true }).count() === 1);
  await page.getByRole('button', { name: '本番へ', exact: true }).tap(); await page.waitForTimeout(800);
  const state = () => page.evaluate(() => { const s = window.__fcSlot && window.__fcSlot.state; if (!s) return null; return { phase: s.phase, round: s.round, done: s.results.hero.length, res: s.results.hero, sub: !!s.current.hero }; });
  let solved = 0, sumsOk = true, condOk = true, dragOk = null, undoOk = null, capOk = null, wrongOk = null, timeoutOk = null, breaks = 0;
  for (let guard = 0; guard < 400; guard++) {
    const st = await state();
    if (!st || st.phase === 'done') break;
    if (st.phase === 'break') { const b = page.getByRole('button', { name: /ラウンド \d へ/ }); if (await b.count()) { await shot('break'); breaks++; await b.tap(); } await page.waitForTimeout(350); continue; }
    if (st.sub || await page.locator('.match .sb:not(.ro) .sb-tray').count() === 0) { await page.waitForTimeout(250); continue; }
    const d = await read('.match'); const sol = solve(d);
    if (st.round === 0) await shot('round1');
    const submit = page.locator('.match').getByRole('button', { name: '提出する' });
    if (st.round === 0 && capOk === null) {
      // 皿には 4 枚まで。5 枚目は載らない
      for (let i = 0; i < 5; i++) await place('.match', i, 1);
      const a = await read('.match');
      capOk = await page.locator('.match .sb-pan.l .sb-tile').count() === 4 && a.sums[0] === d.fixL + d.tiles.slice(0, 4).reduce((n, x) => n + x.v, 0);
      check('皿 1 つに 4 枚まで。5 枚目は載らない', capOk);
      // 載せたタイルをタップすると戻る
      await page.locator('.match .sb-pan.l .sb-tile').first().tap(); await page.waitForTimeout(80);
      undoOk = await page.locator('.match .sb-pan.l .sb-tile').count() === 3;
      check('載せたタイルをタップすると下に戻る', undoOk);
      check('つり合っていない時は提出できない', await submit.isDisabled());
      await page.getByRole('button', { name: '最初から' }).tap(); await page.waitForTimeout(100);
      // 引きずって載せる
      const tl = await page.locator('.match .sb-tray .sb-tile').first().boundingBox(); const pn = await page.locator('.match .sb-pan.r').boundingBox();
      await page.mouse.move(tl.x + tl.width / 2, tl.y + tl.height / 2); await page.mouse.down(); await page.mouse.move(tl.x + 40, tl.y - 30, { steps: 4 }); await page.mouse.move(pn.x + pn.width / 2, pn.y + pn.height / 2, { steps: 6 }); await shot('drag'); await page.mouse.up(); await page.waitForTimeout(120);
      dragOk = await page.locator('.match .sb-pan.r .sb-tile').count() === 1;
      check('タイルを皿まで引きずっても載る', dragOk);
      await page.getByRole('button', { name: '最初から' }).tap(); await page.waitForTimeout(100);
    }
    if (st.round === 4 && timeoutOk === null) {
      // 時間切れ：つり合っていない配置のままだと 0 点
      await place('.match', 0, 1);
      await page.waitForFunction((n) => window.__fcSlot.state.results.hero.length > n, st.done, { timeout: 100000 });
      const a = await state();
      timeoutOk = a.res[st.done].ok === false && a.res[st.done].points === 0;
      check('時間切れは、その時の配置で判定（つり合っていなければ 0 点）', timeoutOk);
      continue;
    }
    if (!sol) { check(`ラウンド ${st.round + 1} の答えが見つかる`, false); break; }
    for (let i = 0; i < sol.length; i++) if (sol[i]) await place('.match', i, sol[i]);
    const a = await read('.match');
    if (a.sums[0] !== a.sums[1]) sumsOk = false;
    if (a.okConds !== a.nConds) condOk = false;
    if (st.round === 1) await shot('solved');
    if (st.round === 5) await shot('solved6');
    await submit.tap(); await page.waitForTimeout(500);
    const b = await state();
    const r = b.res[st.done];
    if (r && r.ok && r.points >= 20) solved++;
    if (st.round === 1) await shot('result');
  }
  await page.waitForTimeout(1500);
  await shot('done');
  const fin = await page.evaluate(() => { const s = window.__fcSlot && window.__fcSlot.state; return s ? { phase: s.phase, pts: s.results.hero.map((r) => r.points) } : null; });
  check('最後まで進む', !fin || fin.phase === 'done', JSON.stringify(fin));
  check('画面の数字だけで解いた答えが、6 ラウンドとも正解になる（20 点以上）', solved === 6 && sumsOk && condOk, `solved=${solved}`);
  check('3 ラウンドの後に休憩がある', breaks === 1, String(breaks));
  check('画面のエラーなし', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
  console.log(res.every(Boolean) ? 'ALL OK' : 'SOME FAILED');
  process.exit(res.every(Boolean) ? 0 : 1);
})();
