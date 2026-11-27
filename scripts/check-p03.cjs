// P03（スピードカード）を画面の操作だけで最後まで遊ぶ確認。npm run build と npx vite preview --port 4173 の後に実行する。
// node scripts/check-p03.cjs [スクリーンショットの保存先]
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2] || null;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  const shot = async (n) => { if (out) await page.screenshot({ path: `${out}/${n}.png` }); };
  const fits = (a, b) => Math.abs(a - b) === 1;
  /** 画面に見えている手札と場札を読む */
  const read = () => page.evaluate(() => ({
    hand: [...document.querySelectorAll('.match .sc-hand .sc-card, .tut .sc-hand .sc-card')].map((e) => Number(e.dataset.v)),
    piles: [...document.querySelectorAll('.match .sc-pile .sc-card, .tut .sc-pile .sc-card')].map((e) => Number(e.dataset.v)),
    swap: document.querySelectorAll('.sc-pile.refresh').length > 0, locked: !!document.querySelector('.sc.locked'), note: document.querySelector('.sc-note')?.textContent ?? '',
  }));
  /** 1 手を画面の操作で行う */
  const doAct = async (a) => {
    const s = await read();
    if (a.k === 'r') { await page.locator('.sc-pile').nth(a.pile).tap(); await page.waitForTimeout(70); return; }
    const i = s.hand.indexOf(a.v);
    await page.locator('.sc-hand .sc-card').nth(i).tap(); await page.waitForTimeout(60);
    if (fits(a.v, s.piles[0]) && fits(a.v, s.piles[1])) { await page.locator('.sc-pile').nth(a.pile).tap(); await page.waitForTimeout(60); }
  };
  await page.goto('http://localhost:4173/FALSE-CROWN/'); await page.waitForTimeout(1500);
  await page.getByText('開発者メニュー').tap(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: /P03 スピード/ }).tap(); await page.waitForTimeout(600);
  let maxLen = 0;
  for (let i = 0; i < 3; i++) { maxLen = Math.max(maxLen, (await page.locator('.tut-text').innerText()).length); if (i < 2) await shot(`p03_tut${i + 1}`); await page.getByRole('button', { name: /次へ|練習へ/ }).tap(); await page.waitForTimeout(250); }
  check('説明は段階表示で、1 画面の文は 70 文字以内', maxLen > 0 && maxLen <= 70, String(maxLen));
  // 練習：出せるカードを出していく（置き換えが出たら左の場札を置き換える）
  await shot('p03_practice');
  for (let n = 0; n < 40; n++) {
    const s = await read();
    if (s.locked) break;
    if (s.swap) { await doAct({ k: 'r', pile: 0 }); continue; }
    const v = s.hand.find((c) => fits(c, s.piles[0]) || fits(c, s.piles[1]));
    if (v === undefined) break;
    await doAct({ k: 'p', v, pile: fits(v, s.piles[0]) ? 0 : 1 });
  }
  check('練習：操作できて、終わりまで進む', (await read()).locked, (await page.locator('.tut-text').innerText()).slice(0, 20));
  await page.getByRole('button', { name: /本番へ/ }).tap(); await page.waitForTimeout(800);
  let total = 0;
  for (let round = 0; round < 3; round++) {
    const first = await read();
    if (round === 0) {
      check('本番の画面に、手札 4 枚、場札 2 枚、山札、予備がある', first.hand.length === 4 && first.piles.length === 2 && await page.locator('.match .sc-stack').count() === 2);
      // 出せないカードをタップしても、何も起きない
      const bad = first.hand.findIndex((c) => !fits(c, first.piles[0]) && !fits(c, first.piles[1]));
      if (bad >= 0) { await page.locator('.sc-hand .sc-card').nth(bad).tap(); await page.waitForTimeout(120); const s2 = await read(); check('出せないカードは出せない', JSON.stringify(s2.hand) === JSON.stringify(first.hand) && JSON.stringify(s2.piles) === JSON.stringify(first.piles)); }
      // 出せるカードがある間は、場札をタップしても置き換えにならない
      if (!first.swap) { await page.locator('.sc-pile').nth(0).tap(); await page.waitForTimeout(100); check('出せる間は、置き換えできない', JSON.stringify((await read()).piles) === JSON.stringify(first.piles)); }
      await shot('p03_round1');
    }
    // 開発版の検証用に、生成時に確かめた「出し切れる手順」を読み、同じ操作を画面で行う（製品版にこの参照は無い）。ラウンド 2 は途中で時間切れにする
    const sol = await page.evaluate(() => { const st = window.__fcSlot.state; const l = st.layouts[st.round];
      const fits = (a, b) => Math.abs(a - b) === 1; const dead = new Set(); const acts = [];
      const rec = (t) => { if (t.played >= l.deck.length) return true; const key = [t.at, [...t.hand].sort((a, b) => a - b), [...t.piles].sort((a, b) => a - b), t.ref].join('|'); if (dead.has(key)) return false;
        const opts = []; for (const v of new Set(t.hand)) for (const p of [0, 1]) if (fits(v, t.piles[p])) opts.push({ k: 'p', v, pile: p });
        if (!opts.length && t.ref < 8 && t.hand.length) opts.push({ k: 'r', pile: 0 }, { k: 'r', pile: 1 });
        for (const a of opts) { const n = { hand: [...t.hand], piles: [...t.piles], at: t.at, ref: t.ref, played: t.played };
          if (a.k === 'p') { const i = n.hand.indexOf(a.v); n.piles[a.pile] = a.v; if (n.at < l.deck.length) n.hand[i] = l.deck[n.at++]; else n.hand.splice(i, 1); n.played++; } else n.piles[a.pile] = l.reserve[n.ref++];
          acts.push(a); if (rec(n)) return true; acts.pop(); }
        dead.add(key); return false; };
      rec({ hand: l.deck.slice(0, 4), piles: [...l.piles], at: 4, ref: 0, played: 0 }); return acts; });
    const upto = round === 1 ? 9 : sol.length;
    let playedCards = 0;
    for (let i = 0; i < upto; i++) { await doAct(sol[i]); if (sol[i].k === 'p') playedCards++; if (round === 0 && i === 6) await shot('p03_round1_mid'); }
    if (round === 1) { await page.evaluate(() => { window.__fcSlot.stageLeft = 600; }); await page.waitForTimeout(1500); } else await page.waitForTimeout(1400);
    const st = await page.evaluate(() => { const s = window.__fcSlot.state; const r = s.results.hero; return { n: r.length, last: r[r.length - 1], total: r.reduce((a, x) => a + x.points, 0), phase: s.phase }; });
    const want = playedCards * 2 + (playedCards === 24 ? 8 : 0);
    check(`ラウンド ${round + 1}：${playedCards} 枚で ${want} 点${round === 1 ? '（時間切れ。そこまでの枚数）' : '（出し切ると自動で提出）'}`, st.n === round + 1 && st.last.points === want && st.last.played === playedCards, JSON.stringify(st.last));
    total = st.total;
    if (round < 2) {
      const txt = (await page.locator('.p01-break').innerText()).replace(/\s+/g, ' ');
      check(`ラウンド ${round + 1} の後：休憩の画面に結果が出る`, txt.includes(`ラウンド ${round + 1} まで終了`) && txt.includes(String(want)), txt.slice(0, 50));
      if (round === 0) await shot('p03_break');
      await page.getByRole('button', { name: new RegExp(`ラウンド ${round + 2} へ`) }).tap(); await page.waitForTimeout(700);
    }
  }
  await shot('p03_done');
  const fin = (await page.locator('.match').innerText()).replace(/\s+/g, ' ');
  check('終了：最終結果と順位が出る', fin.includes('終了') && fin.includes(String(total)), fin.slice(0, 80));
  check('画面のエラーなし', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
  console.log(res.every(Boolean) ? 'ALL OK' : 'SOME FAILED');
  process.exit(res.every(Boolean) ? 0 : 1);
})();
