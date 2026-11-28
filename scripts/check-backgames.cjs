// 裏ゲーム 2 系統（生活棟：賢者の金庫、監獄棟：影の対戦者）の確認。npm run build の後、sh scripts/with-preview.sh node scripts/check-backgames.cjs [写真の保存先]
// 開発者メニューの「裏ゲーム 2 系統の検証」から始める。調べる所は行動ボタンと同じ処理（G.interact）で調べ、そのあとの画面はタップで進める。
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : null;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const res = []; const check = (n, ok, d = '') => { res.push(!!ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  const shot = async (n) => { if (out) await page.screenshot({ path: `${out}/bg_${n}.png` }); };
  const W = (ms) => page.waitForTimeout(ms);
  const S = () => page.evaluate(() => { const s = window.__fc.G.state; return { room: s.actors.hero.pos.room, pieces: s.actors.hero.pieces, flags: { ...s.flags }, claimed: [...s.claimed], bg: JSON.parse(JSON.stringify(s.backGames || null)), match: !!s.match }; });
  const st = () => page.evaluate(() => { const s = window.__fcSlot && window.__fcSlot.state; return s ? JSON.parse(JSON.stringify(s)) : null; });
  const hint = () => page.evaluate(() => window.__fcHint && window.__fcHint());
  const body = () => page.locator('body').innerText();
  const open = async (label) => {
    await page.goto('http://localhost:4173/FALSE-CROWN/'); await W(1500);
    await page.getByText('開発者メニュー').tap(); await W(400);
    await page.getByRole('button', { name: label }).tap(); await W(2500);
  };
  const inspect = async (insId) => {
    await page.evaluate((insId) => { const { G, rooms } = window.__fc; const r = rooms[G.state.actors.hero.pos.room]; const ins = r.inspects.find((i) => i.id === insId); G.interact({ kind: 'inspect', ins }); }, insId);
    await W(500);
  };
  const tap = async (name, timeout = 8000) => { const b = page.getByRole('button', { name }); await b.last().waitFor({ timeout }); await b.last().tap(); await W(400); };
  const shut = async () => !(await page.locator('.layer .panel, .dlg-screen').count());
  const advance = async (until, max = 20) => {
    for (let i = 0; i < max; i++) {
      if (await until()) return true;
      const b = page.getByRole('button', { name: /^(次へ|閉じる|OK|進む|結果へ進む)$/ });
      if (await b.count()) await b.last().tap(); else await page.touchscreen.tap(422, 300);
      await W(400);
    }
    return until();
  };
  const skipTut = async () => { const sk = page.getByRole('button', { name: /飛ばす|スキップ/ }); if (await sk.count()) { await sk.first().tap(); await W(900); } };
  const notebook = async () => { await page.getByRole('button', { name: /手帳/ }).first().tap(); await W(400); };
  const oddTab = () => page.getByRole('button', { name: '気になること', exact: true });
  const closeBook = async () => { await page.locator('.panel.book').getByRole('button', { name: /閉じる/ }).first().tap(); await W(400); };
  const tiles = async (xs) => { for (const x of xs) { await page.locator(`.bg-tile[data-tile="${x}"]`).first().tap(); await W(120); } };

  // ---- 生活棟：手掛かり無しの朝。手帳に欄が無い → 遊戯室の空箱を調べると欄ができる ----
  await open('DAY1 朝・遊戯室（手掛かり無し）');
  await advance(shut, 6);
  await notebook();
  check('手掛かりに気づく前は、手帳に「気になること」の欄が無い', !(await oddTab().count()));
  await closeBook();
  await inspect('game_shelf');
  await advance(shut, 6);
  await notebook();
  check('遊戯室の王冠の空箱を調べると、「気になること」の欄ができる', (await oddTab().count()) === 1);
  await oddTab().tap(); await W(300);
  const t1 = await page.locator('.panel.book').innerText();
  check('1 つ目の手掛かりと、まだほかにある旨。確かめるは押せない', t1.includes('王冠は、いちばん前にも') && t1.includes('ほかにも') && await page.getByRole('button', { name: '確かめる' }).isDisabled());
  await shot('odd_one');
  await closeBook();

  // ---- 生活棟：3 つそろった状態でパズル → 本棚 → 金庫 ----
  await open('DAY2 朝・リビング（生活棟の手掛かり 3 つ）');
  await advance(shut, 6);
  await notebook(); await oddTab().tap(); await W(300);
  await tiles(['♛', '☾', '★', '☀']);
  await tap('確かめる'); await W(300);
  check('違う並び：食い違う手掛かりに × が付く', (await page.locator('.bg-clue.miss').count()) === 1);
  await shot('odd_wrong');
  await tap('並べ直す');
  await tiles(['☾', '★', '♛', '☀']);
  await tap('確かめる'); await W(400);
  check('正しい並び：並べ方が分かった', (await body()).includes('並べ方が分かった'));
  await shot('odd_solved');
  await advance(async () => (await page.locator('.bg-wing').count()) > 0 && !(await page.locator('.panel.dialog').count()), 4);
  let s = await S();
  check('解放（挑戦権）が記録され、報酬はまだ', s.bg.living.unlockedDay === 2 && s.bg.living.rewardDay === null && s.bg.prison.unlockedDay === null);
  await closeBook();
  await inspect('living_bookcase');
  await advance(async () => (await page.getByRole('button', { name: '押す' }).count()) > 0, 4);
  await tap('押す');
  await advance(async () => (await page.getByRole('button', { name: '挑戦する' }).count()) > 0, 4);
  const conf = await body();
  check('挑戦の前に、時間（15 分）と報酬（3 ピース、1 回だけ）を出す', conf.includes('15 分') && conf.includes('3 ピース') && conf.includes('1 回だけ'));
  await shot('live_confirm');
  const p0 = s.pieces;
  await tap('挑戦する'); await W(600);
  await skipTut();
  const mv = await hint();
  for (const d of mv.code) { await page.locator(`.match .sg-key[data-key="${d}"]`).tap(); await W(40); }
  await page.locator('.match .sg-ok').tap(); await W(800);
  await advance(async () => (await body()).includes('賢者の金庫　結果'), 6);
  await shot('live_result');
  check('金庫が開き、3 ピースを受け取る', (await body()).includes('3 ピースを受け取った'));
  await advance(shut, 6);
  s = await S();
  check('報酬受領済み。ピースが 3 増える', s.pieces === p0 + 3 && s.bg.living.rewardDay === 2 && s.claimed.includes('bg:living:reward'));
  await inspect('living_bookcase');
  await advance(async () => (await page.getByRole('button', { name: '腕試しをする' }).count()) > 0, 4);
  check('2 回目は腕試し（報酬なし、時間は先に出す）', (await body()).includes('腕試し') && (await body()).includes('15 分'));
  await shot('live_practice');
  await tap('やめる');

  // ---- 監獄棟：手帳で図形を並べる → 銘板 → 第零牢 → 影の対戦者 ----
  await open('DAY3 朝・共同牢（監獄棟の手掛かり 3 つ）');
  await advance(shut, 6);
  await notebook(); await oddTab().tap(); await W(300);
  await tiles(['●', '◆', '■', '▲']);
  const digits = await page.locator('.bg-slots').innerText();
  check('並べた図形の下に数字が出る（4 2 3 1）', digits.replace(/\s+/g, '').includes('●4◆2■3▲1'), digits.replace(/\s+/g, ' '));
  await tap('確かめる'); await W(400);
  check('合図が分かった（4231）', (await body()).includes('4231'));
  await shot('prison_solved');
  await advance(async () => !(await page.locator('.panel.dialog').count()), 4);
  await closeBook();
  s = await S();
  check('監獄棟は、生活棟を解かずに解放できる', s.bg.prison.unlockedDay === 3 && s.bg.living.unlockedDay === null);
  await inspect('cells_plate');
  await advance(async () => (await page.getByRole('button', { name: '回す' }).count()) > 0, 4);
  await tap('回す');
  await advance(shut, 6);
  s = await S();
  check('銘板を回すと、第零牢への道が開く', s.flags.h04_open === true && s.bg.prison.openedDay === 3);
  await shot('prison_open');
  await page.evaluate(() => { const { G, sim } = window.__fc; sim.placeIn(G.state, 'hero', 'cell_zero'); });
  await W(600);
  await inspect('zero_letters');
  await advance(async () => (await page.getByRole('button', { name: '挑戦する' }).count()) > 0, 4);
  const pc = await body();
  check('影の対戦者の確認：25 分、参加費なし、3 ピース', pc.includes('25 分') && pc.includes('参加費はありません') && pc.includes('3 ピース'));
  await tap('挑戦する'); await W(600);
  await skipTut();
  await W(800);
  const ms = await st();
  check('盤面は矢じりの配置、点は上下の端の合図のマス', ms && ms.pieces.length === 6 && (await page.locator('.pz7.h06 .pzb-cell.center').count()) === 2);
  await shot('h06_board');

  const bad = errs.filter((e) => !/favicon|Failed to load resource/.test(e));
  check('エラーが出ない', !bad.length, bad.slice(0, 3).join(' | '));
  await browser.close();
  console.log(res.every(Boolean) ? 'ALL OK' : 'SOME FAILED');
  process.exit(res.every(Boolean) ? 0 : 1);
})();
