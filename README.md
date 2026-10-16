# Subscription Search

A small set of web pages for browsing the YouTube channels you subscribe to, with the
filtering that YouTube itself doesn't give you:

- **Videos only:** Shorts are excluded. Past live streams are optional.
- **Search** across title, channel and description.
- **Filter** by channel, watch status (unwatched / started / finished), length and upload date.
- **Sort** by newest, oldest, longest, shortest, most viewed, title, channel, recently
  watched, most progress, or least time remaining.
- **Channels page:** an alphabetical, searchable list of your subscriptions. Pick one to sync just
  that channel and browse its videos with the same filters and sorting.
- **Progress tracking:** videos played in the app's built-in player remember where you stopped
  and resume from there. A video you've started counts as *finished* once you've watched 90% of it
  or, for videos longer than 10 minutes, there are less than 3 minutes left (both adjustable in Settings).

Everything runs in your browser. Channels, videos and progress are stored locally in IndexedDB, and
nothing is sent anywhere except the YouTube API.

## Running it on your PC (Windows)

1. Download the repo: **Code → Download ZIP**, then unzip it somewhere (or `git clone` it).
2. Double-click **`start.bat`**. A small window opens and your browser goes to
   <http://localhost:8765/>. Keep that window open while you use the app, and close it to stop.
   (It uses PowerShell, which comes with Windows, so you don't need to install anything.)
3. On first run, open **Settings & channels** and follow the steps there:
   1. Create a free **YouTube Data API key**. The page has step-by-step instructions.
   2. **Import your subscriptions.** The easiest way is the `subscriptions.csv` from
      [Google Takeout](https://takeout.google.com/). You can also paste channel URLs or
      @handles, sign in with Google, or read public subscriptions.
   3. Click **Sync all channels now**.
4. Back on **Browse**, click **Sync new videos** whenever you want the latest uploads. Later syncs only fetch
   what's new.

You can't just open `index.html` by double-clicking it. The embedded YouTube player and Google sign-in
only work when the page is served over `http://`, and that's what `start.bat` does.

macOS / Linux: run `./start.sh` (needs Python 3).

Tip: bookmark <http://localhost:8765/>. Your data is tied to that address, so always use the same one.

### Alternative: GitHub Pages (no local server)

In the repo, go to **Settings → Pages**, choose *Deploy from a branch*, select the branch and `/ (root)`, then save.
The app will be at `https://<your-user>.github.io/<repo>/`. Your API key is saved in your browser, not in
the repo. If you restrict the key by HTTP referrer, add that URL to the allowed list.

## About watch status

YouTube's API doesn't let third-party apps read your watch history or resume positions. The app gets
them in these ways:

- **Grab YouTube progress bookmark (recommended).** Settings step 4 has a button to drag to your
  bookmarks bar. Open youtube.com while signed in, ideally your
  [History](https://www.youtube.com/feed/history) page or a channel's **Videos** tab, and click the bookmark.
  It scrolls the page, reads the red resume bar on each thumbnail, and sends the results back to the app.
  Progress is only ever moved forward. It depends on YouTube's page layout, so if a YouTube redesign
  breaks it, let me know.
- **Playing in this app** (click a thumbnail) records progress automatically and resumes where you stopped.
- **Mark finished / Mark unwatched** buttons on each video set it manually.
- **Google Takeout watch history** (Settings step 4) marks the videos you've watched, but has no positions.
- **Open on YouTube ↗** opens a video on youtube.com. Use the bookmark afterwards to bring that progress back.

Use **Settings → Backup** to export or import your channels and progress, e.g. to move to another PC.

## How it works

| File | Purpose |
| --- | --- |
| `index.html`, `js/browse.js` | Browse / search / filter / sort (`?channel=` for one channel) |
| `channels.html`, `js/channels.js` | Alphabetical list of subscriptions |
| `watch.html`, `js/watch.js` | Embedded player (YouTube IFrame API) that saves progress every 5s |
| `settings.html`, `js/settings.js` | API key, subscription import, sync, history import, backup |
| `js/youtube.js` | YouTube Data API calls and the sync logic |
| `js/store.js` | IndexedDB storage and settings |
| `js/grabber.js` | The "Grab YouTube progress" bookmarklet |
| `start.bat`, `serve.ps1`, `start.sh` | Local web server launchers |

Shorts are excluded by reading each channel's long-form-only uploads playlist (`UULF…`) instead of
the full uploads playlist (`UU…`). If a channel doesn't have one, the app falls back to all uploads and treats
anything 3 minutes or shorter as a Short. A sync costs roughly 2–3 API quota units per channel, and the
free daily quota is 10,000.
