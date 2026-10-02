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
      ['music_web_enable_contained_content_layout', '配置の変更(中身は未確認)'],
    ],
  },
];
const LIST_LIMIT = 150;

let stored = {}; // 拡張に保存した上書き
let page = null; // { server, applied, loggedIn } / YTM のタブでなければ null
let tab = null;
let query = '';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const c of children) if (c != null) e.append(c);
  return e;
};
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
// 入れ物そのものを書き換えてしまう名前(inject.js でも受け付けない)
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
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
        return { server, applied: st.applied, loggedIn: !!(cfg && cfg.get && cfg.get('LOGGED_IN')) };
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
  if (RESERVED.has(name)) return;
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
        seg(allSame ? vals[0] : null, pickAll, !allSame)),
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
  const names = [...new Set([...Object.keys(page.server), ...Object.keys(stored)])].filter((n) => !RESERVED.has(n));
  $('allCount').textContent = `(${names.length})`;
  const q = query.trim().toLowerCase();
  const hits = names.filter((n) => !q || n.toLowerCase().includes(q))
    .sort((a, b) => (has(stored, b) - has(stored, a)) || a.localeCompare(b));
  for (const n of hits.slice(0, LIST_LIMIT)) root.append(flagRow(n));
  if (hits.length > LIST_LIMIT) root.append(el('div', { className: 'empty', textContent: `ほか ${hits.length - LIST_LIMIT} 件。絞り込んでください` }));
  // 一覧に無い名前も足せるように(サーバーが送ってこない試験スイッチを入れたい時)
  const exact = q && /^[a-z0-9_]+$/.test(q) && !RESERVED.has(q) && !names.includes(q);
  if (exact) {
    root.append(el('div', { className: 'row' },
      el('div', { className: 'row-main' }, el('div', { className: 'name', textContent: q }), el('div', { className: 'server', textContent: 'サーバーは送ってきていない名前' })),
      el('button', { className: 'small', textContent: 'ON で追加', onclick: () => setOverride(q, true) })));
  }
  if (!hits.length && !exact) root.append(el('div', { className: 'empty', textContent: '見つかりません' }));
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
}

$('search').addEventListener('input', (e) => { query = e.target.value; renderAll(); });
$('reload').addEventListener('click', () => { if (tab) chrome.tabs.reload(tab.id); });
$('resetAll').addEventListener('click', () => save({}));
// 読み込み直しが終わったら、反映された状態を読み直す
chrome.tabs.onUpdated.addListener(async (id, info) => {
  if (tab && id === tab.id && info.status === 'complete') { await readPage(); render(); }
});

(async () => {
  const { overrides = {} } = await chrome.storage.local.get('overrides');
  stored = Object.fromEntries(Object.entries(overrides).filter(([k]) => !RESERVED.has(k)));
  await readPage();
  render();
})();
