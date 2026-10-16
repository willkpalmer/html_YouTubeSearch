// Shared formatting helpers.
import { getSettings } from './store.js';
import { VERSION, BUILT } from './version.js';

const settings = getSettings();

// Version stamp at the far right of the top bar, e.g. "v8 · 16 Oct 2026, 23:17".
const topbar = document.querySelector('.topbar');
if (topbar) {
  const built = new Date(BUILT);
  const when = built.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const tag = document.createElement('span');
  tag.className = 'app-version';
  tag.textContent = `v${VERSION} \u00b7 ${when}`;
  tag.title = `Version ${VERSION}, published ${built.toUTCString()}`;
  topbar.append(tag);
}

export function formatDuration(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatAge(ts, now = Date.now()) {
  const sec = Math.max(0, (now - ts) / 1000);
  const units = [
    ['year', 365 * 86400], ['month', 30 * 86400], ['week', 7 * 86400],
    ['day', 86400], ['hour', 3600], ['minute', 60],
  ];
  for (const [name, size] of units) {
    const n = Math.floor(sec / size);
    if (n >= 1) return `${n} ${name}${n > 1 ? 's' : ''} ago`;
  }
  return 'just now';
}

export function formatCount(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : String(c));
  }
  return node;
}

// Lower-case and strip accents, for searching ("Ångström" matches "ang").
export function fold(text) {
  return (text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function youtubeUrl(id, position = 0) {
  return `https://www.youtube.com/watch?v=${id}${position > 5 ? `&t=${Math.floor(position)}s` : ''}`;
}

// A started video counts as finished once you've watched enough of it
// (finishThreshold %) or, for videos over 10 minutes, there's only a little
// left (finishRemaining minutes).
const MIN_LENGTH_FOR_REMAINING_RULE = 10 * 60;

export function isFinished(position, duration) {
  if (!duration || !(position > 0)) return false;
  const threshold = (Number(settings.finishThreshold) || 90) / 100;
  const mins = Number(settings.finishRemaining);
  const remaining = (Number.isFinite(mins) ? mins : 3) * 60;
  return position / duration >= threshold
    || (duration > MIN_LENGTH_FOR_REMAINING_RULE && duration - position < remaining);
}

// Seconds watched. Progress imported from YouTube may only have a percentage
// (ytPercent) until the video's length is known.
export function positionOf(progress, video) {
  if (!progress) return 0;
  if (progress.position > 0) return progress.position;
  const dur = progress.duration || video?.duration || 0;
  return progress.ytPercent > 0 && dur ? (progress.ytPercent / 100) * dur : 0;
}

export function statusOf(progress, video) {
  const status = progress?.status || 'unwatched';
  if (status === 'started' && isFinished(positionOf(progress, video), progress.duration || video?.duration)) return 'finished';
  return status;
}

export function percentOf(progress, video) {
  if (!progress) return 0;
  if (statusOf(progress, video) === 'finished') return 100;
  const dur = progress.duration || video?.duration || 0;
  if (!dur) return Math.round(progress.ytPercent || 0);
  return Math.min(100, Math.round((positionOf(progress, video) / dur) * 100));
}
