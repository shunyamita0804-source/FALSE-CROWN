// M09（四王の戦場・改）を画面の操作だけで最後まで遊ぶ確認。npm run build の後、sh scripts/with-preview.sh node scripts/check-m09.cjs [写真の保存先]
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2] || null;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  const shot = async (n) => { if (out) await page.screenshot({ path: `${out}/m09_${n}.png` }); };
  const shots = new Set(); const once = async (n) => { if (!shots.has(n)) { shots.add(n); await shot(n); } };
  const cell = (root, c) => ({ tap: () => page.locator(`${root} .pzb-cell[data-cell="${c}"]`).tap({ force: true, timeout: 3000 }).catch(() => {}) });
  const cells = (root, cls) => page.evaluate(([r, k]) => [...document.querySelectorAll(`${r} .pzb-cell.${k}`)].map((e) => Number(e.dataset.cell)), [root, cls]);
  await page.goto('http://localhost:4173/FALSE-CROWN/'); await page.waitForTimeout(1500);
  await page.getByText('開発者メニュー').tap(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: /M09 四王/ }).tap(); await page.waitForTimeout(600);
  let maxLen = 0;
  for (let i = 0; i < 4; i++) { maxLen = Math.max(maxLen, (await page.locator('.tut-text').innerText()).length); await shot(`tut${i + 1}`); await page.getByRole('button', { name: /次へ|練習へ/ }).tap(); await page.waitForTimeout(250); }
  check('説明は段階表示で、1 画面の文は 80 文字以内', maxLen > 0 && maxLen <= 80, String(maxLen));
  check('練習：選ぶ前は動かせない', await page.locator('.tut').getByRole('button', { name: '動かす' }).isDisabled());
  // 練習：動かせる駒を順に選び、取れるマス（赤い枠）があればそこへ
  let pr = false;
  for (const c of await cells('.tut', 'movable')) {
    await cell('.tut', c).tap(); await page.waitForTimeout(100);
    const caps = await cells('.tut', 'cap');
    if (caps.length) { await cell('.tut', caps[0]).tap(); await page.waitForTimeout(100); await shot('practice'); await cell('.tut', caps[0]).tap(); await page.waitForTimeout(250); pr = true; break; }
  }
  check('練習：敵の兵を取ると、本番へ進める', pr && await page.getByRole('button', { name: '本番へ', exact: true }).count() === 1);
  await page.getByRole('button', { name: '本番へ', exact: true }).tap(); await page.waitForTimeout(800);
  const state = () => page.evaluate(() => { const s = window.__fcSlot && window.__fcSlot.state; if (!s) return null; const i = s.players.indexOf('hero'); const seat = s.seats[i]; return { phase: s.phase, round: s.round, toMove: s.phase === 'play' ? s.order[s.turn] : null, seat, mine: s.pieces.filter((p) => p.seat === seat).map((p) => ({ pos: p.pos, king: p.king })), pts: s.points[i], log: s.log.length, n: s.pieces.length }; });
  let moves = 0, replaySeen = false, moveOk = true, capDone = 0, warnSeen = false, badOk = null, timeoutDone = false, breaks = 0, tapTwice = false, centerPts = false, kingMoveOk = null, soldierMoveOk = null;
  for (let guard = 0; guard < 1500; guard++) {
    const st = await state();
    if (!st || st.phase === 'done') break;
    if (st.phase === 'break') { const b = page.getByRole('button', { name: '再開する' }); if (await b.count()) { await once('break'); breaks++; await b.tap(); } await page.waitForTimeout(350); continue; }
    if (st.toMove !== 'hero') { await page.waitForTimeout(200); continue; }
    if (await page.locator('.match .pzb.active').count() === 0) { replaySeen = true; await once('replay'); await page.waitForTimeout(250); continue; }
    if (await page.getByRole('button', { name: 'パス', exact: true }).count()) { await page.getByRole('button', { name: 'パス', exact: true }).tap(); await page.waitForTimeout(300); continue; }
    await once('turn');
    const movable = await cells('.match', 'movable');
    if (!movable.length) { await page.waitForTimeout(200); continue; }
    if (!timeoutDone && st.round === 1) {
      await page.waitForFunction((n) => window.__fcSlot.state.log.length > n, st.log, { timeout: 60000 });
      const lg = await page.evaluate((n) => window.__fcSlot.state.log[n], st.log);
      check('時間切れは、自動で 1 手動く', lg.kind === 'move' && lg.seat === st.seat);
      timeoutDone = true; continue;
    }
    // 各駒の行き先を画面で調べ、取れる手、中央、警告の出ない手の順に選ぶ
    let pick = null;
    for (const c of movable.slice(0, 3)) {
      await cell('.match', c).tap(); await page.waitForTimeout(60);
      const can = await cells('.match', 'can'); const caps = await cells('.match', 'cap');
      const isKing = st.mine.find((p) => p.pos === c)?.king;
      const x = c % 7, y = Math.floor(c / 7);
      const diag = can.some((d) => Math.abs(d % 7 - x) === 1 && Math.abs(Math.floor(d / 7) - y) === 1);
      const far = can.some((d) => Math.max(Math.abs(d % 7 - x), Math.abs(Math.floor(d / 7) - y)) > 1);
      if (isKing && kingMoveOk === null && can.length >= 3) kingMoveOk = !far;
      if (!isKing && soldierMoveOk === null) soldierMoveOk = !diag && !far;
      if (badOk === null) { const bad = [...Array(49).keys()].find((d) => !can.includes(d) && !st.mine.some((p) => p.pos === d)); await cell('.match', bad).tap(); await page.waitForTimeout(60); badOk = await page.locator('.match').getByRole('button', { name: '動かす' }).isDisabled(); check('動けないマスは選べない', badOk); }
      for (const d of [...new Set([...caps, ...can.filter((q) => q === 24), ...can])].slice(0, 4)) {
        await cell('.match', d).tap(); await page.waitForTimeout(60);
        const warn = await page.locator('.match .pz-warn').count() > 0;
        if (warn) { warnSeen = true; await once('warn'); }
        const score = (caps.includes(d) ? 10 : 0) + (d === 24 ? 5 : 0) - (warn ? (isKing ? 100 : 8) : 0) - (isKing ? 1 : 0) - Math.abs(d % 7 - 3) - Math.abs(Math.floor(d / 7) - 3);
        if (!pick || score > pick.score) pick = { from: c, to: d, score, cap: caps.includes(d) };
        if ((await cells('.match', 'chosen')).length === 0) break;
      }
      await cell('.match', c).tap(); await page.waitForTimeout(40);
    }
    if (!pick) { await page.waitForTimeout(200); continue; }
    if ((await cells('.match', 'sel')).length) { await page.getByRole('button', { name: '選び直す' }).tap({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(50); }
    await cell('.match', pick.from).tap(); await page.waitForTimeout(60);
    await cell('.match', pick.to).tap(); await page.waitForTimeout(60);
    await once('chosen');
    if (pick.cap) await once('capture');
    if (moves % 2 === 0) { await cell('.match', pick.to).tap(); tapTwice = true; } else await page.locator('.match').getByRole('button', { name: '動かす' }).tap({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(250);
    const lg = await page.evaluate((n) => window.__fcSlot.state.log[n], st.log);
    if (!lg || lg.seat !== st.seat) continue; // 時間が切れて自動で動いた時は数えない
    if (lg.kind !== 'move' || lg.from !== pick.from || lg.to !== pick.to) moveOk = false;
    if (lg && lg.cap) capDone++;
    moves++;
  }
  await page.waitForTimeout(6000);
  await shot('done');
  const fin = await page.evaluate(() => { const s = window.__fcSlot && window.__fcSlot.state; if (!s) return null; const i = s.players.indexOf('hero'); return { phase: s.phase, round: s.round, pts: s.points, center: s.log.filter((l) => l.kind === 'center').length, heroKing: s.pieces.some((p) => p.seat === s.seats[i] && p.king), shown: [...document.querySelectorAll('.match .pz-rank .m01-rankrow.me b')].map((e) => e.textContent)[0], hero: s.points[i] }; });
  check('最後まで進む', !fin || fin.phase === 'done', JSON.stringify(fin));
  check('選んだ駒が選んだマスへ動く（2 度タップでも、ボタンでも確定できる）', moves >= 6 && moveOk && tapTwice, `moves=${moves} caps=${capDone}`);
  check('王は 8 方向に 1 マス、兵は縦横に 1 マスだけが光る', kingMoveOk !== false && soldierMoveOk === true, `${kingMoveOk} ${soldierMoveOk}`);
  check('取られる位置を選ぶと、確定の前に知らせる', warnSeen);
  check('終了後の得点表示は、王が残った加点を含む', !fin || Number(fin.shown) === fin.hero + (fin.heroKing ? 5 : 0), fin ? `${fin.shown} / ${fin.hero}` : '');
  check('CPU の手は 1 手ずつ順に見せる', replaySeen);
  check('4 巡ごとに交渉の時間がある', breaks >= 1, String(breaks));
  check('時間切れを確かめた', timeoutDone);
  check('画面のエラーなし', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
  console.log(res.every(Boolean) ? 'ALL OK' : 'SOME FAILED');
  process.exit(res.every(Boolean) ? 0 : 1);
})();
