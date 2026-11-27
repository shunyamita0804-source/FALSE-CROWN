// 新 P01（数字の鎖）を画面の操作だけで最後まで遊ぶ確認。npm run build と npx vite preview --port 4173 の後に実行する。
// node scripts/check-p01.cjs [スクリーンショットの保存先]
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2] || null;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  const shot = async (n) => { if (out) await page.screenshot({ path: `${out}/${n}.png` }); };
  await page.goto('http://localhost:4173/FALSE-CROWN/'); await page.waitForTimeout(1500);
  await page.getByText('開発者メニュー').tap(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: /P01 数字/ }).tap(); await page.waitForTimeout(600);
  let maxLen = 0;
  for (let i = 0; i < 3; i++) { maxLen = Math.max(maxLen, (await page.locator('.tut-text').innerText()).length); if (i === 1) await shot('p01_tut2'); await page.getByRole('button', { name: /次へ|練習へ/ }).tap(); await page.waitForTimeout(250); }
  check('説明は段階表示で、1 画面の文は 70 文字以内', maxLen > 0 && maxLen <= 70, String(maxLen));
  const center = async (c) => { const bb = await page.locator('.cb-grid').last().boundingBox(); const px = bb.width / 4; return [bb.x + ((c % 4) + 0.5) * px, bb.y + (Math.floor(c / 4) + 0.5) * px]; };
  const tapPath = async (path) => { for (const c of path) { const [x, y] = await center(c); await page.touchscreen.tap(x, y); await page.waitForTimeout(50); } };
  // なぞる操作：CDP でタッチを 1 本動かす
  const cdp = await ctx.newCDPSession(page);
  const dragPath = async (path) => {
    const pts = []; for (const c of path) pts.push(await center(c));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0][0], y: pts[0][1] }] });
    for (let i = 1; i < pts.length; i++) for (let k = 1; k <= 4; k++) { const x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k / 4; const y = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k / 4; await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }); await page.waitForTimeout(15); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(60);
  };
  // 練習：目標 14。3 → 9 → 2（マス 5, 9, 8）ではなく、盤面を探索して最初の解を使う
  const solveIn = (board, target) => { const adj = (a, b) => Math.abs((a % 4) - (b % 4)) + Math.abs(Math.floor(a / 4) - Math.floor(b / 4)) === 1; let best = null; const rec = (p, s) => { if (best) return; if (s === target && p.length >= 3) { best = [...p]; return; } if (s >= target || p.length >= 6) return; for (let i = 0; i < 16; i++) if (!p.includes(i) && adj(p[p.length - 1], i)) { p.push(i); rec(p, s + board[i]); p.pop(); } }; for (let i = 0; i < 16 && !best; i++) rec([i], board[i]); return best; };
  const pb = await page.evaluate(() => [...document.querySelectorAll('.tut .cb-cell b')].map((b) => Number(b.textContent)));
  const pp = solveIn(pb, 14);
  check('練習：確定は合計が合うまで押せない', await page.getByRole('button', { name: '確定' }).isDisabled());
  await dragPath(pp);
  await shot('p01_practice');
  check('練習：なぞると合計が合い、確定できる', await page.getByRole('button', { name: '確定' }).isEnabled(), JSON.stringify(pp));
  await page.getByRole('button', { name: '確定' }).tap(); await page.waitForTimeout(300);
  await page.getByRole('button', { name: /本番へ/ }).tap(); await page.waitForTimeout(800);
  let n = 0;
  for (let guard = 0; guard < 40; guard++) {
    const st = await page.evaluate(() => { const s = window.__fcSlot && window.__fcSlot.state; return s ? { phase: s.phase, round: s.round, q: s.q, board: s.boards[s.round * 2 + s.q] || null, target: (s.targets[s.round] || [])[s.q], out: !s.players.includes('hero') } : null; });
    if (!st || st.phase === 'done') break;
    if (st.phase === 'break') { if (n === 2) await shot('p01_break'); const b = page.getByRole('button', { name: /ラウンド \d へ|次/ }).first(); if (await b.count()) await b.tap(); await page.waitForTimeout(500); continue; }
    if (!await page.locator('.p01-play .cb-grid').count()) { await page.waitForTimeout(400); continue; }
    const board = await page.evaluate(() => [...document.querySelectorAll('.p01-play .cb-cell b')].map((b) => Number(b.textContent)));
    const target = Number(await page.locator('.p01-play .cb-target b').innerText());
    const path = solveIn(board, target);
    if (n === 0) await shot('p01_q1');
    if (n % 2 === 0) await dragPath(path); else await tapPath(path);
    if (n === 0) await shot('p01_q1_path');
    const en = await page.getByRole('button', { name: '確定' }).isEnabled();
    if (!en) { check(`問 ${n + 1}：${n % 2 === 0 ? 'なぞって' : 'タップで'}鎖ができる`, false, JSON.stringify({ path, board, target })); break; }
    await page.getByRole('button', { name: '確定' }).tap();
    n++;
    await page.waitForFunction((k) => window.__fcSlot.state.answers.hero.length >= k && !document.querySelector('.p01-play .cb:not(.locked)'), n, { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(300);
  }
  check('12 問をなぞりとタップで解けた', n === 12, String(n));
  const fin = await page.evaluate(() => { const s = window.__fcSlot.state; return { phase: s.phase, ok: s.answers.hero.filter((a) => a.ok).length, n: s.answers.hero.length }; });
  check('すべて正解として記録された', fin.ok === 12 && fin.n === 12, JSON.stringify(fin));
  await shot('p01_end');
  console.log(res.every(Boolean) ? `全 ${res.length} 件成功` : `${res.filter((x) => !x).length} 件失敗`, 'errors', errs.length, errs.slice(0, 3));
  await browser.close();
})();
