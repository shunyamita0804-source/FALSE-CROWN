// 自己紹介の声の確認。npm run build の後に sh scripts/with-preview.sh node scripts/check-intro-voice.cjs [写真の保存先]
// 新しい名前で録り直した人は声が鳴り、字幕は管理表の台詞と同じ全文を最初から明るく出す（声に合わせてなぞらない）。
// 押して次へ送る時と、「飛ばす」で紹介を終える時に、鳴っている声が止まることを確かめる。
const { chromium, devices } = require('playwright');
const voice = require('../src/data/voice.json');
const names = require('../src/data/npc_names.json');
(async () => {
  const out = process.argv[2] || null;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ ...devices['iPhone 13 landscape'] });
  const page = await ctx.newPage();
  const errs = []; page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); page.on('pageerror', (e) => errs.push(String(e)));
  const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  const ev = (f) => page.evaluate(f);
  const strip = (x) => x.replace(/[\s・]+/g, '');
  // 名前 → 内部ID、いまの名前を名乗る声のある人
  const byName = {}; const fresh = {};
  for (const [id, e] of Object.entries(names.characters)) {
    byName[e.ja.short] = id;
    const c = voice.characters[id]?.extra?.introduction;
    if (c && strip(c.spokenName) === strip(e.ja.name)) fresh[id] = c;
  }
  console.log('新しい名前の声:', Object.keys(fresh).join(', '));
  const toIntro = async () => {
    await page.goto('http://localhost:4173/FALSE-CROWN/'); await page.waitForTimeout(1500);
    await page.getByText('開発者メニュー').tap(); await page.waitForTimeout(400);
    await page.getByRole('button', { name: '開会式から（本編の始まり）' }).tap(); await page.waitForTimeout(1200);
    for (let i = 0; i < 40; i++) {
      const end = page.getByRole('button', { name: '開会式を終える' });
      if (await end.count()) { await end.tap(); break; }
      await page.getByRole('button', { name: '次へ' }).first().tap(); await page.waitForTimeout(120);
    }
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: /中央ホールへ/ }).tap(); await page.waitForTimeout(1200);
    for (let i = 0; i < 40 && !(await page.locator('.intro-name').count()); i++) await page.waitForTimeout(500);
  };
  const card = async () => {
    await page.waitForTimeout(250);
    return ev(() => {
      const t = document.querySelector('.intro-text'); const cs = getComputedStyle(t);
      const rgb = cs.color.match(/\d+/g).map(Number);
      return { name: document.querySelector('.intro-name b').innerText, text: t.innerText, lum: (rgb[0] + rgb[1] + rgb[2]) / 3, opacity: Number(cs.opacity), spans: t.children.length, url: window.__fc.Sound.lastVoice, playing: window.__fc.Sound.voicePlaying };
    });
  };
  await toIntro();
  const seen = new Set();
  for (let i = 0; i < 13; i++) {
    if (!(await page.locator('.intro-name').count())) break;
    const c = await card();
    const id = byName[c.name];
    if (id && fresh[id]) {
      seen.add(id);
      check(`${c.name}：声が鳴る`, c.playing && c.url.endsWith(`${id}/${fresh[id].file}`), c.url.split('/').slice(-2).join('/'));
      check(`${c.name}：字幕が台本の全文`, c.text === fresh[id].text, c.text);
      check(`${c.name}：字幕を最初から明るく全文で出す（なぞらない）`, c.lum > 180 && c.opacity === 1 && c.spans === 0, `明るさ ${Math.round(c.lum)}`);
      if (out) await page.screenshot({ path: `${out}/intro_${id}.png` });
      await page.locator('.intro-card').tap(); await page.waitForTimeout(250);
      const after = await ev(() => ({ url: window.__fc.Sound.lastVoice, playing: window.__fc.Sound.voicePlaying }));
      check(`${c.name}：押して次へ送ると声が止まる`, !after.playing || after.url !== c.url, after.url.split('/').slice(-2).join('/'));
    } else {
      await page.locator('.intro-card').tap(); await page.waitForTimeout(250);
    }
  }
  check('録り直した 7 人を全員確かめた', Object.keys(fresh).every((id) => seen.has(id)), [...seen].join(','));
  // 「飛ばす」で紹介を終えた時も止まる
  await toIntro();
  let ok = false; let who = '';
  for (let i = 0; i < 13 && !ok; i++) {
    const c = await card();
    if (c.playing) {
      who = c.name;
      await page.getByRole('button', { name: /飛ばす/ }).first().tap(); await page.waitForTimeout(300);
      ok = !(await ev(() => window.__fc.Sound.voicePlaying));
      break;
    }
    await page.locator('.intro-card').tap();
  }
  check('「飛ばす」で紹介を終えると声が止まる', ok, who);
  check('エラーなし', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
  process.exit(res.every(Boolean) ? 0 : 1);
})();
