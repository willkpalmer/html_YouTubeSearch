import * as store from './store.js';
import { syncAll } from './youtube.js';
import { el, formatAge, formatCount, formatDuration, youtubeUrl, statusOf, percentOf } from './common.js';

const PAGE_SIZE = 60;
const FILTER_KEY = 'yt-subs-search-filters';
const DAY = 86400000;

const $ = (id) => document.getElementById(id);
const statusBoxes = [...document.querySelectorAll('#status input')];

let videos = [];
let channels = [];
let progress = new Map();
let filtered = [];
let shown = 0;

// ---- Filter state ----

function readFilters() {
  return {
    q: $('q').value,
    channel: $('channel').value,
    status: statusBoxes.filter((b) => b.checked).map((b) => b.value),
    minLen: $('minLen').value,
    maxLen: $('maxLen').value,
    newerThan: $('newerThan').value,
    olderThan: $('olderThan').value,
    hideShorts: $('hideShorts').checked,
    showLive: $('showLive').checked,
    sort: $('sort').value,
  };
}

function writeFilters(f) {
  $('q').value = f.q ?? '';
  $('channel').value = f.channel ?? '';
  const status = f.status ?? ['unwatched', 'started'];
  statusBoxes.forEach((b) => { b.checked = status.includes(b.value); });
  $('minLen').value = f.minLen ?? '';
  $('maxLen').value = f.maxLen ?? '';
  $('newerThan').value = f.newerThan ?? '';
  $('olderThan').value = f.olderThan ?? '';
  $('hideShorts').checked = f.hideShorts ?? true;
  $('showLive').checked = f.showLive ?? true;
  $('sort').value = f.sort ?? 'newest';
}

function loadSavedFilters() {
  try { return JSON.parse(localStorage.getItem(FILTER_KEY) || '{}'); } catch { return {}; }
}

// ---- Filtering & sorting ----

function applyFilters() {
  const f = readFilters();
  localStorage.setItem(FILTER_KEY, JSON.stringify(f));
  const now = Date.now();
  const terms = f.q.toLowerCase().split(/\s+/).filter(Boolean);
  const minSec = f.minLen !== '' ? Number(f.minLen) * 60 : null;
  const maxSec = f.maxLen !== '' ? Number(f.maxLen) * 60 : null;
  const newest = f.newerThan ? now - Number(f.newerThan) * DAY : null;
  const oldest = f.olderThan ? now - Number(f.olderThan) * DAY : null;
  const statuses = new Set(f.status);

  filtered = videos.filter((v) => {
    if (f.channel && v.channelId !== f.channel) return false;
    if (f.hideShorts && v.isShort) return false;
    if (!f.showLive && v.kind === 'live') return false;
    if (!statuses.has(statusOf(progress.get(v.id), v))) return false;
    if (minSec !== null && v.duration < minSec) return false;
    if (maxSec !== null && v.duration > maxSec) return false;
    if (newest !== null && v.publishedAt < newest) return false;
    if (oldest !== null && v.publishedAt > oldest) return false;
    if (terms.length) {
      const hay = (v._hay ||= `${v.title}\n${v.channelTitle}\n${v.description}`.toLowerCase());
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    return true;
  });

  const p = (v) => progress.get(v.id);
  const remaining = (v) => v.duration - (p(v)?.position || 0);
  const sorters = {
    newest: (a, b) => b.publishedAt - a.publishedAt,
    oldest: (a, b) => a.publishedAt - b.publishedAt,
    longest: (a, b) => b.duration - a.duration,
    shortest: (a, b) => a.duration - b.duration,
    views: (a, b) => b.views - a.views,
    title: (a, b) => a.title.localeCompare(b.title),
    channel: (a, b) => a.channelTitle.localeCompare(b.channelTitle) || b.publishedAt - a.publishedAt,
    recent: (a, b) => (p(b)?.updatedAt || 0) - (p(a)?.updatedAt || 0) || b.publishedAt - a.publishedAt,
    progress: (a, b) => percentOf(p(b), b) - percentOf(p(a), a) || b.publishedAt - a.publishedAt,
    remaining: (a, b) => remaining(a) - remaining(b),
  };
  filtered.sort(sorters[f.sort] || sorters.newest);

  $('grid').replaceChildren();
  shown = 0;
  renderMore();
}

function renderMore() {
  const grid = $('grid');
  const next = filtered.slice(shown, shown + PAGE_SIZE);
  grid.append(...next.map(card));
  shown += next.length;

  const total = videos.length;
  $('count').textContent = total
    ? `${filtered.length.toLocaleString()} of ${total.toLocaleString()} videos`
    : '';
  $('more').hidden = shown >= filtered.length;

  if (!filtered.length) {
    grid.append(el('div', { class: 'empty', style: 'grid-column: 1 / -1' },
      total
        ? 'No videos match these filters.'
        : channels.length
          ? 'No videos yet. Click "Sync new videos" to download your channels’ uploads.'
          : el('span', {}, 'No channels yet. Go to ', el('a', { href: 'settings.html' }, 'Settings'), ' to add your API key and import your subscriptions.')));
  }
}

// ---- Cards ----

function card(v) {
  const prog = progress.get(v.id);
  const status = statusOf(prog, v);
  const pct = percentOf(prog, v);
  const watchHref = `watch.html?v=${v.id}`;

  const statusBadge = status === 'finished'
    ? el('span', { class: 'badge left finished' }, '✓ Finished')
    : status === 'started'
      ? el('span', { class: 'badge left started' }, `${pct}% watched`)
      : null;

  const node = el('article', { class: `card ${status}`, 'data-id': v.id },
    el('a', { class: 'thumb', href: watchHref },
      el('img', { src: v.thumb, alt: '', loading: 'lazy' }),
      statusBadge,
      el('span', { class: 'badge' }, v.kind === 'live' ? `LIVE · ${formatDuration(v.duration)}` : formatDuration(v.duration)),
      pct > 0 && status !== 'finished' ? el('div', { class: 'bar' }, el('div', { style: `width:${pct}%` })) : null),
    el('div', { class: 'body' },
      el('a', { class: 'title', href: watchHref, title: v.title }, v.title),
      el('div', { class: 'meta' },
        el('a', { href: '#', onclick: (e) => { e.preventDefault(); $('channel').value = v.channelId; applyFilters(); } }, v.channelTitle)),
      el('div', { class: 'meta' }, `${formatCount(v.views)} views · ${formatAge(v.publishedAt)}`),
      el('div', { class: 'actions' },
        status !== 'finished'
          ? el('button', { class: 'btn small', onclick: () => mark(v, 'finished') }, '✓ Mark finished')
          : null,
        status !== 'unwatched'
          ? el('button', { class: 'btn small', onclick: () => mark(v, 'unwatched') }, '↺ Mark unwatched')
          : null,
        el('a', { class: 'btn small', href: youtubeUrl(v.id, status === 'started' ? prog.position : 0), target: '_blank', rel: 'noopener' }, 'Open on YouTube ↗'))));
  return node;
}

async function mark(v, status) {
  const rec = await store.setStatus(v.id, status, { duration: v.duration });
  progress.set(v.id, rec);
  const old = document.querySelector(`.card[data-id="${v.id}"]`);
  if (old) old.replaceWith(card(v));
}

// ---- Sync ----

function updateSyncStatus() {
  const { lastSync } = store.getSettings();
  $('syncStatus').textContent = lastSync ? `Last synced ${formatAge(lastSync)}` : 'Never synced';
}

async function runSync() {
  const btn = $('syncBtn');
  btn.disabled = true;
  try {
    const { total, errors } = await syncAll(({ index, count, channel, done }) => {
      $('syncStatus').textContent = done ? 'Finishing…' : `Syncing ${index + 1}/${count}: ${channel.title}`;
    });
    await loadData();
    updateSyncStatus();
    $('syncStatus').textContent += ` · ${total} new video${total === 1 ? '' : 's'}`;
    if (errors.length) alert(`Some channels could not be synced:\n\n${errors.join('\n')}`);
  } catch (e) {
    $('syncStatus').textContent = 'Sync failed';
    alert(e.message);
  } finally {
    btn.disabled = false;
  }
}

// ---- Init ----

async function loadData() {
  [videos, channels, progress] = await Promise.all([
    store.getAll('videos'), store.getAll('channels'), store.getProgressMap(),
  ]);
  const select = $('channel');
  const current = select.value || loadSavedFilters().channel || '';
  const counts = new Map();
  for (const v of videos) counts.set(v.channelId, (counts.get(v.channelId) || 0) + 1);
  select.replaceChildren(el('option', { value: '' }, 'All channels'),
    ...channels
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((c) => el('option', { value: c.id }, `${c.title} (${counts.get(c.id) || 0})`)));
  select.value = channels.some((c) => c.id === current) ? current : '';
  applyFilters();
}

let debounce;
$('filters').addEventListener('input', (e) => {
  clearTimeout(debounce);
  debounce = setTimeout(applyFilters, e.target.id === 'q' ? 200 : 0);
});
$('sort').addEventListener('change', applyFilters);
$('more').addEventListener('click', renderMore);
$('syncBtn').addEventListener('click', runSync);
$('reset').addEventListener('click', () => {
  writeFilters({ sort: $('sort').value });
  applyFilters();
});
document.querySelectorAll('#lenPresets button').forEach((b) => b.addEventListener('click', () => {
  $('minLen').value = b.dataset.min;
  $('maxLen').value = b.dataset.max;
  applyFilters();
}));

// Refresh progress when coming back from the player in another tab.
window.addEventListener('focus', async () => {
  progress = await store.getProgressMap();
  const scroll = window.scrollY;
  const keep = shown;
  applyFilters();
  while (shown < Math.min(keep, filtered.length)) renderMore();
  window.scrollTo(0, scroll);
});

writeFilters(loadSavedFilters());
updateSyncStatus();
loadData();
