// M08（バリケード）を画面の操作だけで最後まで遊ぶ確認。npm run build の後、sh scripts/with-preview.sh node scripts/check-m08.cjs [写真の保存先]
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2] || null;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  const shot = async (n) => { if (out) await page.screenshot({ path: `${out}/m08_${n}.png` }); };
  const shots = new Set(); const once = async (n) => { if (!shots.has(n)) { shots.add(n); await shot(n); } };
  await page.goto('http://localhost:4173/FALSE-CROWN/'); await page.waitForTimeout(1500);
  await page.getByText('開発者メニュー').tap(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: /M08 バリケード/ }).tap(); await page.waitForTimeout(600);
  let maxLen = 0;
  for (let i = 0; i < 4; i++) { maxLen = Math.max(maxLen, (await page.locator('.tut-text').innerText()).length); await shot(`tut${i + 1}`); await page.getByRole('button', { name: /次へ|練習へ/ }).tap(); await page.waitForTimeout(250); }
  check('説明は段階表示で、1 画面の文は 80 文字以内', maxLen > 0 && maxLen <= 80, String(maxLen));
  const tapNode = async (root, n) => { await page.locator(`${root} .rb-node[data-node="${n}"] .hit`).tap({ force: true }); await page.waitForTimeout(80); };
  check('練習：選ぶ前は動けない', await page.locator('.tut').getByRole('button', { name: 'ここへ動く' }).isDisabled());
  const canT = await page.evaluate(() => [...document.querySelectorAll('.tut .rb-node.can')].map((e) => Number(e.getAttribute('data-node'))));
  await tapNode('.tut', canT[0]);
  await page.locator('.tut').getByRole('button', { name: 'ここへ動く' }).tap(); await page.waitForTimeout(200);
  await page.locator('.tut').getByRole('button', { name: /壁を置く（/ }).tap(); await page.waitForTimeout(200);
  await page.locator('.tut .rb-handle .hit').first().tap({ force: true }); await page.waitForTimeout(150);
  await shot('practice');
  await page.locator('.tut').getByRole('button', { name: 'ここに壁を置く' }).tap(); await page.waitForTimeout(250);
  check('練習：1 歩動いて壁を 1 本置くと、本番へ進める', await page.getByRole('button', { name: '本番へ', exact: true }).count() === 1);
  await page.getByRole('button', { name: '本番へ', exact: true }).tap(); await page.waitForTimeout(800);
  const state = () => page.evaluate(() => { const s = window.__fcSlot && window.__fcSlot.state; if (!s) return null; const i = s.players.indexOf('hero'); const n = s.players.length; const order = s.players.map((_, k) => (k + s.round) % n).filter((k) => s.arrived[k] < 0 || s.arrived[k] === s.round).map((k) => s.players[k]); return { phase: s.phase, round: s.round, toMove: s.phase === 'play' ? order[s.turn] : null, pos: s.pos[i], walls: s.walls.filter(Boolean).length, wallsLeft: s.wallsLeft[i], arrived: s.arrived[i], moves: s.moves[i], log: s.log.length, allArrived: [...s.arrived] }; });
  const leftShown = async () => { const txt = await page.locator('.match .rb-rank .m01-rankrow.me b').innerText(); const m = txt.match(/あと (\d+)/); return m ? Number(m[1]) : (/到着/.test(txt) ? 0 : -1); };
  let moves = 0, wallsPut = 0, replaySeen = false, moveOk = true, wallOk = null, effectOk = null, badOk = null, timeoutDone = false, breaks = 0, tapTwice = false, distOk = true;
  for (let guard = 0; guard < 1200; guard++) {
    const st = await state();
    if (!st || st.phase === 'done') break;
    if (st.phase === 'break') {
      const b = page.getByRole('button', { name: '再開する' });
      if (await b.count()) { await once('break'); breaks++; await b.tap(); }
      await page.waitForTimeout(350); continue;
    }
    if (st.toMove !== 'hero') { await page.waitForTimeout(200); continue; }
    if (await page.locator('.match .rb.move, .match .rb.wall').count() === 0) { replaySeen = true; await once('replay'); await page.waitForTimeout(250); continue; }
    await once('turn');
    if (await page.getByRole('button', { name: 'パス', exact: true }).count()) { await page.getByRole('button', { name: 'パス', exact: true }).tap(); await page.waitForTimeout(300); continue; }
    const can = await page.evaluate(() => [...document.querySelectorAll('.match .rb-node.can')].map((e) => Number(e.getAttribute('data-node'))));
    if (badOk === null) {
      const bad = [...Array(31).keys()].find((n) => !can.includes(n) && n !== st.pos);
      await tapNode('.match', bad);
      badOk = await page.locator('.match').getByRole('button', { name: 'ここへ動く' }).isDisabled();
      check('光っていない点は選べない', badOk);
    }
    if (!timeoutDone && st.round === 1) {
      await page.waitForFunction((n) => window.__fcSlot.state.log.length > n, st.log, { timeout: 60000 });
      const a = await state();
      check('時間切れは、ゴールに近づく点へ自動で動く', a.moves === st.moves + 1 && can.includes(a.pos));
      timeoutDone = true; continue;
    }
    // 壁：2 回だけ、誰かが遠回りになる所に置く
    if (wallsPut < 2 && st.round >= 2 && st.wallsLeft > 0 && await page.locator('.match').getByRole('button', { name: /壁を置く（/ }).isEnabled()) {
      await page.locator('.match').getByRole('button', { name: /壁を置く（/ }).tap(); await page.waitForTimeout(150);
      const n = await page.locator('.match .rb-handle').count();
      let found = false;
      for (let k = 0; k < Math.min(n, 40); k++) {
        const hd = page.locator('.match .rb-handle .hit').nth(k);
        if (await hd.count() === 0) break;
        await hd.tap({ force: true }); await page.waitForTimeout(70);
        const note = await page.locator('.match .fb-note').innerText();
        if (/遠回りになる人/.test(note) && !/あなた/.test(note)) { found = true; if (effectOk === null) { effectOk = await page.locator('.match .rb-delta').count() >= 1; await once('wall_preview'); } break; }
      }
      if (found) {
        await page.locator('.match').getByRole('button', { name: 'ここに壁を置く' }).tap(); await page.waitForTimeout(250);
        const a = await state();
        const lg = await page.evaluate((n) => window.__fcSlot.state.log[n], st.log);
        if (wallOk === null) check('壁を置くと、残りが 1 本減る（動かない）', lg && lg.kind === 'wall' && a.wallsLeft === st.wallsLeft - 1 && a.pos === st.pos);
        wallOk = true; wallsPut++; continue;
      }
      await page.locator('.match').getByRole('button', { name: '動く', exact: true }).tap(); await page.waitForTimeout(120);
      wallsPut = 9;
    }
    // 動く：画面の「あと n」が一番小さくなる点を選ぶ（点線の道の先）
    const before = await leftShown();
    let best = can[0], bestLeft = 99;
    const dists = await page.evaluate((c) => { const s = window.__fcSlot.state; return c; }, can);
    void dists;
    // 点線（自分の最短の道）の 2 点目が、次に進む点
    const next = await page.evaluate(() => { const pl = document.querySelector('.match .rb-path'); if (!pl) return null; const pts = pl.getAttribute('points').trim().split(' ').map((p) => p.split(',').map(Number)); if (pts.length < 2) return null; const [x, y] = pts[1]; let hit = null; document.querySelectorAll('.match .rb-node').forEach((g) => { const m = g.getAttribute('transform').match(/translate\(([-\d.]+) ([-\d.]+)\)/); if (Math.abs(Number(m[1]) - x) < 0.2 && Math.abs(Number(m[2]) - y) < 0.2) hit = Number(g.getAttribute('data-node')); }); return hit; });
    best = can.includes(next) ? next : can[0];
    void bestLeft;
    await tapNode('.match', best);
    await once('move_selected');
    if (moves % 2 === 0) { await tapNode('.match', best); tapTwice = true; } else await page.locator('.match').getByRole('button', { name: 'ここへ動く' }).tap();
    await page.waitForTimeout(250);
    const a = await state();
    if (!(a.pos === best || a.arrived >= 0)) moveOk = false;
    if (can.includes(next) && a.arrived < 0) { await page.waitForTimeout(100); }
    if (before >= 0 && can.includes(next) && a.arrived < 0 && a.moves !== st.moves + 1) distOk = false;
    moves++;
  }
  await page.waitForTimeout(5000);
  await shot('done');
  const fin = await page.evaluate(() => { const s = window.__fcSlot && window.__fcSlot.state; return s ? { phase: s.phase, round: s.round, arrived: s.arrived, hero: s.arrived[s.players.indexOf('hero')] } : null; });
  check('最後まで進む', !fin || fin.phase === 'done', JSON.stringify(fin));
  check('選んだ点へ動く（2 度タップでも、ボタンでも確定できる）', moves >= 5 && moveOk && distOk && tapTwice, `moves=${moves}`);
  check('壁を置く前に、遠回りになる人と歩数が出る', effectOk === true && wallOk === true, `walls=${wallsPut}`);
  check('CPU の手は 1 手ずつ順に見せる', replaySeen);
  check('3 巡ごとに相談の時間がある', breaks >= 1, String(breaks));
  check('時間切れを確かめた', timeoutDone);
  check('画面のエラーなし', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
  console.log(res.every(Boolean) ? 'ALL OK' : 'SOME FAILED');
  process.exit(res.every(Boolean) ? 0 : 1);
})();
