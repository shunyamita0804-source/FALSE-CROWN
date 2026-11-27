// 歩行の回帰確認。npm run build と npx vite preview --port 4173 の後に実行する。
// node scripts/check-walk.cjs [URL]
const { chromium, devices } = require('playwright');
const url = process.argv[2] || 'http://localhost:4173/FALSE-CROWN/';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13 landscape'] });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await page.goto(url);
  await page.waitForTimeout(1500);
  await page.getByText('開発者メニュー').tap();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: '中央ホール', exact: true }).tap();
  await page.waitForTimeout(3000);
  const results = [];
  const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' (' + detail + ')' : ''}`); };
  const quiet = () => page.evaluate(() => { const st = window.__fc.G.state; for (const [id, a] of Object.entries(st.actors)) if (id !== 'hero') { a.talkCd = { ...(a.talkCd || {}), hero: 1e15 }; a.goal = undefined; a.path = []; a.route = []; a.step = undefined; a.busyUntil = 1e15; a.nextThink = 1e15; if (a.pos.room !== 'dining') window.__fc.sim.placeIn(st, id, 'dining'); } st.phaseLeft = 290000; });
  const place = (room, x, y) => page.evaluate(([room, x, y]) => { const h = window.__fc.G.state.actors.hero; h.step = undefined; h.path = []; h.route = []; h.pos = { room, x, y, dir: 'down' }; }, [room, x, y]);
  const center = async (sel) => { const b = await page.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i })) });
  // 毎フレーム、指定した人物の表示位置・画像・コマを記録する
  const record = (ms, ids) => page.evaluate(([ms, ids]) => new Promise((resolve) => {
    const scene = window.__fc.G.field; const out = []; const t0 = performance.now();
    const tick = () => {
      const t = performance.now() - t0; const row = { t, sim: window.__fc.G.state.simTime };
      for (const id of ids) { const v = scene.actors.get(id); if (v) row[id] = { x: v.sprite.x, y: v.sprite.y, tex: v.sprite.texture.key.split(':')[0], frame: Number(v.sprite.frame.name), w: v.sprite.displayWidth, h: v.sprite.displayHeight }; }
      row.cam = { x: scene.cameras.main.scrollX, y: scene.cameras.main.scrollY };
      out.push(row);
      if (t < ms) requestAnimationFrame(tick); else resolve(out);
    };
    requestAnimationFrame(tick);
  }), [ms, ids]);
  await quiet();

  // ---- 主人公：4 方向の連続歩行（生活棟の廊下は横に長く、カメラも動く） ----
  const btn = { right: await center('.touch-pad .right'), left: await center('.touch-pad .left'), up: await center('.touch-pad .up'), down: await center('.touch-pad .down') };
  const ROW = { down: 0, up: 1, left: 2, right: 3 };
  const cases = [['right', 'living_hallway', 3, 5, 1200], ['left', 'living_hallway', 26, 5, 1200], ['down', 'bedroom_hero', 10, 4, 800], ['up', 'bedroom_hero', 10, 11, 800]];
  for (const [dir, room, x, y, ms] of cases) {
    await place(room, x, y); await page.waitForTimeout(1800); await quiet();
    await touch('touchStart', [btn[dir]]);
    await page.waitForTimeout(250);
    const rec = (await record(ms, ['hero'])).filter((r) => r.hero);
    await touch('touchEnd', []);
    const axis = dir === 'left' || dir === 'right' ? 'x' : 'y';
    const speeds = []; let standFrames = 0; let wrongRow = 0; let sizeChange = 0; let camOff = 0; const frames = [];
    for (let i = 1; i < rec.length; i++) {
      const a = rec[i - 1], b = rec[i]; const dt = b.sim - a.sim; if (dt <= 0) continue;
      speeds.push(Math.abs(b.hero[axis] - a.hero[axis]) / dt);
      if (b.hero.tex === 'stand') standFrames++;
      if (Math.floor(b.hero.frame / 4) !== ROW[dir]) wrongRow++;
      if (b.hero.w !== rec[0].hero.w || b.hero.h !== rec[0].hero.h) sizeChange++;
      if (frames[frames.length - 1] !== b.hero.frame % 4) frames.push(b.hero.frame % 4);
    }
    const moved = Math.abs(rec[rec.length - 1].hero[axis] - rec[0].hero[axis]);
    const span = rec[rec.length - 1].sim - rec[0].sim;
    const mean = moved / span;
    // ゲーム内時間に対して速度が一定か（1 フレームの長さが変わっても、進む距離が時間に比例するか）を見る
    const dev = Math.max(...speeds.map((v) => Math.abs(v - mean) / mean));
    const cyc = frames.join('');
    check(`主人公 ${dir}：速度が一定`, dev < 0.02, `平均 ${(mean * 1000).toFixed(1)} px/秒、最大のずれ ${(dev * 100).toFixed(2)}%`);
    check(`主人公 ${dir}：歩行中に待機画像へ切り替わらない`, standFrames === 0, `${standFrames} フレーム`);
    check(`主人公 ${dir}：向きと進行方向が一致`, wrongRow === 0);
    check(`主人公 ${dir}：表示サイズが変わらない`, sizeChange === 0);
    check(`主人公 ${dir}：コマが 0→1→2→3 の順に進む`, /^(0123|1230|2301|3012)+[0-3]{0,3}$/.test(cyc + '') || '01230123012301230123'.includes(cyc), cyc);
    await page.waitForTimeout(500);
    const rest = (await record(200, ['hero'])).filter((r) => r.hero);
    const last = rest[rest.length - 1].hero;
    check(`主人公 ${dir}：止まると待機画像になる`, last.tex === 'stand' && rest[0].hero[axis] === last[axis]);
  }

  // ---- タップ移動の廃止 ----
  await place('bedroom_hero', 9, 11); await page.waitForTimeout(1500); await quiet();
  const pos = () => page.evaluate(() => { const p = window.__fc.G.state.actors.hero.pos; return `${p.room}:${p.x},${p.y}`; });
  const p0 = await pos();
  const vp = page.viewportSize();
  for (const [fx, fy] of [[0.62, 0.45], [0.5, 0.3], [0.75, 0.6], [0.5, 0.9]]) { await page.touchscreen.tap(vp.width * fx, vp.height * fy); await page.waitForTimeout(500); }
  check('フィールドをタップしても主人公は動かない', (await pos()) === p0 && !(await page.evaluate(() => !!document.querySelector('.dlg-box'))), `${p0} / ${await pos()}`);

  // ---- NPC：全員を 4 方向に歩かせ、向き・コマ送り・速度を確認する（主人公と同じ処理） ----
  const ids = await page.evaluate(() => Object.keys(window.__fc.G.state.actors).filter((k) => k !== 'hero'));
  await place('living_hallway', 28, 7); await page.waitForTimeout(1500);
  const legs = [['right', 4, 5, 12, 5], ['left', 12, 5, 4, 5], ['down', 15, 4, 15, 7], ['up', 15, 7, 15, 4]];
  const problems = []; let covered = 0;
  for (const id of ids) {
    await page.evaluate((id) => { const { G, sim } = window.__fc; for (const a of Object.values(G.state.actors)) if (a.id !== 'hero' && a.id !== id) { a.path = []; a.route = []; a.step = undefined; sim.placeIn(G.state, a.id, 'dining'); a.busyUntil = G.state.simTime + 60000; } }, id);
    for (const [dir, x0, y0, x1, y1] of legs) {
      await page.evaluate(([id, x0, y0, x1, y1]) => { const { G, sim } = window.__fc; const a = G.state.actors[id]; a.path = []; a.route = []; a.step = undefined; a.goal = undefined; a.busyUntil = 0; a.nextThink = 1e15; G.state.phaseLeft = 290000; sim.placeIn(G.state, id, 'living_hallway', { x: x0, y: y0 }); sim.setPathTo(G.state, a, x1, y1); }, [id, x0, y0, x1, y1]);
      const rec = (await record(dir === 'left' || dir === 'right' ? 2300 : 1100, [id])).filter((r) => r[id]);
      const axis = dir === 'left' || dir === 'right' ? 'x' : 'y'; const sign = dir === 'right' || dir === 'down' ? 1 : -1;
      let n = 0, wrong = 0, stand = 0; const speeds = []; const frames = [];
      for (let i = 1; i < rec.length; i++) {
        const a = rec[i - 1][id], b = rec[i][id]; const d = (b[axis] - a[axis]) * sign; const dt = rec[i].sim - rec[i - 1].sim;
        if (d < 0.01 || d > 40 || dt <= 0) continue;
        n++; speeds.push(d / dt);
        // 目的地に着いたフレームは待機画像でよい（そのフレームで歩き終えている）
        const arrived = i === rec.length - 1 || Math.abs(rec[i + 1][id][axis] - b[axis]) < 0.01;
        if (b.tex === 'stand') { if (!arrived) stand++; } else { if (Math.floor(b.frame / 4) !== ROW[dir]) wrong++; if (frames[frames.length - 1] !== b.frame % 4) frames.push(b.frame % 4); }
      }
      // 歩き始めと歩き終わりのフレームは 1 フレームの途中で動き出す・止まるので、速度の確認から除く
      const mid = speeds.slice(1, -1);
      const mean = mid.reduce((p, c) => p + c, 0) / Math.max(1, mid.length);
      const dev = mid.length ? Math.max(...mid.map((v) => Math.abs(v - mean) / mean)) : 1;
      const cyc = frames.join('');
      const okCycle = '0123012301230123'.includes(cyc) && cyc.length >= 3;
      if (n < 8 || wrong || stand || dev > 0.02 || !okCycle) problems.push(`${id} ${dir}: 歩行 ${n} フレーム、向きの不一致 ${wrong}、待機画像 ${stand}、速度のずれ ${(dev * 100).toFixed(1)}%、コマ ${cyc}`);
      else covered++;
    }
  }
  check(`NPC ${ids.length} 人 × 4 方向：向き、コマ送り、速度`, problems.length === 0, problems.length ? problems.join(' / ') : `${covered} 通りすべて正常`);

  await browser.close();
  const nbad = results.filter((x) => !x).length;
  console.log(nbad ? `${nbad} 件失敗` : `全 ${results.length} 件成功`);
  process.exit(nbad ? 1 : 0);
})();
