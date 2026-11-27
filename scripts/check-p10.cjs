// P10（最後の一手）を画面の操作だけで最後まで遊ぶ確認。npm run build の後、sh scripts/with-preview.sh node scripts/check-p10.cjs [写真の保存先]
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2] || null;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  const shots = new Set(); const shot = async (n) => { if (out && !shots.has(n)) { shots.add(n); await page.screenshot({ path: `${out}/p10_${n}.png` }); } };
  const at = (x, y) => y * 5 + x;
  const cell = (root, c) => page.locator(`${root} .pzb-cell[data-cell="${c}"]`);
  const tap = async (loc) => { await loc.tap({ force: true }); await page.waitForTimeout(80); };
  const stepsOf = (pieces, seat) => {
    const occ = new Map(pieces.map((p) => [p.pos, p.seat])); const o = [];
    for (const p of pieces) { if (p.seat !== seat) continue; const x = p.pos % 5, y = Math.floor(p.pos / 5);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = x + dx, b = y + dy; if (a < 0 || b < 0 || a > 4 || b > 4) continue; const s = occ.get(at(a, b));
        if (s === undefined) { o.push({ from: p.pos, to: at(a, b) }); continue; } if (s === seat) continue; const a2 = a + dx, b2 = b + dy; if (a2 < 0 || b2 < 0 || a2 > 4 || b2 > 4 || occ.has(at(a2, b2))) continue; o.push({ from: p.pos, to: at(a2, b2), cap: at(a, b) }); } }
    return o;
  };
  const apply = (pieces, seat, s) => pieces.filter((p) => p.pos !== s.cap).map((p) => (p.pos === s.from && p.seat === seat ? { seat, pos: s.to } : p));
  const CENTERS = [12, 11, 13, 7, 17];
  await page.goto('http://localhost:4173/FALSE-CROWN/'); await page.waitForTimeout(1500);
  await page.getByText('開発者メニュー').tap(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: /P10 最後の一手/ }).tap(); await page.waitForTimeout(600);
  let maxLen = 0;
  for (let i = 0; i < 4; i++) { maxLen = Math.max(maxLen, (await page.locator('.tut-text').innerText()).length); await shot(`tut${i + 1}`); await page.getByRole('button', { name: /次へ|練習へ/ }).tap(); await page.waitForTimeout(250); }
  check('説明は段階表示で、1 画面の文は 80 文字以内', maxLen > 0 && maxLen <= 80, String(maxLen));
  await tap(cell('.tut', at(1, 2))); await tap(cell('.tut', at(3, 2))); await shot('practice'); await tap(cell('.tut', at(3, 2)));
  check('練習：敵を飛び越して取ると、本番へ進める', await page.getByRole('button', { name: '本番へ', exact: true }).count() === 1);
  await page.getByRole('button', { name: '本番へ', exact: true }).tap(); await page.waitForTimeout(800);
  const state = () => page.evaluate(() => { const s = window.__fcSlot && window.__fcSlot.state; if (!s) return null; const i = s.players.indexOf('hero'); return { phase: s.phase, game: s.game, round: s.round, k: s.k, me: i, pieces: s.pieces, points: s.points, log: s.log.length, lastKinds: s.log.slice(-3).map((l) => l.kind), first: (s.game) % 2 }; });
  const myTurn = async () => (await page.locator('.match .pzb-cell.movable').count()) > 0 || (await page.locator('.match').getByRole('button', { name: 'パス' }).count()) > 0;
  const box = await cell('.match', 0).boundingBox();
  check('タップするマスは 40px 以上', box && box.width >= 40, box ? box.width.toFixed(1) : '');
  let capOk = null, centerOk = null, badOk = null, timeoutOk = null, warnSeen = false, breaks = 0, game2 = null, moves = 0;
  for (let guard = 0; guard < 1500; guard++) {
    const st = await state();
    if (!st || st.phase === 'done') break;
    if (st.phase === 'break') {
      const b = page.locator('.match').getByRole('button', { name: '再開する' });
      if (await b.count()) {
        if (st.game === 1 && st.round === 0 && game2 === null) { await shot('game2'); game2 = st.pieces.length === 8 && st.first === 1; check('2 ゲーム目：盤面が最初の配置に戻り、先手が入れ替わる', game2); }
        breaks++; await b.tap();
      }
      await page.waitForTimeout(300); continue;
    }
    if (!(await myTurn())) { await page.waitForTimeout(150); continue; }
    const pass = page.locator('.match').getByRole('button', { name: 'パス' });
    if (await pass.count()) { await pass.tap(); await page.waitForTimeout(300); continue; }
    const seat = st.me; const steps = stepsOf(st.pieces, seat);
    if (st.game === 0 && st.round === 0) await shot('round1');
    if (badOk === null) {
      const p = st.pieces.find((q) => q.seat === seat); await tap(cell('.match', p.pos));
      const far = [...Array(25).keys()].find((c) => !steps.some((s) => s.from === p.pos && s.to === c) && !st.pieces.some((q) => q.pos === c));
      await tap(cell('.match', far));
      badOk = (await page.locator('.match .pzb-cell.chosen').count()) === 0 && await page.locator('.match').getByRole('button', { name: '動かす' }).isDisabled();
      check('動けないマスは選べない（確定ボタンは押せないまま）', badOk);
      await tap(cell('.match', p.pos));
    }
    if (st.game === 0 && st.round === 6 && timeoutOk === null) {
      const before = st.log;
      await page.waitForFunction((n) => window.__fcSlot.state.log.length > n, before, { timeout: 40000 });
      const a = await page.evaluate((n) => window.__fcSlot.state.log[n].kind, before);
      timeoutOk = a === 'pass';
      check('時間切れはパスになる', timeoutOk, a);
      continue;
    }
    // 手を決める：取れるなら取る。次に取られない手のうち、中央に近い手
    let best = null;
    for (const s of steps) {
      const next = apply(st.pieces, seat, s);
      const hit = stepsOf(next, 1 - seat).some((e) => e.cap === s.to);
      const x = s.to % 5, y = Math.floor(s.to / 5); const fx = s.from % 5, fy = Math.floor(s.from / 5);
      let v = (s.cap !== undefined ? 6 : 0) - (hit ? 5 : 0) - (Math.abs(x - 2) + Math.abs(y - 2)) + 0.4 * (Math.abs(fx - 2) + Math.abs(fy - 2));
      if (CENTERS.includes(s.from) && !CENTERS.includes(s.to)) v -= 2;
      if (!best || v > best.v) best = { ...s, v, hit };
    }
    await tap(cell('.match', best.from)); await tap(cell('.match', best.to));
    if (await page.locator('.match .pz-warn').count()) { warnSeen = true; await shot('warn'); }
    if (best.cap !== undefined) await shot('capture');
    const btn = page.locator('.match').getByRole('button', { name: '動かす' });
    if (await btn.isDisabled()) { check('選んだ手が確定できる', false, JSON.stringify(best)); break; }
    const before = st.points[seat];
    await btn.tap(); await page.waitForTimeout(250); moves++;
    if (best.cap !== undefined && capOk === null) {
      const a = await page.evaluate((i) => { const s = window.__fcSlot.state; const l = [...s.log].reverse().find((x) => x.seat === i && x.kind === 'move'); return { pts: l.points[i], cap: l.cap }; }, seat);
      capOk = a.pts === before + 3 && a.cap === best.cap;
      check('飛び越して取ると 3 点入る', capOk, JSON.stringify(a));
    }
    if (centerOk === null) {
      const a = await page.evaluate(() => { const s = window.__fcSlot.state; const l = [...s.log].reverse().find((x) => x.kind === 'score'); if (!l) return null; const C = [12, 11, 13, 7, 17]; return { gain: l.gain, n: [0, 1].map((i) => l.pieces.filter((p) => p.seat === i && C.includes(p.pos)).length) }; });
      if (a && a.gain[0] + a.gain[1] > 0) { centerOk = a.gain[0] === a.n[0] && a.gain[1] === a.n[1]; check('巡の終わりに、中央の駒 1 個につき 1 点入る', centerOk, JSON.stringify(a)); await page.waitForTimeout(900); await shot('center'); }
    }
  }
  await page.waitForTimeout(2500);
  await shot('done');
  const fin = await page.evaluate(() => { const s = window.__fcSlot && window.__fcSlot.state; return s ? { phase: s.phase, game: s.game, points: s.points, gamePts: s.gamePts, remain: s.remain } : null; });
  check('2 ゲームを最後まで進む', !fin || (fin.phase === 'done' && fin.game === 1), JSON.stringify(fin));
  check('休憩がある（5 巡ごと、ゲームの間）', breaks >= 3, String(breaks));
  check('飛び越して取る場面があった', capOk === true, `moves=${moves}`);
  check('画面のエラーなし', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(`warnSeen=${warnSeen}`);
  await browser.close();
  console.log(res.every(Boolean) ? 'ALL OK' : 'SOME FAILED');
  process.exit(res.every(Boolean) ? 0 : 1);
})();
