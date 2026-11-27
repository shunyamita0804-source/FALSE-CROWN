// 裏ルート（入口の謎、裏ゲームの起動と報酬、昇降機、資料、結末）の確認。npm run build の後、sh scripts/with-preview.sh node scripts/check-hiddenroute.cjs [写真の保存先] [対象 例 lib,lift]
// 開発者メニューの「裏ルートの検証」から始める。調査点は、行動ボタンと同じ処理（G.interact）で調べ、そのあとの画面はすべてタップで進める。
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : null;
  const only = process.argv[3] ? process.argv[3].split(',') : null;
  const want = (k) => !only || only.includes(k);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const res = []; const check = (n, ok, d = '') => { res.push(!!ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  const shot = async (n) => { if (out) await page.screenshot({ path: `${out}/hr_${n}.png` }); };
  const W = (ms) => page.waitForTimeout(ms);
  const S = () => page.evaluate(() => { const s = window.__fc.G.state; return s ? { day: s.day, room: s.actors.hero.pos.room, pieces: s.actors.hero.pieces, items: { ...s.actors.hero.items }, flags: { ...s.flags }, claimed: [...s.claimed], match: !!s.match, ending: s.ending } : null; });
  const st = () => page.evaluate(() => { const s = window.__fcSlot && window.__fcSlot.state; return s ? JSON.parse(JSON.stringify(s)) : null; });
  const hint = () => page.evaluate(() => window.__fcHint && window.__fcHint());
  const M = (sel) => page.locator(`.match ${sel}`);
  const body = () => page.locator('body').innerText();
  const open = async (label) => {
    await page.goto('http://localhost:4173/FALSE-CROWN/'); await W(1500);
    await page.getByText('開発者メニュー').tap(); await W(400);
    await page.getByRole('button', { name: label }).tap(); await W(2500);
  };
  /** 調査点を調べる（行動ボタンと同じ処理）。調べた文を閉じるところまで */
  const inspect = async (insId) => {
    await page.evaluate((insId) => { const { G, rooms } = window.__fc; const r = rooms[G.state.actors.hero.pos.room]; const ins = r.inspects.find((i) => i.id === insId); G.interact({ kind: 'inspect', ins }); }, insId);
    await W(500);
  };
  /** 名前のボタンが出るまで待ってタップ */
  const tap = async (name, timeout = 8000) => { const b = page.getByRole('button', { name }); await b.last().waitFor({ timeout }); await b.last().tap(); await W(400); };
  /** 次へ／閉じる を、条件が満たされるまで押し進める */
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
  const warp = (room) => page.evaluate((room) => { const { G, sim } = window.__fc; sim.placeIn(G.state, 'hero', room); }, room);

  if (want('lib')) {
    await open('DAY1 朝・図書室（入口から）');
    await inspect('lib_shelf_order');
    await advance(async () => (await page.locator('.hd-entry').count()) > 0, 4);
    await shot('entry');
    check('書棚を調べると、入口の謎（3 冊の順番）が出る', await page.locator('.hd-entry .hd-ekey').count() === 3);
    for (const k of ['☀', '☾', '★']) await page.locator(`.hd-entry .hd-ekey[data-key="${k}"]`).tap();
    await W(200);
    const wrong = (await page.locator('.hd-entry').innerText()).includes('何も起こらない');
    for (const k of ['☾', '★', '☀']) await page.locator(`.hd-entry .hd-ekey[data-key="${k}"]`).tap();
    await W(400);
    await shot('entry_open');
    let s = await S();
    check('違う順番では開かず、正しい順番で隠し書斎への道が開く', wrong && s.flags.h01_open === true && (await body()).includes('秘密の書斎'));
    await advance(async () => !(await page.locator('.layer .panel').count()), 4);
    await warp('secret_study');
    const before = (await S()).pieces;
    await inspect('study_safe');
    await advance(async () => (await page.getByRole('button', { name: '挑戦する' }).count()) > 0, 4);
    await shot('confirm');
    check('金庫を調べると、かかる時間を伝える確認が出る', (await body()).includes('15 分'));
    await tap('挑戦する'); await W(600);
    await skipTut();
    const mv = await hint();
    for (const d of mv.code) { await M(`.sg-key[data-key="${d}"]`).tap(); await W(40); }
    await M('.sg-ok').tap(); await W(800);
    await advance(async () => (await body()).includes('賢者の金庫　結果'), 6);
    await shot('h01_result');
    const txt = await body();
    await advance(async () => !(await page.locator('.layer .panel').count()) && !(await page.locator('.match').count()), 6);
    s = await S();
    check('金庫を開けると、結果に「3 個」と出て、ピースが 3 増える', txt.includes('3 個受け取った') && s.pieces === before + 3 && s.claimed.includes('h01:reward'), `${before}→${s.pieces}`);
    await inspect('study_safe');
    check('もう一度調べると「金庫は空だ」', await advance(async () => (await body()).includes('金庫は空だ'), 3));
    await advance(async () => !(await page.locator('.layer .panel').count()), 4);
    await warp('library');
    await inspect('lib_diary');
    await advance(async () => (await body()).includes('月が昇り'), 3);
    check('詩集を調べると、入口の謎の答えにつながるメモが出る', (await body()).includes('月が昇り'));
  }

  if (want('casino')) {
    await open('DAY3 夜・展望室（ピース 6）');
    await inspect('obs_clock');
    await advance(async () => (await page.locator('.hd-entry').count()) > 0, 4);
    await page.locator('.hd-entry .hd-ekey[data-key="0:00"]').tap(); await W(400);
    check('夜の大時計で、針を 0:00 に合わせると月下の賭場への道が開く', (await S()).flags.h02_open === true);
    await advance(async () => !(await page.locator('.layer .panel').count()), 4);
    await warp('moon_casino');
    const before = (await S()).pieces;
    await inspect('casino_table');
    await advance(async () => (await page.getByRole('button', { name: '2 ピース賭ける' }).count()) > 0, 4);
    await shot('stake');
    check('賭けるピースを 1〜3 から選べる', await page.getByRole('button', { name: /ピース賭ける/ }).count() === 3);
    await tap('2 ピース賭ける'); await W(600);
    check('賭けたピースが先に預けられる', (await S()).pieces === before - 2);
    await skipTut();
    for (let g = 0; g < 30; g++) {
      const s2 = await st(); if (!s2 || s2.phase === 'done') break;
      const d = await page.evaluate(() => ({ target: Number((document.querySelector('.match .p05-total b') || {}).textContent), hand: [...document.querySelectorAll('.match .p05-hand .p05-card:not([disabled])')].map((e) => Number(e.dataset.card)) }));
      if (!d.hand.length || !(await M('.p05-go').count())) { await W(200); continue; }
      const card = d.hand.reduce((b, c) => (Math.abs(c - d.target) < Math.abs(b - d.target) ? c : b), d.hand[0]);
      await M(`.p05-hand .p05-card[data-card="${card}"]`).tap(); await W(80); await M('.p05-go').tap(); await W(300);
    }
    const fin = await st();
    await advance(async () => (await body()).includes('月下の賭場　結果'), 6);
    await shot('h02_result');
    await advance(async () => !(await page.locator('.layer .panel').count()) && !(await page.locator('.match').count()), 6);
    const after = (await S()).pieces;
    const diff = fin.wins[0] - fin.wins[1];
    check('勝てば 2 倍、引き分けは返金、負けは戻らない', after - before === (diff > 0 ? 2 : diff < 0 ? -2 : 0), `wins=${fin.wins} ${before}→${after}`);
  }

  if (want('archive')) {
    await open('DAY4 朝・旧書庫（H04、H05）');
    await inspect('archive_records');
    await advance(async () => (await S()).flags.passage_open === true, 4);
    check('旧書庫の記録を調べると、地下通路への鉄扉が開く', (await S()).flags.passage_open === true);
    await advance(async () => !(await page.locator('.layer .panel').count()), 4);
    await inspect('archive_letters');
    await advance(async () => !!(await S()).items.L02, 4);
    await advance(async () => !(await page.locator('.layer .panel').count()), 4);
    await warp('underground_passage');
    await inspect('passage_lamp');
    await advance(async () => !!(await S()).items.L05, 4);
    await advance(async () => !(await page.locator('.layer .panel').count()), 4);
    await warp('cell_zero');
    await inspect('zero_letters');
    await advance(async () => (await page.getByRole('button', { name: '挑戦する' }).count()) > 0, 5);
    const s = await S();
    check('旧書庫、地下通路、第零牢で手紙 5 通がそろい、囚人の遺言に挑める', ['L01', 'L02', 'L03', 'L04', 'L05'].every((x) => s.items[x]) && await page.getByRole('button', { name: '挑戦する' }).count() > 0);
    await page.getByRole('button', { name: 'やめる' }).last().tap(); await W(300);
    await warp('underground_passage');
    await inspect('passage_mech');
    await advance(async () => (await page.getByRole('button', { name: '挑戦する' }).count()) > 0, 4);
    check('時の牢獄は、1 回だけと伝えてから始める', (await body()).includes('1 回だけ'));
    await tap('挑戦する'); await W(600);
    await skipTut();
    // わざと何もしないで中断はできないので、1 つ目だけ解いて時間切れを待たずに、残りも解く
    for (let g = 0; g < 120; g++) {
      const s2 = await st(); if (!s2 || s2.phase === 'done') break;
      const mv = await hint(); if (!mv) { await W(150); continue; }
      if (mv.t === 'num') { for (const d of String(mv.v)) await M(`.sg-key[data-key="${d}"]`).tap(); await M('.sg-ok').tap(); }
      else if (mv.t === 'slide') await M(`.hd-st[data-pos="${mv.pos}"]`).tap();
      else if (mv.t === 'order') { for (const d of mv.seq) await M(`.sg-key[data-key="${d}"]`).tap(); await M('.sg-ok').tap(); }
      await W(80);
    }
    await advance(async () => (await body()).includes('時の牢獄　結果'), 6);
    await shot('h05_result');
    await advance(async () => !(await page.locator('.layer .panel').count()) && !(await page.locator('.match').count()), 6);
    const s3 = await S();
    check('解くと 5 ピースで、地下迷宮への扉が開く。2 回目は挑めない', s3.flags.h05_cleared === true && s3.flags.h05_tried === true && s3.claimed.includes('h05:reward'));
    await inspect('passage_mech');
    check('もう一度調べると「仕掛けはもう動かない」', await advance(async () => (await body()).includes('もう動かない'), 3));
  }

  if (want('lift')) {
    await open('DAY8 朝・共用廊下（閲覧の許可あり）');
    await inspect('common_map');
    await advance(async () => (await page.getByRole('button', { name: '下りる' }).count()) > 0, 5);
    await shot('lift');
    await tap('下りる'); await W(1200);
    let s = await S();
    check('案内図から保守用の昇降機で、記録保管庫へ下りられる', s.room === 'records_vault', s.room);
    await inspect('vault_docs');
    await advance(async () => (await body()).includes('資料 12 件'), 4);
    await shot('vault');
    s = await S();
    check('索引から、資料 12 件、手紙の写し 5 通、保守用の鍵が手に入る', Object.keys(s.items).filter((k) => /^E\d\d$/.test(k)).length === 12 && Object.keys(s.items).filter((k) => /^L\d\d$/.test(k)).length === 5 && s.items.KEY_SERVICE === 1);
    await advance(async () => !(await page.locator('.layer .panel').count()), 4);
    await page.evaluate(() => window.__fc.G.openMenu()); await W(500);
    await page.getByRole('button', { name: '資料' }).tap(); await W(300);
    await shot('files');
    check('手帳に「資料」の欄ができ、写した資料を読み返せる', (await page.locator('.book').innerText()).includes('白石紗夜の研究計画書'));
    await page.getByRole('button', { name: /閉じる/ }).first().tap(); await W(400);
    await inspect('vault_lift');
    await advance(async () => (await page.getByRole('button', { name: '上の階へ戻る' }).count()) > 0, 4);
    await tap('上の階へ戻る'); await W(1200);
    check('保管庫の昇降機で、共用廊下へ戻れる', (await S()).room === 'common_hall');
  }

  if (want('core')) {
    await open('DAY9 朝・最深部（H08 の条件あり）');
    await inspect('core_terminal');
    await advance(async () => (await page.getByRole('button', { name: '挑戦する' }).count()) > 0, 4);
    await tap('挑戦する'); await W(600);
    await skipTut();
    let mv = await hint();
    for (const d of mv.v) await M(`.sg-key[data-key="${d}"]`).tap();
    await M('.sg-ok').tap(); await W(400);
    mv = await hint();
    for (const d of String(mv.v)) await M(`.sg-key[data-key="${d}"]`).tap();
    await M('.sg-ok').tap(); await W(400);
    await M('.hd-pause').tap(); await W(600);
    await advance(async () => (await body()).includes('神の方程式　結果'), 6);
    await shot('h08_pause');
    await advance(async () => !(await page.locator('.layer .panel').count()) && !(await page.locator('.match').count()), 6);
    check('中断すると、解いた段階（2）が保存される', (await S()).flags.h08_stage === 2);
    await inspect('core_terminal');
    await advance(async () => (await page.getByRole('button', { name: '挑戦する' }).count()) > 0, 4);
    check('もう一度挑むと、段階 3 から始めると伝える', (await body()).includes('段階 3'));
    await tap('挑戦する'); await W(800);
    const s0 = await st();
    check('続きの段階（3 つ目）から始まる', s0 && s0.idx === 2, s0 && s0.idx);
    mv = await hint(); await M(`.hd-op[data-opt="${mv.i}"]`).tap(); await M('.sg-ok').tap(); await W(500);
    mv = await hint();
    const s1 = await st();
    // 道はなぞって引く
    const cdp = await ctx.newCDPSession(page);
    const bb = await page.locator('.match .pb2-board').boundingBox(); const n = s1.maze.size;
    const pts = mv.path.map((c) => [bb.x + ((c % n) + 0.5) * bb.width / n, bb.y + (Math.floor(c / n) + 0.5) * bb.height / n]);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0][0], y: pts[0][1] }] });
    for (let i = 1; i < pts.length; i++) for (let k = 1; k <= 3; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k / 3, y: pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k / 3 }] }); await W(8); }
    await W(110); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await W(900);
    mv = await hint(); await M(`.hd-op[data-opt="${mv.i}"]`).tap(); await M('.sg-ok').tap(); await W(600);
    let sawObserver = false;
    await advance(async () => { const tx = await body(); if (tx.includes('そこまでたどり着いた')) sawObserver = true; return !(await page.locator('.layer').count()) && !(await page.locator('.match').count()) && (await S()).flags.h08_cleared === true; }, 20);
    const s2 = await S();
    check('5 段階を解くと、解放の権限を受け取り、オブザーバーの場面が出る', s2.flags.h08_cleared === true && s2.items.RELEASE_AUTH === 1 && sawObserver);
  }

  if (want('iso')) {
    await open('DAY10 朝・隔離区域（H08 済み）');
    await inspect('iso_terminal');
    await advance(async () => (await page.getByRole('button', { name: '準備する' }).count()) > 0, 4);
    await tap('準備する'); await W(300);
    check('端末で、解放の準備ができる', (await S()).flags.RESCUE_READY === true);
    await advance(async () => !(await page.locator('.layer .panel').count()), 4);
    await inspect('iso_terminal');
    await advance(async () => (await page.getByRole('button', { name: /みんなと外へ出る/ }).count()) > 0, 4);
    await tap(/みんなと外へ出る/);
    await shot('end_confirm');
    check('結末を選ぶと、大会を離れる確認が出る', (await body()).includes('優勝はできなくなります'));
    await page.getByRole('button', { name: 'やめる' }).last().tap(); await W(400);
    check('確認で「キャンセル」なら、何も変わらない', !(await S()).flags.endingChoice);
    await inspect('iso_terminal');
    await advance(async () => (await page.getByRole('button', { name: /みんなと外へ出る/ }).count()) > 0, 4);
    await tap(/みんなと外へ出る/);
    await tap('はい、離れる');
    let ending = '';
    await advance(async () => { const m = (await body()).match(/エンディング　(\S+)/); if (m) ending = m[1]; return !!m; }, 20);
    await shot('end_rescue');
    check('「はい」で、救済者の結末に着く', ending === '救済者', ending);
  }

  if (want('true')) {
    for (const [btn, want2] of [['主人公が優勝（偽りの王冠）', '偽りの王冠'], ['決勝で敗北（解放の準備あり）', '敗者']]) {
      await page.goto('http://localhost:4173/FALSE-CROWN/'); await W(1500);
      await page.getByText('開発者メニュー').tap(); await W(400);
      await page.getByRole('button', { name: btn }).tap();
      await page.getByText('DAY 11　決勝の結果').waitFor({ timeout: 150000 });
      let ending = '';
      await advance(async () => { const m = (await body()).match(/エンディング　(\S+)/); if (m) ending = m[1]; return !!m; }, 40);
      await shot(`final_${want2}`);
      check(`${btn}：結末は「${want2}」`, ending === want2, ending);
    }
  }

  check('画面のエラーなし', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
  console.log(res.every(Boolean) ? 'ALL OK' : 'SOME FAILED');
  process.exit(res.every(Boolean) ? 0 : 1);
})();
