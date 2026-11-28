// 新しく収録した参加者の声の確認。npm run build の後に sh scripts/with-preview.sh node scripts/check-npc-voice.cjs [内部ID ...]
// 既定はヴィクター（npc_08_dojima）とヨウコ（npc_07_tachibana）の 15 種ずつ。
// 用途ごとに、その人のフォルダの決まったファイルが選ばれ、読み込めて長さが合い、実際に鳴り、止めると止まることを確かめる。
const { chromium, devices } = require('playwright');
const voice = require('../src/data/voice.json');
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['npc_08_dojima', 'npc_07_tachibana'];
(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ ...devices['iPhone 13 landscape'] });
  const page = await ctx.newPage();
  const errs = []; page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); page.on('pageerror', (e) => errs.push(String(e)));
  const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} ${d}`); };
  await page.goto('http://localhost:4173/FALSE-CROWN/'); await page.waitForTimeout(1500);
  await page.mouse.click(10, 10); // 音を鳴らせるように一度触る
  for (const id of ids) {
    const c = voice.characters[id];
    const all = [...Object.entries(c.clips), ...Object.entries(c.extra)];
    check(`${id}：15 種ある`, all.length === 15, String(all.length));
    for (const [key, clip] of all) {
      const r = await page.evaluate(async ({ id, key }) => {
        const fc = window.__fc; const v = fc.voice.clip(id, key);
        if (!v) return { none: true };
        const buf = await (await fetch(v.url)).arrayBuffer();
        const ac = new AudioContext(); const dur = (await ac.decodeAudioData(buf)).duration; ac.close();
        fc.Sound.stopVoice();
        fc.Sound.voice(v.url, v.gain);
        let playing = false;
        for (let i = 0; i < 30 && !playing; i++) { await new Promise((ok) => setTimeout(ok, 50)); playing = fc.Sound.voicePlaying; }
        fc.Sound.stopVoice(); await new Promise((ok) => setTimeout(ok, 80));
        return { url: v.url, text: v.text, gain: v.gain, dur, playing, stopped: !fc.Sound.voicePlaying };
      }, { id, key });
      if (r.none) { check(`${id} ${key}：選ばれる`, false, '音源なし'); continue; }
      const ok = r.url.endsWith(`${c.dir}/${clip.file}`) && r.text === clip.text && !/未確認/.test(r.text);
      check(`${id} ${key}：${clip.file} が台本どおりに選ばれる`, ok, r.text);
      check(`${id} ${key}：読み込めて長さがある`, r.dur > 0.8 && r.dur < 8, `${r.dur.toFixed(2)} 秒`);
      check(`${id} ${key}：鳴って、止めると止まる`, r.playing && r.stopped, `gain ${r.gain}`);
    }
  }
  check('エラーなし', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
  process.exit(res.every(Boolean) ? 0 : 1);
})();
