// 上書きしているスイッチの数をアイコンに出す(入れっぱなしの消し忘れに気付けるように)
async function updateBadge() {
  const { overrides } = await chrome.storage.local.get('overrides');
  const n = Object.keys(overrides || {}).filter((k) => !['__proto__', 'constructor', 'prototype'].includes(k) && !k.startsWith('force_')).length;
  await chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
  await chrome.action.setBadgeText({ text: n ? String(n) : '' });
}

chrome.runtime.onStartup.addListener(updateBadge);
chrome.runtime.onInstalled.addListener(updateBadge);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.overrides) updateBadge();
});
