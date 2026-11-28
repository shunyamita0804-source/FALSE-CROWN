// M10（トライアングル）を画面の操作だけで最後まで遊ぶ確認。npm run build の後、sh scripts/with-preview.sh node scripts/check-m10.cjs [写真の保存先]
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2] || null;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  const shots = new Set(); const shot = async (n) => { if (out && !shots.has(n)) { shots.add(n); await page.screenshot({ path: `${out}/m10_${n}.png` }); } };
  const node = (root, n) => page.locator(`${root} .tb-node[data-node="${n}"] .hit`);
  const flag = (root, s) => page.locator(`${root} .tb-flag[data-flag="${s}"] .hit`);
  const tap = async (loc) => { await loc.tap({ force: true }); await page.waitForTimeout(90); };
  await page.goto('http://localhost:4173/FALSE-CROWN/'); await page.waitForTimeout(1500);
  await page.getByText('開発者メニュー').tap(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: /M10 トライアングル/ }).tap(); await page.waitForTimeout(600);
  let maxLen = 0;
  for (let i = 0; i < 4; i++) { maxLen = Math.max(maxLen, (await page.locator('.tut-text').innerText()).length); await shot(`tut${i + 1}`); await page.getByRole('button', { name: /次へ|練習へ/ }).tap(); await page.waitForTimeout(250); }
  check('説明は段階表示で、1 画面の文は 80 文字以内', maxLen > 0 && maxLen <= 80, String(maxLen));
  // 練習：宝石を取りに行き、戻って、旗をタップして納める
  await tap(node('.tut', 1)); await tap(node('.tut', 4)); await tap(node('.tut', 4));
  await shot('practice1');
  await tap(node('.tut', 1)); await tap(node('.tut', 1));
  await tap(flag('.tut', 0)); await shot('practice2'); await tap(flag('.tut', 0));
  await shot('practice3');
  check('練習：宝石を持ち帰って旗をタップすると、本番へ進める', await page.getByRole('button', { name: '本番へ', exact: true }).count() === 1);
  await page.getByRole('button', { name: '本番へ', exact: true }).tap(); await page.waitForTimeout(800);
  const ADJ = []; { const rc = (n) => { let r = 0; while ((r + 1) * (r + 2) / 2 <= n) r++; return [r, n - r * (r + 1) / 2]; }; const idx = (r, c) => r * (r + 1) / 2 + c; for (let n = 0; n < 15; n++) { const [r, c] = rc(n); const o = []; const add = (a, b) => { if (a >= 0 && a < 5 && b >= 0 && b <= a) o.push(idx(a, b)); }; add(r, c - 1); add(r, c + 1); add(r - 1, c - 1); add(r - 1, c); add(r + 1, c); add(r + 1, c + 1); ADJ.push(o); } }
  const FLAGS = [0, 10, 14];
  const state = () => page.evaluate(() => { const s = window.__fcSlot && window.__fcSlot.state; if (!s) return null; const i = s.players.indexOf('hero'); return { phase: s.phase, round: s.round, me: i, seat: s.seats[i], board: s.board, points: s.points, log: s.log.length, delivers: s.delivers[i], myLog: s.log.filter((l) => l.seat === s.seats[i]).length }; });
  const myTurn = async () => (await page.locator('.match .tb-node.movable').count()) > 0 || (await page.locator('.match').getByRole('button', { name: 'パス' }).count()) > 0;
  const dist = (from, to) => { const d = new Array(15).fill(99); d[from] = 0; const q = [from]; while (q.length) { const c = q.shift(); for (const n of ADJ[c]) if (!FLAGS.includes(n) && d[n] > d[c] + 1) { d[n] = d[c] + 1; q.push(n); } } return d[to]; };
  const hit = await page.locator('.match .tb-node .hit').first().boundingBox();
  check('タップする点は 40px 以上', hit && hit.width >= 40, hit ? hit.width.toFixed(1) : '');
  let forced = false, forcedOk = false, atkOk = true, atkWant = 0, atkSeen = 0, atkShot = false, delivered = 0, peaceOk = null, badOk = null, timeoutOk = null, warnSeen = false, breaks = 0, capDone = 0, moves = 0;
  for (let guard = 0; guard < 900; guard++) {
    const st = await state();
    if (!st || st.phase === 'done') break;
    if (st.phase === 'break') { const b = page.locator('.match').getByRole('button', { name: '再開する' }); if (await b.count()) { await shot('break'); breaks++; await b.tap(); } await page.waitForTimeout(350); continue; }
    if (!(await myTurn())) { await page.waitForTimeout(200); continue; }
    const pass = page.locator('.match').getByRole('button', { name: 'パス' });
    if (await pass.count()) { await pass.tap(); await page.waitForTimeout(300); continue; }
    const B = st.board; const seat = st.seat; const home = ADJ[FLAGS[seat]];
    const mine = B.soldiers.filter((s) => s.seat === seat);
    const enemyAt = (n) => B.soldiers.some((s) => s.pos === n && s.seat !== seat);
    const ownAt = (n) => B.soldiers.some((s) => s.pos === n && s.seat === seat);
    // 「！」を確かめるため、取れる巡で一度だけ、敵の兵 1 個を自分の兵の隣へ置き直す（確認用の操作。盤面の表示を確かめるだけ）
    if (st.round >= 3 && !forced && mine.length) {
      const ok = await page.evaluate(({ ADJ, FL }) => {
        const s = window.__fcSlot.state; const seat = s.seats[s.players.indexOf('hero')];
        const boards = [s.board, ...(s.log.length ? [s.log[s.log.length - 1].board] : [])];
        const b0 = boards[0]; const enemy = b0.soldiers.findIndex((q) => q.seat !== seat); if (enemy < 0) return false;
        for (const m of b0.soldiers.filter((q) => q.seat === seat)) for (const n of ADJ[m.pos]) {
          if (FL.includes(n) || b0.soldiers.some((q) => q.pos === n)) continue;
          for (const b of boards) { const e = b.soldiers.find((q) => q.seat === b0.soldiers[enemy].seat && q.pos === b0.soldiers[enemy].pos); if (e) e.pos = n; }
          return true;
        }
        return false;
      }, { ADJ, FL: FLAGS });
      if (ok) {
        forced = true;
        const st2 = await state(); const m0 = st2.board.soldiers.find((q) => q.seat === st2.seat);
        await node('.match', m0.pos).tap({ force: true }); await page.waitForTimeout(300);
        const want2 = st2.board.soldiers.filter((q) => q.seat === st2.seat && ADJ[q.pos].some((n) => st2.board.soldiers.some((e) => e.pos === n && e.seat !== st2.seat))).length;
        const got2 = await page.locator('.match .tb-atk').count();
        forcedOk = want2 > 0 && want2 === got2 && (await page.locator('.match .tb-atknote').count()) === 1;
        await shot('atk');
        await node('.match', m0.pos).tap({ force: true }); await page.waitForTimeout(300);
        continue;
      }
    }
    // 次に取られうる兵の「！」：隣に敵の兵がいる自分の兵の数と同じ（取れない巡では 0）
    { const want = st.round + 1 >= 3 ? mine.filter((q) => ADJ[q.pos].some(enemyAt)).length : 0; const got = await page.locator('.match .tb-atk').count(); if (want) atkWant++; if (want !== got) { atkOk = false; console.log('atk mismatch', st.round, want, got); } if (got) { atkSeen++; if (!atkShot) { atkShot = true; await shot('atk'); } } }
    if (st.round === 0) await shot('round1');
    if (st.round < 3 && peaceOk === null) {
      // 最初の 3 巡：敵の兵がいる点は選べない
      const s = mine.find((q) => ADJ[q.pos].some(enemyAt));
      if (s) {
        await tap(node('.match', s.pos));
        const en = ADJ[s.pos].find(enemyAt);
        peaceOk = (await page.locator(`.match .tb-node[data-node="${en}"].can`).count()) === 0;
        check('最初の 3 巡は、敵の兵がいる点へは動けない', peaceOk);
        await shot('peace');
        await tap(node('.match', s.pos));
      }
    }
    if (badOk === null) {
      // 隣でない点は選べない
      const s = mine[0]; await tap(node('.match', s.pos));
      const far = [...Array(15).keys()].find((n) => !FLAGS.includes(n) && n !== s.pos && !ADJ[s.pos].includes(n));
      await tap(node('.match', far));
      badOk = (await page.locator('.match .tb-node.chosen').count()) === 0 && await page.locator('.match').getByRole('button', { name: '動かす' }).isDisabled();
      check('隣でない点は選べない（確定ボタンは押せないまま）', badOk);
      await tap(node('.match', s.pos));
    }
    if (st.round === 4 && timeoutOk === null) {
      // 時間切れ：自動で 1 手が選ばれる
      const before = st.myLog;
      await page.waitForFunction((n) => { const s = window.__fcSlot.state; return s.log.filter((l) => l.seat === s.seats[s.players.indexOf('hero')]).length > n || s.phase !== 'play'; }, before, { timeout: 60000 });
      timeoutOk = (await state()).myLog === before + 1;
      check('時間切れは、自動で 1 手が選ばれる', timeoutOk);
      continue;
    }
    // 手を決める：納められるなら納める。宝石を持っていれば旗の隣へ。持っていなければ宝石へ
    const carrier = mine.find((s) => s.gem >= 0 && home.includes(s.pos));
    if (carrier) {
      const before = st.points[st.me];
      await tap(node('.match', carrier.pos)); await tap(flag('.match', seat)); await shot('deliver');
      await page.locator('.match').getByRole('button', { name: '納める' }).tap(); await page.waitForTimeout(400);
      const a = await state();
      if (a.points[a.me] === before + 4) delivered++;
      continue;
    }
    let best = null;
    for (const s of mine) for (const n of ADJ[s.pos]) {
      if (FLAGS.includes(n) || ownAt(n)) continue;
      if (enemyAt(n) && st.round < 3) continue;
      let v = 0;
      if (enemyAt(n)) v += 5;
      if (s.gem >= 0) v += 4 - Math.min(...home.map((hn) => dist(n, hn)));
      else if (B.ground.length) v += 3 - Math.min(...B.ground.map((g) => dist(n, g.node)));
      if (st.round >= 2 && ADJ[n].some((m) => enemyAt(m) && m !== n)) v -= 3;
      if (!best || v > best.v) best = { from: s.pos, to: n, v, cap: enemyAt(n) };
    }
    if (!best) { await page.waitForTimeout(300); continue; }
    await tap(node('.match', best.from)); await tap(node('.match', best.to));
    if (await page.locator('.match .pz-warn').count()) { warnSeen = true; await shot('warn'); }
    if (best.cap) await shot('capture');
    const btn = page.locator('.match').getByRole('button', { name: '動かす' });
    if (await btn.isDisabled()) { check('選んだ手が確定できる', false, JSON.stringify(best)); break; }
    await btn.tap(); await page.waitForTimeout(350); moves++;
    if (best.cap) capDone++;
    if (st.round === 5) await shot('mid');
  }
  await page.waitForTimeout(2500);
  await shot('done');
  const fin = await page.evaluate(() => { const s = window.__fcSlot && window.__fcSlot.state; return s ? { phase: s.phase, round: s.round, points: s.points, delivers: s.delivers } : null; });
  check('最後まで進む', !fin || fin.phase === 'done', JSON.stringify(fin));
  check('宝石を旗に納めると 4 点入る', delivered >= 1, `delivered=${delivered} moves=${moves} caps=${capDone}`);
  check('次に取られうる兵に「！」が付く（隣に敵がいる兵だけ。取れない巡は付かない）', atkOk && forcedOk, `want=${atkWant} seen=${atkSeen} forced=${forced}`);
  check('3 巡ごとに交渉の時間がある', breaks >= 2, String(breaks));
  check('画面のエラーなし', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(`warnSeen=${warnSeen} peaceOk=${peaceOk}`);
  await browser.close();
  console.log(res.every(Boolean) ? 'ALL OK' : 'SOME FAILED');
  process.exit(res.every(Boolean) ? 0 : 1);
})();
