import * as store from './store.js';
import * as yt from './youtube.js';
import { el, formatAge } from './common.js';

const $ = (id) => document.getElementById(id);

function msg(id, text, kind = '') {
  const node = $(id);
  node.textContent = text;
  node.className = `msg ${kind}`;
}

async function guard(id, fn) {
  try {
    await fn();
  } catch (e) {
    msg(id, e.message || String(e), 'err');
  }
}

function needKey() {
  if (!store.getSettings().apiKey) throw new Error('Save your API key in step 1 first.');
}

// ---- 1. API key ----

const settings = store.getSettings();
$('apiKey').value = settings.apiKey;
$('clientId').value = settings.clientId;
$('maxPerChannel').value = settings.maxPerChannel;
$('includeLive').checked = settings.includeLive;
$('finishThreshold').value = settings.finishThreshold;
$('originHint').textContent = location.origin;

$('showKey').addEventListener('change', (e) => { $('apiKey').type = e.target.checked ? 'text' : 'password'; });

$('saveKey').addEventListener('click', () => guard('keyMsg', async () => {
  store.saveSettings({ apiKey: $('apiKey').value.trim() });
  msg('keyMsg', 'Testing…');
  // A cheap request (1 unit) to verify the key works.
  await yt.fetchChannels(['UCBR8-60-B28hp2BmDPdntcQ']);
  msg('keyMsg', 'Key saved and working.', 'ok');
}));

// ---- 2. Import ----

async function importIds(ids, source) {
  needKey();
  if (!ids.length) throw new Error(`No channels found in ${source}.`);
  msg('importMsg', `Looking up ${ids.length} channels…`);
  const added = await yt.addChannels(ids);
  msg('importMsg', `Found ${ids.length} channels in ${source}; ${added} new added. Now click "Sync all channels now" below.`, 'ok');
  await renderChannels();
}

$('csvFile').addEventListener('change', (e) => guard('importMsg', async () => {
  const file = e.target.files[0];
  if (!file) return;
  await importIds(yt.parseSubscriptionsCsv(await file.text()), file.name);
  e.target.value = '';
}));

$('pasteBtn').addEventListener('click', () => guard('importMsg', async () => {
  needKey();
  const { ids, problems } = await yt.resolveChannelRefs($('paste').value.split('\n'));
  await importIds(ids, 'the pasted list');
  if (problems.length) msg('importMsg', `${$('importMsg').textContent}\nCouldn't recognise: ${problems.join(', ')}`, 'err');
  else $('paste').value = '';
}));

$('publicBtn').addEventListener('click', () => guard('importMsg', async () => {
  needKey();
  const { ids } = await yt.resolveChannelRefs([$('myChannel').value]);
  if (!ids.length) throw new Error('Enter a channel ID (UC…) or @handle.');
  let subs;
  try {
    subs = await yt.fetchPublicSubscriptions(ids[0]);
  } catch (e) {
    if (e.reason === 'subscriptionForbidden') throw new Error('That channel’s subscriptions are private. Use option A, B or C instead.');
    throw e;
  }
  await importIds(subs, 'your public subscriptions');
}));

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = Object.assign(document.createElement('script'), { src, onload: resolve, onerror: () => reject(new Error(`Could not load ${src}`)) });
    document.head.append(s);
  });
}

$('oauthBtn').addEventListener('click', () => guard('importMsg', async () => {
  needKey();
  const clientId = $('clientId').value.trim();
  if (!clientId) throw new Error('Paste your OAuth client ID first.');
  store.saveSettings({ clientId });
  await loadScript('https://accounts.google.com/gsi/client');
  const token = await new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/youtube.readonly',
      callback: (resp) => (resp.error ? reject(new Error(resp.error_description || resp.error)) : resolve(resp.access_token)),
      error_callback: (err) => reject(new Error(err.message || err.type || 'Sign-in cancelled')),
    });
    client.requestAccessToken();
  });
  msg('importMsg', 'Signed in. Reading subscriptions…');
  await importIds(await yt.fetchMySubscriptions(token), 'your account');
}));

// ---- 3. Channels & sync ----

for (const id of ['maxPerChannel', 'includeLive', 'finishThreshold']) {
  $(id).addEventListener('change', (e) => {
    store.saveSettings({ [id]: e.target.type === 'checkbox' ? e.target.checked : Number(e.target.value) });
  });
}

async function renderChannels() {
  const [channels, videos] = await Promise.all([store.getAll('channels'), store.getAll('videos')]);
  const counts = new Map();
  for (const v of videos) counts.set(v.channelId, (counts.get(v.channelId) || 0) + 1);
  channels.sort((a, b) => a.title.localeCompare(b.title));
  $('channelRows').replaceChildren(...(channels.length ? channels.map((c) => el('tr', {},
    el('td', {}, c.thumb ? el('img', { src: c.thumb, alt: '', loading: 'lazy' }) : null),
    el('td', {}, el('a', { href: `https://www.youtube.com/channel/${c.id}/videos`, target: '_blank', rel: 'noopener' }, c.title)),
    el('td', {}, String(counts.get(c.id) || 0)),
    el('td', {}, c.lastSync ? formatAge(c.lastSync) : 'never'),
    el('td', {}, el('input', {
      type: 'checkbox', checked: c.enabled !== false, title: 'Include this channel when syncing',
      onchange: (e) => store.put('channels', { ...c, enabled: e.target.checked }),
    })),
    el('td', {},
      el('button', { class: 'btn small', onclick: () => syncOne(c) }, 'Sync'), ' ',
      el('button', {
        class: 'btn small',
        onclick: async () => {
          if (!confirm(`Remove ${c.title} and its videos?`)) return;
          await store.removeChannel(c.id);
          renderChannels();
        },
      }, 'Remove')))) : [el('tr', {}, el('td', { colspan: 6 }, 'No channels yet – import some in step 2.'))]));
}

function syncOne(channel) {
  return guard('syncMsg', async () => {
    needKey();
    msg('syncMsg', `Syncing ${channel.title}…`);
    const n = await yt.syncChannel(channel);
    msg('syncMsg', `${channel.title}: ${n} new videos.`, 'ok');
    renderChannels();
  });
}

async function syncAll() {
  const btn = $('syncAllBtn');
  btn.disabled = true;
  await guard('syncMsg', async () => {
    const { total, errors } = await yt.syncAll(({ index, count, channel, total: soFar, done }) => {
      if (!done) msg('syncMsg', `Syncing ${index + 1} of ${count}: ${channel.title} (${soFar} new so far)…`);
    });
    msg('syncMsg', `Done: ${total} new videos.${errors.length ? `\nProblems:\n${errors.join('\n')}` : ''}`, errors.length ? 'err' : 'ok');
  });
  btn.disabled = false;
  renderChannels();
}

$('syncAllBtn').addEventListener('click', syncAll);
$('refetchBtn').addEventListener('click', async () => {
  if (!confirm('Delete all stored videos and download them again? Watch progress is kept.')) return;
  await store.clear('videos');
  const channels = await store.getAll('channels');
  await store.putMany('channels', channels.map((c) => ({ ...c, lastSync: 0 })));
  await syncAll();
});

// ---- 4. Watch history ----

$('historyFile').addEventListener('change', (e) => guard('historyMsg', async () => {
  const file = e.target.files[0];
  if (!file) return;
  const ids = yt.parseWatchHistory(await file.text());
  if (!ids.length) throw new Error('No watched videos found in that file.');
  const status = $('historyStatus').value;
  const progress = await store.getProgressMap();
  const changed = ids
    .filter((id) => (progress.get(id)?.status || 'unwatched') === 'unwatched')
    .map((id) => ({ ...(progress.get(id) || { position: 0 }), id, status, updatedAt: 0, imported: true }));
  await store.putMany('progress', changed);
  msg('historyMsg', `Read ${ids.length} watched videos; marked ${changed.length} as ${status}.`, 'ok');
  e.target.value = '';
}));

// ---- 5. Backup ----

$('exportBtn').addEventListener('click', async () => {
  const blob = new Blob([JSON.stringify(await store.exportAll(), null, 1)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `subscription-search-backup-${new Date().toISOString().slice(0, 10)}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('importFile').addEventListener('change', (e) => guard('backupMsg', async () => {
  const file = e.target.files[0];
  if (!file) return;
  await store.importAll(JSON.parse(await file.text()));
  msg('backupMsg', 'Backup imported. Click "Sync all channels now" to download the videos.', 'ok');
  e.target.value = '';
  renderChannels();
}));

$('wipeBtn').addEventListener('click', async () => {
  if (!confirm('Delete all channels, videos and watch progress from this browser?')) return;
  await Promise.all(['channels', 'videos', 'progress'].map((s) => store.clear(s)));
  store.saveSettings({ lastSync: 0 });
  msg('backupMsg', 'All data deleted.', 'ok');
  renderChannels();
});

renderChannels();
