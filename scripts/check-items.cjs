// 結果画面の報酬表示と、手帳「アイテム」タブの確認。npm run build の後に sh scripts/with-preview.sh node scripts/check-items.cjs [写真の保存先]
const { chromium, devices } = require('playwright');
(async () => {
  const out = process.argv[2] || null;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13 landscape'] });
  const page = await ctx.newPage();
  const errs = []; page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); page.on('pageerror', (e) => errs.push(String(e)));
  const res = []; const check = (n, ok, d = '') => res.push(`${ok ? 'OK ' : 'NG '} ${n}${d ? `（${d}）` : ''}`);
  const shot = async (n) => { if (out) await page.screenshot({ path: `${out}/${n}.png` }); };
  await page.goto('http://localhost:4173/FALSE-CROWN/'); await page.waitForTimeout(1500);
  await page.getByText('開発者メニュー').tap(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: '生活棟 廊下', exact: true }).tap(); await page.waitForTimeout(900);
  for (const n of ['断る', '何でもない', 'OK']) { const b = page.getByRole('button', { name: n, exact: true }); if (await b.count()) { await b.first().tap(); await page.waitForTimeout(300); } }

  // DAY1：主人公が 1 位。メダルを使って 1 人救う。NPC との受け渡しも入れる
  const day1 = await page.evaluate(() => {
    const { G, core, sim } = window.__fc; const s = G.state;
    for (const [id, a] of Object.entries(s.actors)) { if (id === 'hero') continue; a.talkCd = { hero: 1e15 }; a.nextThink = 1e15; a.busyUntil = 1e15; }
    sim.placeIn(s, 'hero', 'bedroom_hero');
    const alive = Object.values(s.actors).filter((a) => a.alive).map((a) => a.id);
    const ranking = ['hero', ...alive.filter((p) => p !== 'hero')];
    const r = core.applyMainResult(s, ranking, Object.fromEntries(ranking.map((p, i) => [p, 100 - i * 7])));
    const before = JSON.stringify(Object.fromEntries(alive.map((p) => [p, s.actors[p].pieces])));
    const m = core.issueMedal(s);
    const { prison, lowestLiving } = core.provisional(s);
    core.applyRescue(s, 'hero', prison[0]);
    const after = JSON.stringify(Object.fromEntries(alive.map((p) => [p, s.actors[p].pieces])));
    core.transfer(s, 'hero', ranking[2], 2, '情報の代金');
    core.transfer(s, ranking[3], 'hero', 1, '貸したピースの返済');
    return { ranking, rewards: r.rewards, balances: r.balances, prison: r.prison, holder: m.holder, rescued: prison[0], swapped: lowestLiving, same: before === after };
  });
  check('救済で入れ替わってもピースは変わらない', day1.same);
  check('監獄棟の人の獲得は 0', day1.prison.every((p) => day1.rewards[p] === 0));
  check('入れ替えられた人の報酬は残る', day1.rewards[day1.swapped] > 0, String(day1.rewards[day1.swapped]));

  // 結果画面（DAY1 の数字で表示）
  await page.evaluate((d) => {
    const { G } = window.__fc;
    void G.ui.rankingScreen({ title: 'DAY 1　メインマッチ結果', ranking: d.ranking, scores: Object.fromEntries(d.ranking.map((p, i) => [p, 100 - i * 7])), rewards: d.rewards, balances: d.balances, cut: 4, cutLabel: '監獄棟（仮）', notes: [] });
  }, day1);
  await page.waitForTimeout(1500);
  const rows = await page.locator('.rank-list.with-pieces .rank').evaluateAll((els) => els.map((e) => ({ id: e.getAttribute('data-id'), gain: e.querySelector('.gain')?.textContent, bal: e.querySelector('.bal')?.textContent })));
  check('全員の行に獲得と残高がある', rows.length === 12 && rows.every((r) => r.gain && r.bal), JSON.stringify(rows.slice(0, 2)));
  check('監獄棟の行は +0', rows.slice(-4).every((r) => r.gain === '+0'), rows.slice(-4).map((r) => r.gain).join(','));
  check('残高は報酬直後の値', rows.every((r) => Number(r.bal) === day1.balances[r.id]));
  const rtxt = (await page.locator('.layer').last().innerText()).replace(/\s+/g, ' ');
  check('自分の要約（順位・獲得・残高）', rtxt.includes(`あなたは 1 位 獲得 ${day1.rewards.hero} ピース 獲得後の残高 ${day1.balances.hero} ピース`), rtxt.slice(0, 160));
  check('見出し', ['順位', '獲得', '残高', '得点'].every((x) => rtxt.includes(x)));
  check('報酬は救済で変わらないという説明', rtxt.includes('報酬は変わりません'));
  const over = await page.locator('.rank-list .rank').evaluateAll((els) => els.some((e) => e.scrollWidth > e.clientWidth + 1));
  check('行がはみ出していない', !over);
  await shot('result_rewards');
  await page.getByRole('button', { name: '次へ', exact: true }).last().tap(); await page.waitForTimeout(500);

  // DAY2：もう一度 1 位。メダルは持ったまま（所持中）
  await page.evaluate(() => {
    const { G, core } = window.__fc; const s = G.state;
    core.endDay(s);
    const alive = Object.values(s.actors).filter((a) => a.alive).map((a) => a.id);
    core.applyMainResult(s, ['hero', ...alive.filter((p) => p !== 'hero')], {});
    core.issueMedal(s);
  });
  const snap = () => page.evaluate(() => { const s = window.__fc.G.state; return JSON.stringify({ r: s.today.rescue, h: s.history.map((x) => x.rescue), p: s.actors.hero.pieces, f: s.facts.length }); });
  const before = await snap();
  await page.getByRole('button', { name: /手帳/ }).tap(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'アイテム', exact: true }).tap(); await page.waitForTimeout(500);
  const txt = (await page.locator('.layer').last().innerText()).replace(/\s+/g, ' ');
  const hero = await page.evaluate(() => window.__fc.G.state.actors.hero.pieces);
  check('残高が今の所持数', txt.includes(`残高 ${hero}`), txt.slice(0, 120));
  check('履歴に報酬・支払い・受け取り', ['DAY1 メインマッチ報酬', 'DAY2 メインマッチ報酬', '情報の代金', '貸したピースの返済'].every((x) => txt.includes(x)));
  const ledger = await page.locator('.item-row:not(.head)').count();
  check('履歴の行数', ledger === 4, String(ledger));
  check('メダル：所持中と使用済み', txt.includes('所持中') && txt.includes('使用済み') && txt.includes('所持 1 使用済み 1'));
  check('メダル：期限', txt.includes('期限：DAY 2 の結果発表の場まで'));
  check('メダル：使った相手', txt.includes('を救い、代わりに'));
  check('メダル：使用条件', ['結果発表の直後だけ', '自分には使えません', '順位報酬は変わりません'].every((x) => txt.includes(x)));
  check('使うボタンが無い', (await page.locator('.layer').last().getByRole('button', { name: /使う/ }).count()) === 0);
  await shot('items_tab');
  await page.locator('.layer .scroll').last().evaluate((e) => { e.scrollTop = e.scrollHeight; }); await page.waitForTimeout(300);
  await shot('items_tab_medal');
  check('開いても状態は変わらない', before === (await snap()));
  check('コンソールにエラーなし', errs.length === 0, errs.slice(0, 2).join(' / '));
  console.log(res.join('\n'));
  await browser.close();
  process.exit(res.some((r) => r.startsWith('NG')) ? 1 : 0);
})();
