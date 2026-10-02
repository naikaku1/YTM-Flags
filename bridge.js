// 拡張に保存した上書きを、ページの localStorage に写す(inject.js が読み込みの最初に同期で読む)。
// chrome.storage は非同期なので、写すのは inject.js が読んだ後になる。写す前の中身が保存内容と違えば
// (新しいプロファイルで初めて開いた時・サイトデータを消した後・YTM のタブが無い時に変えた時)、
// このページは古い上書きで動いているので、1 回だけ読み込み直す
const KEY = 'ytmFlagsDev.overrides';
const RELOADED = 'ytmFlagsDev.reloadedFor';

const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } };
const same = (a, b) => {
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && a[k] === b[k]);
};

function write(overrides) {
  try {
    if (Object.keys(overrides).length) localStorage.setItem(KEY, JSON.stringify(overrides));
    else localStorage.removeItem(KEY);
  } catch (e) {}
}

chrome.storage.local.get('overrides').then(({ overrides = {} }) => {
  if (same(read(), overrides)) return;
  write(overrides);
  // localStorage が使えない環境で読み込み直しを繰り返さないよう、同じ内容では 1 回まで
  const sig = JSON.stringify(Object.entries(overrides).sort());
  try {
    if (sessionStorage.getItem(RELOADED) === sig) return;
    sessionStorage.setItem(RELOADED, sig);
  } catch (e) { return; }
  if (same(read(), overrides)) location.reload();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.overrides) write(changes.overrides.newValue || {});
});
