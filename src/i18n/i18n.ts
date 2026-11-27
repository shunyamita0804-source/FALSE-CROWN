/**
 * 多言語対応。文章は src/locales/<言語>/*.json に置き、プログラムからはキーで参照する。
 * 未翻訳のキーは日本語にフォールバックする（日本語版を先に完成させ、英語は後から正式翻訳する方針）。
 * 言語を追加する時は locales/<言語>/ を作り、LANGS と DICTS に登録する。
 */
import jaUi from '../locales/ja/ui.json';
import enUi from '../locales/en/ui.json';

export type Lang = 'ja' | 'en';
export const LANGS: { id: Lang; name: string }[] = [
  { id: 'ja', name: '日本語' },
  { id: 'en', name: 'English' },
];

const DICTS: Record<Lang, Record<string, string>> = {
  ja: jaUi as Record<string, string>,
  en: enUi as Record<string, string>,
};

let lang: Lang = 'ja';
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return lang;
}

export function setLang(l: Lang): void {
  lang = DICTS[l] ? l : 'ja';
  document.documentElement.lang = lang;
  listeners.forEach((f) => f());
}

export function onLangChange(fn: () => void): void {
  listeners.add(fn);
}

/** 文言を取得する。{name} 形式の変数を置換する */
export function t(key: string, vars?: Record<string, string | number>): string {
  let s = DICTS[lang][key] ?? DICTS.ja[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

export function hasKey(key: string): boolean {
  return key in DICTS.ja;
}
