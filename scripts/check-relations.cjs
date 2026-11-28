// 手帳「関係一覧」の確認。npm run build の後に sh scripts/with-preview.sh node scripts/check-relations.cjs [写真の保存先]
const { chromium, devices } = require('playwright');
(async () => {
  const out = process.argv[2] || null;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13 landscape'] });
  const page = await ctx.newPage();
  const errs = []; page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); page.on('pageerror', (e) => errs.push(String(e)));
  const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  const shot = async (n) => { if (out) await page.screenshot({ path: `${out}/${n}.png` }); };
  const K = 'npc_02_kanzaki', M = 'npc_04_mido', S = 'npc_05_shiraishi', KI = 'npc_06_kiryu';
  await page.goto('http://localhost:4173/FALSE-CROWN/'); await page.waitForTimeout(1500);
  await page.getByText('開発者メニュー').tap(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: '生活棟 廊下', exact: true }).tap(); await page.waitForTimeout(900);
  for (const n of ['断る', '何でもない', 'OK']) { const b = page.getByRole('button', { name: n, exact: true }); if (await b.count()) { await b.first().tap(); await page.waitForTimeout(300); } }
  // 主人公の知っていることを用意する（推定の好意、約束、目撃、噂）。NPC どうしの内部の同盟も入れておく（表示されてはいけない）
  await page.evaluate(({ K, M, S, KI }) => {
    const { G, sim } = window.__fc; const s = G.state;
    for (const [id, a] of Object.entries(s.actors)) { if (id === 'hero') continue; a.talkCd = { hero: 1e15 }; a.nextThink = 1e15; a.busyUntil = 1e15; }
    sim.placeIn(s, 'hero', 'bedroom_hero');
    for (const id of [K, M, S, KI]) { s.flags[`heroMet_${id}`] = true; s.flags[`estSeen_${id}`] = true; }
    s.flags[`est_${K}`] = 25; s.flags[`est_${M}`] = -20; s.flags[`est_${S}`] = 10; s.flags[`est_${KI}`] = 0;
    const base = { day: s.day, payNow: 0, payOnSuccess: 0, untilDay: s.day + 1, status: 'active', witnesses: [], createdAt: 0 };
    s.deals.push({ ...base, id: 'c1', from: 'hero', to: K, kind: 'alliance' });
    s.deals.push({ ...base, id: 'c2', from: S, to: 'hero', kind: 'pledge', untilDay: s.day + 2 });
    s.deals.push({ ...base, id: 'c3', from: 'hero', to: KI, kind: 'loan', payNow: -2, payOnSuccess: 3 });
    s.deals.push({ ...base, id: 'c4', from: M, to: S, kind: 'alliance' });
    const add = (id, text, about, tags, kind = 'rumor') => { s.infos[id] = { id, kind, text, truth: true, about, day: s.day, source: 'world', value: 1, tags }; };
    add('i1', 'リチャードが、クロエの個室に入っていった。', [S, M], ['sighting']);
    add('i2', 'レオンとマイクが、何か約束を交わしていた。', [K, KI], ['deal'], 'deal');
    s.actors.hero.knows.i1 = { conf: 1, from: 'self', day: s.day };
    s.actors.hero.knows.i2 = { conf: 0.5, from: S, day: s.day };
  }, { K, M, S, KI });
  const snap = () => page.evaluate(() => { const s = window.__fc.G.state; return JSON.stringify({ d: s.deals, k: s.actors.hero.knows, f: s.flags, i: Object.keys(s.infos).length }); });
  const before = await snap();
  await page.getByRole('button', { name: /手帳/ }).tap(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: '関係一覧', exact: true }).tap(); await page.waitForTimeout(500);
  const txt = (await page.locator('.layer').last().innerText()).replace(/\s+/g, ' ');
  check('列の見出し', ['人物', '親密度〈推定〉', '協力関係', '約束', '所属'].every((x) => txt.includes(x)), txt.slice(0, 200));
  check('好意と信用は別という説明', txt.includes('好意と信用は別'));
  check('全員の行がある', (await page.locator('.rl-row:not(.rl-head)').count()) === 11);
  check('未確認と 5 段階', txt.includes('未確認') && txt.includes('好意的') && txt.includes('冷たい'));
  check('協力と約束の要約', txt.includes('同盟（DAY') && txt.includes('次は協力しよう') && txt.includes('3ピース返す'));
  await shot('rel_list');
  // 顔アイコン：丸枠の中に顔の箱が収まっている（切り抜きの指定がある）
  const crops = await page.locator('.rl-row .face').evaluateAll((els) => els.map((e) => ({ crop: e.classList.contains('face-crop'), w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height })));
  check('顔アイコンは人物ごとの切り抜き', crops.length === 11 && crops.every((c) => c.crop && Math.abs(c.w - c.h) < 1), JSON.stringify(crops.slice(0, 2)));
  // 並べ替え
  await page.getByRole('button', { name: '親密度順', exact: true }).tap(); await page.waitForTimeout(400);
  const order = await page.locator('.rl-row:not(.rl-head) .rl-who b').allInnerTexts();
  check('親密度順で推定の高い人が先頭', order[0].includes('レオン'), order.slice(0, 4).join(','));
  await shot('rel_sorted');
  // 絞り込み
  await page.getByRole('button', { name: '協力中', exact: true }).tap(); await page.waitForTimeout(400);
  const co = await page.locator('.rl-row:not(.rl-head)').count();
  check('協力中で絞り込み', co === 1, String(co));
  await page.getByRole('button', { name: '協力中', exact: true }).tap(); await page.getByRole('button', { name: '約束あり', exact: true }).tap(); await page.waitForTimeout(400);
  const pr = await page.locator('.rl-row:not(.rl-head)').count();
  check('約束ありで絞り込み', pr === 2, String(pr));
  await page.getByRole('button', { name: '約束あり', exact: true }).tap(); await page.waitForTimeout(300);
  // 縦スクロールできる
  const sc = await page.locator('.book .scroll').first().evaluate((e) => ({ sh: e.scrollHeight, ch: e.clientHeight, oy: getComputedStyle(e).overflowY }));
  check('縦スクロール', sc.sh > sc.ch && sc.oy === 'auto', JSON.stringify(sc));
  // 詳細
  await page.locator('.rl-row', { hasText: 'クロエ' }).tap(); await page.waitForTimeout(500);
  const det = (await page.locator('.rl-dialog').innerText()).replace(/\s+/g, ' ');
  check('人物詳細と約束の詳細', det.includes('次は協力しよう') && det.includes('必ず守るとは限りません') && det.includes('目撃'), det.slice(0, 240));
  check('NPC どうしの内部の同盟は出ない', !det.includes('同盟（') && !txt.includes('リチャードと同盟'));
  await shot('rel_detail');
  await page.getByRole('button', { name: '閉じる', exact: true }).last().tap(); await page.waitForTimeout(300);
  // 他の人どうし
  await page.getByRole('button', { name: '他の人どうし', exact: true }).tap(); await page.waitForTimeout(400);
  const oth = (await page.locator('.layer').last().innerText()).replace(/\s+/g, ' ');
  check('他の人どうし：出所と確かさ', oth.includes('目撃') && oth.includes('確か') && oth.includes('噂（クロエから）') && oth.includes('未確認') && (await page.locator('.rl-other').count()) === 2, oth.slice(0, 200));
  await shot('rel_others');
  check('一覧を開いても状態は変わらない', (await snap()) === before);
  console.log(res.every(Boolean) ? `全 ${res.length} 件成功` : `${res.filter((x) => !x).length} 件失敗`, 'errors', errs.length, errs.slice(0, 3));
  await browser.close();
  process.exit(res.every(Boolean) ? 0 : 1);
})();
