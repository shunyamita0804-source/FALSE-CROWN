// DAY1 の通し確認（画面操作）。npm run build の後に
// sh scripts/with-preview.sh node scripts/check-day1.cjs [写真の保存先]
// タイトル「はじめから」→ 主人公の作成 → 開会式 → 自己紹介 → 自由時間 → 集合案内 → 歩いて会場へ → ルール説明 → 作戦時間 → M01 → 結果 → 棟分け → 自由時間 → 監獄マッチ／速報 → 夜 → 消灯 → DAY2 の朝。
// 画面のボタンを押して進める。待ち時間の短縮（自由時間の残りを縮める）と、会場までの道順の指示（主人公の歩き）と、M01 の解の読み出しだけは開発版の参照（window.__fc / __fcSlot）を使う。
// 各場面で、ボタン・文字が画面の外にはみ出していないか、ボタン同士が重なっていないかを確かめる（Playwright の iPhone 横画面相当。実機ではない）。
const { chromium } = require('playwright');
const { newPhoneContext, offscreen } = require('./iphone.cjs');
const MODE = process.env.MODE || 'win'; // win：M01 を解く（生活棟の日）、lose：M01 で何も置かない（監獄棟の日になりやすい）
(async () => {
  const out = process.argv[2] || null;
  const browser = await chromium.launch();
  const ctx = await newPhoneContext(browser);
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const res = []; const check = (n, ok, d = '') => { res.push(!!ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  let shotN = 0;
  const shot = async (n) => { if (out) await page.screenshot({ path: `${out}/day1_${MODE}_${String(++shotN).padStart(2, '0')}_${n}.png` }); };
  const st = () => page.evaluate(() => { const G = window.__fc?.G; const s = G?.state; if (!s) return null; return { day: s.day, phase: s.phase, left: s.phaseLeft, room: s.actors.hero.pos.room, house: s.actors.hero.house, alive: s.actors.hero.alive, n: Object.values(s.actors).filter((a) => a.alive).length }; });
  // ボタン同士の重なり（同じ層の中で、見えているボタンの矩形が重なっている組）
  const overlaps = () => page.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 2 && r.height > 2 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05; };
    const bs = [...document.querySelectorAll('button, .btn')].filter(vis);
    const bad = [];
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i].getBoundingClientRect(), b = bs[j].getBoundingClientRect();
      if (bs[i].contains(bs[j]) || bs[j].contains(bs[i])) continue;
      const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left), iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ix > 3 && iy > 3) {
        // 上に別の層がかぶっている（下の層は押せない）なら重なりとは数えない
        const top = document.elementFromPoint((Math.max(a.left, b.left) + Math.min(a.right, b.right)) / 2, (Math.max(a.top, b.top) + Math.min(a.bottom, b.bottom)) / 2);
        if (top && (bs[i].contains(top) || bs[j].contains(top))) bad.push(`${(bs[i].innerText || bs[i].className).slice(0, 12)} × ${(bs[j].innerText || bs[j].className).slice(0, 12)}`);
      }
    }
    return bad;
  });
  const seen = new Set();
  const inspect = async (tag) => {
    if (seen.has(tag)) return; seen.add(tag);
    await page.waitForTimeout(250);
    await shot(tag);
    const off = await offscreen(page, '.layer button, .layer .btn, .panel, .hud button, .talk-box, .dialog');
    const ov = await overlaps();
    check(`${tag}：はみ出し・ボタンの重なりなし`, off.length === 0 && ov.length === 0, [...off, ...ov].slice(0, 4).join(' | '));
  };
  // 一番上に見えていて押せるボタンだけ押す（下の層にあるボタンは押さない）
  const tapIf = async (re) => {
    const b = page.getByRole('button', { name: re });
    const n = await b.count();
    for (let i = 0; i < n; i++) {
      const v = b.nth(i);
      if (!(await v.isVisible()) || !(await v.isEnabled())) continue;
      const top = await v.evaluate((e) => { const r = e.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!t && (e === t || e.contains(t)); });
      if (!top) continue;
      if (process.env.DBG) console.log('   tap', String(re)); await v.tap({ timeout: 3000 }).catch((e) => console.log('   tap失敗', String(e).slice(0, 80))); await page.waitForTimeout(250); return true;
    }
    return false;
  };
  const buttons = () => page.evaluate(() => [...document.querySelectorAll('button')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean));

  await page.goto('http://localhost:4173/FALSE-CROWN/'); await page.waitForTimeout(1500);
  for (let i = 0; i < 6 && !(await page.getByText('はじめから').count()); i++) { await page.touchscreen.tap(400, 200); await page.waitForTimeout(800); }
  await inspect('title');
  await page.getByText('はじめから').first().tap(); await page.waitForTimeout(800);
  const log = [];
  let lastPhase = '', routed = '', m01done = false, heroOut = false, titleAgain = false;
  for (let it = 0; it < 2500; it++) {
    const s = await st();
    const bs = await buttons();
    const key = s ? `${s.day}:${s.phase}` : 'none';
    if (key !== lastPhase) { log.push(`${key} room=${s?.room} house=${s?.house} n=${s?.n}`); console.log('  →', log.at(-1), '|', bs.slice(0, 8).join(' / ')); lastPhase = key; }
    if (s && s.day === 2 && s.phase === 'morning') { await page.waitForTimeout(1500); await inspect('day2_morning'); break; }
    if (s && !s.alive && !heroOut) { heroOut = true; await inspect('hero_out'); }
    // 主人公の脱落：脱落の発表のあと、大会の終わり（結末）を経てタイトルへ戻ることを確かめる
    if (heroOut && await page.getByText('はじめから').count() && await page.getByText('はじめから').first().isVisible()) { await inspect('back_to_title'); titleAgain = true; break; }
    // M01 の本番：解の読み出しで置く（win）か、何もしないで時間切れを待つ（lose）
    if (s && s.phase === 'main' && await page.evaluate(() => !!window.__fcSlot?.state?.solutions) && await page.locator('.pb-board').count() && !(await page.locator('.m01-break').count())) {
      await inspect('m01_stage');
      if (MODE === 'win') {
        const data = await page.evaluate(() => { const st = window.__fcSlot.state; const rot = (c, r) => { let o = c.map((v) => [...v]); const norm = (a) => { const mx = Math.min(...a.map((v) => v[0])), my = Math.min(...a.map((v) => v[1])); return a.map(([x, y]) => [x - mx, y - my]).sort((p, q) => p[1] - q[1] || p[0] - q[0]); }; o = norm(o); for (let i = 0; i < r; i++) o = norm(o.map(([x, y]) => [-y, x])); return o; }; return st.solutions[st.stage].map((p) => ({ ...p, c: rot(st.puzzles[st.stage].pieces[p.piece], p.rot)[0] })); });
        for (const pl of data) {
          await page.locator(`.pb-slot[data-piece="${pl.piece}"]`).tap(); await page.waitForTimeout(60);
          for (let r = 0; r < pl.rot; r++) { await page.getByRole('button', { name: '回す' }).tap(); await page.waitForTimeout(50); }
          const bb = await page.locator('.pb-board').boundingBox();
          const w = await page.evaluate(() => { const b = document.querySelector('.pb-board'); const c = b.querySelectorAll('.pb-cell'); return Math.round(b.offsetWidth / c[0].offsetWidth); });
          const px = bb.width / w;
          await page.touchscreen.tap(bb.x + (pl.x + pl.c[0] + 0.5) * px, bb.y + (pl.y + pl.c[1] + 0.5) * px); await page.waitForTimeout(70);
        }
        await page.waitForTimeout(900);
      } else {
        // 何も置かずに時間切れ（開発版：ステージの残り時間を縮める）
        await page.evaluate(() => { const sl = window.__fcSlot; if (sl?.state?.current?.hero) sl.state.current.hero.ms = 119_000; });
        await page.waitForTimeout(1500);
      }
      continue;
    }
    if (await page.locator('.m01-break').count()) { await inspect('m01_break'); }
    // 優先して押すボタン（進行）
    const order = [/^大会に参加する$/, /^開会式を終える$/, /^全員の紹介を飛ばす$/, /^説明を飛ばす$/, /^スタート$/, /^会場へ向かう$/, /^作戦時間を始める$/, /^準備完了$/, /^競技を始める$/, /ステージ \d へ/, /ラウンド \d+ へ/, /^断る$/, /^結果/, /^使わない$/, /^眠る$/, /タイトルへ|タイトルに戻る/, /^次へ$/, /^OK$/, /^閉じる$/, /^はい$/, /^進む$/, /へ$/, /^続ける$/, /^始める$/, /^確認$/, /^了解$/];
    let tapped = false;
    if (bs.length) {
      if (s) await inspect(`${key}_${bs.slice(0, 2).join('+').slice(0, 20)}`);
      for (const re of order) if (await tapIf(re)) { tapped = true; break; }
      if (!tapped) { const pr = page.locator('.btn-primary:visible'); if (await pr.count() && await pr.first().evaluate((e) => { const r = e.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!t && (e === t || e.contains(t)); })) { const t = (await pr.first().innerText()).trim(); await pr.first().tap({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(250); tapped = true; console.log('   (主ボタン)', t); } }
      if (!tapped && bs.length) { log.push(`未知のボタン ${bs.join(' / ')}`); console.log('   ?', bs.join(' / ')); }
    }
    // 台詞の枠（▼）は枠をタップして送る
    if (!tapped) { const box = page.locator('.dlg-box:has(.dlg-next)'); if (await box.count() && await box.last().isVisible()) { if (!seen.has(`${key}_dlg`)) await inspect(`${key}_dlg`); await box.last().tap({ timeout: 3000 }).catch(() => {}); tapped = true; } }
    if (!tapped && s) {
      // フィールド：自由時間は残りを縮める。集合移動は会場への道を歩かせる
      if (['morning', 'house', 'night'].includes(s.phase) && s.left > 3000) { await inspect(`${key}_field`); await page.evaluate(() => { window.__fc.G.state.phaseLeft = 2000; }); }
      if ((s.phase === 'gather' || s.phase === 'gatherPrison') && routed !== key) { routed = key; await inspect(`${key}_walk`); await page.evaluate((p) => { const { G, sim } = window.__fc; const st = G.state; sim.setRouteTo(st, st.actors.hero, p === 'gather' ? 'main_arena' : 'prison_arena'); }, s.phase); }
      // 消灯：寝台を調べて「眠る」
      if (s.phase === 'curfew') await page.evaluate(() => { window.__fc.G.interact({ kind: 'bed' }); });
    }
    await page.waitForTimeout(tapped ? 150 : 600);
  }
  const fin = await st();
  console.log(log.join('\n'));
  if (heroOut) check('主人公が脱落したら、その日で終わり、結末の後にタイトルへ戻る', titleAgain && (!fin || fin.day === 1), JSON.stringify(fin));
  else check('DAY2 の朝に進む', fin && fin.day === 2 && fin.phase === 'morning', JSON.stringify(fin));
  check('画面のエラーなし', errs.length === 0, errs.slice(0, 3).join(' / '));
  console.log(res.every(Boolean) ? `全 ${res.length} 件成功` : `${res.filter((x) => !x).length} 件失敗 / ${res.length}`);
  await browser.close();
  process.exit(res.every(Boolean) ? 0 : 1);
})();
