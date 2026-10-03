// YouTube Data API v3 helpers and the subscription sync logic.
import * as store from './store.js';

const API = 'https://www.googleapis.com/youtube/v3/';

export class ApiError extends Error {
  constructor(message, status, reason) {
    super(message);
    this.status = status;
    this.reason = reason;
  }
}

async function call(endpoint, params, { apiKey, accessToken } = {}) {
  const url = new URL(API + endpoint);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, v);
  const headers = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  else url.searchParams.set('key', apiKey || store.getSettings().apiKey);
  const res = await fetch(url, { headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = body.error || {};
    const reason = err.errors?.[0]?.reason || '';
    throw new ApiError(err.message || `HTTP ${res.status}`, res.status, reason);
  }
  return body;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// "PT1H2M3S" / "P1DT2H" -> seconds
export function parseDuration(iso) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(iso || '');
  if (!m) return 0;
  const [, d, h, min, s] = m.map((x) => Number(x) || 0);
  return Math.round(d * 86400 + h * 3600 + min * 60 + s);
}

function bestThumb(thumbs = {}) {
  return (thumbs.medium || thumbs.high || thumbs.default || {}).url || '';
}

// ---- Channels / subscriptions ----

export async function fetchChannels(ids) {
  const out = [];
  for (const group of chunk(ids, 50)) {
    const data = await call('channels', { part: 'snippet,contentDetails', id: group.join(','), maxResults: 50 });
    for (const c of data.items || []) {
      out.push({
        id: c.id,
        title: c.snippet.title,
        handle: c.snippet.customUrl || '',
        thumb: bestThumb(c.snippet.thumbnails),
        uploadsId: c.contentDetails?.relatedPlaylists?.uploads || 'UU' + c.id.slice(2),
      });
    }
  }
  return out;
}

// Accepts channel IDs, @handles, or youtube.com/channel/... and youtube.com/@... URLs.
export async function resolveChannelRefs(lines) {
  const ids = new Set();
  const problems = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    let m = /(UC[\w-]{22})/.exec(line);
    if (m) { ids.add(m[1]); continue; }
    m = /@([\w.\-·]+)/.exec(line);
    if (m) {
      const data = await call('channels', { part: 'id', forHandle: '@' + m[1] });
      if (data.items?.length) ids.add(data.items[0].id);
      else problems.push(line);
      continue;
    }
    problems.push(line);
  }
  return { ids: [...ids], problems };
}

// Requires an OAuth access token with youtube.readonly scope.
export async function fetchMySubscriptions(accessToken) {
  const ids = [];
  let pageToken;
  do {
    const data = await call('subscriptions', { part: 'snippet', mine: 'true', maxResults: 50, pageToken }, { accessToken });
    for (const s of data.items || []) ids.push(s.snippet.resourceId.channelId);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return ids;
}

// Works with only an API key, but only if the channel's subscriptions are public.
export async function fetchPublicSubscriptions(channelId) {
  const ids = [];
  let pageToken;
  do {
    const data = await call('subscriptions', { part: 'snippet', channelId, maxResults: 50, pageToken });
    for (const s of data.items || []) ids.push(s.snippet.resourceId.channelId);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return ids;
}

// Google Takeout: "YouTube and YouTube Music/subscriptions/subscriptions.csv"
export function parseSubscriptionsCsv(text) {
  const ids = new Set();
  for (const m of text.matchAll(/\b(UC[\w-]{22})\b/g)) ids.add(m[1]);
  return [...ids];
}

// Google Takeout: "YouTube and YouTube Music/history/watch-history.(json|html)"
export function parseWatchHistory(text) {
  const ids = new Set();
  for (const m of text.matchAll(/watch\?v(?:=|\\u003d)([\w-]{11})/g)) ids.add(m[1]);
  return [...ids];
}

// ---- Videos ----

// Special playlists per channel: UU = all uploads, UULF = long-form videos only
// (no Shorts, no live streams), UULV = past live streams, UUSH = Shorts.
function playlistFor(channelId, prefix) {
  return prefix + channelId.slice(2);
}

async function listPlaylist(playlistId, knownIds, limit) {
  const ids = [];
  let pageToken;
  do {
    const data = await call('playlistItems', { part: 'contentDetails', playlistId, maxResults: 50, pageToken });
    let hitKnown = false;
    for (const item of data.items || []) {
      const id = item.contentDetails.videoId;
      if (knownIds.has(id)) { hitKnown = true; break; }
      ids.push(id);
      if (ids.length >= limit) break;
    }
    if (hitKnown || ids.length >= limit) break;
    pageToken = data.nextPageToken;
  } while (pageToken);
  return ids;
}

async function fetchVideoDetails(ids, channel, kind) {
  const out = [];
  for (const group of chunk(ids, 50)) {
    const data = await call('videos', { part: 'snippet,contentDetails,statistics', id: group.join(','), maxResults: 50 });
    for (const v of data.items || []) {
      const live = v.snippet.liveBroadcastContent;
      if (live === 'upcoming' || live === 'live') continue; // not watchable as a normal video yet
      const duration = parseDuration(v.contentDetails.duration);
      out.push({
        id: v.id,
        channelId: channel.id,
        channelTitle: v.snippet.channelTitle || channel.title,
        title: v.snippet.title,
        description: (v.snippet.description || '').slice(0, 500),
        publishedAt: Date.parse(v.snippet.publishedAt),
        duration,
        views: Number(v.statistics?.viewCount || 0),
        likes: Number(v.statistics?.likeCount || 0),
        thumb: bestThumb(v.snippet.thumbnails),
        kind, // 'video' | 'live' | 'unknown' (fallback: could be a Short)
        isShort: kind === 'unknown' && duration > 0 && duration <= 180,
      });
    }
  }
  return out;
}

// Pull new videos for one channel. Returns the number of new videos stored.
export async function syncChannel(channel, settings = store.getSettings()) {
  const known = new Set(await store.getVideoIdsForChannel(channel.id));
  const limit = Number(settings.maxPerChannel) || 200;
  let added = [];

  const sources = [['UULF', 'video']];
  if (settings.includeLive) sources.push(['UULV', 'live']);

  for (const [prefix, sourceKind] of sources) {
    let ids;
    let kind = sourceKind;
    try {
      ids = await listPlaylist(playlistFor(channel.id, prefix), known, limit);
    } catch (e) {
      if (e.status !== 404) throw e;
      if (prefix !== 'UULF') continue; // channel simply has no live streams
      // Long-form playlist unavailable: fall back to all uploads and guess Shorts by length.
      ids = await listPlaylist(channel.uploadsId || playlistFor(channel.id, 'UU'), known, limit);
      kind = 'unknown';
    }
    ids = ids.filter((id) => !known.has(id));
    ids.forEach((id) => known.add(id));
    if (ids.length) added = added.concat(await fetchVideoDetails(ids, channel, kind));
  }

  if (added.length) await store.putMany('videos', added);
  await store.put('channels', { ...channel, lastSync: Date.now() });
  return added.length;
}

export async function syncAll(onProgress = () => {}) {
  const settings = store.getSettings();
  if (!settings.apiKey) throw new Error('Add your YouTube API key on the Settings page first.');
  const channels = (await store.getAll('channels')).filter((c) => c.enabled !== false);
  let total = 0;
  const errors = [];
  for (let i = 0; i < channels.length; i++) {
    const c = channels[i];
    onProgress({ index: i, count: channels.length, channel: c, total });
    try {
      total += await syncChannel(c, settings);
    } catch (e) {
      if (e.reason === 'quotaExceeded' || e.reason === 'keyInvalid' || (e.status === 400 && /API key/i.test(e.message))) throw e;
      errors.push(`${c.title}: ${e.message}`);
    }
  }
  store.saveSettings({ lastSync: Date.now() });
  onProgress({ index: channels.length, count: channels.length, total, done: true });
  return { total, errors };
}

export async function addChannels(ids) {
  const existing = new Set((await store.getAll('channels')).map((c) => c.id));
  const fresh = ids.filter((id) => !existing.has(id));
  const channels = await fetchChannels(fresh);
  await store.putMany('channels', channels.map((c) => ({ ...c, enabled: true, lastSync: 0 })));
  return channels.length;
}
