// P05（21の攻防）を画面の操作だけで最後まで遊ぶ確認。npm run build と npx vite preview --port 4173 の後に実行する。
// node scripts/check-p05.cjs [スクリーンショットの保存先]
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2] || null;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  const shot = async (n) => { if (out) await page.screenshot({ path: `${out}/p05_${n}.png` }); };
  const shots = new Set(); const once = async (n) => { if (!shots.has(n)) { shots.add(n); await shot(n); } };
  await page.goto('http://localhost:4173/FALSE-CROWN/'); await page.waitForTimeout(1500);
  await page.getByText('開発者メニュー').tap(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: /P05 21/ }).tap(); await page.waitForTimeout(600);
  let maxLen = 0;
  for (let i = 0; i < 4; i++) { maxLen = Math.max(maxLen, (await page.locator('.tut-text').innerText()).length); await shot(`tut${i + 1}`); await page.getByRole('button', { name: /次へ|練習へ/ }).tap(); await page.waitForTimeout(250); }
  check('説明は段階表示で、1 画面の文は 75 文字以内', maxLen > 0 && maxLen <= 75, String(maxLen));
  await page.locator('.tut .p05-card').nth(3).tap(); await page.waitForTimeout(150);
  check('練習：21 を超えるカードでは進めない', await page.getByRole('button', { name: '本番へ', exact: true }).count() === 0);
  await shot('practice');
  await page.locator('.tut .p05-card').nth(2).tap(); await page.waitForTimeout(200);
  check('練習：ちょうど 21 になるカードを出すと本番へ進める', await page.getByRole('button', { name: '本番へ' }).count() === 1);
  await page.getByRole('button', { name: /本番へ/ }).tap(); await page.waitForTimeout(800);
  const state = () => page.evaluate(() => { const s = window.__fcSlot && window.__fcSlot.state; if (!s) return null; const k = s.players.length; const turn = Math.floor(s.n / k); return { phase: s.phase, set: s.set, n: s.n, total: s.total, toMove: s.phase === 'play' ? s.players[(s.set + turn + (s.n % k)) % k] : null, hand: s.hands.hero, score: s.scores.hero, hits: s.hits.hero, busts: s.busts.hero, log: s.log.length, players: s.players, hands: s.hands }; });
  let plays = 0, hits = 0, busts = 0, breaks = 0, timeoutDone = false, previewOk = true, twoTap = false, replaySeen = false, oppOk = true;
  for (let guard = 0; guard < 600; guard++) {
    const st = await state();
    if (!st || st.phase === 'done') break;
    if (st.phase === 'break') {
      const b = page.getByRole('button', { name: /セット \d へ/ });
      if (await b.count()) { breaks++; await once('break'); await b.tap(); }
      await page.waitForTimeout(400); continue;
    }
    if (st.toMove !== 'hero') { await page.waitForTimeout(200); continue; }
    // 自分の番：CPU の手を順に見せ終わるまで、手札は押せない
    if (await page.locator('.match .p05-card:not([disabled])').count() === 0) { replaySeen = true; await once('replay'); await page.waitForTimeout(200); continue; }
    const shownTotal = Number(await page.locator('.match .p05-total b').innerText());
    if (shownTotal !== st.total) { await page.waitForTimeout(150); continue; }
    // 相手の残りの手札の表示が、実際と一致しているか
    const opp = st.players.filter((p) => p !== 'hero');
    const shownOpp = await page.evaluate(() => [...document.querySelectorAll('.match .p05-opp .p05-mini')].map((m) => [...m.querySelectorAll('i:not(.gone)')].map((i) => Number(i.textContent))));
    if (JSON.stringify(shownOpp) !== JSON.stringify(opp.map((p) => st.hands[p]))) oppOk = false;
    await once('turn'); if (st.n > 15) await once('turn_late');
    const hand = st.hand;
    const hit = hand.find((c) => st.total + c === 21);
    const safe = hand.filter((c) => st.total + c < 21).sort((a, b) => b - a);
    const card = hit ?? (safe.length ? safe[0] : Math.min(...hand));
    const el = page.locator(`.match .p05-card[data-card="${card}"]`);
    const pv = await el.locator('small').innerText();
    const want = st.total + card === 21 ? '21' : st.total + card > 21 ? '超過' : `→ ${st.total + card}`;
    if (!pv.includes(want)) previewOk = false;
    if (!timeoutDone && plays === 3) {
      // 時間切れ：一番小さいカードが出る
      const min = Math.min(...hand);
      await page.waitForFunction((n) => window.__fcSlot.state.log.length > n, st.log, { timeout: 40000 });
      const lg = await page.evaluate((i) => window.__fcSlot.state.log[i], st.log);
      check('時間切れ：手札の一番小さいカードが出る', lg.who === 'hero' && lg.card === min, `${lg.card} / ${min}`);
      timeoutDone = true; plays++; continue;
    }
    await el.tap(); await page.waitForTimeout(80);
    if (plays === 0) { check('カードをタップすると選ばれ、まだ出ていない', (await state()).log === st.log && await page.locator('.match .p05-card.sel').count() === 1); await once('select'); }
    if (plays % 2 === 0) { await page.getByRole('button', { name: `${card} を出す` }).tap(); } else { await el.tap(); twoTap = true; }
    await page.waitForFunction((n) => window.__fcSlot.state.log.length > n, st.log, { timeout: 5000 });
    const after = await state();
    if (st.total + card === 21) { hits++; await once('hit'); } else if (st.total + card > 21) busts++;
    plays++;
    if (plays === 1) check('出したカードは手札から消える', !after.hands.hero.includes(card) || after.set !== st.set);
    await page.waitForTimeout(120);
  }
  const fin = await state();
  check('3 セット、27 枚を画面の操作で出し切って終わる', fin.phase === 'done' && plays === 27 && fin.log === 27 * fin.players.length, `${plays} / ${fin.log}`);
  check('得点：21 が +4、超過が −3', fin.hits >= hits && fin.busts >= busts && fin.score === fin.hits * 4 - fin.busts * 3, `${fin.score} = ${fin.hits}×4 − ${fin.busts}×3`);
  check('カードの下に、出した後の合計（21、超過を含む）が出る', previewOk);
  check('選んだカードをもう一度タップしても出せる', twoTap);
  check('相手の残りの手札の表示が実際と一致する', oppOk);
  check('相手の手を順に見せている間は、自分の手札を押せない', replaySeen);
  check('セットの間に休憩が 2 回入る', breaks === 2, String(breaks));
  await page.waitForTimeout(2500); await shot('done');
  check('画面のエラーなし', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
  console.log(res.every(Boolean) ? 'ALL OK' : 'SOME FAILED');
  process.exit(res.every(Boolean) ? 0 : 1);
})();
