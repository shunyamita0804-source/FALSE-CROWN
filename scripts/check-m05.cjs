// M05（ナンバー・リレー）を画面の操作だけで最後まで遊ぶ確認。npm run build と npx vite preview --port 4173 の後に実行する。
// node scripts/check-m05.cjs [スクリーンショットの保存先]
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2] || null;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  const shot = async (n) => { if (out) await page.screenshot({ path: `${out}/m05_${n}.png` }); };
  const shots = new Set(); const once = async (n) => { if (!shots.has(n)) { shots.add(n); await shot(n); } };
  const key = async (root, k) => { await page.locator(`${root} .xp button[data-k="${k}"]`).tap(); await page.waitForTimeout(40); };
  const enter = async (root, toks) => { for (const x of toks) await key(root, typeof x === 'number' ? `c${x}` : x); };
  await page.goto('http://localhost:4173/FALSE-CROWN/'); await page.waitForTimeout(1500);
  await page.getByText('開発者メニュー').tap(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: /M05 ナンバー/ }).tap(); await page.waitForTimeout(600);
  let maxLen = 0;
  for (let i = 0; i < 4; i++) { maxLen = Math.max(maxLen, (await page.locator('.tut-text').innerText()).length); await shot(`tut${i + 1}`); await page.getByRole('button', { name: /次へ|練習へ/ }).tap(); await page.waitForTimeout(250); }
  check('説明は段階表示で、1 画面の文は 75 文字以内', maxLen > 0 && maxLen <= 75, String(maxLen));
  // 練習：（8 − 3）× 9
  check('練習：最初は記号を押せず、確定もできない', await page.locator('.tut .xp button[data-k="+"]').isDisabled() && await page.locator('.tut .xp-ok').isDisabled());
  await enter('.tut', ['(', 2, '-', 0]);
  check('練習：括弧が閉じていなくても、途中の値が出る', (await page.locator('.tut .xp-val').innerText()).includes('5'));
  check('練習：使ったカードはもう使えない', await page.locator('.tut .xp button[data-k="c2"]').isDisabled());
  await enter('.tut', [')', '*', 3]);
  await shot('practice');
  check('練習：目標と同じ数になると確定できる', !(await page.locator('.tut .xp-ok').isDisabled()) && (await page.locator('.tut .xp-val').innerText()).includes('45'));
  await key('.tut', 'back'); await key('.tut', 'back');
  check('練習：1 つ戻すと、確定できなくなる', await page.locator('.tut .xp-ok').isDisabled());
  await enter('.tut', ['*', 3]);
  await page.locator('.tut .xp-ok').tap(); await page.waitForTimeout(300);
  check('練習：確定すると本番へ進める', await page.getByRole('button', { name: '本番へ' }).count() === 1);
  await page.getByRole('button', { name: /本番へ/ }).tap(); await page.waitForTimeout(800);
  const state = () => page.evaluate(() => { const s = window.__fcSlot && window.__fcSlot.state; if (!s) return null; const r = Math.min(s.round, 7); const teams = s.halves[r < 4 ? 0 : 1]; const ti = teams.findIndex((t) => t.includes('hero')); const tm = teams[ti]; return { phase: s.phase, round: s.round, cards: s.rounds[r].cards, cands: s.rounds[r].cands, pick: s.pick[ti], tell: s.tell[ti], setter: tm[(r % 4) % tm.length], team: tm, played: s.results.hero.length, res: s.results.hero, extra: s.extra.hero }; });
  // 画面に見えているカードと目標から、3 枚で作れる式を総当たりで探す（画面の外の情報は使わない）
  const find = (cards, target, want) => {
    const ops = ['+', '-', '*', '/']; const ev = (a, o, b) => o === '+' ? a + b : o === '-' ? a - b : o === '*' ? a * b : b === 0 ? NaN : a / b;
    const n = cards.length; let best = null;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) { if (i === j || j === k || i === k) continue;
      for (const o1 of ops) for (const o2 of ops) {
        if (Math.abs(ev(ev(cards[i], o1, cards[j]), o2, cards[k]) - target) < 1e-9) { best = ['(', i, o1, j, ')', o2, k]; if (want === 3) return best; }
        if (Math.abs(ev(cards[i], o1, ev(cards[j], o2, cards[k])) - target) < 1e-9) { best = [i, o1, '(', j, o2, k, ')']; if (want === 3) return best; }
      } }
    return best; };
  let solved = 0, setterRounds = 0, toldSeen = 0, expected = 0, timeoutDone = false, extraDone = false;
  for (let guard = 0; guard < 400; guard++) {
    const st = await state();
    if (!st || st.phase === 'done') break;
    if (st.phase === 'pick') {
      if (st.setter !== 'hero') { await once('pick_wait'); await page.waitForTimeout(250); continue; }
      if (!(await page.locator('.m05-pick').count())) { await page.waitForTimeout(250); continue; }
      const shown = await page.locator('.m05-pick .xp-card').allInnerTexts();
      check(`出題担当（ラウンド ${st.round + 1}）：配られるカード 6 枚が先に見える`, shown.join(',') === st.cards.join(','), shown.join(','));
      await page.locator('.m05-pick .m05-cand').nth(2).tap();
      if (setterRounds === 1) await page.getByRole('button', { name: '教えない' }).tap();
      await page.waitForTimeout(120); await once('pick');
      await page.getByRole('button', { name: /で出題する/ }).tap(); await page.waitForTimeout(400);
      const after = await state();
      check(`出題担当：選んだ目標と「${setterRounds === 1 ? '教えない' : '教える'}」が記録される`, after.pick === 2 && after.tell === (setterRounds !== 1), `${after.pick} ${after.tell}`);
      setterRounds++;
      continue;
    }
    if (st.phase === 'prep') {
      const b = page.getByRole('button', { name: '始める' });
      if (!(await b.count())) { await page.waitForTimeout(250); continue; }
      if (st.round === 0) await once('prep1'); else await once('prep_result');
      if (st.setter !== 'hero' && await page.locator('.m05-prep .m05-nums').count()) { toldSeen++; await once('prep_told'); }
      if (st.setter !== 'hero' && !(await page.locator('.m05-prep .m05-nums').count())) await once('prep_nottold');
      if (st.round === 4) await once('prep_regroup');
      if (!extraDone && st.round === 2) {
        await page.getByRole('button', { name: /追加カード/ }).tap(); await page.waitForTimeout(300);
        await page.getByRole('button', { name: /支払う|ピース 1 個/ }).last().tap(); await page.waitForTimeout(400);
        const a2 = await state();
        check('追加カード：ピース 1 個で、そのラウンドの記録に入る', a2.extra.includes(2), JSON.stringify(a2.extra));
        extraDone = true;
      }
      await b.tap(); await page.waitForTimeout(350); continue;
    }
    // solve
    if (!(await page.locator('.match .xp').count())) { await page.waitForTimeout(250); continue; }
    const cards = (await page.locator('.match .xp-card').allInnerTexts()).map(Number);
    const target = Number(await page.locator('.match .xp-target b').innerText());
    if (st.round === 2) check('追加カード：解く時にカードが 7 枚になる', cards.length === 7, String(cards.length));
    if (st.round === 0) check('解く段階：全員共通のカードと、担当が選んだ目標が出る', cards.join(',') === st.cards.join(',') && target === st.cands[st.pick], `${cards} → ${target}`);
    const toks = find(cards, target, 3);
    await once('solve_empty');
    if (st.round === 3 && !timeoutDone) {
      // 時間切れ：正しい式を組んだまま確定しない
      await enter('.match', toks); await once('solve_ok');
      await page.waitForFunction((n) => window.__fcSlot.state.results.hero.length > n, st.played, { timeout: 100000 });
      const a3 = await state();
      check('時間切れ：その時点の式が目標と一致していれば正解になる', a3.res[3].correct && a3.res[3].used === 3, JSON.stringify(a3.res[3].points));
      timeoutDone = true; solved++; continue;
    }
    if (st.round === 5) {
      // わざと間違えたまま時間切れにはせず、確定できないことだけ確かめてから正しく解く
      await enter('.match', [0, '+', 1]);
      check('目標と違う式は確定できない', await page.locator('.match .xp-ok').isDisabled());
      await key('.match', 'clear');
    }
    await enter('.match', toks); await once('solve_ok'); if (st.round === 2) await once('solve_extra');
    await page.locator('.match .xp-ok').tap(); solved++;
    await page.waitForFunction((n) => window.__fcSlot.state.results.hero.length > n || window.__fcSlot.state.phase === 'done', st.played, { timeout: 100000 });
    await page.waitForTimeout(300);
  }
  const fin = await state();
  check('8 ラウンドで終わる。全問を画面の操作だけで正解できた', fin.phase === 'done' && fin.played === 8 && fin.res.every((r) => r.correct), `${fin.played} / 正解 ${fin.res.filter((r) => r.correct).length}`);
  check('出題担当は 2 回まわってくる', setterRounds === 2, String(setterRounds));
  check('得点：正解 40 ＋ カード 3 枚 6 ＋ 時間（0〜8）＋ 組の加点（0 か 10）', fin.res.every((r) => r.points >= 46 && r.points <= 54 && (r.bonus === 0 || r.bonus === 10)), fin.res.map((r) => `${r.points}+${r.bonus}`).join(' '));
  console.log(`   担当から教わった回数 ${toldSeen} / 6`);
  await page.waitForTimeout(500); await shot('done');
  check('画面のエラーなし', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
  console.log(res.every(Boolean) ? 'ALL OK' : 'SOME FAILED');
  process.exit(res.every(Boolean) ? 0 : 1);
})();
