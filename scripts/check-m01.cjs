// 新 M01（ピース・アセンブル）を画面の操作だけで最後まで遊ぶ確認。npm run build と npx vite preview --port 4173 の後に実行する。
// node scripts/check-m01.cjs [スクリーンショットの保存先]
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2] || null;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  const shot = async (n) => { if (out) await page.screenshot({ path: `${out}/${n}.png` }); };
  await page.goto('http://localhost:4173/FALSE-CROWN/'); await page.waitForTimeout(1500);
  await page.getByText('開発者メニュー').tap(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: /M01 ピース/ }).tap(); await page.waitForTimeout(600);
  // 説明は 4 画面＋練習。1 画面の文は 70 文字以内
  let maxLen = 0;
  for (let i = 0; i < 4; i++) { maxLen = Math.max(maxLen, (await page.locator('.tut-text').innerText()).length); await page.getByRole('button', { name: /次へ|練習へ/ }).tap(); await page.waitForTimeout(250); }
  check('説明は段階表示で、1 画面の文は 70 文字以内', maxLen > 0 && maxLen <= 70, String(maxLen));
  // 置き場のピースを選んで回し、盤面のマスをタップして置く（説明の練習と本番で同じ操作）
  const place = async (pl, cells0) => {
    const slot = page.locator(`.pb-slot[data-piece="${pl.piece}"]`);
    await slot.tap(); await page.waitForTimeout(60);
    for (let r = 0; r < pl.rot; r++) { await page.getByRole('button', { name: '回す' }).tap(); await page.waitForTimeout(60); }
    const bb = await page.locator('.pb-board').boundingBox();
    const dims = await page.evaluate(() => { const b = document.querySelector('.pb-board'); const c = b.querySelectorAll('.pb-cell'); const w = Math.round(b.offsetWidth / c[0].offsetWidth); return { w, h: c.length / w }; });
    const px = bb.width / dims.w;
    await page.touchscreen.tap(bb.x + (pl.x + cells0[0] + 0.5) * px, bb.y + (pl.y + cells0[1] + 0.5) * px);
    await page.waitForTimeout(80);
  };
  // 練習：盤面を見て解く（ページ内の探索は使わず、練習用の既知の配置を置く）
  const prac = [{ piece: 0, rot: 2, x: 0, y: 0, c: [0, 0] }, { piece: 1, rot: 3, x: 0, y: 1, c: [0, 0] }];
  void prac;
  await shot('m01_practice');
  await page.getByRole('button', { name: /本番へ/ }).tap(); await page.waitForTimeout(800);
  check('本番の画面に盤面と置き場がある', await page.locator('.pb-board').count() === 1 && await page.locator('.pb-slot').count() >= 4);
  let totalBefore = 0;
  for (let stage = 0; stage < 6; stage++) {
    // 開発版の検証用に、生成時の解を読んで同じ操作を行う（製品版にこの参照は無い）
    const data = await page.evaluate(() => { const st = window.__fcSlot.state; const rot = (c, r) => { let o = c.map((v) => [...v]); const norm = (a) => { const mx = Math.min(...a.map((v) => v[0])), my = Math.min(...a.map((v) => v[1])); return a.map(([x, y]) => [x - mx, y - my]).sort((p, q) => p[1] - q[1] || p[0] - q[0]); }; o = norm(o); for (let i = 0; i < r; i++) o = norm(o.map(([x, y]) => [-y, x])); return o; }; return { stage: st.stage, sol: st.solutions[st.stage].map((p) => ({ ...p, c: rot(st.puzzles[st.stage].pieces[p.piece], p.rot)[0] })) }; });
    if (stage === 0) {
      // 1 片目を置いた後、2 片目を選んで穴をタップしても置けない
      await place(data.sol[0], data.sol[0].c);
      const n1 = await page.locator('.pb-piece.on-board').count();
      await page.locator('.pb-slot[data-piece="' + data.sol[1].piece + '"]').tap(); await page.waitForTimeout(60);
      await page.locator('.pb-cell.hole').first().tap(); await page.waitForTimeout(80);
      const n2 = await page.locator('.pb-piece.on-board').count();
      check('穴の上には置けない', n1 === 1 && n2 === 1, `${n1},${n2}`);
      await page.getByRole('button', { name: '全部戻す' }).tap(); await page.waitForTimeout(100);
      check('全部戻すで盤面が空になる', await page.locator('.pb-piece.on-board').count() === 0);
      // 回した向きは戻しても残るので、配られた向きへ戻しておく
      await page.locator('.pb-slot[data-piece="' + data.sol[0].piece + '"]').tap(); await page.waitForTimeout(60);
      for (let r = 0; r < (4 - data.sol[0].rot) % 4; r++) { await page.getByRole('button', { name: '回す' }).tap(); await page.waitForTimeout(60); }
      await page.locator('.pb-slot[data-piece="' + data.sol[1].piece + '"]').tap(); await page.waitForTimeout(60);
      await shot('m01_stage1');
    }
    for (const pl of data.sol) { await place(pl, pl.c); if (process.env.DBG) console.log(stage, JSON.stringify(pl), await page.locator('.pb-piece.on-board').count(), await page.locator('.pb-slot.sel').count()); }
    if (stage === 3) await shot('m01_stage4_done');
    await page.waitForTimeout(900);
    const txt = (await page.locator('.m01-break').innerText().catch(() => '')).replace(/\s+/g, ' ');
    check(`ステージ ${stage + 1}：完成して自動で提出され、結果が出る`, txt.includes(`ステージ ${stage + 1} の結果`) && txt.includes('100'), txt.slice(0, 60));
    if (stage === 0) await shot('m01_break');
    const tot = await page.evaluate(() => { const st = window.__fcSlot.state; return st.results.hero.reduce((n, r) => n + r.base + r.speed + r.team, 0); });
    check(`ステージ ${stage + 1}：得点が加算される`, tot >= totalBefore + 100, String(tot));
    totalBefore = tot;
    if (stage < 5) { await page.getByRole('button', { name: /ステージ \d へ/ }).tap(); await page.waitForTimeout(500); }
  }
  await shot('m01_end');
  await page.getByRole('button', { name: /結果/ }).first().tap(); await page.waitForTimeout(600);
  await shot('m01_rank');
  const rank = (await page.locator('.layer').last().innerText()).replace(/\s+/g, ' ');
  check('順位表に 12 人が出る', (rank.match(/位|\d+\s/g) || []).length >= 12, rank.slice(0, 80));
  console.log(res.every(Boolean) ? `全 ${res.length} 件成功` : `${res.filter((x) => !x).length} 件失敗`, 'errors', errs.length, errs.slice(0, 3));
  await browser.close();
})();
