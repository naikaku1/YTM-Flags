// ページのスクリプトより先に走り、YTM の試験スイッチ(ytcfg の EXPERIMENT_FLAGS)を上書きする。
// 上書きの中身は bridge.js が localStorage に写しておいたものを同期で読む
// (MAIN world からは chrome.storage を読めず、非同期では YTM の初期化に間に合わない)。
(() => {
  const KEY = 'ytmFlagsDev.overrides';
  // 入れ物そのものを書き換えてしまう名前と、YTM がサーバーに「社内用の実験スイッチ」として送ってしまう force_ で始まる名前は受け付けない
  const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
  const blocked = (k) => RESERVED.has(k) || k.startsWith('force_');
  let overrides = {};
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const k of Object.keys(raw)) if (!blocked(k)) overrides[k] = raw[k];
    }
  } catch (e) {}
  const names = Object.keys(overrides);
  // 上書きが無い時は ytcfg にもページにも一切触れない(拡張が入っていることもページからは分からない)
  if (!names.length) return;
  // ポップアップに見せる状態。original はサーバーが送ってきた上書き前の値、absent はサーバーが送ってこなかった名前
  const state = { applied: overrides, original: {}, absent: [] };
  window.__ytmFlagsDev = state;

  const seen = new WeakSet();
  const apply = (cfg) => {
    let d;
    try { d = cfg && (typeof cfg.d === 'function' ? cfg.d() : cfg.data_); } catch (e) { return; }
    if (!d) return;
    let flags = d.EXPERIMENT_FLAGS;
    if (!flags) { flags = d.EXPERIMENT_FLAGS = {}; seen.add(flags); } // 自分で作った空の入れ物は元の値として記録しない
    if (!seen.has(flags)) {
      // サーバーから届いた一覧を初めて見た時に、上書きする前の値を覚えておく
      seen.add(flags);
      const absent = [];
      for (const k of names) { if (k in flags) state.original[k] = flags[k]; else { delete state.original[k]; absent.push(k); } }
      state.absent = absent;
    }
    for (const k of names) if (flags[k] !== overrides[k]) flags[k] = overrides[k];
  };
  const wrapSet = (cfg) => {
    if (!cfg || typeof cfg.set !== 'function' || cfg.set.__ytmFlagsDev) return;
    const orig = cfg.set;
    const wrapped = function (...args) { const r = orig.apply(this, args); apply(cfg); return r; };
    wrapped.__ytmFlagsDev = true;
    cfg.set = wrapped;
  };

  // ページは `var ytcfg = {...}` → `ytcfg.set({... EXPERIMENT_FLAGS ...})` の順に作る。
  // 先に window.ytcfg を差し替え口にしておき、代入された時点で set を包む
  let real = window.ytcfg;
  try {
    Object.defineProperty(window, 'ytcfg', {
      configurable: true,
      get() { wrapSet(real); apply(real); return real; },
      set(v) { real = v; wrapSet(v); apply(v); },
    });
  } catch (e) {}
  // set が後から付け替えられた場合の取りこぼし対策。初期化が終わる頃まで見張る
  const timer = setInterval(() => { wrapSet(real); apply(real); }, 5);
  setTimeout(() => clearInterval(timer), 15000);
})();
