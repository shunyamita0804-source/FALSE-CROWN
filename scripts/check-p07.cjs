// P07（ブラック＆ホワイト）を画面の操作だけで最後まで遊ぶ確認。npm run build と npx vite preview --port 4173 の後に実行する。
// node scripts/check-p07.cjs [スクリーンショットの保存先]
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2] || null;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  const shot = async (n) => { if (out) await page.screenshot({ path: `${out}/p07_${n}.png` }); };
  const shots = new Set(); const once = async (n) => { if (!shots.has(n)) { shots.add(n); await shot(n); } };
  await page.goto('http://localhost:4173/FALSE-CROWN/'); await page.waitForTimeout(1500);
  await page.getByText('開発者メニュー').tap(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: /P07 ブラック/ }).tap(); await page.waitForTimeout(600);
  let maxLen = 0;
  for (let i = 0; i < 4; i++) { maxLen = Math.max(maxLen, (await page.locator('.tut-text').innerText()).length); await shot(`tut${i + 1}`); await page.getByRole('button', { name: /次へ|練習へ/ }).tap(); await page.waitForTimeout(250); }
  check('説明は段階表示で、1 画面の文は 80 文字以内', maxLen > 0 && maxLen <= 80, String(maxLen));
  const put = (root) => page.locator(root).getByRole('button', { name: '置く', exact: true });
  check('練習：選ぶ前は確定できない', await put('.tut').isDisabled());
  const lgT = await page.evaluate(() => [...document.querySelectorAll('.tut .hx.lg')].map((e) => e.getAttribute('data-cell')));
  // 1 個しか返せない場所では進めない
  let oneOk = false, twoOk = false;
  for (const c of lgT) {
    await page.locator(`.tut .hx[data-cell="${c}"]`).tap(); await page.waitForTimeout(100);
    const will = await page.locator('.tut .hx.will').count();
    if (will === 1) { await put('.tut').tap(); await page.waitForTimeout(200); oneOk = await page.getByRole('button', { name: '本番へ', exact: true }).count() === 0; }
  }
  for (const c of lgT) {
    if (await page.locator(`.tut .hx.lg[data-cell="${c}"]`).count() === 0) continue;
    await page.locator(`.tut .hx[data-cell="${c}"]`).tap(); await page.waitForTimeout(100);
    if (await page.locator('.tut .hx.will').count() === 2) { await shot('practice'); await page.locator(`.tut .hx[data-cell="${c}"]`).tap(); await page.waitForTimeout(250); twoOk = true; break; }
  }
  check('練習：1 個しか返せない場所では進めず、2 個返すと本番へ進める', oneOk && twoOk && await page.getByRole('button', { name: '本番へ', exact: true }).count() === 1, `${oneOk} ${twoOk}`);
  await page.getByRole('button', { name: '本番へ', exact: true }).tap(); await page.waitForTimeout(800);
  const state = () => page.evaluate(() => { const s = window.__fcSlot && window.__fcSlot.state; if (!s) return null; const n = s.players.length; const seat = s.players.indexOf('hero'); return { phase: s.phase, round: s.round, turn: s.turn, toMove: s.phase === 'play' ? s.players[(s.turn + s.round) % n] : null, seat, mine: s.board.filter((o) => o === seat).length, log: s.log.length, board: [...s.board] }; });
  let moves = 0, replaySeen = false, flipOk = true, previewOk = true, badOk = null, timeoutDone = false, breaks = 0, tapTwice = false;
  for (let guard = 0; guard < 900; guard++) {
    const st = await state();
    if (!st || st.phase === 'done') break;
    if (st.phase === 'break') {
      const b = page.getByRole('button', { name: '再開する' });
      if (await b.count()) { await once('break'); breaks++; await b.tap(); }
      await page.waitForTimeout(350); continue;
    }
    if (st.toMove !== 'hero') { await page.waitForTimeout(200); continue; }
    if (await page.locator('.match .hxb.active').count() === 0) { replaySeen = true; await once('replay'); await page.waitForTimeout(250); continue; }
    if (await page.getByRole('button', { name: 'パス', exact: true }).count()) { await once('pass'); await page.getByRole('button', { name: 'パス', exact: true }).tap(); await page.waitForTimeout(300); continue; }
    const legal = await page.evaluate(() => [...document.querySelectorAll('.match .hx.lg')].map((e) => Number(e.getAttribute('data-cell'))));
    if (!legal.length) { await page.waitForTimeout(200); continue; }
    await once('turn');
    if (badOk === null) {
      const bad = st.board.findIndex((o, c) => o === -1 && !legal.includes(c));
      if (bad >= 0) {
        await page.locator(`.match .hx[data-cell="${bad}"]`).tap(); await page.waitForTimeout(120);
        badOk = await put('.match').isDisabled() && /置けません/.test(await page.locator('.match .fb-note').innerText());
        check('印の無いマスには置けず、理由が出る', badOk);
      }
    }
    if (!timeoutDone && st.round === 1) {
      await page.waitForFunction((n) => window.__fcSlot.state.log.length > n, st.log, { timeout: 60000 });
      const a = await page.evaluate((n) => window.__fcSlot.state.log[n], st.log);
      check('時間切れは、置ける場所へ自動で置かれる', a.seat === st.seat && a.cell !== null && legal.includes(a.cell));
      timeoutDone = true; continue;
    }
    // 画面に出る「返る駒」の数が一番多い場所を選ぶ
    let best = legal[0], bestN = -1, cur = -1;
    for (const c of legal.slice(0, 8)) {
      await page.locator(`.match .hx[data-cell="${c}"]`).tap(); await page.waitForTimeout(60); cur = c;
      const n = await page.locator('.match .hx.will').count();
      if (n > bestN) { bestN = n; best = c; }
    }
    if (cur !== best) { await page.locator(`.match .hx[data-cell="${best}"]`).tap(); await page.waitForTimeout(80); }
    const shown = await page.locator('.match .hx.will').count();
    if (shown !== bestN) previewOk = false;
    await once('preview');
    if (moves % 2 === 0) { await page.locator(`.match .hx[data-cell="${best}"]`).tap(); tapTwice = true; } else await put('.match').tap();
    await page.waitForTimeout(250);
    const a = await state();
    if (a.mine < st.mine + 1 + bestN && a.log === st.log + 1) flipOk = false;
    const mineLog = await page.evaluate((n) => window.__fcSlot.state.log[n], st.log);
    if (!mineLog || mineLog.cell !== best || mineLog.flipped.length !== bestN) flipOk = false;
    moves++;
  }
  await page.waitForTimeout(4000);
  await shot('done');
  const fin = await page.evaluate(() => { const s = window.__fcSlot && window.__fcSlot.state; return s ? { phase: s.phase, round: s.round, counts: s.players.map((_, i) => s.board.filter((o) => o === i).length) } : null; });
  check('最後まで進む', !fin || fin.phase === 'done', JSON.stringify(fin));
  check('置くと、先に示された数だけ駒が返る', moves >= 5 && flipOk && previewOk, `moves=${moves}`);
  check('同じマスをもう一度タップしても確定できる', tapTwice);
  check('CPU の手は 1 手ずつ順に見せる', replaySeen);
  check('3 巡ごとに相談の時間がある', breaks >= 1, String(breaks));
  check('時間切れを確かめた', timeoutDone);
  check('画面のエラーなし', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
  console.log(res.every(Boolean) ? 'ALL OK' : 'SOME FAILED');
  process.exit(res.every(Boolean) ? 0 : 1);
})();
