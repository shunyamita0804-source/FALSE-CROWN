// 音声付きの競技説明（M01）を指の操作で確かめる。npm run build の後、sh scripts/with-preview.sh node scripts/check-voicetut.cjs [写真の保存先]
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2] || null;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  // IPHONE=1 で、ノッチのある iPhone（932×430、左右 59・下 21 の余白）を再現する
  const notch = !!process.env.IPHONE;
  const ctx = await browser.newContext({ viewport: notch ? { width: 932, height: 430 } : { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  if (notch) await page.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '#safe-probe{padding:0 59px 21px 59px !important}'; document.head.append(st); setTimeout(() => window.dispatchEvent(new Event('resize')), 50); }); });
  const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const res = []; const check = (n, ok, d = '') => { res.push(!!ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  const shot = async (n) => { if (out) await page.screenshot({ path: `${out}/vt_${n}.png` }); };
  const W = (ms) => page.waitForTimeout(ms);
  const title = () => page.locator('.vt-title').innerText();
  const sub = () => page.locator('.vt-line').innerText();
  const subShown = () => page.locator('.vt-subtext').innerText();
  const waitReady = async (ms = 15000) => { await page.locator('.vt-next.ready').waitFor({ timeout: ms }); };
  const next = async () => { await page.locator('.vt-next').tap(); await W(500); };
  const voicePlaying = () => page.evaluate(() => window.__fc.Sound.voicePlaying);

  await page.goto('http://localhost:4173/FALSE-CROWN/'); await W(1500);
  await page.evaluate(() => localStorage.removeItem('false-crown/tutorial-seen'));
  await page.getByText('開発者メニュー').tap(); await W(400);
  await page.getByRole('button', { name: /M01 ピース/ }).tap(); await W(700);
  check('ゲームマスターの立ち絵と説明の枠が出る', await page.locator('.vt-gm').count() === 1 && await page.locator('.vt').count() === 1);
  check('競技名を大きく出す', (await page.locator('.vt-titlecard').innerText()).includes('ピース・アセンブル'));
  check('初めての時も、説明全体を飛ばすボタンがある', await page.locator('.vt-skipall').count() === 1);
  await W(600);
  const partial = await subShown();
  check('声が鳴っている間、字幕は少しずつ出る', (await voicePlaying()) && partial.length < (await sub()).length, `${partial.length}/${(await sub()).length}`);
  await shot('01_title');
  await waitReady();
  check('声が終わると字幕は台本の全文になる', (await subShown()) === '第1競技、ピース・アセンブル。');
  check('声が終わると、BGM の音量が戻る（声は鳴っていない）', !(await voicePlaying()));
  await next();
  // 基本のルール：置き場と枠を順に目立たせる
  await W(500);
  const hlTray = await page.locator('.pb-tray.vt-hl').count();
  await W(2600);
  const hlBoard = await page.locator('.pb-board.vt-hl').count();
  check('説明に合わせて、置き場、枠の順に目立たせる', hlTray === 1 && hlBoard === 1, `${hlTray} ${hlBoard}`);
  await shot('02_rules');
  // 聞き直し：字幕が最初から出直す
  await page.locator('.vt-replay').tap(); await W(400);
  check('「聞き直す」で、声と字幕が最初から出直す', (await voicePlaying()) && (await subShown()).length < (await sub()).length);
  await page.locator('.vt-toggle').tap(); await W(300);
  check('「声を止める」で声が止まり、字幕は全文になる', !(await voicePlaying()) && (await subShown()) === (await sub()));
  await next();
  // 操作：選んで回す → 枠に置く。操作が済むと次へ進む
  check('操作の段階では、やることを一言で出す', (await page.locator('.vt-prompt.on').innerText()).includes('回す'));
  await page.locator('.pb-slot[data-piece="0"]').tap(); await W(150);
  await page.getByRole('button', { name: '回す' }).tap(); await W(400);
  check('回すと、次は「置いてみよう」に変わる', (await page.locator('.vt-prompt').innerText()).includes('置いて'));
  await shot('03_controls');
  await page.getByRole('button', { name: '回す' }).tap(); await W(150);
  await page.getByRole('button', { name: '回す' }).tap(); await W(150);
  await page.getByRole('button', { name: '回す' }).tap(); await W(150);
  const bb = await page.locator('.pb-board').boundingBox();
  await page.touchscreen.tap(bb.x + bb.width * 0.15, bb.y + bb.height * 0.2); await W(400);
  const placed = await page.locator('.pb-board .pb-piece').count();
  check('ピースを枠に置ける', placed >= 1, String(placed));
  await page.waitForFunction(() => document.querySelector('.vt-title')?.textContent === '組とステージ', null, { timeout: 15000 }).catch(() => null);
  check('操作が済み、声も終わると、自動で次の説明へ進む', (await title()) === '組とステージ');
  await shot('04_format');
  check('組の図は 4 人ずつ 3 組', await page.locator('.vt-group').count() === 3 && await page.locator('.vt-group .face').count() === 12);
  await waitReady(); await next();
  // 収録に無い決まり：字幕と図だけ（声は鳴らさない）
  check('収録に無い決まり（休憩、組替え）の段階がある', (await title()) === '休憩と組替え');
  check('この段階は声を鳴らさず、字幕で説明する', !(await voicePlaying()));
  await W(300); await shot('04b_between');
  check('組替えの前と後の組を図で出す', await page.locator('.vt-regroup').count() === 2 && await page.locator('.vt-regroup .face').count() === 24);
  await waitReady();
  check('字幕に休憩の秒数と組替えが出る', (await subShown()).includes('20秒') && (await subShown()).includes('組が入れ替わり'));
  await next();
  await shot('05_scoring'); await waitReady(); await next();
  await W(5000); await shot('06_team'); await waitReady(); await next();
  check('ヒントの段階', (await title()) === 'ヒント');
  await page.locator('.vt-hintbtn').tap(); await W(400);
  check('「ヒント」を押すと、正しい 1 片の位置が枠に出る', await page.locator('.pb-hint').count() > 0);
  await shot('07_hint');
  await page.waitForFunction(() => document.querySelector('.vt-title')?.textContent === '練習', null, { timeout: 15000 }).catch(() => null);
  check('練習へ進む', (await title()) === '練習');
  await shot('08_practice');
  await page.getByRole('button', { name: '練習を飛ばして本番へ' }).tap(); await W(1200);
  const lastV = await page.evaluate(() => window.__fc.Sound.lastVoice);
  check('説明を閉じると説明の声が止まり、本番が始まる（進行役の「ゲーム、スタート」に替わる）', lastV.endsWith('host_observer/04_game_start.mp3') && await page.locator('.match .pb-board').count() === 1, lastV);
  await W(2500);
  // 試合中の「ルール」：音声付きの説明を見直せる。開いている間は時計が止まる
  const t1 = await page.locator('.match-head').innerText();
  await page.getByRole('button', { name: 'ルール' }).tap(); await W(2500);
  const t2 = await page.locator('.match-head').innerText();
  check('試合中の「ルール」で、説明を見直せる（閉じるボタンあり）', await page.locator('.vt').count() === 1 && await page.locator('.vt-skipall').count() === 1);
  check('見直している間、競技の時間は止まる', t1.match(/\d:\d\d/)?.[0] === t2.match(/\d:\d\d/)?.[0], `${t1.match(/\d:\d\d/)?.[0]} ${t2.match(/\d:\d\d/)?.[0]}`);
  await page.locator('.vt-skipall').tap(); await W(400);
  check('閉じると声が止まる', !(await voicePlaying()) && await page.locator('.vt').count() === 0);
  // 2 回目：説明を飛ばせる
  await page.goto('http://localhost:4173/FALSE-CROWN/'); await W(1500);
  await page.getByText('開発者メニュー').tap(); await W(400);
  await page.getByRole('button', { name: /M01 ピース/ }).tap(); await W(700);
  check('2 回目からは、説明全体を飛ばせる', await page.locator('.vt-skipall').count() === 1);
  check('画面のエラーなし', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(res.every(Boolean) ? 'ALL OK' : 'SOME FAILED');
  await browser.close();
})();
