// M07（六角領域）を画面の操作だけで最後まで遊ぶ確認。npm run build と npx vite preview --port 4173 の後に実行する。
// node scripts/check-m07.cjs [スクリーンショットの保存先]
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2] || null;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  const shot = async (n) => { if (out) await page.screenshot({ path: `${out}/m07_${n}.png` }); };
  const shots = new Set(); const once = async (n) => { if (!shots.has(n)) { shots.add(n); await shot(n); } };
  await page.goto('http://localhost:4173/FALSE-CROWN/'); await page.waitForTimeout(1500);
  await page.getByText('開発者メニュー').tap(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: /M07 六角/ }).tap(); await page.waitForTimeout(600);
  let maxLen = 0;
  for (let i = 0; i < 4; i++) { maxLen = Math.max(maxLen, (await page.locator('.tut-text').innerText()).length); await shot(`tut${i + 1}`); await page.getByRole('button', { name: /次へ|練習へ/ }).tap(); await page.waitForTimeout(250); }
  check('説明は段階表示で、1 画面の文は 80 文字以内', maxLen > 0 && maxLen <= 80, String(maxLen));
  const put = (root) => page.locator(root).getByRole('button', { name: '置く', exact: true });
  check('練習：置く場所を決める前は確定できない', await put('.tut').isDisabled());
  // 指で試す：タイルを選び、点線のマスをタップし、置けるまで回す
  const tryPlace = async (root, shape) => {
    await page.locator(`${root} .hx-tile[data-shape="${shape}"]`).tap(); await page.waitForTimeout(60);
    const fr = await page.evaluate((r) => [...document.querySelectorAll(`${r} .hx.fr`)].map((e) => e.getAttribute('data-cell')), root);
    for (const c of fr.slice(0, 8)) {
      await page.locator(`${root} .hx[data-cell="${c}"]`).tap(); await page.waitForTimeout(50);
      for (let k = 0; k < 6; k++) {
        if (!(await put(root).isDisabled())) return true;
        await page.locator(root).getByRole('button', { name: '⟳' }).tap(); await page.waitForTimeout(40);
      }
    }
    return false;
  };
  const okP = await tryPlace('.tut', 'line3');
  await shot('practice');
  if (okP) await put('.tut').tap(); await page.waitForTimeout(250);
  check('練習：タイルを選び、回して置くと、本番へ進める', okP && await page.getByRole('button', { name: '本番へ', exact: true }).count() === 1);
  await page.getByRole('button', { name: '本番へ', exact: true }).tap(); await page.waitForTimeout(800);
  const state = () => page.evaluate(() => { const s = window.__fcSlot && window.__fcSlot.state; if (!s) return null; const seat = s.seats[s.players.indexOf('hero')]; return { phase: s.phase, round: s.round, turn: s.turn, toMove: s.phase === 'play' ? s.order[s.turn] : null, seat, mine: s.owner.filter((o) => o === seat).length, tiles: [...s.tiles.hero], aid: s.aidUsed.hero, log: s.log.length, lastLog: s.log[s.log.length - 1], ready: s.ready.hero, owner: [...s.owner] }; });
  const AREA = { one: 1, two: 2, line3: 3, bend3: 3, tri3: 3, line4: 4, rhomb4: 4, hook4: 4, star4: 4, bolt4: 4 };
  let placed = 0, passes = 0, replaySeen = false, capOk = null, badOk = null, rotOk = null, aidDone = false, timeoutDone = false, breaks = 0, growOk = true;
  for (let guard = 0; guard < 1500; guard++) {
    const st = await state();
    if (!st || st.phase === 'done') break;
    if (st.phase === 'break') {
      const b = page.getByRole('button', { name: '再開する' });
      if (await b.count()) { await once('break'); breaks++; await b.tap(); }
      await page.waitForTimeout(350); continue;
    }
    if (st.toMove !== 'hero') { await page.waitForTimeout(200); continue; }
    if (await page.locator('.match .hxb.active').count() === 0) { replaySeen = true; await once('replay'); await page.waitForTimeout(250); continue; }
    await once('turn');
    if (capOk === null && st.round === 0) {
      const locked = await page.locator('.match .hx-tile.locked').count(); const open = await page.locator('.match .hx-tile:not(.locked)').count();
      capOk = locked >= 7 && open === 1;
      check('第 1 巡は 1 マスのタイルだけが選べる', capOk, `locked=${locked} open=${open}`);
    }
    if (badOk === null) {
      // 自分の領域から離れたマス（塔の反対側）には置けない
      await page.locator('.match .hx-tile:not(.locked)').first().tap(); await page.waitForTimeout(60);
      const far = await page.evaluate(() => { const s = window.__fcSlot.state; const fr = new Set([...document.querySelectorAll('.match .hx.fr')].map((e) => Number(e.getAttribute('data-cell')))); return [...document.querySelectorAll('.match .hx.empty')].map((e) => Number(e.getAttribute('data-cell'))).find((c) => !fr.has(c) && s.owner[c] < 0); });
      await page.locator(`.match .hx[data-cell="${far}"]`).tap(); await page.waitForTimeout(80);
      badOk = await put('.match').isDisabled() && await page.locator('.match .hx.bad').count() >= 1;
      await once('bad');
      check('離れたマスには置けず、赤で示される', badOk);
      await page.locator('.match .hx-tile.sel').tap(); await page.waitForTimeout(60);
    }
    if (!aidDone && st.round >= 3 && st.tiles.some((x) => AREA[x] === 4)) {
      const shape = st.tiles.find((x) => AREA[x] === 4);
      await page.locator(`.match .hx-tile[data-shape="${shape}"]`).tap(); await page.waitForTimeout(60);
      await page.getByRole('button', { name: /形を替える/ }).tap(); await page.waitForTimeout(200);
      await once('aid_pick');
      const to = await page.locator('.match .hx-tile.alt').first().getAttribute('data-alt');
      await page.locator('.match .hx-tile.alt').first().tap(); await page.waitForTimeout(300);
      await page.getByRole('button', { name: /2 ピース支払う/ }).tap(); await page.waitForTimeout(400);
      const a = await state();
      check('形を替える：ピース 2 個で、同じ面積の別の形になる（手番は続く）', a.aid && a.tiles.includes(to) && a.tiles.length === st.tiles.length && a.toMove === 'hero', `${shape}→${to}`);
      aidDone = true; continue;
    }
    if (!timeoutDone && st.round === 1) {
      await page.waitForFunction((n) => window.__fcSlot.state.log.length > n, st.log, { timeout: 60000 });
      const a = await page.evaluate((n) => window.__fcSlot.state.log[n], st.log);
      check('時間切れはパスになる', a.seat === st.seat && a.cells === null);
      timeoutDone = true; continue;
    }
    // 大きいタイルから順に試す
    const shapes = [...new Set(st.tiles)].sort((a, b) => AREA[b] - AREA[a]);
    let done = false;
    for (const shape of shapes) {
      if (await page.locator(`.match .hx-tile[data-shape="${shape}"]:not(.locked)`).count() === 0) continue;
      if (await page.locator(`.match .hx-tile.sel`).count()) { await page.locator('.match .hx-tile.sel').tap(); await page.waitForTimeout(40); }
      if (await tryPlace('.match', shape)) {
        if (rotOk === null && AREA[shape] >= 2) {
          const g1 = await page.evaluate(() => [...document.querySelectorAll('.match .hx.gh, .match .hx.bad')].map((e) => e.getAttribute('data-cell')).sort().join());
          await page.locator('.match').getByRole('button', { name: '⟳' }).tap(); await page.waitForTimeout(60);
          const g2 = await page.evaluate(() => [...document.querySelectorAll('.match .hx.gh, .match .hx.bad')].map((e) => e.getAttribute('data-cell')).sort().join());
          await page.locator('.match').getByRole('button', { name: '⟲' }).tap(); await page.waitForTimeout(60);
          rotOk = g1 !== g2 && !(await put('.match').isDisabled());
          check('回すと形の向きが変わり、戻すと元の位置に置ける', rotOk);
        }
        await once(`ghost_${AREA[shape]}`);
        await put('.match').tap(); await page.waitForTimeout(250);
        const a = await state();
        if (a.mine !== st.mine + AREA[shape]) growOk = false;
        placed++; done = true; break;
      }
    }
    if (!done) {
      if (await page.locator('.match .hx-tile.sel').count()) { await page.locator('.match .hx-tile.sel').tap(); await page.waitForTimeout(40); }
      await page.getByRole('button', { name: 'パス', exact: true }).tap(); await page.waitForTimeout(250);
      const dlg = page.getByRole('button', { name: 'パス', exact: true }).last();
      if (await page.locator('.dialog, .confirm').count()) await dlg.tap();
      await page.waitForTimeout(250); passes++;
    }
  }
  await page.waitForTimeout(6000);
  await shot('done');
  const fin = await page.evaluate(() => { const s = window.__fcSlot && window.__fcSlot.state; return s ? { phase: s.phase, round: s.round } : null; });
  check('最後まで進む', !fin || fin.phase === 'done', JSON.stringify(fin));
  check('タイルを置くと、その面積だけ自分のマスが増える', placed >= 3 && growOk, `placed=${placed} passes=${passes}`);
  check('CPU の手は 1 人ずつ順に見せる', replaySeen);
  check('3 巡ごとに交渉の時間がある', breaks >= 1, String(breaks));
  check('形を替える補助を使えた', aidDone);
  check('時間切れを確かめた', timeoutDone);
  check('画面のエラーなし', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
  console.log(res.every(Boolean) ? 'ALL OK' : 'SOME FAILED');
  process.exit(res.every(Boolean) ? 0 : 1);
})();
