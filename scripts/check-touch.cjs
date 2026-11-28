// 画面左下の移動スティックの回帰確認。他の参加者が入れない自分の個室で行い、確認中は NPC から話しかけられないようにする。
// npm run build のあとに：sh scripts/with-preview.sh node scripts/check-touch.cjs [写真の保存先フォルダ]
const { chromium, devices } = require('playwright');
const url = process.env.URL || 'http://localhost:4173/FALSE-CROWN/';
const out = process.argv[2] || '';
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
  const pos = () => page.evaluate(() => { const p = window.__fc.G.state.actors.hero.pos; return `${p.room}:${p.x},${p.y}`; });
  const xy = () => page.evaluate(() => { const p = window.__fc.G.state.actors.hero.pos; return { room: p.room, x: p.x, y: p.y, dir: p.dir }; });
  const active = () => page.evaluate(() => window.__fc.Input.stickActive());
  const held = () => page.evaluate(() => window.__fc.Input.touchHeld().join(','));
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i })) });
  const dismiss = async () => { for (let k = 0; k < 4; k++) { const b = page.getByRole('button', { name: '断る' }); if (await b.count()) { await b.first().tap(); await page.waitForTimeout(300); } const box = page.locator('.dlg-box'); if (await box.count()) { await box.first().tap(); await page.waitForTimeout(300); } } };
  const place = async (p = { room: 'bedroom_hero', x: 9, y: 11, dir: 'down' }) => {
    await dismiss();
    await page.evaluate((p) => { const st = window.__fc.G.state; st.phaseLeft = 1e9; for (const [id, a] of Object.entries(st.actors)) if (id !== 'hero') a.talkCd = { ...(a.talkCd || {}), hero: 1e15 }; const h = st.actors.hero; h.step = undefined; h.path = []; h.route = []; h.pos = { ...p }; }, p);
    await page.waitForTimeout(700);
  };
  const results = [];
  const check = (name, ok, detail) => { results.push(!!ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' (' + detail + ')' : ''}`); };
  // 離したあと歩行が止まるか。歩き終わりの1歩ぶんを待ってから、位置が動かないことを見る
  const stopped = async () => { await page.waitForTimeout(1000); const a = await pos(); await page.waitForTimeout(900); const b = await pos(); return { ok: a === b, detail: `${a} / ${b}` }; };
  const geom = async () => { const b = await page.locator('.touch-stick .stick-base').boundingBox(); return { cx: b.x + b.width / 2, cy: b.y + b.height / 2, r: b.width / 2 }; };
  let g = await geom();
  const at = (deg, k = 0.8) => ({ x: g.cx + Math.cos((deg * Math.PI) / 180) * g.r * k, y: g.cy + Math.sin((deg * Math.PI) / 180) * g.r * k });
  const C = () => ({ x: g.cx, y: g.cy });
  const actBox = await page.locator('.touch-act button').boundingBox();
  const A = { x: actBox.x + actBox.width / 2, y: actBox.y + actBox.height / 2, id: 7 };

  // 配置：左下の固定位置、右下に「話す・調べる」
  const vp = page.viewportSize();
  check('スティックは画面の左下', g.cx < vp.width * 0.3 && g.cy > vp.height * 0.55, `中心 ${g.cx.toFixed(0)},${g.cy.toFixed(0)} 半径 ${g.r.toFixed(0)}`);
  check('行動ボタンは画面の右側', A.x > vp.width * 0.7);
  check('方向キーは出ていない', (await page.locator('.touch-pad').count()) === 0);

  await place();
  let p0 = await pos();
  await touch('touchStart', [C()]); await page.waitForTimeout(700);
  check('中央に触れただけでは動かない', (await pos()) === p0 && (await active()), `${p0} / ${await pos()}`);
  await touch('touchMove', [at(0, 0.18)]); await page.waitForTimeout(500);
  check('無反応領域の中で少し動かしても動かない', (await pos()) === p0);
  await touch('touchMove', [at(0)]); await page.waitForTimeout(800);
  let q = await xy();
  check('右へ倒すと右へ歩く', q.x > 9 && q.y === 11 && q.dir === 'right', `${p0} から ${q.x},${q.y} ${q.dir}`);
  await touch('touchEnd', []);
  let s = await stopped(); check('指を離すと止まる', s.ok && !(await active()), s.detail);

  // 斜め：上と左へ同時に進む。向きは近い 4 方向
  await place({ room: 'bedroom_hero', x: 12, y: 11, dir: 'down' });
  await touch('touchStart', [at(-135)]); await page.waitForTimeout(700);
  q = await xy();
  check('斜めに倒すと斜めに歩く', q.x < 12 && q.y < 11, `12,11 から ${q.x},${q.y}`);
  check('斜めでも向きは 4 方向の歩行の絵', ['up', 'left'].includes(q.dir), q.dir);
  await touch('touchMove', [at(-170)]); await page.waitForTimeout(300);
  check('指を滑らせると向きが変わる', (await xy()).dir === 'left');
  await touch('touchEnd', []); await stopped();

  // 縁より外へ指を出しても、つまみは縁で止まり、歩き続ける
  await place();
  await touch('touchStart', [at(0)]); await page.waitForTimeout(200);
  await touch('touchMove', [at(0, 1.9)]); await page.waitForTimeout(400);
  const knob = await page.evaluate(() => getComputedStyle(document.querySelector('.stick-knob')).transform);
  check('スティックの外へ指を出しても操作は続く', (await active()) && (await xy()).x > 9, knob);
  await touch('touchEnd', []); await stopped();

  // マルチタッチ：歩きながら右側のボタンを押せる
  await place();
  await touch('touchStart', [{ ...at(0), id: 1 }]); await page.waitForTimeout(250);
  await touch('touchStart', [{ ...at(0), id: 1 }, A]); await page.waitForTimeout(200);
  const both = (await active()) && (await held()) === 'a';
  const before = await pos(); await page.waitForTimeout(300);
  check('歩きながら右側のボタンを押せる', both && (await pos()) !== before, `stick=${await active()} key=${await held()}`);
  // 右側の指だけ離す（残る指だけを送る）
  await touch('touchEnd', [A]); await page.waitForTimeout(150);
  const mid = await pos(); await page.waitForTimeout(300);
  check('右側のボタンを離しても歩き続ける', (await active()) && (await held()) === '' && (await pos()) !== mid, `stick=${await active()} key=${await held()}`);
  await touch('touchEnd', []);
  s = await stopped(); check('両方離すと止まる', s.ok && !(await active()), s.detail);

  await place(); await touch('touchStart', [at(180)]); await page.waitForTimeout(400);
  await touch('touchCancel', []);
  s = await stopped(); check('タッチが中断されると止まる', s.ok && !(await active()), s.detail);

  await place(); await touch('touchStart', [at(0)]); await page.waitForTimeout(300);
  await touch('touchMove', [{ x: -20, y: g.cy }]); await page.waitForTimeout(100);
  await touch('touchMove', [at(0)]);
  s = await stopped(); check('画面の外まで指を動かすと解除され、戻しても動かない', s.ok && !(await active()), s.detail);
  await touch('touchEnd', []);

  await place(); await touch('touchStart', [at(0)]); await page.waitForTimeout(400);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  s = await stopped(); check('アプリが背面に回ると止まる', s.ok && !(await active()), s.detail);
  await touch('touchEnd', []);
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await page.waitForTimeout(300);

  await place(); await touch('touchStart', [at(0)]); await page.waitForTimeout(400);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  s = await stopped(); check('画面が隠れると止まる', s.ok && !(await active()), s.detail);
  await touch('touchEnd', []);

  await place(); await touch('touchStart', [at(0)]); await page.waitForTimeout(400);
  await page.evaluate(() => { document.querySelector('.touch-stick').style.display = 'none'; });
  s = await stopped(); check('スティックが画面から消えると止まる', s.ok && !(await active()), s.detail);
  await page.evaluate(() => { document.querySelector('.touch-stick').style.display = ''; });
  await touch('touchEnd', []);

  await place(); await touch('touchStart', [at(0)]); await page.waitForTimeout(400);
  await page.evaluate(() => window.__fc.G.openMenu());
  await page.waitForTimeout(300);
  check('メニューを開くと解除される', !(await active()));
  await touch('touchEnd', []);
  await page.keyboard.press('Escape'); await page.waitForTimeout(400); await dismiss();

  // 会話の開始：NPC の隣で右のボタンを押す
  await place({ room: 'main_hall', x: 14, y: 9, dir: 'right' });
  await page.evaluate(() => { const s = window.__fc.G.state; const id = Object.keys(s.actors).find((k) => k !== 'hero' && s.actors[k].alive); const a = s.actors[id]; a.goal = undefined; a.path = []; a.route = []; a.step = undefined; a.busyUntil = 1e15; a.nextThink = 1e15; a.pos = { room: 'main_hall', x: 15, y: 9, dir: 'left' }; });
  await page.waitForTimeout(400);
  await touch('touchStart', [{ ...at(90, 0.15), id: 1 }]); await page.waitForTimeout(150);
  await touch('touchStart', [{ ...at(90, 0.15), id: 1 }, A]); await page.waitForTimeout(150);
  await touch('touchEnd', [{ ...at(90, 0.15), id: 1 }]); await page.waitForTimeout(600);
  const talking = await page.evaluate(() => !!document.querySelector('.layer:not(.layer-passive) .dlg-screen, .layer:not(.layer-passive) .dlg-box'));
  check('会話が始まるとスティックは解除される', talking && !(await active()), `会話=${talking}`);
  await touch('touchEnd', []);
  for (let k = 0; k < 6 && (await page.evaluate(() => !!document.querySelector('.layer:not(.layer-passive)'))); k++) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
  await dismiss();

  // 扉：歩いて扉へ入ると、着いた先ではスティックが解除されて止まる
  await place({ room: 'bedroom_hero', x: 9, y: 11, dir: 'down' });
  const startRoom = (await xy()).room;
  await touch('touchStart', [at(90)]);
  let moved = false;
  for (let k = 0; k < 40; k++) { await page.waitForTimeout(150); if ((await xy()).room !== startRoom) { moved = true; break; } }
  await page.waitForTimeout(900);
  const after = await xy();
  check('扉を通って部屋が変わるとスティックは解除され、止まる', moved && !(await active()), `${startRoom} → ${after.room}`);
  s = await stopped(); check('着いた先で歩き出さない', s.ok, s.detail);
  await touch('touchEnd', []);

  // キーボード（PC）
  await place();
  await page.keyboard.down('ArrowRight'); await page.waitForTimeout(600); await page.keyboard.up('ArrowRight');
  q = await xy(); check('キーボードの方向キーで歩く', q.x > 9 && q.y === 11, `${q.x},${q.y}`);
  await stopped();
  await place({ room: 'bedroom_hero', x: 12, y: 11, dir: 'down' });
  await page.keyboard.down('ArrowUp'); await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(500);
  await page.keyboard.up('ArrowUp'); await page.keyboard.up('ArrowLeft');
  q = await xy(); check('キーボードの 2 つ同時押しで斜めに歩く', q.x < 12 && q.y < 11, `${q.x},${q.y}`);
  s = await stopped(); check('キーを離すと止まる', s.ok, s.detail);

  // 写真：ノッチとホームバーの余白（iPhone 横画面の左右 47px、下 21px）をつけて
  if (out) {
    await page.evaluate(() => { const p = document.getElementById('safe-probe'); if (p) p.style.padding = '0px 47px 21px 47px'; window.dispatchEvent(new Event('resize')); });
    await page.waitForTimeout(800);
    g = await geom();
    await place({ room: 'main_hall', x: 14, y: 9, dir: 'down' });
    await touch('touchStart', [at(-30)]); await page.waitForTimeout(1300);
    await page.screenshot({ path: `${out}/stick_walk.png` });
    console.log('  写真の時点 ' + JSON.stringify(await xy()) + ' stick=' + (await active()) + ' ' + await page.evaluate(() => { const v = window.__fc.G.field.actors.get('hero'); const c = window.__fc.G.field.cameras.main; return v.sprite.texture.key + '#' + v.sprite.frame.name + ' at ' + v.sprite.x.toFixed(0) + ',' + v.sprite.y.toFixed(0) + ' cam ' + c.scrollX.toFixed(0) + ',' + c.scrollY.toFixed(0) + ' ' + window.__fc.G.state.hero.name; }));
    const box = await page.locator('.touch-stick .stick-base').boundingBox();
    check('ノッチの余白より内側', box.x >= 47, `左端 ${box.x.toFixed(0)}`);
    await touch('touchEnd', []);
  }

  await browser.close();
  const bad = results.filter((x) => !x).length;
  console.log(bad ? `${bad} 件失敗` : `全 ${results.length} 件成功`);
  process.exit(bad ? 1 : 0);
})();
