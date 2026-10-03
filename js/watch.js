// Plays a video with the YouTube IFrame player and records how far you got.
import * as store from './store.js';
import { formatAge, formatCount, formatDuration, youtubeUrl } from './common.js';

const $ = (id) => document.getElementById(id);
const videoId = new URLSearchParams(location.search).get('v');
const threshold = (Number(store.getSettings().finishThreshold) || 90) / 100;

let player;
let video;
let rec;
let timer;

function describe() {
  if (!rec || rec.status === 'unwatched') return 'Not watched yet';
  if (rec.status === 'finished') return '✓ Finished';
  const dur = rec.duration || video?.duration || 0;
  return `Watched ${formatDuration(rec.position)}${dur ? ` of ${formatDuration(dur)}` : ''}`;
}

function refreshUi() {
  $('statusText').textContent = describe();
  $('ytLink').href = youtubeUrl(videoId, rec?.status === 'started' ? rec.position : 0);
}

async function save(final = false) {
  if (!player?.getCurrentTime) return;
  const position = player.getCurrentTime();
  const duration = player.getDuration() || video?.duration || 0;
  if (position < 1 && !final) return;
  const finished = rec?.status === 'finished' || (duration && position / duration >= threshold);
  rec = await store.setStatus(videoId, finished ? 'finished' : 'started', { position, duration });
  refreshUi();
}

function onStateChange(e) {
  const S = YT.PlayerState;
  if (e.data === S.PLAYING) {
    clearInterval(timer);
    timer = setInterval(save, 5000);
  } else {
    clearInterval(timer);
    if (e.data === S.PAUSED) save();
    if (e.data === S.ENDED) {
      store.setStatus(videoId, 'finished', { position: player.getDuration(), duration: player.getDuration() })
        .then((r) => { rec = r; refreshUi(); });
    }
  }
}

function onError(e) {
  const blocked = e.data === 101 || e.data === 150 || e.data === 153;
  const wrap = document.querySelector('.player-wrap');
  wrap.innerHTML = '';
  wrap.append(Object.assign(document.createElement('div'), {
    style: 'display:flex;align-items:center;justify-content:center;color:#fff;text-align:center;padding:20px',
    innerHTML: blocked
      ? `This video can't be played here (the uploader disabled embedding, or the page isn't running from a web server).<br><br><a href="${youtubeUrl(videoId, rec?.position)}" target="_blank" rel="noopener">Watch it on YouTube ↗</a>`
      : `The player reported error ${e.data}. <a href="${youtubeUrl(videoId)}" target="_blank" rel="noopener">Watch it on YouTube ↗</a>`,
  }));
}

function createPlayer() {
  const resumeAt = rec?.status === 'started' && rec.position > 5 ? Math.floor(rec.position) - 2 : 0;
  player = new YT.Player('player', {
    videoId,
    playerVars: { autoplay: 1, start: resumeAt, rel: 0, playsinline: 1, origin: location.origin },
    events: { onStateChange, onError },
  });
}

async function init() {
  if (!videoId) {
    $('title').textContent = 'No video selected';
    return;
  }
  [video, rec] = await Promise.all([store.get('videos', videoId), store.get('progress', videoId)]);
  if (video) {
    document.title = `${video.title} – Subscription Search`;
    $('title').textContent = video.title;
    $('meta').textContent = `${video.channelTitle} · ${formatCount(video.views)} views · ${formatAge(video.publishedAt)} · ${formatDuration(video.duration)}`;
    if (video.description) {
      $('desc').hidden = false;
      $('desc').textContent = video.description + (video.description.length >= 500 ? '…' : '');
    }
  }
  refreshUi();

  window.onYouTubeIframeAPIReady = createPlayer;
  const s = document.createElement('script');
  s.src = 'https://www.youtube.com/iframe_api';
  document.head.append(s);
}

$('finishBtn').addEventListener('click', async () => {
  rec = await store.setStatus(videoId, 'finished', { duration: video?.duration });
  refreshUi();
});
$('resetBtn').addEventListener('click', async () => {
  rec = await store.setStatus(videoId, 'unwatched');
  refreshUi();
});
// Save on tab close / navigation.
window.addEventListener('pagehide', () => save());
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

init();
