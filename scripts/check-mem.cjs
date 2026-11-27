// 新 M02（フラッグ・フラッシュ）と新 P02（瞬間記憶）を、画面の操作だけで最後まで遊ぶ確認。
// npm run build と npx vite preview --port 4173 の後に実行する。 node scripts/check-mem.cjs m02|p02 [スクリーンショットの保存先]
const { chromium } = require('playwright');
(async () => {
  const id = process.argv[2] || 'm02';
  const out = process.argv[3] || null;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  const shot = async (n) => { if (out) await page.screenshot({ path: `${out}/${id}_${n}.png` }); };
  await page.goto('http://localhost:4173/FALSE-CROWN/'); await page.waitForTimeout(1500);
  await page.getByText('開発者メニュー').tap(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: id === 'm02' ? /M02 フラッグ/ : /P02 瞬間/ }).tap(); await page.waitForTimeout(600);
  const pages = id === 'm02' ? 4 : 3;
  let maxLen = 0;
  for (let i = 0; i < pages; i++) { maxLen = Math.max(maxLen, (await page.locator('.tut-text').innerText()).length); await shot(`tut${i + 1}`); await page.getByRole('button', { name: /次へ|練習へ/ }).tap(); await page.waitForTimeout(250); }
  check('説明は段階表示で、1 画面の文は 110 文字以内', maxLen > 0 && maxLen <= 110, String(maxLen));
  // 練習：表示中の盤面を画面から読み取り、隠れた後に答える
  const seen = await page.evaluate(() => [...document.querySelectorAll('.tut .mq-board .mq-cell')].map((c) => { const s = c.querySelector('svg'); return s ? s.getAttribute('aria-label') : null; }));
  await shot('practice_show');
  check('練習：盤面に図柄が表示される', seen.filter(Boolean).length >= 5, String(seen.filter(Boolean).length));
  await page.waitForFunction(() => document.querySelector('.tut .mq-cell.back'), null, { timeout: 9000 });
  check('練習：表示時間が終わると盤面が隠れる', (await page.locator('.tut .mq-cell svg').count()) === 0);
  for (let q = 0; q < 4; q++) {
    await page.waitForTimeout(250);
    if (!(await page.locator('.tut .mq-dots').count())) break;
    if (q === 0) await shot('practice_q1');
    const target = await page.locator('.tut .mq-target svg').count() ? await page.locator('.tut .mq-target svg').getAttribute('aria-label') : null;
    if (target) await page.locator(`.tut .mq-cell[data-cell="${seen.indexOf(target)}"]`).tap();
    else {
      const asked = await page.evaluate(() => { const c = document.querySelector('.tut .mq-cell.asked'); return c ? Number(c.dataset.cell) : -1; });
      const opts = await page.evaluate(() => [...document.querySelectorAll('.tut .mq-opt svg')].map((s) => s.getAttribute('aria-label')));
      const want = asked >= 0 ? opts.indexOf(seen[asked]) : opts.findIndex((o) => seen.includes(o));
      await page.locator(`.tut .mq-opt[data-opt="${want}"]`).tap();
    }
    await page.waitForTimeout(650);
  }
  check('練習：全問に答えると本番へ進める', await page.getByRole('button', { name: '本番へ' }).count() === 1);
  await shot('practice_done');
  await page.getByRole('button', { name: /本番へ/ }).tap(); await page.waitForTimeout(800);
  // 本番
  const state = () => page.evaluate(() => { const s = window.__fcSlot && window.__fcSlot.state; if (!s) return null; const set = s.phase === 'quiz' ? (s.chosen ? s.sets[s.round][s.chosen[s.round]] : s.sets[s.round]) : null; return { phase: s.phase, round: s.round, setter: s.order ? s.order[s.round] : null, set, played: s.results.hero.length }; });
  const answerOf = (board, q) => q.kind === 'place' ? board.cells.indexOf(q.item) : q.kind === 'item' ? q.options.indexOf(board.cells[q.cell]) : q.options.findIndex((o) => board.cells.includes(o));
  let quizzes = 0; let picked = 0; let wrongDone = false; let timeoutDone = false; let expected = 0; const shots = new Set();
  const once = async (n) => { if (!shots.has(n)) { shots.add(n); await shot(n); } };
  for (let guard = 0; guard < 400; guard++) {
    const st = await state();
    if (!st || st.phase === 'done') break;
    if (st.phase === 'pick') {
      if (!(await page.locator('.m02-pick').count())) { await page.waitForTimeout(300); continue; }
      check('出題者：候補を選ぶまで確定できない', await page.getByRole('button', { name: 'この候補で出題する' }).isDisabled());
      await page.locator('.m02-pick .m02-cand').nth(1).tap();
      await page.locator('.m02-tellbtn').nth(0).tap(); await page.locator('.m02-tellbtn').nth(1).tap(); await page.locator('.m02-tellbtn').nth(1).tap();
      await page.waitForTimeout(150); await once('pick');
      await page.getByRole('button', { name: 'この候補で出題する' }).tap(); picked++; await page.waitForTimeout(400);
      const tips = await page.evaluate(() => { const s = window.__fcSlot.state; return [s.chosen[s.round], Object.values(s.tips[s.round])]; });
      check('出題者：選んだ候補と、伝えた内容（本当 1 人、嘘 1 人）が記録される', tips[0] === 1 && tips[1].length === 2 && tips[1].includes(1) && tips[1].includes(2), JSON.stringify(tips));
      continue;
    }
    if (st.phase === 'prep') { const b = page.getByRole('button', { name: '始める' }); if (await b.count()) { await once('prep'); if (st.round === 1) await once('prep2'); await b.tap(); } await page.waitForTimeout(300); continue; }
    if (st.phase === 'break') { const b = page.getByRole('button', { name: /ラウンド \d+ へ/ }).first(); if (await b.count()) { await once('break'); if (st.round >= 3) await once('break_late'); await b.tap(); } await page.waitForTimeout(400); continue; }
    // quiz
    if (!(await page.locator('.match .mq').count())) { await page.waitForTimeout(300); continue; }
    await page.waitForTimeout(600); await once('show'); if (st.round === 5) await once('show_late');
    await page.waitForFunction(() => document.querySelector('.match .mq-dots'), null, { timeout: 20000 });
    const set = st.set; let good = 0;
    for (let q = 0; q < set.questions.length; q++) {
      await page.waitForFunction((k) => { const d = document.querySelectorAll('.match .mq-dots i'); return d.length && d[k] && d[k].classList.contains('on'); }, q, { timeout: 12000 });
      const qq = set.questions[q]; let ans = answerOf(set.board, qq);
      await once(`q_${qq.kind}`);
      if (quizzes === 1 && q === 0 && !wrongDone) { ans = (ans + 1) % (qq.kind === 'place' ? set.board.cells.length : qq.options.length); wrongDone = true; }
      else if (quizzes === 2 && q === 1 && !timeoutDone) { timeoutDone = true; await page.waitForTimeout(8300); continue; }
      else good++;
      await page.locator(qq.kind === 'place' ? `.match .mq-cell[data-cell="${ans}"]` : `.match .mq-opt[data-opt="${ans}"]`).tap();
      await page.waitForTimeout(80); if (q === 0) await once('feedback');
    }
    quizzes++;
    const per = id === 'm02' ? 10 : 2;
    expected += good * per + (good === set.questions.length ? per : 0);
    await page.waitForFunction((k) => window.__fcSlot.state.results.hero.length >= k, quizzes, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(300);
  }
  const fin = await page.evaluate(() => { const s = window.__fcSlot.state; return { phase: s.phase, n: s.results.hero.length, pts: s.results.hero.reduce((a, x) => a + x.points, 0), players: s.players.length }; });
  await shot('end');
  const rounds = id === 'm02' ? fin.players : 8;
  check(`${rounds} ラウンドを画面の操作だけで最後まで進めた`, fin.phase === 'done' && fin.n === rounds && quizzes === rounds, JSON.stringify(fin));
  check('得点が操作どおり（不正解 1 問、時間切れ 1 問を含む）', fin.pts === expected, `${fin.pts} / ${expected}`);
  if (id === 'm02') check('出題者の番が 1 回あった', picked === 1, String(picked));
  console.log(res.every(Boolean) ? `全 ${res.length} 件成功` : `${res.filter((x) => !x).length} 件失敗`, 'errors', errs.length, errs.slice(0, 3));
  await browser.close();
})();
