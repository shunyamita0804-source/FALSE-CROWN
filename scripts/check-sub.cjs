// サブゲーム S01〜S06 と、遊戯室の卓（入口と報酬）の確認。npm run build の後、sh scripts/with-preview.sh node scripts/check-sub.cjs [写真の保存先] [対象 例 s01,s03,hub]
// 説明と練習、本番の対局を、すべて指の操作（タップ）で進める。対局で選ぶ手は、開発版だけの「CPU と同じ考え方の手」を読み、それを画面のタップで入力する。
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : null;
  const only = process.argv[3] ? process.argv[3].split(',') : null;
  const want = (k) => !only || only.includes(k);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  const shot = async (n) => { if (out) await page.screenshot({ path: `${out}/sub_${n}.png` }); };
  const W = (ms) => page.waitForTimeout(ms);
  const st = () => page.evaluate(() => { const s = window.__fcSlot && window.__fcSlot.state; return s ? JSON.parse(JSON.stringify(s)) : null; });
  const hint = () => page.evaluate(() => window.__fcHint && window.__fcHint());
  const M = (sel) => page.locator(`.match ${sel}`);
  const fits = () => page.evaluate(() => { const m = document.querySelector('.match-main'); return m ? m.scrollHeight <= m.clientHeight + 2 && m.scrollWidth <= m.clientWidth + 2 : false; });

  const open = async (label) => {
    await page.goto('http://localhost:4173/FALSE-CROWN/'); await W(1500);
    await page.getByText('開発者メニュー').tap(); await W(400);
    await page.getByRole('button', { name: label }).tap(); await W(600);
  };
  /** 説明のページを最後まで進めて、練習の画面で止まる */
  const tutorial = async (id, pages) => {
    let maxLen = 0;
    for (let i = 0; i < pages; i++) { maxLen = Math.max(maxLen, (await page.locator('.tut-text').innerText()).length); if (i === 1) await shot(`${id}_tut2`); await page.getByRole('button', { name: /次へ|練習へ/ }).tap(); await W(250); }
    check(`${id}：説明は ${pages} 画面で、1 画面の文は 80 文字以内`, maxLen > 0 && maxLen <= 80, String(maxLen));
  };
  const toMain = async (id) => {
    await shot(`${id}_prac`);
    const ok = await page.getByRole('button', { name: '本番へ', exact: true }).count() === 1;
    check(`${id}：練習を指の操作で終えると「本番へ」が出る`, ok);
    if (ok) await page.getByRole('button', { name: '本番へ', exact: true }).tap(); else await page.getByRole('button', { name: /飛ばす|スキップ/ }).first().tap();
    await W(900);
  };
  const enter = async (root, code) => { for (const d of code) { await page.locator(`${root} .sg-key[data-key="${d}"]`).tap(); await W(60); } };

  if (want('s01')) {
    await open(/S01 数字当て/);
    await tutorial('S01', 3);
    await enter('.tut', '258'); await page.locator('.tut .sg-ok').tap(); await W(200);
    const mid = await page.getByRole('button', { name: '本番へ', exact: true }).count() === 0;
    await enter('.tut', '582'); await page.locator('.tut .sg-ok').tap(); await W(300);
    check('S01：練習は、外れの数では終わらず、当たりの数で終わる', mid);
    await toMain('S01');
    // 同じ数字は 2 回押せない
    await enter('.match', '1');
    const dis = await M('.sg-key[data-key="1"]').isDisabled();
    await M('.sg-key[data-key="del"]').tap(); await W(80);
    await enter('.match', '407'); await shot('s01_secret'); await M('.sg-ok').tap(); await W(500);
    let s = await st();
    const me = s.players.indexOf('hero');
    check('S01：秘密の数を入力盤で決められる（同じ数字は押せない）', dis && s.secrets[me] === '407' && s.phase === 'guess', JSON.stringify(s.secrets[me]));
    let turns = 0; let fitOk = true;
    for (let g = 0; g < 10; g++) {
      s = await st(); if (!s || s.phase === 'done') break;
      const mv = await hint(); if (!mv) { await W(200); continue; }
      await enter('.match', mv.code); if (g === 1) { await shot('s01_guess'); fitOk = fitOk && await fits(); }
      await M('.sg-ok').tap(); await W(350); turns++;
    }
    s = await st();
    await shot('s01_end');
    const rows = await M('.match-main .sg-g').count();
    check('S01：推理を入力すると、ヒットとブローの返事が 1 行ずつ増える', rows === s.guesses[me].length && rows >= 1, `${rows}`);
    check('S01：どちらかが当てるか 8 回で終わり、2 人の数が明かされる', s.phase === 'done' && (await M('.sg-end').innerText()).includes(s.secrets[1 - me]), `turns=${turns}`);
    check('S01：盤面がスクロールなしで収まる', fitOk);
  }

  for (const [id, label, cellSel] of [['s02', /S02 五目並べ/, '.sg-pt'], ['s03', /S03 ミニリバーシ/, '.sg-sq']]) {
    if (!want(id)) continue;
    const ID = id.toUpperCase();
    await open(label);
    await tutorial(ID, 3);
    if (id === 's02') {
      await page.locator('.tut .sg-pt[data-cell="50"]').tap(); await W(150);
      const miss = await page.getByRole('button', { name: '本番へ', exact: true }).count() === 0;
      await page.locator('.tut .sg-pt[data-cell="34"]').tap(); await W(250);
      check('S02：練習は、5 つ並ばないマスでは終わらない', miss);
    } else {
      await page.locator('.tut .sg-sq.can').first().tap(); await W(250);
    }
    await toMain(ID);
    let s = await st();
    const me = s.players.indexOf('hero');
    let moves = 0; let twoTap = false; let fitOk = await fits(); let passes = 0;
    for (let g = 0; g < 120; g++) {
      s = await st(); if (!s || s.phase === 'done') break;
      const mv = await hint(); if (!mv) { await W(120); continue; }
      if (mv.t === 'pass') { await M('.sg-ok').tap(); passes++; await W(200); continue; }
      const cell = M(`${cellSel}[data-cell="${mv.cell}"]`);
      await cell.tap(); await W(60);
      if (moves === 0) {
        // 1 回目のタップでは置かれない（選ぶだけ）
        const b = (await st()).board[mv.cell];
        twoTap = b === -1 && await M(`${cellSel}.sel`).count() === 1;
        await shot(`${id}_sel`);
        await M('.sg-ok').tap();
      } else await cell.tap();
      await W(160); moves++;
      if (moves === 6) { await shot(`${id}_mid`); fitOk = fitOk && await fits(); }
    }
    s = await st();
    await W(300); await shot(`${id}_end`);
    check(`${ID}：1 回目のタップは選ぶだけで、確定で石が置かれる`, twoTap);
    check(`${ID}：指の操作で最後まで対局できる`, s.phase === 'done' && moves > 3, `moves=${moves} passes=${passes}`);
    check(`${ID}：終わると勝ち負けが出る`, await M('.sg-end').count() === 1, await M('.sg-end').count() ? (await M('.sg-end').innerText()).replace(/\n/g, ' ') : '');
    if (id === 's03') {
      const stones = s.board.filter((c) => c === 0).length + '-' + s.board.filter((c) => c === 1).length;
      check('S03：横の石の数が、盤面と合っている', (await page.locator('.match-side').innerText()).replace(/\s/g, '').includes(String(s.board.filter((c) => c === 0).length)), stones);
    }
    check(`${ID}：盤面がスクロールなしで収まる`, fitOk);
  }

  if (want('s04')) {
    await open(/S04 記憶カード/);
    await tutorial('S04', 3);
    // 練習：違う絵をめくると伏せ直される。同じ絵で取れる
    await page.locator('.tut .sg-card[data-cell="0"]').tap(); await W(100);
    await page.locator('.tut .sg-card[data-cell="1"]').tap(); await W(1400);
    const back = await page.locator('.tut .sg-card.up').count() === 0;
    for (const c of [0, 3, 1, 2]) { await page.locator(`.tut .sg-card[data-cell="${c}"]`).tap(); await W(150); }
    check('S04：練習で、違う絵は伏せ直される', back);
    await toMain('S04');
    let s = await st();
    const me = s.players.indexOf('hero');
    let flips = 0; let acks = 0; let sawShow = false; let fitOk = await fits(); let hidden = true;
    for (let g = 0; g < 200; g++) {
      s = await st(); if (!s || s.phase === 'done') break;
      // 伏せたカードの絵は、画面のどこにも出ていない
      const upCount = await M('.sg-card.up').count();
      if (s.phase === 'flip' && upCount > (s.first >= 0 ? 1 : 0)) hidden = false;
      const mv = await hint(); if (!mv) { await W(120); continue; }
      if (mv.t === 'ok') {
        if (!sawShow) { sawShow = await M('.sg-card.up').count() === 2; await shot('s04_show'); }
        await M('.sg-ok').tap(); acks++; await W(150); continue;
      }
      await M(`.sg-card[data-cell="${mv.cell}"]`).tap(); flips++; await W(160);
      if (flips === 1) { await shot('s04_first'); fitOk = fitOk && await fits(); }
    }
    s = await st(); await W(300); await shot('s04_end');
    check('S04：タップでカードがめくれ、2 枚めくると結果が出て「次へ」で進む', flips >= 2 && acks >= 1 && sawShow, `flips=${flips} acks=${acks}`);
    check('S04：伏せたカードの絵は見えない', hidden);
    check('S04：全部取られると終わり、勝ち負けが出る', s.phase === 'done' && s.pairs[0] + s.pairs[1] === 6 && await M('.sg-end').count() === 1, JSON.stringify(s.pairs));
    check('S04：盤面がスクロールなしで収まる', fitOk);
  }

  if (want('s05')) {
    await open(/S05 ダイスパズル/);
    await tutorial('S05', 4);
    await page.locator('.tut .sg-cond[data-cond="1"]').tap(); await W(80);
    await page.locator('.tut .sg-ok').tap(); await W(150);
    const miss = await page.getByRole('button', { name: '本番へ', exact: true }).count() === 0;
    await page.locator('.tut .sg-cond[data-cond="0"]').tap(); await W(80);
    await page.locator('.tut .sg-dbtn[data-die="3"]').tap(); await W(80);
    await page.locator('.tut .sg-dbtn[data-die="4"]').tap(); await W(80);
    await page.locator('.tut .sg-ok').tap(); await W(300);
    check('S05：練習は、指示と違う選び方では終わらない', miss);
    await toMain('S05');
    let s = await st();
    const me = s.players.indexOf('hero');
    let rounds = 0; let fitOk = await fits(); let usedOk = true; let noGo = true;
    for (let g = 0; g < 20; g++) {
      s = await st(); if (!s || s.phase === 'done') break;
      const mv = await hint(); if (!mv) { await W(150); continue; }
      if (mv.t === 'ok') { if (rounds === 1) { await shot('s05_show'); fitOk = fitOk && await fits(); } await M('.sg-ok').tap(); await W(250); continue; }
      // 条件を選ぶまで、決定は押せない
      if (rounds === 0) noGo = await M('.sg-ok').isDisabled();
      // もう選んだ条件は押せない
      for (let c = 0; c < 3; c++) if (s.used[me][c] && !(await M(`.sg-cond[data-cond="${c}"]`).isDisabled())) usedOk = false;
      for (const j of mv.re) { await M(`.sg-dbtn[data-die="${j}"]`).tap(); await W(60); }
      await M(`.sg-cond[data-cond="${mv.cond}"]`).tap(); await W(80);
      if (rounds === 0) { await shot('s05_pick'); fitOk = fitOk && await fits(); }
      await M('.sg-ok').tap(); await W(300); rounds++;
    }
    s = await st(); await W(300); await shot('s05_end');
    const mine = s.log.map((r) => r.picks[me]);
    check('S05：サイコロと条件をタップで選び、決定で結果が出る（3 ラウンド）', rounds === 3 && s.phase === 'done', `rounds=${rounds}`);
    check('S05：条件を選ぶまで決定できず、選んだ条件は次から選べない', noGo && usedOk && new Set(mine.map((p) => p.cond)).size === 3);
    check('S05：得点は、成立した条件 1 つにつき 3 点', s.points[me] === mine.filter((p) => p.ok).length * 3, String(s.points[me]));
    check('S05：盤面がスクロールなしで収まる', fitOk);
  }

  if (want('s06')) {
    await open(/S06 ミニジグソー/);
    await tutorial('S06', 3);
    for (const [a, b] of [[1, 4], [6, 8]]) { await page.locator(`.tut .sg-tile[data-pos="${a}"]`).first().tap(); await W(100); await page.locator(`.tut .sg-tile[data-pos="${b}"]`).first().tap(); await W(200); }
    await toMain('S06');
    let s = await st();
    const me = s.players.indexOf('hero');
    const fitOk = await fits();
    await shot('s06_start');
    const img = await M('.sg-tile').first().evaluate((e) => getComputedStyle(e).backgroundImage);
    // 決まりどおりの入れ替えの列を、タップで入力する
    const plan = await page.evaluate(() => { const s = window.__fcSlot.state; const n = s.n; const p = [...s.perm]; const out = []; const sw = (a, b) => { [p[a], p[b]] = [p[b], p[a]]; out.push([a, b]); }; for (let pos = 0; pos < p.length; pos++) { let at = p.indexOf(pos); if (at === pos) continue; if (s.mode === 'any') { sw(at, pos); continue; } const tx = pos % n; while (at % n !== tx) { const nx = at + (at % n < tx ? 1 : -1); sw(at, nx); at = nx; } while (at !== pos) { sw(at, at - n); at -= n; } } return out; });
    let adjBlock = true;
    if (s.mode === 'adj') {
      // 隣でない 2 枚は入れ替わらない
      await M('.sg-tile[data-pos="0"]').tap(); await W(80); await M(`.sg-tile[data-pos="${s.n * s.n - 1}"]`).tap(); await W(150);
      const cnt = await page.evaluate(() => document.querySelectorAll('.match .sg-tile.sel').length);
      adjBlock = cnt === 1;
      await M(`.sg-tile[data-pos="${s.n * s.n - 1}"]`).tap(); await W(80);
    }
    for (let i = 0; i < plan.length; i++) {
      await M(`.sg-tile[data-pos="${plan[i][0]}"]`).tap(); await W(50);
      if (i === 0) await shot('s06_sel');
      await M(`.sg-tile[data-pos="${plan[i][1]}"]`).tap(); await W(70);
    }
    await W(700);
    s = await st(); await shot('s06_end');
    check('S06：タイルに施設の絵が出る', /url\(/.test(img), img.slice(0, 60));
    check(`S06：2 枚のタップで入れ替わり、完成すると時間が記録される（${s.n}×${s.n}、${s.mode === 'adj' ? '隣どうし' : '好きな 2 枚'}、${plan.length} 回）`, typeof s.results[me] === 'number' && s.phase === 'done', String(s.results[me]));
    check('S06：隣どうしだけの問題では、離れた 2 枚は入れ替わらない（この問題が対象の時だけ確認）', adjBlock, s.mode);
    check('S06：終わると勝ち負けが出る。盤面がスクロールなしで収まる', await M('.sg-end').count() === 1 && fitOk);
  }

  if (want('hub')) {
    // 遊戯室の卓：相手がいない時、いる時、対局、報酬（1 日 1 回）
    await page.goto('http://localhost:4173/FALSE-CROWN/'); await W(1500);
    await page.getByText('開発者メニュー').tap(); await W(400);
    await page.getByRole('button', { name: '遊戯室', exact: true }).tap(); await W(2500);
    const K = 'npc_06_kiryu';
    const prep = (withNpc) => page.evaluate(([K, withNpc]) => { const { G, sim } = window.__fc; const s = G.state; s.phaseLeft = 200000; for (const [id, a] of Object.entries(s.actors)) { if (id === 'hero') continue; a.talkCd = { hero: 1e15 }; a.goal = undefined; a.path = []; a.route = []; a.step = undefined; a.nextThink = 1e15; a.busyUntil = 1e15; sim.placeIn(s, id, id === K && withNpc ? 'game_room' : 'dining'); } G.meta.matchesPlayed = ['s01', 's02', 's03', 's04', 's06']; }, [K, withNpc]);
    const tapTable = () => page.evaluate(() => { const { G, rooms } = window.__fc; const ins = rooms.game_room.inspects.find((i) => i.event === 'sub_games'); G.interact({ kind: 'inspect', ins }); });
    const closeInspect = async () => { for (let i = 0; i < 6; i++) { if (await page.locator('.subhub').count()) return; const b = page.getByRole('button', { name: /^(次へ|閉じる)$/ }); if (await b.count()) await b.last().tap(); else await page.touchscreen.tap(422, 320); await W(350); } };
    await prep(false); await tapTable(); await closeInspect();
    await shot('hub_empty');
    check('卓：ゲームが 6 つ並び、相手がいない時はその案内が出る', await page.locator('.subhub-game').count() === 6 && (await page.locator('.subhub').innerText()).includes('相手がいません'));
    await page.locator('.subhub-game[data-game="s06"]').tap(); await W(250);
    check('卓：ミニジグソーは 1 人で遊べる', await page.locator('.subhub-opp[data-opp="solo"]').count() === 1);
    await page.getByRole('button', { name: '閉じる' }).tap(); await W(300);
    await prep(true); await tapTable(); await closeInspect();
    await page.locator('.subhub-game[data-game="s05"]').tap(); await W(250);
    await shot('hub_opp');
    check('卓：同じ部屋にいる参加者が、相手の候補に出る', await page.locator(`.subhub-opp[data-opp="${K}"]`).count() === 1);
    const before = await page.evaluate((K) => { const s = window.__fc.G.state; return { left: s.phaseLeft, hero: s.actors.hero.pieces, npc: s.actors[K].pieces, trust: s.actors[K].rel.hero ? s.actors[K].rel.hero.trust : null }; }, K);
    await page.locator(`.subhub-opp[data-opp="${K}"]`).tap(); await W(700);
    // S05 は初めてなので説明が出る。飛ばして本番へ
    const hasTut = await page.locator('.tut').count() === 1;
    if (hasTut) { const sk = page.getByRole('button', { name: /飛ばす|スキップ/ }); await sk.first().tap(); await W(800); }
    for (let g = 0; g < 20; g++) {
      const s = await st(); if (!s || s.phase === 'done') break;
      const mv = await hint(); if (!mv) { await W(150); continue; }
      if (mv.t === 'ok') { await M('.sg-ok').tap(); await W(250); continue; }
      for (const j of mv.re) { await M(`.sg-dbtn[data-die="${j}"]`).tap(); await W(50); }
      await M(`.sg-cond[data-cond="${mv.cond}"]`).tap(); await W(60); await M('.sg-ok').tap(); await W(300);
    }
    const fin = await st();
    await page.getByRole('button', { name: /結果へ|結果を見る|次へ/ }).last().tap(); await W(600);
    await shot('hub_result');
    const txt = await page.locator('body').innerText();
    const after = await page.evaluate((K) => { const s = window.__fc.G.state; return { left: s.phaseLeft, hero: s.actors.hero.pieces, npc: s.actors[K].pieces, trust: s.actors[K].rel.hero.trust, flag: !!s.flags[`sub:s05:${s.day}`], match: s.match }; }, K);
    const me = fin.players.indexOf('hero');
    const diff = fin.points[me] - fin.points[1 - me];
    check('卓：初めてのゲームは説明から始まり、対局のあと結果と報酬が出る', hasTut && /ダイスパズル　結果/.test(txt) && txt.includes('打ち解けた'));
    check('卓：勝った方がピースを 1 枚受け取る（引き分けは無し。NPC が勝っても同じ）', after.hero - before.hero === (diff > 0 ? 1 : 0) && after.npc - before.npc === (diff < 0 ? 1 : 0), `diff=${diff} hero+${after.hero - before.hero} npc+${after.npc - before.npc}`);
    check('卓：1 局で 20 分進み、相手との信頼が上がる', before.left - after.left >= 20000 && before.left - after.left < 40000 && after.trust > (before.trust ?? 0) && after.flag && after.match === null, `${before.left - after.left}`);
    await page.getByRole('button', { name: '次へ' }).last().tap(); await W(500);
    await tapTable(); await closeInspect();
    check('卓：同じ日の 2 回目は「受け取り済み」と出る', (await page.locator('.subhub-game[data-game="s05"]').innerText()).includes('受け取り済み'));
    await shot('hub_again');
  }

  check('画面のエラーなし', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
  console.log(res.every(Boolean) ? 'ALL OK' : 'SOME FAILED');
  process.exit(res.every(Boolean) ? 0 : 1);
})();
