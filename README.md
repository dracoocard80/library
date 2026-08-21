# Library — a home screen for your HTML apps

A tiny PWA (hosted on GitHub Pages) that works like a Steam-style library for single-file HTML apps on an iPhone:

- **Import `.html` files from your phone** (Files app / iCloud / Downloads), or paste HTML, or pull from a URL. They're stored on-device in IndexedDB — you never have to re-import.
- **Home screen of app tiles** with icons, folders, search and sort. Long-press a tile (or tap ✎) to edit it.
- **Runs offline.** The Library shell is cached by a service worker; the apps live in the browser's storage.
- **Per-app memory.** Every app gets its own private `localStorage`, `sessionStorage`, `indexedDB` and `caches` namespace, so ten copies of a game don't overwrite each other and none of them can touch the Library's data.
- **Storage screen** showing what the Library plus each app takes up, persistent-storage status, and full backup / restore.
- **Suspend/resume.** Tap ⌂ to go back to the home screen while the app keeps running; resume or quit from the banner.
- **True full-screen.** Apps fill the whole display; only the top inset is (optionally) padded. Apps that leave their own gap above the home indicator get it removed automatically — see *Full-screen and safe areas* below.
- **Per-app orientation lock** (Auto / Portrait / Landscape) that works on iOS, where the OS can't lock a web app.
- **A design guide for LLMs** — Settings → *Design guide for LLMs* → **Copy all**, then paste it into a prompt. Also in the repo as [`LIBRARY-APP-GUIDE.md`](LIBRARY-APP-GUIDE.md).
- **A one-line snippet** you can paste into any HTML app to give it a native "back to Library" button — see [`library-snippet.html`](library-snippet.html) or Settings → *For your HTML apps* inside the app.

## Deploy to GitHub Pages (once)

1. Create a new GitHub repository, e.g. `library` (public, or private with Pages enabled on your plan).
2. Upload everything in this folder (`index.html`, `app.js`, `sw.js`, `manifest.webmanifest`, `icons/`, `.nojekyll`, …). Keep the folder structure.
3. Repo **Settings → Pages → Build and deployment**: Source = *Deploy from a branch*, Branch = `main`, folder = `/ (root)`. Save.
4. After a minute, open `https://<your-user>.github.io/library/` in **Safari** on the iPhone.
5. Tap **Share → Add to Home Screen**. Open it from the Home Screen from now on — the installed copy has its own storage and stays offline-capable.

Or from a terminal:

```bash
cd path/to/library
git init -b main
git add .
git commit -m "Library PWA"
git remote add origin https://github.com/<your-user>/library.git
git push -u origin main
```

Then enable Pages as in step 3.

## Using it

- **＋** → *Choose .html file(s)* → pick one or more files. The Library reads `<title>` / `apple-mobile-web-app-title`, the `theme-color`, and any data-URL `apple-touch-icon` for the tile.
- Tap a tile to run the app. The floating **⌂** goes back to the Library (drag it anywhere; it remembers). Two-finger hold on the screen for a second is the emergency exit if an app hides the button.
- **Long-press** a tile: rename, change icon (upload / emoji / from HTML / letter), move to a folder, top inset, *Fill bottom edge*, orientation lock, update the HTML with a newer file (keeps saved data), export the HTML back out, export/import/reset the app's saved data, delete.
- **Import the same app again** (same name) → you're asked whether to *update in place* (keeps its saved data) or add a copy. That's the workflow for "Claude regenerated my app".
- The **storage pill** in the header opens the Storage screen (device usage, per-app breakdown, backup / restore).

## Making your HTML apps Library-aware (optional)

Nothing is required — any single-file HTML app works as-is. But you can add:

```html
<button data-library-home hidden>⌂ Library</button>
```

anywhere in the page. It's hidden when the file is opened on its own and revealed inside the Library, where it replaces the floating ⌂. From JS use `window.__LIBRARY__` (only defined inside the Library): `home()`, `homeButton(false)`, `setIcon(dataUrl)`, `setName(name)`. `<html>` gets the class `in-library`.

Head tags read at import time:

```html
<meta name="library-name" content="My App">
<meta name="library-icon" content="🚀">              <!-- emoji, or data:image/... URL -->
<meta name="library-folder" content="Games">
<meta name="library-orientation" content="portrait"> <!-- or landscape -->
<meta name="library-home-button" content="off">      <!-- you draw your own button -->
<meta name="library-fill-bottom" content="off">      <!-- keep your own home-indicator padding -->
```

For anything more than this, hand your LLM [`LIBRARY-APP-GUIDE.md`](LIBRARY-APP-GUIDE.md) — it covers
the iPhone 15 Pro Max metrics, where the Dynamic Island sits, blocking zoom, touch-control patterns,
icon requirements, saving state, and this whole contract in one paste-able document.

## Full-screen and safe areas

Apps run edge-to-edge. Only the **top** inset is ever padded by the Library, and only when the app
doesn't handle the notch itself (*Top inset: Auto/Full/Pad* per app). The **bottom is always
full-bleed**.

Many hand-written apps reserve `env(safe-area-inset-bottom)` for the home indicator — and some
reserve it twice (once on a page wrapper, once on a bottom bar), leaving a fat dead strip. With
**Fill bottom edge** on (the default) the Library re-declares every CSS rule in the app that
mentions the insets it owns, with that inset replaced by `0px` — including `--var: env(...)`
custom properties, so indirect uses collapse too. Rules that don't mention an inset are untouched,
and turning the switch off restores the app's own layout instantly.

The same mechanism prevents double-padding at the top: in *Pad* mode the Library zeroes the app's
top/left/right insets and applies them itself.

### Why the status bar is a solid bar, not translucent

`apple-mobile-web-app-status-bar-style: black-translucent` sounds like the full-screen option —
content draws under the status bar — but on iOS it comes with a defect: the layout viewport stays
at *screen height − status bar* while being **anchored at the top**, so the bottom of the screen
(59pt on a 15 Pro Max) is never composited. Anything drawn there is clipped, not merely absent:
measured on-device you get `viewport: 430 x 873` on a 932pt screen with `top 59 / bottom 34`
insets, and a dead strip along the bottom in portrait. It only affects portrait, because the top
inset is 0 in landscape.

Nothing in CSS can reach that strip, so the Library asks for `black` by default. iOS then draws the
status bar itself and hands the page everything below it, all the way to the bottom edge — which
is the half that matters for most apps.

Because the strip can only ever be black *or* app-painted, both are offered: **Settings → Status
bar** sets the default and each app can override it (long-press → *Status bar*, or
`<meta name="library-status-bar" content="fill">` in the file). **Fill** uses `black-translucent`, so
the app paints behind the clock and iOS takes the bottom 59pt instead — the same 59pt either way,
at whichever end suits the app. iOS only reads the status-bar style while parsing the page, so
opening an app that wants the other mode reloads the Library into it (and reopens the app for you);
quitting returns to your default. Expected readings in Settings → **Full-screen test**:

| | portrait | landscape |
|---|---|---|
| viewport | 430 x 873 | 932 x 430 |
| safe areas | top 0, bottom 34 | left/right 59, bottom 20 |
| verdict | *Full-bleed below the status bar ✓* | *Full-bleed ✓* |

The pink border should touch the left, right and bottom edges, with the green home-indicator band
visible at the bottom. iOS may snapshot the status-bar style when the icon is added, so if the
strip survives an update: **Storage → Back up everything** first (removing the icon deletes the
data), then delete the Home Screen icon, re-add it from Safari, and restore the backup.

## Orientation lock

iOS ignores the manifest `orientation` field for home-screen web apps and doesn't implement
`screen.orientation.lock()`, so a per-app lock can't be delegated to the OS. Set **Orientation** to
Portrait or Landscape and the Library rotates the app itself when the phone doesn't match: the app
gets a genuine portrait (or landscape) viewport — `window.innerWidth/innerHeight` swap, media
queries and layout all follow — displayed rotated, exactly like an OS lock. Safe-area padding is
disabled while rotated (the device insets no longer line up with the app's edges). On platforms
that do support the native API, that's used first.

## How it works / limits

- Apps run in a same-origin, sandboxed `<iframe>` (no top-navigation) loaded from a `blob:` URL. Before the file is loaded, a small script is injected at the top of `<head>` that swaps `localStorage`/`sessionStorage` for private in-memory copies (persisted to IndexedDB by the Library), prefixes `indexedDB` database names and `caches` names with the app id, makes `navigator.serviceWorker.register()` fail gracefully, and lets `history.pushState` with a path degrade instead of throwing. Apps that access `localStorage` with `getItem`/`setItem`, bracket syntax, `Object.keys`, `length`, `key(i)`, `in`, `delete` all work. (`storage` events are not emitted.)
- Apps must be **single-file** (inline CSS/JS/images/fonts). Relative `src`/`href`/`fetch()` to other files won't resolve.
- **Trust model:** imported apps are *your* files. The isolation is for convenience (no data collisions), not security — an app could reach the Library's storage if it tried. Don't import HTML you don't trust.
- Only one app runs at a time. Opening another quits the current one (after saving). Tapping ⌂ suspends instead (the app keeps running; its `document.hidden` reports `true` so autosave-on-hide code runs).
- If iOS kills the Library in the background, it reloads on return and offers to **Reopen** the app you were in. Apps that only keep state in memory lose it (same as any web page); apps that save to `localStorage` are fine.
- iOS keeps the storage of Home Screen web apps as long as the app stays installed (it's exempt from Safari's 7-day cleanup and, on iOS 17+, gets the full storage quota — up to 60% of the disk). Deleting the Home Screen icon deletes the data, and *Clear History and Website Data* may too — use **Storage → Back up everything** occasionally (one JSON file with every app + its saved data) and keep it in Files/iCloud.
- Sharing/exporting uses the iOS share sheet ("Save to Files" etc.). Note that if one of *your apps* triggers a file download (`<a download>`) inside a Home Screen web app, iOS shows a preview/"Open in…" sheet that's awkward to leave — that's an iOS thing; prefer `navigator.share` in your apps.
- The status bar is drawn by iOS above the page (`black`, white text) — see *Why the status bar is a solid bar* above. Apps therefore see `env(safe-area-inset-top): 0` and start right below it; the bottom, left and right insets are real. Override the top handling per app under *Top inset*.

## Updating the Library itself

Edit the files, bump `CACHE_VERSION` in `sw.js`, push. Installed copies get an "Update available — Reload" toast on next launch/foreground (or Settings → *Check for updates*). Your imported apps and their data are untouched by updates.

Gotchas:
- GitHub Pages caches files at its CDN for up to ~10 minutes, so a fresh deploy may take a few minutes to show up.
- Keep `.nojekyll` in the repo (without it GitHub Pages runs Jekyll and drops files/folders starting with `_`).
- iOS snapshots the icon/name when you Add to Home Screen; if you change `icons/` or the manifest name, remove and re-add the icon to see it.
- Every repo on `<you>.github.io` shares one browser origin. The Library only touches its own IndexedDB database (`html-library`), its own cache names, and app data under `lib.<id>.` prefixes, so it coexists with your other Pages sites.

## Files

| File | Purpose |
|---|---|
| `index.html` | markup + styles |
| `app.js` | the Library, plus the shim injected into each app |
| `sw.js` | service worker (offline cache) |
| `manifest.webmanifest`, `icons/` | PWA metadata / icons (`tools/make_icons.py` regenerates them) |
| `library-snippet.html` | copy-paste snippet for your apps |
| `LIBRARY-APP-GUIDE.md` | the design guide to paste into an LLM (also shown in Settings) |
| `.nojekyll` | tells GitHub Pages to serve files as-is |
