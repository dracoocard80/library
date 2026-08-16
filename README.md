# Library — a home screen for your HTML apps

A tiny PWA (hosted on GitHub Pages) that works like a Steam-style library for single-file HTML apps on an iPhone:

- **Import `.html` files from your phone** (Files app / iCloud / Downloads), or paste HTML, or pull from a URL. They're stored on-device in IndexedDB — you never have to re-import.
- **Home screen of app tiles** with icons, folders, search and sort. Long-press a tile (or tap ✎) to edit it.
- **Runs offline.** The Library shell is cached by a service worker; the apps live in the browser's storage.
- **Per-app memory.** Every app gets its own private `localStorage`, `sessionStorage`, `indexedDB` and `caches` namespace, so ten copies of a game don't overwrite each other and none of them can touch the Library's data.
- **Storage screen** showing what the Library plus each app takes up, persistent-storage status, and full backup / restore.
- **Suspend/resume.** Tap ⌂ to go back to the home screen while the app keeps running; resume or quit from the banner.
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
- **Long-press** a tile: rename, change icon (upload / emoji / from HTML / letter), move to a folder, safe-area mode, update the HTML with a newer file (keeps saved data), export the HTML back out, export/import/reset the app's saved data, delete.
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
<meta name="library-icon" content="🚀">           <!-- emoji, or data:image/... URL -->
<meta name="library-folder" content="Games">
<meta name="library-home-button" content="off">  <!-- you draw your own button -->
```

## How it works / limits

- Apps run in a same-origin, sandboxed `<iframe>` (no top-navigation) loaded from a `blob:` URL. Before the file is loaded, a small script is injected at the top of `<head>` that swaps `localStorage`/`sessionStorage` for private in-memory copies (persisted to IndexedDB by the Library), prefixes `indexedDB` database names and `caches` names with the app id, makes `navigator.serviceWorker.register()` fail gracefully, and lets `history.pushState` with a path degrade instead of throwing. Apps that access `localStorage` with `getItem`/`setItem`, bracket syntax, `Object.keys`, `length`, `key(i)`, `in`, `delete` all work. (`storage` events are not emitted.)
- Apps must be **single-file** (inline CSS/JS/images/fonts). Relative `src`/`href`/`fetch()` to other files won't resolve.
- **Trust model:** imported apps are *your* files. The isolation is for convenience (no data collisions), not security — an app could reach the Library's storage if it tried. Don't import HTML you don't trust.
- Only one app runs at a time. Opening another quits the current one (after saving). Tapping ⌂ suspends instead (the app keeps running; its `document.hidden` reports `true` so autosave-on-hide code runs).
- If iOS kills the Library in the background, it reloads on return and offers to **Reopen** the app you were in. Apps that only keep state in memory lose it (same as any web page); apps that save to `localStorage` are fine.
- iOS keeps the storage of Home Screen web apps as long as the app stays installed (it's exempt from Safari's 7-day cleanup and, on iOS 17+, gets the full storage quota — up to 60% of the disk). Deleting the Home Screen icon deletes the data, and *Clear History and Website Data* may too — use **Storage → Back up everything** occasionally (one JSON file with every app + its saved data) and keep it in Files/iCloud.
- Sharing/exporting uses the iOS share sheet ("Save to Files" etc.). Note that if one of *your apps* triggers a file download (`<a download>`) inside a Home Screen web app, iOS shows a preview/"Open in…" sheet that's awkward to leave — that's an iOS thing; prefer `navigator.share` in your apps.
- The status bar style is fixed by the Library (`black-translucent`, white text). Apps that handle the notch themselves (`viewport-fit=cover` / `env(safe-area-inset-*)`) run full-bleed and see the real insets; others are automatically padded. Override per app under *Safe area*.

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
| `.nojekyll` | tells GitHub Pages to serve files as-is |
