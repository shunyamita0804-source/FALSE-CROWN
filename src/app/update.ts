/**
 * 端末に古い版が残り続けないようにする仕組み。
 * ホーム画面に追加したアプリは、再開してもページを読み込み直さないことがあり、その間は新しい版の確認が行われない。
 * そこで、起動時と画面へ戻った時にサーバーの version.json（キャッシュしない）を見て、
 * いま動いているビルドと違えば、保存済みの古いファイルを捨てて読み込み直す。セーブデータ（localStorage）は消えない。
 */
const KEY = 'fc_update_tried';

async function latestBuild(): Promise<string | null> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = (await r.json()) as { build?: string };
    return typeof j.build === 'string' ? j.build : null;
  } catch {
    return null; // オフラインなど。いまの版のまま遊べる
  }
}

/** 新しい版が公開されているか */
export async function updateAvailable(): Promise<boolean> {
  const b = await latestBuild();
  return !!b && b !== __BUILD_ID__;
}

/** 新しい版があれば入れ替えて読み込み直す。同じ版への入れ替えは 1 回だけ試す（失敗しても繰り返さない） */
export async function applyUpdateIfAny(): Promise<boolean> {
  const b = await latestBuild();
  if (!b || b === __BUILD_ID__) return false;
  try {
    if (sessionStorage.getItem(KEY) === b) return false;
    sessionStorage.setItem(KEY, b);
  } catch { /* 記録できなくても続ける */ }
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch { /* 消せなくても読み込み直しは試す */ }
  location.replace(`${location.pathname}?v=${b}`);
  return true;
}

/** 確認だけ行う（Service Worker にも更新を確認させる） */
export function pokeServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  void navigator.serviceWorker.getRegistration().then((r) => r?.update()).catch(() => undefined);
}
