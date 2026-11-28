// 確認用：IPHONE=1 の時、ノッチのある iPhone の横画面（932×430、左右 59・下 21 の余白）を再現する画面を開く
module.exports.newPhoneContext = async (browser, opts = {}) => {
  const notch = !!process.env.IPHONE;
  const ctx = await browser.newContext({ viewport: notch ? { width: 932, height: 430 } : { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ...opts });
  if (notch) await ctx.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '#safe-probe{padding:0 59px 21px 59px !important}'; document.head.append(st); setTimeout(() => window.dispatchEvent(new Event('resize')), 50); }); });
  return ctx;
};
/** 画面の中（セーフエリアの内側）に収まっているか。収まっていない要素の説明を返す */
module.exports.offscreen = (page, sel) => page.evaluate((sel) => {
  const notch = window.innerWidth === 932; const L = notch ? 59 : 0, R = window.innerWidth - (notch ? 59 : 0), B = window.innerHeight - (notch ? 21 : 0);
  const bad = [];
  document.querySelectorAll(sel).forEach((e) => { const r = e.getBoundingClientRect(); if (r.width && (r.left < L - 1 || r.right > R + 1 || r.top < -1 || r.bottom > B + 1)) bad.push(`${e.className} ${Math.round(r.left)},${Math.round(r.top)}-${Math.round(r.right)},${Math.round(r.bottom)}`); });
  return bad;
}, sel);
