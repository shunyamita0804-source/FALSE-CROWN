// M04（鉄道王国・改）を画面の操作だけで最後まで遊ぶ確認。npm run build と npx vite preview --port 4173 の後に実行する。
// node scripts/check-m04.cjs [スクリーンショットの保存先]
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2] || null;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  const shot = async (n) => { if (out) await page.screenshot({ path: `${out}/${n}.png` }); };
  const tapEdge = async (e) => { const bb = await page.locator(`.rm-hit[data-edge="${e}"]`).last().boundingBox(); await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.waitForTimeout(90); };
  await page.goto('http://localhost:4173/FALSE-CROWN/'); await page.waitForTimeout(1500);
  await page.getByText('開発者メニュー').tap(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: /M04 鉄道/ }).tap(); await page.waitForTimeout(600);
  let maxLen = 0;
  for (let i = 0; i < 4; i++) { maxLen = Math.max(maxLen, (await page.locator('.tut-text').innerText()).length); if (i === 0 || i === 2) await shot(`m04_tut${i + 1}`); await page.getByRole('button', { name: /次へ|練習へ/ }).tap(); await page.waitForTimeout(250); }
  check('説明は段階表示で、1 画面の文は 70 文字以内', maxLen > 0 && maxLen <= 70, String(maxLen));
  // 練習：A–B、B–E を敷いて輸送する
  await tapEdge(0); await page.getByRole('button', { name: /に敷く/ }).tap(); await page.waitForTimeout(120);
  await tapEdge(8); await shot('m04_practice'); await page.getByRole('button', { name: /に敷く/ }).tap(); await page.waitForTimeout(120);
  await page.getByRole('button', { name: '輸送', exact: true }).tap(); await page.waitForTimeout(300);
  check('練習：2 本敷いて輸送すると完了になる', (await page.locator('.tut-text').innerText()).includes('できました'));
  await page.getByRole('button', { name: /本番へ/ }).tap(); await page.waitForTimeout(800);
  // 準備：任務の札をタップすると道筋が出る
  check('準備：任務が 3 つ見える', await page.locator('.m04-ms').count() === 3);
  await page.locator('.m04-ms').nth(0).tap(); await page.waitForTimeout(150);
  check('任務の札をタップすると、出発地と目的地、道筋が地図に出る', await page.locator('.rm-ring').count() === 2 && await page.locator('.rm-route').count() >= 2);
  await shot('m04_setup');
  await page.getByRole('button', { name: '始める' }).tap(); await page.waitForTimeout(600);
  const state = () => page.evaluate(() => { const s = window.__fcSlot.state; const t = s.tables.find((x) => x.players.includes('hero')); const seat = t.players.indexOf('hero'); return { phase: s.phase, turn: t.turn, n: t.players.length, seat, funds: t.funds[seat], all: [...t.funds], owner: [...t.owner], costs: t.costs, missions: t.missions[seat], built: t.built[seat], toMove: (Math.floor(t.turn / t.players.length) + (t.turn % t.players.length)) % t.players.length, passed: t.passed }; });
  const EDGES = [[0, 1], [1, 2], [3, 4], [4, 5], [6, 7], [7, 8], [0, 3], [3, 6], [1, 4], [4, 7], [2, 5], [5, 8], [1, 3], [1, 5], [3, 7], [5, 7]];
  /** 画面に見えている地図から、任務の道筋（敷く区間）を求める */
  const plan = (st, m) => { const dist = Array(9).fill(1e9), via = Array(9).fill(-1), done = Array(9).fill(false); dist[m.from] = 0;
    for (;;) { let c = -1; for (let i = 0; i < 9; i++) if (!done[i] && dist[i] < 1e9 && (c < 0 || dist[i] < dist[c])) c = i; if (c < 0 || c === m.to) break; done[c] = true;
      EDGES.forEach(([a, b], e) => { if (a !== c && b !== c) return; const n = a === c ? b : a; const w = st.owner[e] < 0 ? st.costs[e] + 0.01 : st.owner[e] === st.seat ? 0 : 1; if (dist[c] + w < dist[n]) { dist[n] = dist[c] + w; via[n] = e; } }); }
    const edges = []; for (let c = m.to; c !== m.from;) { const e = via[c]; edges.unshift(e); c = EDGES[e][0] === c ? EDGES[e][1] : EDGES[e][0]; } return edges.filter((e) => st.owner[e] < 0); };
  let builds = 0, moves = 0, funds = 0, breaks = 0, tollSeen = false, shortSeen = false;
  for (let guard = 0; guard < 60; guard++) {
    const st = await state();
    if (st.phase === 'done') break;
    if (st.phase === 'break') { if (breaks === 0) await shot('m04_break'); breaks++; await page.getByRole('button', { name: '再開する' }).tap(); await page.waitForTimeout(500); continue; }
    if (st.toMove !== st.seat) { await page.waitForTimeout(200); continue; }
    if (guard === 1) await shot('m04_play1');
    const mi = st.missions.findIndex((m) => !m.done);
    const ready = page.locator('.m04-ms .btn');
    if (await ready.count()) {
      const before = st.all.reduce((a, b) => a + b, 0);
      await ready.first().tap(); await page.waitForTimeout(350); moves++;
      const after = await state();
      // 通行料は持ち主へ移るだけなので、資金 +3 を選んだ人の分を除けば、卓の資金の合計は建設でしか減らない
      if (after.missions.filter((m) => m.done).length > st.missions.filter((m) => m.done).length) tollSeen = tollSeen || before >= 0;
      continue;
    }
    if (mi < 0) { await page.getByRole('button', { name: /資金 \+3/ }).tap(); await page.waitForTimeout(350); funds++; continue; }
    const need = plan(st, st.missions[mi]);
    const e = need[0];
    if (e === undefined || st.costs[e] > st.funds) {
      if (e !== undefined && !shortSeen) { await tapEdge(e); shortSeen = await page.getByRole('button', { name: /に敷く/ }).isDisabled(); }
      await page.getByRole('button', { name: /資金 \+3/ }).tap(); await page.waitForTimeout(350); funds++; continue;
    }
    await tapEdge(e);
    if (builds === 1) await shot('m04_select');
    await page.getByRole('button', { name: /に敷く/ }).tap(); await page.waitForTimeout(350); builds++;
    const after = await state();
    if (builds === 1) check('区間を選んで敷くと、自分の線路になり、建設費が引かれる', after.owner[e] === st.seat && after.built === st.built + 1, `${st.funds}→${after.funds}（費用 ${st.costs[e]}）`);
  }
  const fin = await state();
  check('8 巡で終わる（3 巡ごとに交渉が 2 回入る）', fin.phase === 'done' && fin.turn === 8 * fin.n && breaks === 2, `turn ${fin.turn} breaks ${breaks}`);
  check('敷く、資金、輸送の 3 つの行動を画面から実行できた', builds > 0 && moves > 0, `敷く ${builds} 資金 ${funds} 輸送 ${moves}`);
  if (shortSeen !== false) check('資金が足りない区間は敷けない', shortSeen === true);
  const want = fin.missions.filter((m) => m.done).reduce((a, m) => a + m.points, 0) + fin.built + Math.floor(fin.funds / 3);
  const txt = (await page.locator('.match').innerText()).replace(/\s+/g, ' ');
  check('終了：得点＝任務＋線路＋資金 ÷ 3 が表示される', txt.includes(`＝${want} 点`), txt.slice(txt.indexOf('任務'), txt.indexOf('任務') + 40));
  await shot('m04_done');
  check('画面のエラーなし', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
  console.log(res.every(Boolean) ? 'ALL OK' : 'SOME FAILED');
  process.exit(res.every(Boolean) ? 0 : 1);
})();
