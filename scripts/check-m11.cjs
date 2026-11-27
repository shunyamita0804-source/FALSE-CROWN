// M11（最後の王座）の確認。npm run build の後、sh scripts/with-preview.sh node scripts/check-m11.cjs [写真の保存先]
// 種目 1〜4 は、元の競技の画面が決勝の中で動くこと（表示、最初の操作、補助と会話のボタンが出ないこと）を指の操作で確かめ、
// 残りの手は開発版だけの自動進行（CPU と同じ考え方）で進める。各種目の操作そのものは、それぞれの check-<id>.cjs で確認済み。
// 種目の間の画面と、カード対決は、最後まで指の操作で進める。
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2] || null;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  const shots = new Set(); const shot = async (n) => { if (out && !shots.has(n)) { shots.add(n); await page.screenshot({ path: `${out}/m11_${n}.png` }); } };
  await page.goto('http://localhost:4173/FALSE-CROWN/'); await page.waitForTimeout(1500);
  await page.getByText('開発者メニュー').tap(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: /M11 最後の王座/ }).tap(); await page.waitForTimeout(600);
  let maxLen = 0;
  for (let i = 0; i < 4; i++) { maxLen = Math.max(maxLen, (await page.locator('.tut-text').innerText()).length); await shot(`tut${i + 1}`); await page.getByRole('button', { name: /次へ|練習へ/ }).tap(); await page.waitForTimeout(250); }
  check('説明は段階表示で、1 画面の文は 80 文字以内', maxLen > 0 && maxLen <= 80, String(maxLen));
  // 練習：種目を選べる
  await page.locator('.tut').getByRole('button', { name: '1 図形' }).tap(); await page.waitForTimeout(300);
  check('練習：種目 1 を選ぶと、図形の練習盤面が出る', await page.locator('.tut .pb-board').count() === 1);
  await shot('prac1');
  await page.locator('.tut').getByRole('button', { name: '5 カード対決' }).tap(); await page.waitForTimeout(300);
  await page.locator('.tut .p05-card[data-card="4"]').tap(); await page.waitForTimeout(150);
  const missed = await page.getByRole('button', { name: '本番へ', exact: true }).count() === 0;
  await page.locator('.tut .p05-card[data-card="7"]').tap(); await page.waitForTimeout(300);
  await shot('prac5');
  check('練習：カード対決は、目標に一番近いカードを出すと完了', missed && await page.getByRole('button', { name: '本番へ', exact: true }).count() === 1);
  await page.getByRole('button', { name: '本番へ', exact: true }).tap(); await page.waitForTimeout(900);

  const state = () => page.evaluate(() => { const s = window.__fcSlot && window.__fcSlot.state; if (!s) return null; return { phase: s.phase, event: s.event, rematch: s.rematch, wins: s.wins, results: s.results.length, subPhase: s.sub && s.sub.phase, me: s.players.indexOf('hero') }; });
  const hidden = () => page.evaluate(() => [...document.querySelectorAll('.match .fin-hide, .match .mq-talk')].every((e) => getComputedStyle(e).display === 'none'));
  const stageText = () => page.locator('.match-stage').innerText();
  const auto = () => page.evaluate(() => window.__fcAuto());
  const seen = {}; let hideOk = true; let betweens = 0; let duelByTaps = 0; let labelOk = true;
  for (let guard = 0; guard < 3000; guard++) {
    const st = await state();
    if (!st || st.phase === 'done') break;
    if (st.phase === 'between') {
      const b = page.locator('.match').getByRole('button', { name: /へ$/ });
      if (await b.count()) { await shot(`between${st.results}`); betweens++; await b.first().tap(); await page.waitForTimeout(500); } else await page.waitForTimeout(200);
      continue;
    }
    const ev = st.event;
    if (!(await hidden())) hideOk = false;
    if (!seen[ev]) {
      await page.waitForTimeout(400);
      const label = await stageText();
      if (!label.includes(`種目 ${ev + 1} / 5`) || /\/ (6|8|12)\b/.test(label)) labelOk = false;
      const box = await page.locator('.match .m11-box').count();
      if (ev === 0) {
        // 図形：解の 1 片目を、本来の操作（置き場のピースを選ぶ、回す、盤面をタップ）で置く
        const d = await page.evaluate(() => { const st = window.__fcSlot.state.sub; const rot = (c, r) => { let o = c.map((v) => [...v]); const norm = (a) => { const mx = Math.min(...a.map((v) => v[0])), my = Math.min(...a.map((v) => v[1])); return a.map(([x, y]) => [x - mx, y - my]).sort((p, q) => p[1] - q[1] || p[0] - q[0]); }; o = norm(o); for (let i = 0; i < r; i++) o = norm(o.map(([x, y]) => [-y, x])); return o; }; return { w: st.puzzles[0].w, sol: st.solutions[0].map((p) => ({ ...p, c: rot(st.puzzles[0].pieces[p.piece], p.rot)[0] })) }; });
        const pl = d.sol[0];
        await page.locator(`.match .pb-slot[data-piece="${pl.piece}"]`).tap(); await page.waitForTimeout(80);
        for (let r = 0; r < pl.rot; r++) { await page.locator('.match').getByRole('button', { name: '回す' }).tap(); await page.waitForTimeout(60); }
        const bb = await page.locator('.match .pb-board').boundingBox(); const px = bb.width / d.w;
        await page.touchscreen.tap(bb.x + (pl.x + pl.c[0] + 0.5) * px, bb.y + (pl.y + pl.c[1] + 0.5) * px); await page.waitForTimeout(150);
        const placed = await page.locator('.match .pb-piece.on-board').count();
        await shot('ev1');
        check('種目 1：図形の盤面が出て、ピースを選んで置ける（4×4 から始まる）', box === 1 && placed === 1 && d.w === 4, `placed=${placed} w=${d.w}`);
        check('種目 1：ヒントを買う欄と、組の欄は出ない', await hidden());
      } else if (ev === 1) {
        const b = page.locator('.match').getByRole('button', { name: '始める' });
        const has = await b.count();
        await shot('ev2_prep');
        if (has) { await b.tap(); await page.waitForTimeout(600); }
        const quiz = await page.locator('.match .mq, .match .mq-frame, .match .mq-board').count();
        await shot('ev2');
        check('種目 2：記憶の準備画面から「始める」で盤面の表示に進む。表示を延ばすボタンは出ない', box === 1 && has === 1 && quiz >= 1 && await hidden(), `quiz=${quiz}`);
      } else if (ev === 2) {
        await page.waitForTimeout(300);
        const cand = page.locator('.match .m05-pick .m05-cand');
        const n = await cand.count();
        await shot('ev3_pick');
        if (n) { await cand.nth(0).tap(); await page.waitForTimeout(200); const ok = page.locator('.match').getByRole('button', { name: /決める|確定|この目標/ }); if (await ok.count()) { await ok.first().tap(); await page.waitForTimeout(300); } }
        const a = await state();
        check('種目 3：数字の式の、目標を選ぶ画面が出る（候補 3 つ）', box === 1 && n === 3, `cands=${n} sub=${a.subPhase}`);
      } else if (ev === 3) {
        const hex = await page.locator('.match .hxb, .match .hx7 svg').count();
        await shot('ev4');
        check('種目 4：陣取りの盤面が出る。タイルの形を替えるボタンは出ない', box === 1 && hex >= 1 && await hidden(), `hex=${hex}`);
      } else if (ev === 4) {
        await shot('ev5');
        check('種目 5：カード対決の画面が出る（手札 9 枚）', box === 1 && await page.locator('.match .p05-hand .p05-card').count() === 9);
      }
      seen[ev] = true;
    }
    if (ev === 4) {
      // カード対決は、指の操作で最後まで：目標に一番近い手札を選んで、確定する
      const d = await page.evaluate(() => ({ target: Number(document.querySelector('.match .p05-total b').textContent), hand: [...document.querySelectorAll('.match .p05-hand .p05-card:not([disabled])')].map((e) => Number(e.dataset.card)) }));
      if (!d.hand.length) { await page.waitForTimeout(200); continue; }
      const card = d.hand.reduce((b, c) => (Math.abs(c - d.target) < Math.abs(b - d.target) ? c : b), d.hand[0]);
      await page.locator(`.match .p05-hand .p05-card[data-card="${card}"]`).tap(); await page.waitForTimeout(80);
      if (duelByTaps === 2) await shot('ev5_sel');
      await page.locator('.match .p05-go').tap(); await page.waitForTimeout(250);
      duelByTaps++;
      continue;
    }
    if (!(await auto())) await page.waitForTimeout(150); else await page.waitForTimeout(30);
  }
  await page.waitForTimeout(1500);
  await shot('done');
  const fin = await page.evaluate(() => { const s = window.__fcSlot && window.__fcSlot.state; return s ? { phase: s.phase, wins: s.wins, results: s.results.map((r) => `${r.event}:${r.winner}`) } : null; });
  check('先に 3 勝した時点で終わる', !!fin && fin.phase === 'done' && Math.max(...fin.wins) === 3, JSON.stringify(fin));
  check('終了の画面に、優勝者と 5 種目の勝敗が出る', (await page.locator('.match .m01-big').innerText()).includes('優勝') && await page.locator('.match .m11-board.big .m11-ev').count() === 5);
  check('種目の間に結果の画面が出て、ボタンで次へ進む', betweens >= 2, String(betweens));
  check('見出しは「種目 n / 5」で、元の競技のラウンド数は出ない', labelOk);
  check('補助、組、会話のボタンは、どの種目でも出ない', hideOk);
  check('画面のエラーなし', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(`events seen=${Object.keys(seen).join(',')} duelByTaps=${duelByTaps}`);
  await browser.close();
  console.log(res.every(Boolean) ? 'ALL OK' : 'SOME FAILED');
  process.exit(res.every(Boolean) ? 0 : 1);
})();
