// M06（クロス・カード）を画面の操作だけで最後まで遊ぶ確認。npm run build と npx vite preview --port 4173 の後に実行する。
// node scripts/check-m06.cjs [スクリーンショットの保存先]
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2] || null;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  const shot = async (n) => { if (out) await page.screenshot({ path: `${out}/m06_${n}.png` }); };
  const shots = new Set(); const once = async (n) => { if (!shots.has(n)) { shots.add(n); await shot(n); } };
  const rank = (c) => (c % 13) + 1, suit = (c) => Math.floor(c / 13);
  const meets = (tg, a, b) => a !== b && (tg === 'pair' ? rank(a) === rank(b) : tg === 'suit' ? suit(a) === suit(b) : Math.abs(rank(a) - rank(b)) === 1);
  const pairsIn = (tg, hand) => { const o = []; for (let i = 0; i < hand.length; i++) for (let j = i + 1; j < hand.length; j++) if (meets(tg, hand[i], hand[j])) o.push([hand[i], hand[j]]); return o; };
  await page.goto('http://localhost:4173/FALSE-CROWN/'); await page.waitForTimeout(1500);
  await page.getByText('開発者メニュー').tap(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: /M06 クロス/ }).tap(); await page.waitForTimeout(600);
  let maxLen = 0;
  for (let i = 0; i < 4; i++) { maxLen = Math.max(maxLen, (await page.locator('.tut-text').innerText()).length); await shot(`tut${i + 1}`); await page.getByRole('button', { name: /次へ|練習へ/ }).tap(); await page.waitForTimeout(250); }
  check('説明は段階表示で、1 画面の文は 80 文字以内', maxLen > 0 && maxLen <= 80, String(maxLen));
  check('練習：選ぶ前は交換できない', await page.locator('.tut').getByRole('button', { name: '交換する' }).isDisabled());
  await page.locator('.tut .xc-row.hand .xc-card').nth(0).tap(); await page.locator('.tut .xc-row:not(.hand) .xc-card').nth(0).tap(); await page.waitForTimeout(120);
  await shot('practice');
  await page.locator('.tut').getByRole('button', { name: '交換する' }).tap(); await page.waitForTimeout(250);
  check('練習：手札と場を 1 枚ずつ選んで交換すると、本番へ進める', await page.getByRole('button', { name: '本番へ', exact: true }).count() === 1);
  await page.getByRole('button', { name: '本番へ', exact: true }).tap(); await page.waitForTimeout(800);
  const state = () => page.evaluate(() => { const s = window.__fcSlot && window.__fcSlot.state; if (!s) return null; const n = s.players.length; const order = s.players.map((_, i) => s.players[(i + s.round) % n]); return { phase: s.phase, round: s.round, turn: s.turn, toMove: s.phase === 'swap' ? order[s.turn] : null, target: s.targets[Math.min(s.round, 5)], field: s.field, hand: s.hands.hero, score: s.scores.hero, ach: s.achieved.hero, log: s.log.length, sub: !!s.subs.hero, hist: s.history, bonus: s.bonus.hero, aid: s.aidUsed.hero, ready: s.ready.hero, n }; });
  const shownCards = (sel) => page.evaluate((q) => [...document.querySelectorAll(q)].map((e) => Number(e.dataset.card)), sel);
  let swaps = 0, passes = 0, subs = 0, expected = 0, aidDone = false, handOk = true, fieldOk = true, replaySeen = false, timeoutDone = false, dumpDone = false, hintOk = true;
  for (let guard = 0; guard < 900; guard++) {
    const st = await state();
    if (!st || st.phase === 'done') break;
    if (st.phase === 'break') {
      const b = page.getByRole('button', { name: /ラウンド \d へ/ });
      if (await b.count()) { await once('break'); if (st.round === 2) await once('break3'); await b.tap(); }
      await page.waitForTimeout(350); continue;
    }
    if (st.phase === 'swap') {
      if (st.toMove !== 'hero') { await page.waitForTimeout(200); continue; }
      if (await page.locator('.match .xc-row.hand .xc-card:not([disabled])').count() === 0) { replaySeen = true; await once('replay'); await page.waitForTimeout(250); continue; }
      const hand = await shownCards('.match .xc-row.hand .xc-card'); const field = await shownCards('.match .xc-row:not(.hand):not(.mini) button.xc-card');
      if (JSON.stringify(hand) !== JSON.stringify(st.hand)) handOk = false;
      if (JSON.stringify(field) !== JSON.stringify(st.field)) fieldOk = false;
      await once('swap_turn');
      if (!aidDone && st.round === 1) {
        await page.locator(`.match .xc-row.hand .xc-card[data-card="${hand[0]}"]`).tap(); await page.waitForTimeout(80);
        await page.getByRole('button', { name: /山札と交換/ }).tap(); await page.waitForTimeout(300);
        await page.getByRole('button', { name: /2 ピース支払う/ }).tap(); await page.waitForTimeout(400);
        const a = await state();
        check('山札と交換：ピース 2 個で、選んだ手札 1 枚が入れ替わる（手番は続く）', a.aid && !a.hand.includes(hand[0]) && a.toMove === 'hero' && a.hand.length === 5, JSON.stringify(a.hand));
        aidDone = true; continue;
      }
      // 画面に見えている手札と場だけで、目標に合う組を作れる交換を探す
      let mv = null;
      if (!pairsIn(st.target, hand).length) for (const h of hand) { for (const f of field) { if (pairsIn(st.target, hand.map((c) => c === h ? f : c)).length) { mv = [h, f]; break; } } if (mv) break; }
      if (swaps === 0 && !mv) mv = [hand[0], field[0]];
      if (mv) {
        await page.locator(`.match .xc-row.hand .xc-card[data-card="${mv[0]}"]`).tap(); await page.locator(`.match .xc-row:not(.hand) .xc-card[data-card="${mv[1]}"]`).tap(); await page.waitForTimeout(100);
        await once('swap_selected');
        await page.getByRole('button', { name: '交換する' }).tap(); await page.waitForTimeout(250);
        const a = await state();
        if (swaps === 0) check('交換：選んだ手札が場に出て、場のカードが手札に入る', a.hand.includes(mv[1]) && !a.hand.includes(mv[0]) && a.log > st.log, '');
        swaps++;
      } else { await page.getByRole('button', { name: 'パス', exact: true }).tap(); await page.waitForTimeout(250); passes++; }
      continue;
    }
    // submit
    if (st.sub) { await page.waitForTimeout(200); continue; }
    if (await page.getByRole('button', { name: /提出する|出さない/ }).count() === 0) { await page.waitForTimeout(250); continue; }
    const hand = await shownCards('.match .xc-row.hand .xc-card');
    const pairs = pairsIn(st.target, hand);
    const hinted = await shownCards('.match .xc-row.hand .xc-card.hint');
    if (JSON.stringify([...new Set(pairs.flat())].sort()) !== JSON.stringify([...hinted].sort())) hintOk = false;
    await once('submit');
    if (st.round === 3 && !timeoutDone) {
      // 時間切れ：選んだまま提出しないと「出さない」になる
      if (pairs.length) { for (const c of pairs[0]) await page.locator(`.match .xc-row.hand .xc-card[data-card="${c}"]`).tap(); }
      await page.waitForFunction((r) => window.__fcSlot.state.history.length > r, st.round, { timeout: 60000 });
      const a = await state();
      check('時間切れ：提出は「出さない」になる', a.hist[3].hero.cards.length === 0, JSON.stringify(a.hist[3].hero));
      timeoutDone = true; subs++; continue;
    }
    if (pairs.length) {
      const best = pairs.sort((x, y) => rank(y[0]) + rank(y[1]) - rank(x[0]) - rank(x[1]))[0];
      for (const c of best) await page.locator(`.match .xc-row.hand .xc-card[data-card="${c}"]`).tap();
      await page.waitForTimeout(100); await once('submit_ok');
      if (subs === 0) {
        const extra = hand.find((c) => !best.includes(c));
        await page.locator(`.match .xc-row.hand .xc-card[data-card="${extra}"]`).tap(); await page.waitForTimeout(80);
        check('提出：選べるのは 2 枚まで', await page.locator('.match .xc-row.hand .xc-card.sel').count() === 2);
      }
      await page.getByRole('button', { name: /2 枚を提出する/ }).tap(); expected += 6;
    } else if (!dumpDone && st.round < 5) {
      await page.locator(`.match .xc-row.hand .xc-card[data-card="${hand[0]}"]`).tap(); await page.waitForTimeout(80); await once('submit_dump');
      await page.getByRole('button', { name: /1 枚を提出する/ }).tap(); dumpDone = true;
    } else await page.getByRole('button', { name: '出さない' }).tap();
    subs++;
    await page.waitForFunction((r) => window.__fcSlot.state.history.length > r, st.round, { timeout: 60000 });
    const a = await state();
    if (a.phase !== 'done') check(`ラウンド ${st.round + 1}：提出の後、手札が 5 枚に補充される`, a.hand.length === 5, String(a.hand.length));
    await page.waitForTimeout(300);
  }
  const fin = await state();
  const tops = fin.hist.filter((h) => h.hero.top).length;
  check('6 ラウンドを画面の操作だけで終える', fin.phase === 'done' && subs === 6, `提出 ${subs} 交換 ${swaps} パス ${passes}`);
  check('得点：達成 6 点 ＋ 合計が最大の時 +3 ＋ 最後の手札の加点', fin.score === expected + tops * 3 + fin.bonus.points, `${fin.score} = ${expected} + ${tops}×3 + ${fin.bonus.points}`);
  check('画面の手札と場が、実際と一致する', handOk && fieldOk);
  check('目標に合う組の印が、手札の実際の組と一致する', hintOk);
  check('相手の交換を順に見せている間は、自分のカードを押せない', replaySeen);
  await page.waitForTimeout(600); await shot('done');
  check('終了：全員の最後の手札が公開される', await page.locator('.match .xc-done .xc-sub').count() === fin.n);
  check('画面のエラーなし', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
  console.log(res.every(Boolean) ? 'ALL OK' : 'SOME FAILED');
  process.exit(res.every(Boolean) ? 0 : 1);
})();
