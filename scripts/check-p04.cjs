// P04（消えた図形）を画面の操作だけで最後まで遊ぶ確認。npm run build と npx vite preview --port 4173 の後に実行する。
// node scripts/check-p04.cjs [スクリーンショットの保存先]
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2] || null;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  const shot = async (n) => { if (out) await page.screenshot({ path: `${out}/p04_${n}.png` }); };
  const shots = new Set(); const once = async (n) => { if (!shots.has(n)) { shots.add(n); await shot(n); } };
  await page.goto('http://localhost:4173/FALSE-CROWN/'); await page.waitForTimeout(1500);
  await page.getByText('開発者メニュー').tap(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: /P04 消えた/ }).tap(); await page.waitForTimeout(600);
  let maxLen = 0;
  for (let i = 0; i < 4; i++) { maxLen = Math.max(maxLen, (await page.locator('.tut-text').innerText()).length); await shot(`tut${i + 1}`); await page.getByRole('button', { name: /次へ|練習へ/ }).tap(); await page.waitForTimeout(250); }
  check('説明は段階表示で、1 画面の文は 75 文字以内', maxLen > 0 && maxLen <= 75, String(maxLen));
  // 練習：見えている盤面を読み取り、切り替わった後と見比べて答える
  const read = (sel) => page.evaluate((s) => [...document.querySelectorAll(`${s} .dq-board .dq-cell`)].map((c) => { const g = c.querySelector('svg'); return g ? g.getAttribute('aria-label') : null; }), sel);
  const a0 = await read('.tut'); await shot('practice_show');
  check('練習：盤面に図柄が表示される', a0.filter(Boolean).length === 7, String(a0.filter(Boolean).length));
  await page.waitForFunction(() => document.querySelector('.tut .dq-cell.tap'), null, { timeout: 9000 });
  const b0 = await read('.tut');
  const diff0 = a0.map((x, i) => i).filter((i) => a0[i] !== b0[i]);
  check('練習：表示時間が終わると、変わった盤面に切り替わる', diff0.length === 3, diff0.join(','));
  for (const c of diff0) await page.locator(`.tut .dq-cell[data-cell="${c}"]`).tap();
  await shot('practice_pick');
  await page.getByRole('button', { name: /確定する/ }).tap(); await page.waitForTimeout(300);
  check('練習：確定すると答え合わせが出て、本番へ進める', await page.locator('.tut .dq-review .dq-cell.ok').count() === 3 && await page.getByRole('button', { name: '本番へ' }).count() === 1);
  await shot('practice_done');
  await page.getByRole('button', { name: /本番へ/ }).tap(); await page.waitForTimeout(800);
  const state = () => page.evaluate(() => { const s = window.__fcSlot && window.__fcSlot.state; if (!s) return null; return { phase: s.phase, round: s.round, set: s.sets[Math.min(s.round, 9)], played: s.results.hero.length, pts: s.results.hero.map((r) => r.points), last: s.results.hero[s.results.hero.length - 1] }; });
  let expected = 0; let quizzes = 0; let capDone = false; let toggleDone = false; let breaks = 0;
  for (let guard = 0; guard < 300; guard++) {
    const st = await state();
    if (!st || st.phase === 'done') break;
    if (st.phase === 'prep') {
      const b = page.getByRole('button', { name: '始める' });
      if (await b.count()) {
        await once('prep'); if (st.round === 1) await once('prep_review');
        if (await page.locator('.mq-talk').count()) { breaks++; await once('break'); }
        await b.tap();
      }
      await page.waitForTimeout(300); continue;
    }
    if (!(await page.locator('.match .dq').count())) { await page.waitForTimeout(300); continue; }
    await page.waitForTimeout(500); await once('show'); if (st.round === 9) await once('show_late');
    const seen = await read('.match');
    await page.waitForFunction(() => document.querySelector('.match .dq-cell.tap'), null, { timeout: 15000 });
    const now = await read('.match');
    const diff = seen.map((x, i) => i).filter((i) => seen[i] !== now[i]);
    const truth = st.set.a.map((x, i) => i).filter((i) => st.set.a[i] !== st.set.b[i]);
    if (quizzes === 0) check('本番：画面で見比べた違いが、問題の変化と一致する', JSON.stringify(diff) === JSON.stringify(truth), `${diff} / ${truth}`);
    const k = st.set.k;
    let picks = diff;
    if (st.round === 1) { const wrong = [...Array(25).keys()].find((i) => !diff.includes(i)); picks = [...diff.slice(0, k - 1), wrong]; }
    if (st.round === 2) picks = diff.slice(0, 1);
    for (const c of picks) await page.locator(`.match .dq-cell[data-cell="${c}"]`).tap();
    if (!capDone && picks.length === k) {
      const extra = [...Array(25).keys()].find((i) => !picks.includes(i));
      await page.locator(`.match .dq-cell[data-cell="${extra}"]`).tap();
      check('選べるマスの数は、変わった数まで', await page.locator('.match .dq-cell.sel').count() === k);
      capDone = true;
    }
    if (!toggleDone) {
      await page.locator(`.match .dq-cell[data-cell="${picks[0]}"]`).tap();
      const off = await page.locator('.match .dq-cell.sel').count();
      await page.locator(`.match .dq-cell[data-cell="${picks[0]}"]`).tap();
      check('選んだマスをもう一度タップすると外れる', off === picks.length - 1 && await page.locator('.match .dq-cell.sel').count() === picks.length);
      toggleDone = true;
    }
    await once('pick');
    if (st.round === 3) {
      // 時間切れ：選んだまま確定しない
      await page.waitForFunction((n) => window.__fcSlot.state.results.hero.length > n || window.__fcSlot.state.phase === 'done', st.played, { timeout: 40000 });
      const after = await state();
      check('時間切れ：選んでいたマスで採点される', after.last.hits === k && after.last.perfect, JSON.stringify(after.last));
      expected += k * 3 + 3;
    } else {
      await page.getByRole('button', { name: /確定する/ }).tap();
      expected += st.round === 1 ? (k - 1) * 3 - 1 : st.round === 2 ? 3 : k * 3 + 3;
      await page.waitForFunction((n) => window.__fcSlot.state.results.hero.length > n || window.__fcSlot.state.phase === 'done', st.played, { timeout: 40000 });
    }
    quizzes++;
  }
  const fin = await state();
  const total = fin.pts.reduce((a, b) => a + b, 0);
  check('10 ラウンドで終わる', fin.phase === 'done' && fin.played === 10 && quizzes === 10, `${fin.played}`);
  check('得点：当たり 3、外れ −1、全部当たり +3 の通りに付く', total === expected, `${total} / ${expected}（${fin.pts.join(',')}）`);
  check('2 ラウンドごとに休憩（雑談）が入る', breaks === 4, String(breaks));
  await page.waitForTimeout(500); await shot('done');
  check('画面のエラーなし', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
  console.log(res.every(Boolean) ? 'ALL OK' : 'SOME FAILED');
  process.exit(res.every(Boolean) ? 0 : 1);
})();
