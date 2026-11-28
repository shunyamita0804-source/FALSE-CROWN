// 開会式と参加者の自己紹介の確認。npm run build の後に sh scripts/with-preview.sh node scripts/check-intro.cjs [写真の保存先]
const { chromium, devices } = require('playwright');
(async () => {
  const out = process.argv[2] || null;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ ...devices['iPhone 13 landscape'] });
  const page = await ctx.newPage();
  const errs = []; page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); page.on('pageerror', (e) => errs.push(String(e)));
  const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  const ev = (f) => page.evaluate(f);
  await page.goto('http://localhost:4173/FALSE-CROWN/'); await page.waitForTimeout(1500);
  // 開会式：専用の曲
  await page.getByText('開発者メニュー').tap(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: '開会式から（本編の始まり）' }).tap(); await page.waitForTimeout(1500);
  check('開会式で専用の曲（Stay the Course）が鳴る', await ev(() => window.__fc.Sound.bgmId) === 'opening', await ev(() => window.__fc.Sound.bgmId));
  if (out) await page.screenshot({ path: out + '/intro_0_ceremony.png' });
  // 説明を最後まで送る
  for (let i = 0; i < 40; i++) {
    const end = page.getByRole('button', { name: '開会式を終える' });
    if (await end.count()) { await end.tap(); break; }
    await page.getByRole('button', { name: '次へ' }).first().tap(); await page.waitForTimeout(120);
  }
  await page.waitForTimeout(600);
  const ho = (await page.locator('.layer').allInnerTexts()).join('|');
  check('説明の後すぐ自由時間にならず、自己紹介の案内が出る', ho.includes('自己紹介') && !ho.includes('正午まで自由時間'), ho.replace(/\s+/g, ' ').slice(0, 120));
  check('説明の終わりで開会式の曲を止める', await ev(() => window.__fc.Sound.bgmId) === null, String(await ev(() => window.__fc.Sound.bgmId)));
  await page.getByRole('button', { name: /中央ホールへ/ }).tap(); await page.waitForTimeout(1200);
  const st = () => ev(() => { const s = window.__fc.G.state; return { phase: s.phase, left: s.phaseLeft, room: s.actors.hero.pos.room, cut: !!window.__fc.G.cutscene }; });
  const a = await st();
  check('自己紹介は中央ホールで、時計が止まっている', a.room === 'main_hall' && a.cut, JSON.stringify(a));
  check('自己紹介の曲に切り替わる', await ev(() => window.__fc.Sound.bgmId) === 'introduction');
  if (out) await page.screenshot({ path: out + '/intro_1_gather.png' });
  // 全員が揃うまで待つ
  for (let i = 0; i < 40 && !(await page.locator('.intro-name').count()); i++) await page.waitForTimeout(500);
  const ring = await ev(() => { const s = window.__fc.G.state; return Object.values(s.actors).filter((x) => x.alive).map((x) => [x.id, x.pos.room, x.pos.x, x.pos.y, !!x.step]); });
  check('12 人全員が中央ホールで立ち止まっている', ring.length === 12 && ring.every((r) => r[1] === 'main_hall' && !r[4]), JSON.stringify(ring.map((r) => r.slice(2, 4))));
  const card1 = ((await page.locator('.intro-tab').innerText()) + ' | ' + (await page.locator('.intro-card').innerText())).replace(/\s+/g, ' ');
  const box = async (sel) => page.locator(sel).first().boundingBox();
  const [pb, cb, sb] = [await box('.intro-profile .intro-bust'), await box('.intro-card'), await box('.intro-top')];
  const [nb, mb, tb] = [await box('.intro-name'), await box('.intro-meta'), await box('.intro-card .intro-text')];
  // 名札（名前｜年齢 職業を 1 行）は台詞の枠の上の縁の左寄りに半分かぶせる。人物は枠の後ろから上に出る。台詞は名札の少し下から（本人の指示、2026-11-28）
  const gb = await box('.intro-tab');
  const layerOk = () => page.evaluate(() => {
    const at = (el, fx, fy) => { const r = el.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width * fx, r.y + r.height * fy); };
    const meta = document.querySelector('.intro-meta'); const txt = document.querySelector('.intro-card .intro-text');
    const m = at(meta, 0.95, 0.5); const t = at(txt, 0.02, 0.3);
    return !!m && !!m.closest('.intro-tab') && !!t && !!t.closest('.intro-card');
  });
  check('人物の絵・名札・台詞の文字が重ならない', pb && cb && sb && gb && (await layerOk()) && gb.y < cb.y && gb.y + gb.height > cb.y && gb.y + gb.height <= tb.y && mb.x >= nb.x + nb.width && gb.height < 60 && pb.y < cb.y - 60 && pb.y >= sb.y + sb.height, JSON.stringify([pb, nb, mb, cb, tb]));
  check('台詞の枠に絵は入れない（名前と年齢は枠の上の名札）', !(await page.locator('.intro-card .bust').count()) && (await page.locator('.intro-card .intro-tab.on').count()) === 1);
  check('話す人の名前、年齢、職業、字幕が出る', /歳/.test(card1) && card1.length > 20, card1);
  const v1 = await ev(() => window.__fc.Sound.lastVoice);
  // 改名した人の古い自己紹介（旧名を名乗る声）は鳴らさない。新しい名前で録り直した声が届いていれば鳴らす
  const fresh = await ev(() => { const id = window.__fc.G.cutscene?.speaker ?? null; return id; });
  const named = /♪/.test(card1);
  check(named ? '自己紹介の声を鳴らす' : '旧名を名乗る古い声は鳴らさない（字幕だけ）', named ? /11_intro/.test(v1) : !/11_intro/.test(v1 || ''), `${v1} ${fresh ?? ''}`);
  if (out) await page.screenshot({ path: out + '/intro_2_talk.png' });
  const b = await st();
  await page.waitForTimeout(1500);
  check('紹介の間は時計が進まない', (await st()).left === b.left);
  // 声の終わりで自動で次へ進む
  const first = await page.locator('.intro-name b').innerText();
  let moved = false;
  for (let i = 0; i < 24 && !moved; i++) { await page.waitForTimeout(500); moved = (await page.locator('.intro-name b').count()) && (await page.locator('.intro-name b').innerText()) !== first; }
  check('自動で次の人へ進む', moved, first);
  // 押して送る
  const second = await page.locator('.intro-name b').innerText();
  await page.locator('.intro-card').tap(); await page.waitForTimeout(400);
  check('画面を押すと次の人へ送る', (await page.locator('.intro-name b').innerText()) !== second);
  // 全員分を送って、主人公（最後）は声なし
  let heroSeen = false;
  let overlapOk = 0;
  for (let i = 0; i < 14; i++) {
    if (!(await page.locator('.intro-name').count())) break;
    const meta = await page.locator('.intro-meta').innerText();
    { const [p1, c1, s1, n1, m1] = [await box('.intro-profile .intro-bust'), await box('.intro-card'), await box('.intro-top'), await box('.intro-name'), await box('.intro-meta')];
      const t1 = await box('.intro-card .intro-text');
      const g1 = await box('.intro-tab');
      const vis = await layerOk();
      // 名札は枠の上の縁にかかり、台詞はその下から。年齢・職業は名前の右で、名札の中に収まる。人物の絵は枠より手前に出ない
      if (!(vis && g1.y < c1.y && g1.y + g1.height > c1.y && g1.y + g1.height <= t1.y && m1.x >= n1.x + n1.width && m1.x + m1.width <= g1.x + g1.width && g1.x >= 0 && p1.y < c1.y - 60 && p1.y >= s1.y + s1.height && t1.y + t1.height <= c1.y + c1.height + 1)) check('全員：枠と文字が重ならない', false, meta + JSON.stringify([p1, c1, s1, t1])); else overlapOk++; }
    if (meta.includes('あなた')) { heroSeen = true; const lv = await ev(() => window.__fc.Sound.voicePlaying); check('主人公は文字だけ（声を鳴らさない）', !lv); if (out) await page.screenshot({ path: out + '/intro_3_hero.png' }); }
    if (await page.locator('.intro-card.talk').count()) await page.locator('.intro-card.talk').tap();
    await page.waitForTimeout(350);
  }
  check('主人公の自己紹介がある', heroSeen);
  check('全員：上段・下段・文字が重ならない', overlapOk >= 10, String(overlapOk));
  // 検査の環境が遅いと、主人公の字幕と解散の演出が測っている間に自動で終わることがある。その時は案内の文を表から確かめる
  const done = (await page.locator('.intro-card.wait').count()) ? (await page.locator('.intro-card.wait').innerText()).replace(/\s+/g, ' ') : null;
  const flags = await ev(() => ({ done: !!window.__fc.G.state.flags.introDone }));
  check('紹介が終わると解散の案内', done ? done.includes('自由時間') : flags.done, done ?? '（自動で解散まで進んだ）');
  await page.waitForTimeout(1500);
  if (out) await page.screenshot({ path: out + '/intro_4_depart.png' });
  { const go = page.getByRole('button', { name: 'スタート' }); if (await go.count()) await go.tap(); } await page.waitForTimeout(1500);
  const c = await st();
  check('紹介の後に自由時間が始まる', !c.cut && c.phase === 'morning' && await ev(() => window.__fc.G.inFreePhase()), JSON.stringify(c));
  const dest = await ev(() => { const s = window.__fc.G.state; return Object.values(s.actors).filter((x) => x.id !== 'hero').map((x) => x.goal ? x.goal.room : x.pos.room); });
  check('NPC はそれぞれの施設へ向かう', dest.filter((r) => r !== 'main_hall').length >= 9, dest.join(','));
  await page.waitForTimeout(2500);
  check('自由時間では時計が進む', (await st()).left < c.left);
  // 手帳：公開プロフィールと自己紹介
  await page.getByRole('button', { name: /手帳/ }).tap(); await page.waitForTimeout(400);
  const tab = page.locator('.tab', { hasText: '関係' }); if (await tab.count()) { await tab.first().tap(); await page.waitForTimeout(300); }
  const book = (await page.locator('.layer').last().innerText()).replace(/\s+/g, ' ');
  check('手帳に年齢・職業と自己紹介が載る', book.includes('自己紹介') && book.includes('28歳・数学者') && !book.includes('まだ話していない'), book.slice(0, 200));
  check('能力値・性格の値は出ない', !/(論理|記憶|交渉|演技|観察|強欲|忠誠|野心|道徳)\s*[:：]?\s*\d/.test(book), book.match(/.{20}(論理|強欲).{20}/)?.[0] || '');
  if (out) await page.screenshot({ path: out + '/intro_5_notebook.png' });
  check('エラーなし', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
  process.exit(res.every(Boolean) ? 0 : 1);
})();
