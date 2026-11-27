// P09（鏡の決闘）を画面の操作だけで最後まで遊ぶ確認。npm run build の後、sh scripts/with-preview.sh node scripts/check-p09.cjs [写真の保存先]
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2] || null;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  const shot = async (n) => { if (out) await page.screenshot({ path: `${out}/p09_${n}.png` }); };
  // 画面に出ている見本（マスの位置、札の種類と向き、軸の向き）だけから答えを作る
  const read = (root) => page.evaluate((r) => {
    const mb = document.querySelector(`${r} .mb:not(.ro)`);
    if (!mb) return null;
    const cells = [...mb.querySelectorAll('.mb-cell')];
    const n = Math.round(Math.sqrt(cells.length));
    const axis = [...mb.classList].find((c) => c.startsWith('ax-')).slice(3);
    const src = {};
    cells.forEach((c, i) => { if (c.classList.contains('src')) { const tl = c.querySelector('.mb-tile'); if (tl) src[i] = tl.classList.contains('blk') ? 'b' : tl.dataset.dir; } });
    const mine = {};
    cells.forEach((c, i) => { if (c.dataset.tile) mine[i] = c.dataset.tile; });
    const sz = cells[0].getBoundingClientRect();
    return { n, axis, src, mine, cellPx: sz.width };
  }, root);
  const solve = (d) => {
    const map = { v: { u: 'u', d: 'd', l: 'r', r: 'l' }, h: { u: 'd', d: 'u', l: 'l', r: 'r' }, d: { u: 'l', l: 'u', d: 'r', r: 'd' }, a: { u: 'r', r: 'u', d: 'l', l: 'd' } }[d.axis];
    const o = {};
    for (const [cs, tl] of Object.entries(d.src)) {
      const c = Number(cs); const x = c % d.n, y = Math.floor(c / d.n);
      const [a, b] = d.axis === 'v' ? [d.n - 1 - x, y] : d.axis === 'h' ? [x, d.n - 1 - y] : d.axis === 'd' ? [y, x] : [d.n - 1 - y, d.n - 1 - x];
      o[b * d.n + a] = tl === 'b' ? 'b' : map[tl];
    }
    return o;
  };
  const tool = async (root, k) => { await page.locator(`${root} .mb-tool[data-tool="${k}"]`).tap(); await page.waitForTimeout(40); };
  const cell = (root, c) => page.locator(`${root} .mb:not(.ro) .mb-cell[data-cell="${c}"]`);
  const put = async (root, c, tl) => {
    if (tl === 'b') { await tool(root, 'b'); await cell(root, c).tap(); await page.waitForTimeout(40); return; }
    await tool(root, 'a');
    for (let k = 0; k <= ['u', 'r', 'd', 'l'].indexOf(tl); k++) { await cell(root, c).tap(); await page.waitForTimeout(40); }
  };
  await page.goto('http://localhost:4173/FALSE-CROWN/'); await page.waitForTimeout(1500);
  await page.getByText('開発者メニュー').tap(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: /P09 鏡の決闘/ }).tap(); await page.waitForTimeout(600);
  let maxLen = 0;
  for (let i = 0; i < 4; i++) { maxLen = Math.max(maxLen, (await page.locator('.tut-text').innerText()).length); await shot(`tut${i + 1}`); await page.getByRole('button', { name: /次へ|練習へ/ }).tap(); await page.waitForTimeout(250); }
  check('説明は段階表示で、1 画面の文は 80 文字以内', maxLen > 0 && maxLen <= 80, String(maxLen));
  const dp = await read('.tut'); const sp = solve(dp);
  check('タップするマスは 40px 以上（練習）', dp.cellPx >= 40, dp.cellPx.toFixed(1));
  for (const [c, tl] of Object.entries(sp)) await put('.tut', c, tl);
  await shot('practice');
  check('練習：鏡映しの形を作ると、本番へ進める', await page.getByRole('button', { name: '本番へ', exact: true }).count() === 1);
  await page.getByRole('button', { name: '本番へ', exact: true }).tap(); await page.waitForTimeout(800);
  const state = () => page.evaluate(() => { const s = window.__fcSlot && window.__fcSlot.state; if (!s) return null; return { phase: s.phase, round: s.round, done: s.results.hero.length, res: s.results.hero, sub: !!s.current.hero, aid: s.aidUsed.hero }; });
  const pieces = async () => null;
  let solved = 0, breaks = 0, first = true, minCell = 999, partOk = null, timeoutOk = null, axes = [];
  for (let guard = 0; guard < 400; guard++) {
    const st = await state();
    if (!st || st.phase === 'done') break;
    if (st.phase === 'break') { const b = page.getByRole('button', { name: /ラウンド \d へ/ }); if (await b.count()) { await shot('break'); breaks++; await b.tap(); } await page.waitForTimeout(350); continue; }
    const d = await read('.match');
    if (st.sub || !d) { await page.waitForTimeout(250); continue; }
    const sol = solve(d); const keys = Object.keys(sol);
    minCell = Math.min(minCell, d.cellPx); axes.push(d.axis);
    const submit = page.locator('.match').getByRole('button', { name: '提出する' });
    await shot(`round${st.round + 1}`);
    if (first) {
      first = false;
      check('何も置いていない時は提出できない', await submit.isDisabled());
      // 見本側のマスには置けない
      const s0 = Object.keys(d.src)[0];
      await page.locator(`.match .mb .mb-cell[data-cell="${s0}"]`).tap({ force: true }).catch(() => {});
      check('見本側のマスには置けない', Object.keys((await read('.match')).mine).length === 0);
      // 四角：置く、もう一度で消える
      await put('.match', keys[0], 'b'); const a1 = (await read('.match')).mine[keys[0]];
      await cell('.match', keys[0]).tap(); await page.waitForTimeout(40); const a2 = (await read('.match')).mine[keys[0]];
      check('四角はタップで置き、もう一度で消える', a1 === 'b' && a2 === undefined);
      await put('.match', keys[0], 'b');
      check('ラウンド 1 は四角だけ（矢印の道具は出ない）', await page.locator('.match .mb-tool[data-tool="a"]').count() === 0);
      await tool('.match', 'x'); await cell('.match', keys[0]).tap(); await page.waitForTimeout(40);
      check('消しゴムで消える', Object.keys((await read('.match')).mine).length === 0);
    }
    if (st.round === 1 && !st.aid) {
      // 矢印：上、右、下、左の順に回る
      const seq = []; await tool('.match', 'a');
      for (let k = 0; k < 5; k++) { await cell('.match', keys[0]).tap(); await page.waitForTimeout(40); seq.push((await read('.match')).mine[keys[0]]); }
      check('矢印はタップするたびに右回りに回る', seq.join('') === 'urdlu', seq.join(''));
      await shot('arrow');
      await tool('.match', 'x'); await cell('.match', keys[0]).tap(); await page.waitForTimeout(40);
      // 補助：1 ピースで、正しい 1 マスが光る
      const before = await pieces();
      await page.locator('.match').getByRole('button', { name: /正しい 1 マス/ }).tap(); await page.waitForTimeout(300);
      await page.getByRole('button', { name: /1 ピース支払う/ }).tap(); await page.waitForTimeout(400);
      await shot('aid');
      const after = await pieces();
      const hint = await page.locator('.match .mb-cell.hint').count();
      check('補助：ピース 1 個で、正しい札のマスが 1 つ示される', hint === 1 && (await state()).aid, `hint=${hint}`);
    }
    if (st.round === 2 && partOk === null) {
      // 1 マスだけ違う札で提出：完全一致にならず、部分点になる
      for (const [c, tl] of Object.entries(sol).slice(1)) await put('.match', c, tl);
      await submit.tap(); await page.waitForTimeout(600);
      const r = (await state()).res[st.done];
      partOk = !!r && r.perfect === false && r.correct === r.total - 1 && r.points === Math.floor(((r.total - 1) / r.total) * 8);
      check('1 マス足りない答えは部分点（合っている割合 × 8）', partOk, JSON.stringify(r && { c: r.correct, t: r.total, p: r.points }));
      await shot('review');
      continue;
    }
    if (st.round === 3 && timeoutOk === null) {
      // 時間切れ：その時点の盤面で採点
      await put('.match', keys[0], sol[keys[0]]);
      await page.waitForFunction((n) => window.__fcSlot.state.results.hero.length > n, st.done, { timeout: 100000 });
      const r = (await state()).res[st.done];
      timeoutOk = r.perfect === false && r.correct === 1;
      check('時間切れは、その時の盤面で採点する', timeoutOk, JSON.stringify({ c: r.correct, p: r.points }));
      continue;
    }
    for (const [c, tl] of Object.entries(sol)) await put('.match', c, tl);
    if (st.round === 4) await shot('diag');
    await submit.tap(); await page.waitForTimeout(600);
    const r = (await state()).res[st.done];
    if (r && r.perfect && r.points >= 20) solved++;
    if (st.round === 0) await shot('result');
  }
  await page.waitForTimeout(1500);
  await shot('done');
  const fin = await page.evaluate(() => { const s = window.__fcSlot && window.__fcSlot.state; return s ? { phase: s.phase, pts: s.results.hero.map((r) => r.points) } : null; });
  check('最後まで進む', !fin || fin.phase === 'done', JSON.stringify(fin));
  check('画面の見本だけで作った答えが、縦、横、斜めの軸で完全一致になる', solved === 4, `solved=${solved} axes=${axes.join('')}`);
  check('斜めの軸は後半の 2 ラウンドだけ', axes.join('') === 'vhvhda', axes.join(''));
  check('タップするマスは 40px 以上（7×7 でも）', minCell >= 40, minCell.toFixed(1));
  check('3 ラウンドの後に休憩がある', breaks === 1, String(breaks));
  check('画面のエラーなし', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
  console.log(res.every(Boolean) ? 'ALL OK' : 'SOME FAILED');
  process.exit(res.every(Boolean) ? 0 : 1);
})();
