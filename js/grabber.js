// The "Grab YouTube progress" bookmarklet. It runs on youtube.com (where you're
// signed in), reads the red resume bars YouTube draws on video thumbnails, and
// sends them to this app's Settings page in the URL hash.
//
// grabProgress is serialised with toString(), so it must be self-contained:
// no imports, no outside variables. It also must not use innerHTML, which
// YouTube's Trusted Types policy blocks.

export function grabProgress(appUrl) {
  if (!/(^|\.)youtube\.com$/.test(location.hostname)) {
    alert('Open youtube.com first (your History page, or a channel’s Videos tab), then click this bookmark.');
    return;
  }
  if (window.__subsSearchGrab) return;
  window.__subsSearchGrab = true;

  const found = new Map(); // videoId -> { p: percent, t: seconds, i: order seen }
  let order = 0;

  function add(id, p, t) {
    if (!/^[\w-]{11}$/.test(id || '') || (p == null && t == null)) return;
    const cur = found.get(id) || { i: order++ };
    if (p != null && !(cur.p >= p)) cur.p = Math.max(0, Math.min(100, p));
    if (t != null) cur.t = t;
    found.set(id, cur);
  }

  function parseT(value) {
    if (!value) return null;
    if (/^\d+$/.test(value)) return Number(value);
    const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
    return m && m[0] ? (Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0) : null;
  }

  // 1) Data YouTube embedded in the page when it first loaded.
  function walk(o, id, depth) {
    if (!o || typeof o !== 'object' || depth > 80) return;
    if (Array.isArray(o)) { for (const x of o) walk(x, id, depth + 1); return; }
    if (typeof o.videoId === 'string' && o.videoId.length === 11) id = o.videoId;
    else if (typeof o.contentId === 'string' && o.contentId.length === 11) id = o.contentId;
    if (id && typeof o.percentDurationWatched === 'number') add(id, o.percentDurationWatched, null);
    for (const k in o) {
      const v = o[k];
      // Watched-progress bars only: YouTube also uses startPercent for "segment"
      // bars that highlight part of a video, which aren't watch progress.
      if (id && /progressbar/i.test(k) && v && typeof v.startPercent === 'number'
        && v.segmentDurationPercent == null && !/SEGMENT/.test(v.style || '')) add(id, v.startPercent, null);
      walk(v, id, depth + 1);
    }
  }
  try { walk(window.ytInitialData, null, 0); } catch (e) { /* ignore */ }

  // 2) What's on screen now (covers videos loaded while scrolling).
  const CARDS = [
    'ytd-rich-item-renderer', 'ytd-video-renderer', 'ytd-grid-video-renderer', 'ytd-compact-video-renderer',
    'ytd-playlist-video-renderer', 'ytd-playlist-panel-video-renderer', 'yt-lockup-view-model',
  ].join(',');
  const BARS = [
    'ytd-thumbnail-overlay-resume-playback-renderer #progress',
    '[class*="WatchedProgressBarSegment"]',
    '[class*="ResumePlayback"] [style*="width"]',
  ].join(',');

  function scanDom() {
    for (const card of document.querySelectorAll(CARDS)) {
      const a = card.querySelector('a[href*="watch?v="]');
      if (!a) continue;
      let url;
      try { url = new URL(a.href, location.href); } catch (e) { continue; }
      const bar = card.querySelector(BARS);
      const m = bar && /width:\s*([\d.]+)%/.exec(bar.getAttribute('style') || '');
      add(url.searchParams.get('v'), m ? Number(m[1]) : null, parseT(url.searchParams.get('t')));
    }
  }

  // ---- Overlay UI ----
  const box = document.createElement('div');
  Object.assign(box.style, {
    position: 'fixed', right: '16px', bottom: '16px', zIndex: 2147483647, width: '320px',
    background: '#1b1b1d', color: '#fff', font: '14px/1.4 system-ui, sans-serif',
    padding: '14px 16px', borderRadius: '12px', boxShadow: '0 6px 24px rgba(0,0,0,.4)',
  });
  const title = document.createElement('div');
  title.textContent = 'Subscription Search';
  title.style.fontWeight = '700';
  const status = document.createElement('div');
  status.style.margin = '6px 0 10px';
  const row = document.createElement('div');
  Object.assign(row.style, { display: 'flex', gap: '8px', flexWrap: 'wrap' });
  function button(label, primary, onClick) {
    const b = document.createElement('button');
    b.textContent = label;
    Object.assign(b.style, {
      font: 'inherit', padding: '6px 12px', borderRadius: '8px', cursor: 'pointer',
      border: '1px solid #555', background: primary ? '#ff4e45' : '#2a2b2e', color: '#fff',
    });
    b.addEventListener('click', onClick);
    row.append(b);
    return b;
  }
  box.append(title, status, row);
  document.body.append(box);

  let scrolling = true;
  let idleRounds = 0;
  let lastHeight = 0;
  let lastCount = -1;

  function payload() {
    const items = [...found.entries()]
      .sort((a, b) => a[1].i - b[1].i)
      .map(([id, v]) => [id, v.p == null ? null : Math.round(v.p * 10) / 10, v.t == null ? null : v.t]);
    return JSON.stringify({ v: 1, from: location.pathname, items });
  }
  function update() {
    status.textContent = `${scrolling ? 'Scrolling and collecting… ' : 'Done. '}Found progress for ${found.size} video${found.size === 1 ? '' : 's'}.`;
  }

  const stopBtn = button('Stop scrolling', false, () => { scrolling = false; stopBtn.remove(); update(); });
  button('Send to app', true, () => {
    const url = `${appUrl}#ytprogress=${encodeURIComponent(payload())}`;
    if (!window.open(url, '_blank')) location.href = url;
  });
  button('Copy', false, async () => {
    try { await navigator.clipboard.writeText(payload()); status.textContent = 'Copied. Paste it on the app’s Settings page.'; } catch (e) { alert('Copy failed: ' + e.message); }
  });
  button('Close', false, () => { scrolling = false; box.remove(); window.__subsSearchGrab = false; });

  (async function loop() {
    while (scrolling) {
      scanDom();
      update();
      const height = document.documentElement.scrollHeight;
      idleRounds = height === lastHeight && found.size === lastCount ? idleRounds + 1 : 0;
      lastHeight = height;
      lastCount = found.size;
      if (idleRounds >= 4) break; // reached the end of the list
      window.scrollTo(0, height);
      await new Promise((r) => setTimeout(r, 1500));
    }
    scanDom();
    scrolling = false;
    stopBtn.remove();
    update();
  })();
}

// The javascript: URL to drag to the bookmarks bar.
export function bookmarkletHref(appUrl) {
  return 'javascript:' + encodeURIComponent(`(${grabProgress.toString()})(${JSON.stringify(appUrl)})`);
}

// "{v:1, items:[[id, percent|null, seconds|null], ...]}" (from the bookmarklet)
export function parsePayload(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('That isn’t data from the "Grab YouTube progress" bookmark.'); }
  if (!data || !Array.isArray(data.items)) throw new Error('That isn’t data from the "Grab YouTube progress" bookmark.');
  return data.items
    .filter((x) => Array.isArray(x) && /^[\w-]{11}$/.test(x[0]))
    .map(([id, percent, seconds]) => ({ id, percent: percent ?? null, seconds: seconds ?? null }));
}
