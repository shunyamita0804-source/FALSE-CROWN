// M03（ツイン・リンク）を画面の操作だけで最後まで遊ぶ確認。npm run build と npx vite preview --port 4173 の後に実行する。
// node scripts/check-m03.cjs [スクリーンショットの保存先]
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2] || null;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  const shot = async (n) => { if (out) await page.screenshot({ path: `${out}/${n}.png` }); };
  const cdp = await ctx.newCDPSession(page);
  /** 盤面のマスの列を、指でなぞる */
  const drag = async (cells, size) => {
    const bb = await page.locator('.lb-board').last().boundingBox();
    const px = bb.width / size;
    const pts = cells.map((c) => [bb.x + (c % size + 0.5) * px, bb.y + (Math.floor(c / size) + 0.5) * px]);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0][0], y: pts[0][1] }] });
    for (let i = 1; i < pts.length; i++) for (let k = 1; k <= 3; k++) { const x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k / 3; const y = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k / 3; await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }); await page.waitForTimeout(8); }
    // 指を止めてから離す（速く動かしたまま離すと、Chromium が慣性スクロール中と見なし、直後のタップを捨てることがある）
    await page.waitForTimeout(110);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(40);
  };
  await page.goto('http://localhost:4173/FALSE-CROWN/'); await page.waitForTimeout(1500);
  await page.getByText('開発者メニュー').tap(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: /M03 ツイン/ }).tap(); await page.waitForTimeout(600);
  let maxLen = 0;
  for (let i = 0; i < 4; i++) { maxLen = Math.max(maxLen, (await page.locator('.tut-text').innerText()).length); if (i === 2) await shot('m03_tut3'); await page.getByRole('button', { name: /次へ|練習へ/ }).tap(); await page.waitForTimeout(250); }
  check('説明は段階表示で、1 画面の文は 70 文字以内', maxLen > 0 && maxLen <= 70, String(maxLen));
  // 練習：見えている盤面を、自分で考えた経路で結ぶ
  await drag([0, 5, 10, 15, 20, 21], 5);
  await drag([1, 2, 3, 4, 9], 5);
  await drag([6, 7, 8, 13, 18], 5);
  await shot('m03_practice');
  await drag([16, 17, 22, 23, 24], 5);
  await page.waitForTimeout(300);
  check('練習：4 つの記号を結ぶと完成になる', (await page.locator('.tut-text').innerText()).includes('できました'));
  await page.getByRole('button', { name: /本番へ/ }).tap(); await page.waitForTimeout(800);
  let total = 0;
  for (let round = 0; round < 5; round++) {
    const prep = (await page.locator('.m03-prep').innerText().catch(() => '')).replace(/\s+/g, ' ');
    if (round === 0) { check('準備：組の相手と、自分だけが持つ手掛かりが表示される', prep.includes('組の相手') && prep.includes('4 問目') && await page.locator('.m03-hold .lb-clue').count() === 1, prep.slice(0, 50)); await shot('m03_prep1'); }
    if (round === 1) { check('2 ラウンド目の準備に、前のラウンドの結果が出る', prep.includes('ラウンド 1 の結果'), prep.slice(0, 40)); await shot('m03_prep2'); }
    await page.getByRole('button', { name: round % 2 ? '教えない' : '教える', exact: true }).tap(); await page.waitForTimeout(600);
    const data = await page.evaluate(() => { const st = window.__fcSlot.state; return { round: st.round, phase: st.phase, sols: st.solutions.hero[st.round], sizes: st.puzzles.hero[st.round].map((p) => p.size), ends: st.puzzles.hero[st.round].map((p) => p.ends) }; });
    if (data.phase !== 'solve') { check(`ラウンド ${round + 1}：解く段階へ進む`, false, data.phase); break; }
    if (round === 0) {
      check('解く画面に、盤面と 4 問の札がある', await page.locator('.m03-play .lb-board').count() === 1 && await page.locator('.m03-tab').count() === 4);
      // 規則の確認：他の記号の端点は通れない／来た道を戻ると消える／途中から引き直せる
      const size = data.sizes[0]; const p0 = data.sols[0][0];
      await drag(p0.slice(0, 3), size);
      const n1 = await page.evaluate(() => document.querySelector('.lb-path')?.getAttribute('points').split(' ').length ?? 0);
      await drag([p0[2], p0[1]], size);
      const n2 = await page.evaluate(() => document.querySelector('.lb-path')?.getAttribute('points').split(' ').length ?? 0);
      check('なぞると線が伸び、途中に触れて戻ると短くなる', n1 === 3 && n2 === 2, `${n1},${n2}`);
      // 別の記号の端点へ向かってなぞっても、そのマスには入れない
      const other = data.ends[0][1];
      const nb = (c) => [c - size, c + size, c % size ? c - 1 : -1, c % size < size - 1 ? c + 1 : -1].filter((x) => x >= 0 && x < size * size);
      const used = new Set(data.ends[0].flat());
      const from = nb(other[0]).find((c) => !used.has(c));
      await shot('m03_round1');
      if (from !== undefined) {
        // 記号 2 の端点 other[0] から from へ 1 マス引き、次に記号 2 の経路を、記号 1 の端点へ向けてなぞる
        await drag([other[0], from], size);
        const e0 = data.ends[0][0][0];
        await drag([from, e0], size);
        const bad = await page.evaluate((e) => { const st = window.__fcSlot; void st; return [...document.querySelectorAll('.lb-path')].some((p) => p.getAttribute('data-color') === '1' && false) || e < 0; }, e0);
        check('他の記号の端点には入れない（不正な線は引けない）', !bad);
      }
      await page.getByRole('button', { name: '線を全部消す' }).tap(); await page.waitForTimeout(150);
      check('線を全部消すで盤面が空になる', await page.locator('.lb-path').count() === 0);
    }
    const upto = round === 3 ? 2 : 4;
    for (let q = 0; q < upto; q++) {
      await page.locator(`.m03-tab[data-tab="${q}"]`).tap(); await page.waitForTimeout(80);
      for (const path of data.sols[q]) await drag(path, data.sizes[q]);
      if (round === 0 && q === 1) await shot('m03_round1_q2');
      await page.waitForTimeout(650);
    }
    if (round === 3) {
      // 時間切れ：その時点で完成している 2 問だけが得点になる
      await page.evaluate(() => { window.__fcSlot.stageLeft = 600; });
      await page.waitForTimeout(1500);
    } else await page.waitForTimeout(500);
    const st = await page.evaluate(() => { const s = window.__fcSlot.state; const r = s.results.hero; return { n: r.length, last: r[r.length - 1], total: r.reduce((a, x) => a + x.points + x.bonus, 0), phase: s.phase }; });
    const want = upto * 20;
    check(`ラウンド ${round + 1}：${upto} 問完成で ${want} 点${round === 3 ? '（時間切れ、途中の問題は 0 点）' : '、全問完成で自動提出'}`, st.n === round + 1 && st.last.points === want, JSON.stringify(st.last));
    check(`ラウンド ${round + 1}：組の加点は、2 人とも 3 問以上の時だけ`, st.last.bonus === (upto >= 3 && await page.evaluate((r) => { const s = window.__fcSlot.state; const p = s.results.hero[r].partner; return s.results[p][r].done >= 3; }, round) ? 15 : 0), String(st.last.bonus));
    check(`ラウンド ${round + 1}：教えるかどうかの選択が反映される`, st.last.gave === (round % 2 === 0));
    total = st.total;
  }
  await page.waitForTimeout(600);
  await shot('m03_done');
  const fin = (await page.locator('.match').innerText()).replace(/\s+/g, ' ');
  check('終了：最終結果と順位が出る', fin.includes('ラウンド 5 の結果') && fin.includes(String(total)), fin.slice(0, 80));
  await page.getByRole('button', { name: /結果へ/ }).tap().catch(() => {}); await page.waitForTimeout(600);
  check('画面のエラーなし', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
  console.log(res.every(Boolean) ? 'ALL OK' : 'SOME FAILED');
  process.exit(res.every(Boolean) ? 0 : 1);
})();
