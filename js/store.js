// Local storage for channels, videos and watch progress (IndexedDB),
// plus small settings (localStorage). Everything stays in this browser.

const DB_NAME = 'yt-subs-search';
const DB_VERSION = 1;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('channels')) db.createObjectStore('channels', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('videos')) {
        const videos = db.createObjectStore('videos', { keyPath: 'id' });
        videos.createIndex('channelId', 'channelId');
      }
      if (!db.objectStoreNames.contains('progress')) db.createObjectStore('progress', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(storeName, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    let result;
    Promise.resolve(fn(store)).then((r) => { result = r; }, reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const getAll = (storeName) => tx(storeName, 'readonly', (s) => promisify(s.getAll()));
export const get = (storeName, key) => tx(storeName, 'readonly', (s) => promisify(s.get(key)));
export const put = (storeName, value) => tx(storeName, 'readwrite', (s) => promisify(s.put(value)));
export const remove = (storeName, key) => tx(storeName, 'readwrite', (s) => promisify(s.delete(key)));
export const clear = (storeName) => tx(storeName, 'readwrite', (s) => promisify(s.clear()));

export function putMany(storeName, values) {
  return tx(storeName, 'readwrite', (s) => {
    for (const v of values) s.put(v);
  });
}

export function getVideoIdsForChannel(channelId) {
  return tx('videos', 'readonly', (s) => promisify(s.index('channelId').getAllKeys(channelId)));
}

export function removeChannel(channelId) {
  return tx('videos', 'readwrite', async (s) => {
    const keys = await promisify(s.index('channelId').getAllKeys(channelId));
    for (const k of keys) s.delete(k);
  }).then(() => remove('channels', channelId));
}

// ---- Watch progress ----
// status: 'unwatched' | 'started' | 'finished'

export async function getProgressMap() {
  const all = await getAll('progress');
  return new Map(all.map((p) => [p.id, p]));
}

export async function setStatus(videoId, status, extra = {}) {
  const existing = (await get('progress', videoId)) || { id: videoId, position: 0 };
  const rec = { ...existing, ...extra, status, updatedAt: Date.now() };
  if (status === 'unwatched') rec.position = 0;
  await put('progress', rec);
  return rec;
}

// ---- Settings ----

const SETTINGS_KEY = 'yt-subs-search-settings';
const DEFAULT_SETTINGS = {
  apiKey: '',
  clientId: '',
  maxPerChannel: 200,
  includeLive: false,
  finishThreshold: 90,
  finishRemaining: 3,
  lastSync: 0,
};

export function getSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

// ---- Backup ----

export async function exportAll() {
  const settings = getSettings();
  return {
    app: DB_NAME,
    exportedAt: new Date().toISOString(),
    settings: { ...settings, apiKey: undefined, clientId: undefined },
    channels: await getAll('channels'),
    progress: await getAll('progress'),
  };
}

export async function importAll(data) {
  if (!data || data.app !== DB_NAME) throw new Error('This does not look like a backup from this app.');
  if (Array.isArray(data.channels)) await putMany('channels', data.channels.map((c) => ({ ...c, lastSync: 0 })));
  if (Array.isArray(data.progress)) await putMany('progress', data.progress);
}
