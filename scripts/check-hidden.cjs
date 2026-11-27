// 裏ゲーム H01〜H08 の画面の確認。npm run build の後、sh scripts/with-preview.sh node scripts/check-hidden.cjs [写真の保存先] [対象 例 h01,h03]
// 説明と練習、本番を、すべて指の操作（タップとなぞり）で進める。本番で選ぶ手は、開発版だけの「CPU と同じ考え方の手」を読み、それを画面の操作で入力する。
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : null;
  const only = process.argv[3] ? process.argv[3].split(',') : null;
  const want = (k) => !only || only.includes(k);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const res = []; const check = (n, ok, d = '') => { res.push(!!ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  const shot = async (n) => { if (out) await page.screenshot({ path: `${out}/hid_${n}.png` }); };
  const W = (ms) => page.waitForTimeout(ms);
  const st = () => page.evaluate(() => { const s = window.__fcSlot && window.__fcSlot.state; return s ? JSON.parse(JSON.stringify(s)) : null; });
  const hint = () => page.evaluate(() => window.__fcHint && window.__fcHint());
  const M = (sel) => page.locator(`.match ${sel}`);
  const T = (sel) => page.locator(`.tut ${sel}`);
  const fits = () => page.evaluate(() => { const m = document.querySelector('.match-main'); return m ? m.scrollHeight <= m.clientHeight + 2 && m.scrollWidth <= m.clientWidth + 2 : false; });
  const small = (sel) => page.evaluate((sel) => [...document.querySelectorAll(sel)].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 39.5 || r.width < 39.5); }).map((e) => { const r = e.getBoundingClientRect(); return `${e.className}:${r.width.toFixed(0)}x${r.height.toFixed(0)}`; }), sel);
  const open = async (label) => {
    await page.goto('http://localhost:4173/FALSE-CROWN/'); await W(1500);
    await page.getByText('開発者メニュー').tap(); await W(400);
    await page.getByRole('button', { name: label }).tap(); await W(600);
  };
  const tutorial = async (id, pages) => {
    let maxLen = 0;
    for (let i = 0; i < pages; i++) { maxLen = Math.max(maxLen, (await page.locator('.tut-text').innerText()).length); await shot(`${id}_tut${i + 1}`); await page.getByRole('button', { name: /次へ|練習へ/ }).tap(); await W(250); }
    check(`${id}：説明は ${pages} 画面で、1 画面の文は 80 文字以内`, maxLen > 0 && maxLen <= 80, String(maxLen));
  };
  const ready = () => page.getByRole('button', { name: '本番へ', exact: true }).count().then((n) => n === 1);
  const toMain = async (id, midOk = true) => {
    await shot(`${id}_prac`);
    const ok = await ready();
    check(`${id}：練習は、間違いでは終わらず、正しい操作で終わって「本番へ」が出る`, ok && midOk);
    if (ok) await page.getByRole('button', { name: '本番へ', exact: true }).tap(); else await page.getByRole('button', { name: /飛ばす|スキップ/ }).first().tap();
    await W(900);
  };
  const keys = async (root, code) => { for (const d of code) { await page.locator(`${root} .sg-key[data-key="${d}"]`).tap(); await W(50); } };
  const drag = async (root, cells, size) => {
    const bb = await page.locator(`${root} .pb2-board`).boundingBox();
    const pts = cells.map((c) => [bb.x + ((c % size) + 0.5) * bb.width / size, bb.y + (Math.floor(c / size) + 0.5) * bb.height / size]);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0][0], y: pts[0][1] }] });
    for (let i = 1; i < pts.length; i++) for (let k = 1; k <= 3; k++) { const x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k / 3; const y = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k / 3; await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }); await W(8); }
    await W(110);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await W(40);
  };

  if (want('h01')) {
    await open(/H01 賢者の金庫/);
    await tutorial('H01', 3);
    await keys('.tut', '213'); await T('.sg-ok').tap(); await W(200);
    const mid = !(await ready());
    await keys('.tut', '312'); await T('.sg-ok').tap(); await W(300);
    await toMain('H01', mid);
    await shot('h01_start');
    check('H01：条件が 6 つ並び、盤面がスクロールなしで収まる', await M('.hd-clue').count() === 6 && await fits());
    { const sm = await small('.match .sg-key, .match .hd-clue'); check('H01：押す所は 40px 以上', sm.length === 0, sm.slice(0, 4).join(' ')); }
    await M('.hd-clue[data-clue="1"]').tap(); await W(100);
    const marked = await M('.hd-clue.on').count() === 1;
    await keys('.match', '1');
    const dis = await M('.sg-key[data-key="1"]').isDisabled();
    await keys('.match', '23456'); await M('.sg-ok').tap(); await W(400);
    let s = await st();
    check('H01：条件に印を付けられる。同じ数字は 2 回押せない。違う数は 1 回に数える', marked && dis && s.tries.length === 1 && !s.solved && await M('.hd-try').count() === 1);
    await keys('.match', '123456');
    check('H01：試した数は、もう一度は出せない', await M('.sg-ok').isDisabled());
    for (let i = 0; i < 6; i++) { await M('.sg-key[data-key="del"]').tap(); await W(40); }
    const mv = await hint();
    await keys('.match', mv.code); await shot('h01_code'); await M('.sg-ok').tap(); await W(500);
    s = await st(); await shot('h01_end');
    check('H01：条件に合う数で金庫が開く', s.solved && s.phase === 'done' && (await M('.sg-end').innerText()).includes('開きました'));
  }

  if (want('h02')) {
    await open(/H02 月下の賭場/);
    await tutorial('H02', 3);
    await page.locator('.tut .p05-card[data-card="1"]').tap(); await W(150);
    const mid = !(await ready());
    await page.locator('.tut .p05-card[data-card="4"]').tap(); await W(250);
    await toMain('H02', mid);
    let rounds = 0; let fitOk = true;
    for (let g = 0; g < 30; g++) {
      const s = await st(); if (!s || s.phase === 'done') break;
      const d = await page.evaluate(() => ({ target: Number((document.querySelector('.match .p05-total b') || {}).textContent), hand: [...document.querySelectorAll('.match .p05-hand .p05-card:not([disabled])')].map((e) => Number(e.dataset.card)) }));
      if (!d.hand.length || !(await M('.p05-go').count())) { await W(200); continue; }
      const card = d.hand.reduce((b, c) => (Math.abs(c - d.target) < Math.abs(b - d.target) ? c : b), d.hand[0]);
      await M(`.p05-hand .p05-card[data-card="${card}"]`).tap(); await W(80);
      if (rounds === 0) { await shot('h02_r1'); fitOk = await fits(); check('H02：手札は 1 から 5 の 5 枚。相手は仮面のディーラー', d.hand.length === 5 && s.players[1] === 'dealer' && (await page.locator('.match').innerText()).includes('ディーラー')); }
      await M('.p05-go').tap(); await W(300); rounds++;
    }
    const s = await st(); await shot('h02_end');
    check('H02：5 ラウンドで終わり、勝ち数の合計が 5 になる', s.phase === 'done' && rounds === 5 && s.wins[0] + s.wins[1] === 5, JSON.stringify(s.wins));
    check('H02：盤面がスクロールなしで収まる', fitOk);
  }

  if (want('h03')) {
    await open(/H03 鏡の迷宮/);
    await tutorial('H03', 4);
    await T('.hd-dir[data-dir="R"]').tap(); await W(120);
    const mid = !(await ready());
    for (const d of ['R', 'U', 'U']) { await T(`.hd-dir[data-dir="${d}"]`).tap(); await W(120); }
    // 右の盤面は左右が逆なので、もう一度そろえる
    for (let i = 0; i < 12 && !(await ready()); i++) { await T(`.hd-dir[data-dir="${i % 2 ? 'U' : 'R'}"]`).tap(); await W(100); }
    await toMain('H03', mid);
    await shot('h03_start');
    check('H03：左右に 7×7 の盤面が出て、スクロールなしで収まる', await M('.hd-maze.a .hd-mc').count() === 49 && await M('.hd-maze.b .hd-mc').count() === 49 && await fits());
    { const sm = await small('.match .hd-dir, .match .hd-reset'); check('H03：押す所は 40px 以上', sm.length === 0, sm.slice(0, 4).join(' ')); }
    let s = await st(); const p0 = s.pos;
    await M('.hd-dir[data-dir="R"]').tap(); await W(200);
    s = await st();
    check('H03：▶ で、左の駒は右へ、右の駒は左へ動く（1 手に数える）', s.pos[0][0] === p0[0][0] + 1 && s.pos[1][0] === p0[1][0] - 1 && s.moves === 1, JSON.stringify(s.pos));
    await M('.hd-reset').tap(); await W(200);
    s = await st();
    check('H03：「最初から」で始めの位置に戻り、1 手に数える', JSON.stringify(s.pos) === JSON.stringify(p0) && s.moves === 2);
    let shotMid = false;
    for (let g = 0; g < 120; g++) {
      s = await st(); if (!s || s.phase === 'done') break;
      const mv = await hint(); if (!mv || mv.t !== 'go') { await W(150); continue; }
      await M(`.hd-dir[data-dir="${mv.dir}"]`).tap(); await W(70);
      if (s.idx === 1 && !shotMid) { shotMid = true; await shot('h03_stage2'); }
    }
    s = await st(); await shot('h03_end');
    check('H03：3 面とも、2 つの駒を同時にゴールへ乗せて成功する', s.phase === 'done' && s.cleared === 3 && (await M('.sg-end').innerText()).includes('成功'), `cleared=${s.cleared}`);
  }

  if (want('h04')) {
    await open(/H04 囚人の遺言/);
    await tutorial('H04', 3);
    await T('.hd-op[data-opt="0"]').tap(); await T('.sg-ok').tap(); await W(200);
    const mid = !(await ready());
    await T('.hd-op[data-opt="1"]').tap(); await T('.sg-ok').tap(); await W(300);
    await toMain('H04', mid);
    await shot('h04_start');
    check('H04：手紙 5 通と問い 5 つが出て、スクロールなしで収まる', await M('.hd-ltab').count() === 5 && await M('.hd-q').count() === 5 && await fits());
    { const sm = await small('.match .hd-ltab, .match .hd-op'); check('H04：押す所は 40px 以上', sm.length === 0, sm.slice(0, 4).join(' ')); }
    const t1 = await M('.hd-letter').innerText();
    await M('.hd-ltab[data-letter="L03"]').tap(); await W(150);
    const t3 = await M('.hd-letter').innerText();
    check('H04：番号をタップすると、別の手紙を読める', t1 !== t3 && t3.includes('07'));
    check('H04：全部選ぶまで、答えは出せない', await M('.sg-ok').isDisabled());
    const mv = await hint();
    for (let i = 0; i < 5; i++) { await M(`.hd-q[data-q="${i}"] .hd-op[data-opt="${(mv.a[i] + 1) % 3}"]`).tap(); await W(40); await M(`.hd-q[data-q="${i}"] .hd-op[data-opt="${mv.a[i]}"]`).tap(); await W(40); }
    await shot('h04_picked'); await M('.sg-ok').tap(); await W(500);
    const s = await st(); await shot('h04_end');
    check('H04：選び直せる。答えを出すと、問いごとの正誤と結果が出る', s.phase === 'done' && JSON.stringify(s.answers) === JSON.stringify(mv.a) && await M('.hd-q.ok').count() === s.correct && await M('.sg-end').count() === 1, `correct=${s.correct}`);
  }

  if (want('h05')) {
    await open(/H05 時の牢獄/);
    await tutorial('H05', 4);
    const mid = !(await ready());
    await T('.hd-st[data-n="5"]').tap(); await W(120); await T('.hd-st[data-n="8"]').tap(); await W(300);
    await toMain('H05', mid);
    await shot('h05_p1');
    check('H05：1 つ目は数の列。スクロールなしで収まる', await M('.hd-seq b').count() === 6 && await fits());
    await keys('.match', '36'); await M('.sg-ok').tap(); await W(300);
    let s = await st();
    check('H05：違う数では進まず、入れ直せる', s.idx === 0 && s.misses === 1 && await M('.hd-miss').count() === 1);
    let mv = await hint();
    await keys('.match', String(mv.v)); await M('.sg-ok').tap(); await W(400);
    s = await st(); await shot('h05_p2');
    check('H05：正しい数で 2 つ目（スライド板）へ進む。押す所は 40px 以上', s.idx === 1 && await M('.hd-st').count() === 9 && await fits() && (await small('.match .hd-st')).length === 0);
    let n = 0;
    for (let g = 0; g < 80; g++) { s = await st(); if (s.idx !== 1 || s.phase === 'done') break; mv = await hint(); if (!mv || mv.t !== 'slide') break; await M(`.hd-st[data-pos="${mv.pos}"]`).tap(); await W(60); n++; }
    s = await st(); await shot('h05_p3');
    check(`H05：板をタップで動かして並べると 3 つ目へ進む（${n} 手）`, s.idx === 2 && await fits());
    await keys('.match', 'ABCD'); await M('.sg-ok').tap(); await W(300);
    s = await st();
    const missOk = s.idx === 2 && s.phase === 'play';
    mv = await hint();
    await keys('.match', mv.seq.join('')); await M('.sg-ok').tap(); await W(500);
    s = await st(); await shot('h05_end');
    check('H05：記号の順は、違う並びでは進まず、条件に合う並びで全部解ける', missOk && s.phase === 'done' && s.idx === 3 && (await M('.sg-end').innerText()).includes('解けました'));
  }

  if (want('h06')) {
    await open(/H06 影の対戦者/);
    await tutorial('H06', 4);
    const cell = (root, c) => page.locator(`${root} .pzb-cell[data-cell="${c}"]`);
    const tap = async (loc) => { await loc.tap({ force: true }); await W(80); };
    const at = (x, y) => y * 5 + x;
    await tap(cell('.tut', at(1, 2))); await tap(cell('.tut', at(3, 2))); await tap(cell('.tut', at(3, 2)));
    await toMain('H06');
    await shot('h06_start');
    let s = await st();
    check('H06：駒は 3 個ずつ。相手は仮面の対戦者。スクロールなしで収まる', s.pieces.length === 6 && s.players.includes('mask') && (await page.locator('.match').innerText()).includes('仮面') && await fits());
    let moves = 0;
    for (let g = 0; g < 400; g++) {
      s = await st(); if (!s || s.phase === 'done') break;
      const pass = page.locator('.match').getByRole('button', { name: 'パス' });
      if (await pass.count()) { await pass.tap(); await W(300); continue; }
      if (!(await M('.pzb-cell.movable').count())) { await W(150); continue; }
      const mv = await hint(); if (!mv) { await W(150); continue; }
      if (mv.t !== 'move') { await W(150); continue; }
      await tap(cell('.match', mv.from)); await tap(cell('.match', mv.to));
      const btn = page.locator('.match').getByRole('button', { name: '動かす' });
      if (await btn.isDisabled()) { check('H06：選んだ手が確定できる', false, JSON.stringify(mv)); break; }
      if (moves === 1) await shot('h06_move');
      await btn.tap(); await W(280); moves++;
    }
    s = await st(); await shot('h06_end');
    check(`H06：15 巡までで終わり、得点が出る（${moves} 手）`, s.phase === 'done' && moves >= 1 && moves <= 15, JSON.stringify(s.points));
  }

  if (want('h07')) {
    await open(/H07 十二の証明/);
    await tutorial('H07', 3);
    await T('.hd-op[data-opt="1"]').tap(); await T('.hd-ev[data-ev="0"]').tap(); await T('.sg-ok').tap(); await W(200);
    const mid = !(await ready());
    await T('.hd-op[data-opt="0"]').tap(); await T('.sg-ok').tap(); await W(300);
    await toMain('H07', mid);
    await shot('h07_start');
    check('H07：12 人と資料 12 枚が出て、スクロールなしで収まる', await M('.hd-person').count() === 12 && await M('.hd-ev').count() === 12 && await fits());
    { const sm = await small('.match .hd-person, .match .hd-ev, .match .hd-op'); check('H07：押す所は 40px 以上', sm.length === 0, sm.slice(0, 4).join(' ')); }
    check('H07：全員ぶんを選ぶまで、照らし合わせられない', await M('.sg-ok').isDisabled());
    const fill = async (a, only) => {
      for (let i = 0; i < 12; i++) {
        if (only && !only.includes(i)) continue;
        await M(`.hd-person[data-person="${i}"]`).tap(); await W(40);
        await M(`.hd-detail .hd-op[data-opt="${a[i].opt}"]`).tap(); await W(40);
        await M(`.hd-ev[data-ev="${a[i].ev}"]`).tap(); await W(40);
      }
    };
    let mv = await hint();
    // 1 回目は、1 人ぶんをわざと違う札にして出す
    const first = mv.a.map((x) => ({ ...x })); first[4].opt = (first[4].opt + 1) % 3;
    await fill(first); await shot('h07_filled');
    const evText = await M('.hd-evtext').innerText();
    await M('.sg-ok').tap(); await W(400);
    let s = await st(); await shot('h07_wrong');
    check('H07：資料の番号をタップすると中身を読める。食い違いは、人だけが分かる', evText.length > 10 && s.tries === 1 && s.wrong.includes(4) && await M('.hd-person.bad').count() === s.wrong.length && !s.solved, JSON.stringify(s.wrong));
    for (let g = 0; g < 6; g++) {
      s = await st(); if (s.phase === 'done') break;
      mv = await hint();
      await fill(mv.a, s.wrong); await M('.sg-ok').tap(); await W(400);
    }
    s = await st(); await shot('h07_end');
    check('H07：食い違いの人だけ直して出し直すと、全部合って成功する', s.solved && s.phase === 'done' && (await M('.sg-end').innerText()).includes('合いました'), `tries=${s.tries}`);
  }

  if (want('h08')) {
    await open(/H08 神の方程式/);
    await tutorial('H08', 3);
    await keys('.tut', 'ABC'); await T('.sg-ok').tap(); await W(200);
    const mid = !(await ready());
    await keys('.tut', 'KEY'); await T('.sg-ok').tap(); await W(300);
    await toMain('H08', mid);
    await shot('h08_p1');
    { const sm = await small('.match .sg-key, .match .hd-pause'); check('H08：1 つ目は暗号。文字の入力盤が出て、スクロールなしで収まる', await M('.sg-key').count() === 27 && await fits() && sm.length === 0, `${await M('.sg-key').count()} ${await fits()} ${sm.join(' ')}`); }
    await keys('.match', 'ABCDE'); await M('.sg-ok').tap(); await W(300);
    let s = await st();
    const miss1 = s.idx === 0 && s.misses >= 1;
    let mv = await hint();
    await keys('.match', mv.v); await M('.sg-ok').tap(); await W(400);
    s = await st(); await shot('h08_p2');
    check('H08：違う文字では進まず、正しい文字で 2 つ目へ進む', miss1 && s.idx === 1);
    mv = await hint(); await keys('.match', String(mv.v)); await M('.sg-ok').tap(); await W(400);
    s = await st(); await shot('h08_p3');
    check('H08：数の列を解くと 3 つ目（3 つの箱）へ進む', s.idx === 2 && await M('.hd-op').count() === 3 && await fits());
    mv = await hint(); await M(`.hd-op[data-opt="${mv.i}"]`).tap(); await W(80); await M('.sg-ok').tap(); await W(400);
    s = await st(); await shot('h08_p4');
    check('H08：箱を選んで答えると 4 つ目（道）へ進む', s.idx === 3 && await M('.pb2-board').count() === 1 && await fits());
    mv = await hint();
    await drag('.match', mv.path, s.maze.size); await W(900);
    s = await st(); await shot('h08_p5');
    check('H08：指でなぞって道を引くと 5 つ目（記録）へ進む', s.idx === 4 && await fits());
    mv = await hint(); await M(`.hd-op[data-opt="${mv.i}"]`).tap(); await W(80); await M('.sg-ok').tap(); await W(500);
    s = await st(); await shot('h08_end');
    check('H08：5 つとも解くと成功する', s.phase === 'done' && s.idx === 5 && (await M('.sg-end').innerText()).includes('解きました'));
    // 中断
    await open(/H08 神の方程式/);
    await page.getByRole('button', { name: /飛ばす|スキップ/ }).first().tap(); await W(900);
    await M('.hd-pause').tap(); await W(400);
    s = await st();
    check('H08：「中断する」で終わり、解けた段階の数が残る', s.phase === 'done' && s.idx === 0 && (await M('.sg-end').innerText()).includes('中断'));
  }

  check('画面のエラーなし', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
  console.log(res.every(Boolean) ? 'ALL OK' : 'SOME FAILED');
  process.exit(res.every(Boolean) ? 0 : 1);
})();
