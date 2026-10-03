// 試験スイッチの上書きを編集するポップアップ。
// 上書きは chrome.storage.local の overrides({名前: 値})に置き、開いている YTM のタブの様子(サーバー値・反映済みの上書き)を読んで並べる
const KEY = 'ytmFlagsDev.overrides';
const PRESETS = [
  {
    title: '新プレイヤーバー',
    note: 'ON で新しいプレイヤーバー、OFF で元のプレイヤーバー。どちらに切り替えても、バーの高評価・低評価ボタンは出なくなる(YouTube から届くデータの形が合わないため)',
    flags: [
      ['music_web_enable_wiz_miniplayer', '新しいバー本体(ytmusic-miniplayer)'],
      ['music_web_enable_action_bar_view_model_in_player_overlay', 'バーの高評価・低評価(新しい形)'],
      ['music_web_enable_like_count_in_player_overlay', '高評価の数'],
      ['music_web_enable_contained_content_layout', '中身だけがスクロールする配置(サイドバーとバーは固定。コードから推測)'],
    ],
  },
  {
    title: 'コードから見つけた機能',
    note: 'YTM の JS に入っていたが、まだ広く配られていない機能。✓ は動くことを確かめたもの。ほかはコードから読み取った中身で、効くかどうかは未確認',
    single: true, // まとめて切り替えるものではないので、一括の切り替えは出さない
    flags: [
      ['music_web_enable_album_art_zoom', '✓ アルバム・プレイリストのジャケットをクリックすると全画面で開く'],
      ['music_web_enable_equalizer_now_playing_indicator', '再生中の曲の印を、動くイコライザーにする'],
      ['music_home_enable_new_content_pill', 'タブに戻った時、ホームに「新しいおすすめ」ボタンを出す'],
      ['music_web_enable_library_page_scroll_persistence', 'ライブラリに戻った時、スクロール位置を保つ'],
      ['music_populate_web_player_bar_using_queue_metadata', 'プレイヤーバーの高評価ボタンを、キューの曲情報から作る'],
      ['enable_equal_shelf_spacing', '横に流れる棚の間隔をそろえる'],
      ['music_web_enable_diwali_india_promo_interactions', '高評価・再生ボタンでディワリの花火が出る(季節の販促)'],
    ],
  },
];
const LIST_LIMIT = 150;
// 届いていないスイッチのうち、名前から見て修正・停止用・記録・広告・通信まわりらしいもの(見た目は変わらないことが多い)
const NOISE = /fix|killswitch|kill_switch|_ks$|_ks_|log|metric|telemetry|(^|_)ads?(_|$)|deprecat|migrat|refactor|cleanup|tracing|csi|gel|cache|prefetch|debug|test|holdback|perf|optimi|mweb|(^|_)tv|unplugged|kids|embed|ios|android|aosp|automotive|latency|innertube|request|endpoint|network|retry|timeout|canary|idb|ping|jspb|shadydom|biscotti|auth|token|attestation|botguard|polymer|scheduler|header/;

let stored = {}; // 拡張に保存した上書き
let page = null; // { server, applied, loggedIn } / YTM のタブでなければ null
let tab = null;
let query = '';
let scan = null; // { src, total, hidden, at } / JS から探した結果
let hiddenQuery = '';
let showNoise = false;

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const c of children) if (c != null) e.append(c);
  return e;
};
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
// 受け付けない名前(inject.js・background.js も同じ)。
// __proto__ などは入れ物そのものを書き換えてしまう。force_ で始まる名前は、YTM が「社内用の実験スイッチ」として
// YouTube のサーバーに送ってしまう(ページの表示を変えるだけ、という範囲を越える)
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
const blocked = (k) => RESERVED.has(k) || k.startsWith('force_');
const show = (v) => (v === undefined ? 'なし' : JSON.stringify(v));
const sameOverrides = (a, b) => {
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
};
// 入力欄の文字を値にする: true/false は真偽、数字は数、それ以外は文字列
const parseValue = (s) => {
  const t = s.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return t;
};

async function readPage() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  page = null;
  if (!tab || !/^https:\/\/music\.youtube\.com\//.test(tab.url || '')) return;
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: () => {
        const cfg = window.ytcfg;
        const flags = (cfg && typeof cfg.get === 'function' && cfg.get('EXPERIMENT_FLAGS')) || {};
        const st = window.__ytmFlagsDev || { applied: {}, original: {}, absent: [] };
        // 上書きした名前はサーバーの元の値に戻して返す
        const server = { ...flags };
        for (const k of Object.keys(st.applied)) {
          if (st.absent.includes(k)) delete server[k];
          else if (k in st.original) server[k] = st.original[k];
        }
        // YTM 本体の JS(届いていないスイッチを探す時に読む)
        const src = [...document.scripts].map((s) => s.src).find((s) => /\/music_polymer[^/]*\.js(\?|$)/.test(s)) || null;
        return { server, applied: st.applied, loggedIn: !!(cfg && cfg.get && cfg.get('LOGGED_IN')), src };
      },
    });
    page = result;
  } catch (e) {
    page = null;
  }
}

async function save(next) {
  stored = next;
  await chrome.storage.local.set({ overrides: stored });
  // bridge.js も写すが、再読み込みとの前後を気にしなくて済むようここでも直接写す
  if (page && tab) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [KEY, stored],
      func: (key, o) => {
        if (Object.keys(o).length) localStorage.setItem(key, JSON.stringify(o));
        else localStorage.removeItem(key);
      },
    }).catch(() => {});
  }
  render();
}

function setOverride(name, value) {
  if (blocked(name)) return;
  const next = { ...stored };
  if (value === undefined) delete next[name];
  else next[name] = value;
  save(next);
}

// 既定 / ON / OFF の切り替え
function seg(current, onPick, mixed = false) {
  const box = el('div', { className: 'seg' + (mixed ? ' mixed' : '') });
  for (const [label, value, cls] of [['既定', undefined, ''], ['ON', true, 'on'], ['OFF', false, 'off']]) {
    const sel = !mixed && current === value;
    box.append(el('button', { textContent: label, className: (sel ? 'sel ' : '') + cls, onclick: () => onPick(value) }));
  }
  return box;
}

function flagRow(name, label) {
  const server = page ? page.server[name] : undefined;
  const overridden = has(stored, name);
  const cur = stored[name];
  const main = el('div', { className: 'row-main' },
    label ? el('div', { className: 'label', textContent: label }) : null,
    el('div', { className: 'name', textContent: name }),
    el('div', { className: 'server', textContent: page ? `サーバー: ${show(server)}` : '' }));
  const row = el('div', { className: 'row' + (overridden ? ' overridden' : '') }, main);
  const boolish = (server === undefined || typeof server === 'boolean') && (!overridden || typeof cur === 'boolean');
  if (boolish) {
    row.append(seg(cur, (v) => setOverride(name, v)));
  } else {
    // 数や文字列のスイッチは値を打ち込む
    const input = el('input', { className: 'val', value: overridden ? String(cur) : '', placeholder: show(server) });
    input.addEventListener('change', () => setOverride(name, input.value.trim() === '' ? undefined : parseValue(input.value)));
    row.append(input, el('button', { className: 'small', textContent: '既定', onclick: () => setOverride(name, undefined) }));
  }
  return row;
}

function renderPresets() {
  const root = $('presets');
  root.replaceChildren();
  for (const p of PRESETS) {
    const names = p.flags.map(([n]) => n);
    const vals = names.map((n) => (has(stored, n) ? stored[n] : undefined));
    const allSame = vals.every((v) => v === vals[0]);
    const pickAll = (v) => {
      const next = { ...stored };
      for (const n of names) { if (v === undefined) delete next[n]; else next[n] = v; }
      save(next);
    };
    root.append(el('div', { className: 'group' },
      el('div', { className: 'group-head' },
        el('span', { className: 'group-title', textContent: p.title }),
        p.single ? null : seg(allSame ? vals[0] : null, pickAll, !allSame)),
      el('div', { className: 'group-note', textContent: p.note }),
      ...p.flags.map(([n, label]) => flagRow(n, label))));
  }
}

function renderActive() {
  const names = Object.keys(stored).sort();
  $('activeCount').textContent = names.length ? `(${names.length})` : '';
  const root = $('active');
  root.replaceChildren();
  if (!names.length) { root.append(el('div', { className: 'empty', textContent: 'なし(すべてサーバーの値のまま)' })); return; }
  for (const n of names) {
    const server = page ? page.server[n] : undefined;
    root.append(el('div', { className: 'row overridden' },
      el('div', { className: 'row-main' },
        el('div', { className: 'name', textContent: n }),
        el('div', { className: 'server', textContent: `→ ${show(stored[n])}` + (page ? `(サーバー: ${show(server)})` : '') })),
      el('button', { className: 'small', textContent: '既定に戻す', onclick: () => setOverride(n, undefined) })));
  }
}

function renderAll() {
  const root = $('all');
  root.replaceChildren();
  if (!page) {
    $('allCount').textContent = '';
    root.append(el('div', { className: 'empty', textContent: 'YouTube Music のタブで開くと、サーバーから届いたスイッチの一覧が出ます' }));
    return;
  }
  const names = [...new Set([...Object.keys(page.server), ...Object.keys(stored)])].filter((n) => !blocked(n));
  $('allCount').textContent = `(${names.length})`;
  const q = query.trim().toLowerCase();
  const hits = names.filter((n) => !q || n.toLowerCase().includes(q))
    .sort((a, b) => (has(stored, b) - has(stored, a)) || a.localeCompare(b));
  for (const n of hits.slice(0, LIST_LIMIT)) root.append(flagRow(n));
  if (hits.length > LIST_LIMIT) root.append(el('div', { className: 'empty', textContent: `ほか ${hits.length - LIST_LIMIT} 件。絞り込んでください` }));
  // 一覧に無い名前も足せるように(サーバーが送ってこない試験スイッチを入れたい時)
  const exact = q && /^[a-z0-9_]+$/.test(q) && !blocked(q) && !names.includes(q);
  if (exact) {
    root.append(el('div', { className: 'row' },
      el('div', { className: 'row-main' }, el('div', { className: 'name', textContent: q }), el('div', { className: 'server', textContent: 'サーバーは送ってきていない名前' })),
      el('button', { className: 'small', textContent: 'ON で追加', onclick: () => setOverride(q, true) })));
  }
  if (q.startsWith('force_')) root.append(el('div', { className: 'empty', textContent: 'force_ で始まる名前は、YTM が YouTube のサーバーに送ってしまうため追加できません' }));
  else if (!hits.length && !exact) root.append(el('div', { className: 'empty', textContent: '見つかりません' }));
}

// YTM の JS を読み、スイッチを読む関数(届いたスイッチの名前を一番多く読んでいる関数)を見つけて、
// その関数が読む名前のうち、このアカウントにもログアウト状態にも届いていないものを返す。
// タブの中(拡張側の隔離された環境)で動く。読むのは YTM 自身の JS とトップページだけ
async function scanBundle(src, sentNames) {
  const js = await (await fetch(src)).text();
  let loggedOut = [];
  try {
    const html = await (await fetch('/', { credentials: 'omit' })).text();
    const m = html.match(/"EXPERIMENT_FLAGS":(\{.*?\})/);
    if (m) loggedOut = Object.keys(JSON.parse(m[1]));
  } catch (e) {}
  const sent = new Set([...sentNames, ...loggedOut]);
  const byFn = new Map();
  for (const [, fn, name] of js.matchAll(/(?<![\w$.])((?:[\w$]{1,3}\.)?[\w$]{1,4})\("([a-z][a-z0-9_]{5,})"/g)) {
    if (!name.includes('_')) continue;
    if (!byFn.has(fn)) byFn.set(fn, new Set());
    byFn.get(fn).add(name);
  }
  let best = null, bestHit = 0;
  for (const [fn, names] of byFn) {
    let hit = 0;
    for (const n of names) if (sent.has(n)) hit++;
    if (hit > bestHit) { best = fn; bestHit = hit; }
  }
  if (!best || bestHit < 20) return { error: 'スイッチを読む関数が見つかりませんでした(YTM の作りが変わったのかもしれません)' };
  const all = [...byFn.get(best)];
  return { total: all.length, hidden: all.filter((n) => !sent.has(n)).sort(), loggedOutChecked: loggedOut.length > 0 };
}

async function runScan() {
  if (!page || !page.src || !tab) return;
  $('scan').disabled = true;
  $('scanStatus').textContent = '読み込み中…(数秒かかります)';
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [page.src, Object.keys(page.server)],
      func: scanBundle,
    });
    if (result.error) { $('scanStatus').textContent = result.error; return; }
    scan = { src: page.src, total: result.total, hidden: result.hidden, loggedOutChecked: result.loggedOutChecked, at: Date.now() };
    await chrome.storage.local.set({ scan });
  } catch (e) {
    $('scanStatus').textContent = `読み込めませんでした: ${e.message}`;
    return;
  } finally {
    $('scan').disabled = false;
  }
  renderHidden();
}

function renderHidden() {
  const root = $('hidden');
  root.replaceChildren();
  $('scan').disabled = !page || !page.src;
  const status = $('scanStatus');
  if (!scan) {
    $('hiddenCount').textContent = '';
    status.textContent = page ? (page.src ? '' : 'このページでは YTM の本体の JS が見つかりません') : '';
    root.append(el('div', { className: 'empty', textContent: page ? '「JS から探す」を押すと一覧が出ます' : 'YouTube Music のタブで開いてください' }));
    return;
  }
  // 探した後にサーバーが送り始めた名前は外す。上書き中の名前は残す
  const names = scan.hidden.filter((n) => !blocked(n) && !(page && has(page.server, n)));
  const visible = names.filter((n) => showNoise || !NOISE.test(n) || has(stored, n));
  $('hiddenCount').textContent = `(${visible.length}${showNoise ? '' : ` / 全 ${names.length}`})`;
  const stale = page && page.src && page.src !== scan.src;
  status.textContent = `${new Date(scan.at).toLocaleString()} に探した結果` +
    (scan.loggedOutChecked ? '' : '(ログアウト状態との比較はできませんでした)') +
    (stale ? '。YTM が更新されているので、探し直してください' : '');
  const q = hiddenQuery.trim().toLowerCase();
  const hits = visible.filter((n) => !q || n.includes(q))
    .sort((a, b) => (has(stored, b) - has(stored, a)) || a.localeCompare(b));
  for (const n of hits.slice(0, LIST_LIMIT)) root.append(flagRow(n));
  if (hits.length > LIST_LIMIT) root.append(el('div', { className: 'empty', textContent: `ほか ${hits.length - LIST_LIMIT} 件。絞り込んでください` }));
  if (!hits.length) root.append(el('div', { className: 'empty', textContent: '見つかりません' }));
}

function renderStatus() {
  const s = $('status');
  s.className = 'status';
  if (!page) {
    s.textContent = 'このタブは YouTube Music ではありません(保存した上書きは YTM を開いた時に効きます)';
    s.classList.add('warn');
  } else {
    s.textContent = `このタブ: ${page.loggedIn ? 'ログイン中' : 'ログアウト中'} / 反映中の上書き ${Object.keys(page.applied).length} 件`;
  }
  $('pending').hidden = !page || sameOverrides(stored, page.applied);
}

function render() {
  renderStatus();
  renderPresets();
  renderActive();
  renderAll();
  renderHidden();
}

$('search').addEventListener('input', (e) => { query = e.target.value; renderAll(); });
$('hiddenSearch').addEventListener('input', (e) => { hiddenQuery = e.target.value; renderHidden(); });
$('showNoise').addEventListener('change', (e) => { showNoise = e.target.checked; renderHidden(); });
$('scan').addEventListener('click', runScan);
$('reload').addEventListener('click', () => { if (tab) chrome.tabs.reload(tab.id); });
$('resetAll').addEventListener('click', () => save({}));
// 読み込み直しが終わったら、反映された状態を読み直す
chrome.tabs.onUpdated.addListener(async (id, info) => {
  if (tab && id === tab.id && info.status === 'complete') { await readPage(); render(); }
});

(async () => {
  const { overrides = {}, scan: saved } = await chrome.storage.local.get(['overrides', 'scan']);
  stored = Object.fromEntries(Object.entries(overrides).filter(([k]) => !blocked(k)));
  scan = saved && Array.isArray(saved.hidden) ? saved : null;
  await readPage();
  render();
})();
