// Alphabetical, searchable list of subscribed channels.
import * as store from './store.js';
import { el, formatAge, statusOf, fold } from './common.js';

const $ = (id) => document.getElementById(id);
const LETTERS = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];

let channels = [];
const stats = new Map(); // channelId -> { videos, unwatched, started }

function letterOf(title) {
  const ch = fold(title).charAt(0).toUpperCase();
  return ch >= 'A' && ch <= 'Z' ? ch : '#';
}

function describe(c) {
  const s = stats.get(c.id);
  if (!c.lastSync && !s) return 'Not synced yet';
  if (!s) return `No videos · synced ${formatAge(c.lastSync)}`;
  const parts = [`${s.videos} video${s.videos === 1 ? '' : 's'}`, `${s.unwatched} unwatched`];
  if (s.started) parts.push(`${s.started} in progress`);
  if (c.lastSync) parts.push(`synced ${formatAge(c.lastSync)}`);
  return parts.join(' · ');
}

function render() {
  const terms = fold($('q').value).split(/\s+/).filter(Boolean);
  const shown = channels.filter((c) => {
    const hay = fold(`${c.title} ${c.handle || ''}`);
    return terms.every((t) => hay.includes(t));
  });

  const groups = new Map();
  for (const c of shown) {
    const letter = letterOf(c.title);
    if (!groups.has(letter)) groups.set(letter, []);
    groups.get(letter).push(c);
  }

  $('count').textContent = channels.length
    ? terms.length ? `${shown.length} of ${channels.length} channels` : `${channels.length} channels`
    : '';

  $('letters').replaceChildren(...LETTERS.map((l) => groups.has(l)
    ? el('a', { href: `#letter-${l}` }, l)
    : el('span', {}, l)));

  if (!channels.length) {
    $('list').replaceChildren(el('div', { class: 'empty' },
      'No channels yet. Go to ', el('a', { href: 'settings.html' }, 'Settings'), ' to import your subscriptions.'));
    return;
  }
  if (!shown.length) {
    $('list').replaceChildren(el('div', { class: 'empty' }, 'No channels match your search.'));
    return;
  }

  $('list').replaceChildren(...LETTERS.filter((l) => groups.has(l)).map((l) => el('section', { class: 'letter-group' },
    el('h2', { id: `letter-${l}` }, l),
    el('ul', { class: 'channel-list' }, ...groups.get(l).map((c) => el('li', {},
      el('a', { class: 'channel-row', href: `index.html?channel=${encodeURIComponent(c.id)}` },
        c.thumb ? el('img', { src: c.thumb, alt: '', loading: 'lazy' }) : el('span', { class: 'avatar' }),
        el('span', { class: 'channel-text' },
          el('strong', {}, c.title),
          c.handle ? el('span', { class: 'meta' }, c.handle) : null,
          el('span', { class: 'meta' }, describe(c))),
        c.enabled === false ? el('span', { class: 'meta' }, 'excluded from Sync all') : null,
        el('span', { class: 'chev' }, '›'))))))));
}

async function init() {
  const [chs, videos, progress] = await Promise.all([
    store.getAll('channels'), store.getAll('videos'), store.getProgressMap(),
  ]);
  for (const v of videos) {
    if (v.isShort) continue;
    const s = stats.get(v.channelId) || { videos: 0, unwatched: 0, started: 0 };
    s.videos++;
    const status = statusOf(progress.get(v.id), v);
    if (status === 'unwatched') s.unwatched++;
    else if (status === 'started') s.started++;
    stats.set(v.channelId, s);
  }
  channels = chs.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  render();
}

$('q').addEventListener('input', render);
init();
