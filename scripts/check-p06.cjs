// P06（一筆の迷宮）を画面の操作だけで最後まで遊ぶ確認。npm run build と npx vite preview --port 4173 の後に実行する。
// node scripts/check-p06.cjs [スクリーンショットの保存先]
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2] || null;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  const shot = async (n) => { if (out) await page.screenshot({ path: `${out}/p06_${n}.png` }); };
  const shots = new Set(); const once = async (n) => { if (!shots.has(n)) { shots.add(n); await shot(n); } };
  /** 盤面の上を、マスの中心を順に指でなぞる */
  const drag = async (root, cells, size) => {
    const bb = await page.locator(`${root} .pb2-board`).boundingBox();
    const pts = cells.map((c) => [bb.x + ((c % size) + 0.5) * bb.width / size, bb.y + (Math.floor(c / size) + 0.5) * bb.height / size]);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0][0], y: pts[0][1] }] });
    for (let i = 1; i < pts.length; i++) for (let k = 1; k <= 3; k++) { const x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k / 3; const y = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k / 3; await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }); await page.waitForTimeout(8); }
    await page.waitForTimeout(110);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(40);
  };
  await page.goto('http://localhost:4173/FALSE-CROWN/'); await page.waitForTimeout(1500);
  await page.getByText('開発者メニュー').tap(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: /P06 一筆/ }).tap(); await page.waitForTimeout(600);
  let maxLen = 0;
  for (let i = 0; i < 4; i++) { maxLen = Math.max(maxLen, (await page.locator('.tut-text').innerText()).length); await shot(`tut${i + 1}`); await page.getByRole('button', { name: /次へ|練習へ/ }).tap(); await page.waitForTimeout(250); }
  check('説明は段階表示で、1 画面の文は 80 文字以内', maxLen > 0 && maxLen <= 80, String(maxLen));
  // 練習：壁を越える向き（1→5）へは進めない。行き止まり（0→4→8→12）からは戻る
  await drag('.tut', [0, 1, 5], 4);
  check('練習：壁は越えられない', await page.locator('.tut .lb-cell.on').count() === 2, String(await page.locator('.tut .lb-cell.on').count()));
  await page.locator('.tut').getByRole('button', { name: '最初から' }).tap(); await page.waitForTimeout(150);
  await drag('.tut', [0, 4, 5, 9], 4);
  check('練習：順番の違うチェック点へは進めない', await page.locator('.tut .lb-cell.on').count() === 3, String(await page.locator('.tut .lb-cell.on').count()));
  await page.locator('.tut').getByRole('button', { name: '1 マス戻す' }).tap(); await page.waitForTimeout(120);
  check('練習：1 マス戻すと線が短くなる', await page.locator('.tut .lb-cell.on').count() === 2);
  await page.locator('.tut').getByRole('button', { name: '最初から' }).tap(); await page.waitForTimeout(150);
  await drag('.tut', [0, 1, 2, 6, 5], 4); await shot('practice');
  await drag('.tut', [5, 9, 13, 14, 15], 4); await page.waitForTimeout(300);
  check('練習：指を離して続きからなぞれる。G に着くと本番へ進める', await page.getByRole('button', { name: '本番へ', exact: true }).count() === 1);
  await page.getByRole('button', { name: '本番へ', exact: true }).tap(); await page.waitForTimeout(800);
  const state = () => page.evaluate(() => { const s = window.__fcSlot && window.__fcSlot.state; if (!s) return null; return { phase: s.phase, stage: s.stage_, maze: s.mazes[Math.min(s.stage_, 5)], played: s.results.hero.length, res: s.results.hero, aid: s.aidUsed.hero, sub: !!s.current.hero }; });
  // 画面に見えている盤面（始点、終点、チェック点、壁）だけから、深さ優先で道を探す
  const solve = (m) => { const n = m.size; const walls = new Set(m.walls); const nb = (c) => { const o = []; const x = c % n, y = Math.floor(c / n); if (y > 0) o.push(c - n); if (x < n - 1) o.push(c + 1); if (y < n - 1) o.push(c + n); if (x > 0) o.push(c - 1); return o.filter((t) => !walls.has(Math.min(c, t) * 100 + Math.max(c, t))); };
    const path = [m.start]; const seen = new Set(path); let checks = 0; let nodes = 0;
    const dfs = () => { const cur = path[path.length - 1]; if (cur === m.goal) return checks === m.checks.length; if (++nodes > 400000) return false;
      for (const t of nb(cur)) { if (seen.has(t)) continue; const ci = m.checks.indexOf(t); if (ci >= 0 && ci !== checks) continue; if (t === m.goal && checks < m.checks.length) continue;
        path.push(t); seen.add(t); if (ci >= 0) checks++; if (dfs()) return true; if (ci >= 0) checks--; seen.delete(t); path.pop(); } return false; };
    return dfs() ? path : null; };
  let stages = 0, breaks = 0, timeoutDone = false, aidDone = false;
  for (let guard = 0; guard < 300; guard++) {
    const st = await state();
    if (!st || st.phase === 'done') break;
    if (st.phase === 'break') { const b = page.getByRole('button', { name: /ステージ \d へ/ }); if (await b.count()) { breaks++; await once('break'); await b.tap(); } await page.waitForTimeout(400); continue; }
    if (st.sub || !(await page.locator('.match .pb2-board').count())) { await page.waitForTimeout(250); continue; }
    const m = st.maze; const sol = solve(m);
    await once('stage1'); if (m.size === 7) await once('stage7');
    if (stages === 0) check('本番：盤面に壁、始点、終点、チェック点が出る', await page.locator('.match .pb2-wall').count() === m.walls.length && await page.locator('.match .pb2-mark.check').count() === m.checks.length);
    if (st.stage === 1 && !timeoutDone) {
      // 時間切れ：最初のチェック点の先まで引いて放置する
      const upto = sol.indexOf(m.checks[0]) + 2;
      await drag('.match', sol.slice(0, upto), m.size); await once('partial');
      await page.waitForFunction((k) => window.__fcSlot.state.results.hero.length > k, st.played, { timeout: 120000 });
      const a = await state();
      check('時間切れ：その時点の線で採点（通ったチェック点 1 つ 2 点）', !a.res[1].done && a.res[1].checks === 1 && a.res[1].points === 2, JSON.stringify([a.res[1].checks, a.res[1].points]));
      timeoutDone = true; stages++; continue;
    }
    if (st.stage === 2 && !aidDone) {
      // 補助：わざと行き止まりの向きへ数マス進めてから使う
      await drag('.match', sol.slice(0, 3), m.size);
      await page.getByRole('button', { name: /次の 1 マス/ }).tap(); await page.waitForTimeout(300);
      await page.getByRole('button', { name: /2 ピース支払う/ }).tap(); await page.waitForTimeout(400);
      const a = await state();
      check('補助：ピース 2 個で、次に進むマスが示される', a.aid && await page.locator('.match .pb2-hint').count() === 1);
      await once('aid'); aidDone = true;
      await drag('.match', sol.slice(2), m.size);
    } else {
      // 何回かに分けてなぞる（指を離しても続きから引ける）
      const cut = Math.floor(sol.length / 2);
      await drag('.match', sol.slice(0, cut + 1), m.size); await once('half');
      await drag('.match', sol.slice(cut), m.size);
    }
    await page.waitForFunction((k) => window.__fcSlot.state.results.hero.length > k || window.__fcSlot.state.phase === 'done', st.played, { timeout: 120000 });
    stages++; await page.waitForTimeout(300); await once('after');
  }
  const fin = await state();
  const done = fin.res.filter((r) => r.done).length;
  check('6 ステージを指の操作だけで終える（時間切れの 1 つを除いて完成）', fin.phase === 'done' && fin.played === 6 && done === 5, `完成 ${done} / ${fin.played}`);
  check('得点：完成 30 ＋ 時間（0〜10）', fin.res.filter((r) => r.done).every((r) => r.points >= 30 && r.points <= 40), fin.res.map((r) => r.points).join(' '));
  check('3 ステージの後に休憩が入る', breaks === 1, String(breaks));
  await page.waitForTimeout(500); await shot('done');
  check('画面のエラーなし', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
  console.log(res.every(Boolean) ? 'ALL OK' : 'SOME FAILED');
  process.exit(res.every(Boolean) ? 0 : 1);
})();
