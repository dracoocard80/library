# Building HTML apps for Library (iPhone 15 Pro Max)

Paste this whole file into an LLM before asking it to build or modify a single-file HTML app.
It describes the target device, the rules a file must follow, and the small contract that makes
the app talk to **Library** — a PWA that stores `.html` files on the phone and runs them
full-screen, each with its own private storage.

---

## 0. The short version (paste this if you only paste one thing)

> Build a **single self-contained `.html` file** — all CSS, JS, images and fonts inline, no
> network requests, works offline. Target an **iPhone 15 Pro Max in a home-screen PWA**:
> CSS viewport **430 × 932 pt**, DPR 3, dark UI. Lock the layout: `html,body{position:fixed;
> inset:0;overflow:hidden}` and put scrolling inside an inner element. Block all zooming
> (viewport meta + `gesturestart`/`gesturechange`/`gestureend` preventDefault + `touch-action`).
> Handle the **top** safe area with `env(safe-area-inset-top)` **exactly once**; do not add
> bottom safe-area padding — content should reach the bottom edge. Use **Pointer Events**
> (`pointerdown`/`pointermove`/`pointerup` + `setPointerCapture`), `touch-action:none` on any
> interactive surface, ≥44 pt hit targets, and never rely on hover. Persist state to
> `localStorage` (JSON, one key) and save on `visibilitychange`→hidden and `pagehide`.
> Add `<button data-library-home hidden>⌂ Library</button>` for the back-to-Library button, and
> these head tags: `library-name`, `library-icon`, `library-folder`, `library-orientation`.
> Add an `<link rel="apple-touch-icon" href="data:image/png;base64,…">` (512×512 square) so the
> app gets a real icon tile.

---

## 1. Hard rules

| Rule | Why |
|---|---|
| **One file.** Inline every `<style>`, `<script>`, image (`data:` URL), and font (`@font-face` with a `data:` URL). | Library stores exactly one file per app. Relative paths (`./img.png`, `fetch('data.json')`) resolve against the Library's own URL and will 404 or return the Library's HTML. |
| **No external requests.** No CDN scripts, Google Fonts, analytics, remote APIs. | Apps must work offline, in airplane mode, forever. |
| **No service worker.** `navigator.serviceWorker.register()` is stubbed and rejects. | Library owns the service worker for the whole origin. |
| **No `window.open`, no `<a download>`, no `target="_blank"`.** | In a home-screen web app these open a sheet the user can't easily get back from. Use `navigator.share({files:[…]})` inside a click handler instead. |
| **No `history.pushState(state, '', '/path')`.** Fragment-only (`location.hash = 'x'`) is fine. | The app runs from a `blob:` document; a path-changing pushState throws. (Library patches it to degrade instead of throwing, but don't rely on routing.) |
| Keep the file **under ~2 MB** if you can. | It lives in on-device storage and gets loaded into memory on every launch. |

Everything else — canvas, WebGL, Web Audio, `requestAnimationFrame`, IndexedDB, workers created
from blob URLs, `alert`/`confirm`/`prompt`, vibration, device orientation — works normally.

---

## 2. The device

**iPhone 15 Pro Max, installed to the Home Screen (standalone PWA):**

| | Value |
|---|---|
| CSS viewport (portrait) | **430 × 932 pt** |
| CSS viewport (landscape) | 932 × 430 pt |
| Device pixels | 1290 × 2796 (**DPR 3**) |
| Top safe-area inset (portrait) | **59 pt** — status bar + Dynamic Island |
| Bottom safe-area inset (portrait) | **34 pt** — home indicator |
| Landscape insets | left/right **59 pt**, bottom **21 pt**, top 0 |
| Dynamic Island itself | pill ≈ **125 × 37 pt**, horizontally centred, ≈ 11 pt below the top edge |
| Status bar text | always **white** (Library sets `black-translucent`), so keep the top strip dark |

Design for **430 × 932** and let it scale; other iPhones are narrower (375–430 pt) and shorter.
Use `min()/max()/clamp()`, flexbox and `%`/`vh` rather than fixed pixel layouts, and test that
nothing breaks at 375 × 667.

**Where the notch is:** the Dynamic Island floats over the top ~59 pt. Never put text, buttons or
score readouts in the top 59 pt unless you offset them with `env(safe-area-inset-top)`. The
bottom 34 pt is the home-indicator strip: it's fine to *draw* there (background, artwork, a game
board), just don't put a control the user must tap repeatedly right at the very bottom edge —
the system swipe-up gesture lives there.

---

## 3. The `<head>` block to copy

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="My App">
<meta name="theme-color" content="#0b0d12">
<meta name="color-scheme" content="dark">
<meta name="format-detection" content="telephone=no">
<title>My App</title>

<!-- Library metadata (all optional) -->
<meta name="library-name" content="My App">
<meta name="library-icon" content="🎲">
<meta name="library-folder" content="Games">
<meta name="library-orientation" content="portrait">
<!-- <meta name="library-home-button" content="off"> if you draw your own ⌂ button -->
<!-- <meta name="library-fill-bottom" content="off"> if your bottom controls must sit above the home bar -->

<!-- App icon: square PNG, 512×512 (or 180×180), as a data: URL -->
<link rel="apple-touch-icon" href="data:image/png;base64,iVBORw0KGgo…">
<link rel="icon" href="data:image/png;base64,iVBORw0KGgo…">
</head>
```

---

## 4. Blocking zoom (all four ways — you need all of them)

1. **Viewport meta** — `user-scalable=no, maximum-scale=1, minimum-scale=1` (in the block above).
   iOS partly ignores this for accessibility, hence the rest.
2. **Pinch gestures** — Safari fires non-standard `gesture*` events:

```js
['gesturestart','gesturechange','gestureend'].forEach(function (t) {
  document.addEventListener(t, function (e) { e.preventDefault(); }, { passive: false });
});
```

3. **Double-tap zoom** — kill it with CSS (`touch-action`), not JS timers:

```css
* { touch-action: manipulation; }        /* no double-tap zoom, taps stay instant */
.surface, canvas, .control { touch-action: none; }  /* drag/draw surfaces: no panning either */
```

4. **Text auto-sizing and callouts**

```css
html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
body { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none;
       -webkit-tap-highlight-color: transparent; }
input, textarea, [contenteditable] { -webkit-user-select: text; user-select: text; }
```

Also: **give every `<input>`/`<textarea>`/`<select>` a `font-size` of at least 16px**, otherwise
iOS zooms the page when the field is focused and never fully zooms back out.

---

## 5. Layout skeleton (safe areas done right)

The single most common bug: applying `env(safe-area-inset-bottom)` **twice** (once on a page
wrapper, once on a bottom bar) which leaves a fat dead strip above the home indicator. Apply each
inset **once**, and prefer no bottom inset at all.

```css
:root {
  --safe-top: env(safe-area-inset-top, 0px);
  --safe-left: env(safe-area-inset-left, 0px);
  --safe-right: env(safe-area-inset-right, 0px);
}
html, body {
  position: fixed; inset: 0; margin: 0;
  overflow: hidden; overscroll-behavior: none;
  background: #0b0d12; color: #e8ecf5;
  font: 15px/1.4 -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
}
#app {
  position: absolute; inset: 0;
  display: flex; flex-direction: column;
  padding: var(--safe-top) var(--safe-right) 0 var(--safe-left);  /* note: no bottom */
}
#scroll { flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch;
          overscroll-behavior: contain; }
#dock  { flex: none; padding: 8px 10px; }   /* reaches the bottom edge of the screen */
```

Inside Library the bottom inset is forced to `0px` anyway (the *Fill bottom edge* setting), so a
file written this way looks identical standalone and in the Library.

If you have a bottom bar whose buttons must stay clear of the home-indicator swipe area, add
`padding-bottom: 10px` (a plain constant) rather than the inset, or set
`<meta name="library-fill-bottom" content="off">`.

### The iOS "gap at the bottom" bug (only when run standalone)

If you add a file to the Home Screen **as its own web app** with
`apple-mobile-web-app-status-bar-style: black-translucent`, iOS shifts the document up under the
status bar but keeps the layout viewport at *screen height − status-bar height*. On a 15 Pro Max
that's `window.innerHeight === 873` on a 932pt screen, and a dead strip 59pt tall is left at the
bottom (portrait only — in landscape the top inset is 0, so nothing is wrong). `100%`, `100vh`,
`100dvh` and `position:fixed;bottom:0` all follow the short viewport, so the strip stays empty.

Cover it by extending the root by the top inset:

```css
html { min-height: calc(100% + env(safe-area-inset-top)); }
/* and for a full-screen fixed layout: */
#app { height: calc(100% + env(safe-area-inset-top)); }
```

Anything anchored to the bottom needs the same shift: `bottom: calc(0px - env(safe-area-inset-top))`.
Inside Library this is measured and handled for you, so an app that does nothing about it still
fills the screen; the fix above only matters for files you install directly.

---

## 6. Touch controls

**Use Pointer Events.** They cover touch, Pencil and mouse in one path, and give you capture:

```js
const el = document.getElementById('pad');
el.style.touchAction = 'none';                 // REQUIRED or the browser steals the gesture
el.addEventListener('pointerdown', (e) => {
  el.setPointerCapture(e.pointerId);           // keep receiving moves outside the element
  start(e.clientX, e.clientY, e.pointerId);
});
el.addEventListener('pointermove', (e) => {
  // coalesced events give you every sample at 120 Hz on ProMotion
  for (const p of (e.getCoalescedEvents ? e.getCoalescedEvents() : [e])) move(p.clientX, p.clientY);
});
el.addEventListener('pointerup', end);
el.addEventListener('pointercancel', end);     // ALWAYS handle: a system gesture can cancel a touch
```

Rules that matter on iOS:

- **`touch-action: none`** on canvases, joysticks, sliders and drag surfaces; `manipulation`
  everywhere else. Without it, iOS scrolls/zooms instead of sending you moves.
- **Handle `pointercancel`** exactly like `pointerup`. A notification banner, an incoming call or
  a palm touch cancels the pointer, and a game that only listens for `pointerup` gets stuck.
- **Hit targets ≥ 44 × 44 pt.** Add invisible padding rather than growing the artwork.
- **Act on `pointerdown`, not `click`**, for game controls — but for anything destructive use
  `click` so the user can slide off to cancel.
- **No hover.** `:hover` sticks on iOS after a tap; style `:active` (or a JS `.is-down` class).
- **Multi-touch:** track pointers in a `Map` keyed by `pointerId`. Two thumbs on two buttons is
  normal; don't assume one live pointer.
- **Avoid a resting two-finger hold as a gesture** — Library uses a stationary two-finger hold
  (~1.5 s) as its emergency "back to Library" exit. Moving two-finger gestures (pinch, pan) are
  fine.
- **Passive listeners:** add `{ passive: true }` to `touchstart`/`touchmove` listeners that don't
  call `preventDefault()`, and `{ passive: false }` to the ones that do.
- **Haptics:** `navigator.vibrate()` does nothing on iOS. Use a short Web Audio click or a CSS
  flash for feedback instead.
- **Safe thumb zone:** the comfortable area on a 15 Pro Max is the lower ~60% of the screen. Put
  primary controls there; keep the top strip for status.

---

## 7. Talking to Library

Everything here is optional — an ordinary HTML file just works.

### Back-to-Library button

Library draws a small floating **⌂** over your app. If you'd rather place your own button, add
this anywhere in the page:

```html
<button data-library-home hidden>⌂ Library</button>
```

It stays hidden when the file is opened on its own; inside Library it's revealed, Library hides
its floating button, and tapping it returns to the app list (your app stays running in the
background). Any element with `data-library-home` works — style it however you like.

### JS API

`window.__LIBRARY__` exists **only** when running inside Library:

```js
if (window.__LIBRARY__) {
  __LIBRARY__.home();               // back to the app list (app keeps running)
  __LIBRARY__.homeButton(false);    // hide Library's floating ⌂ (you draw your own)
  __LIBRARY__.setName('New name');  // rename this app in the library
  __LIBRARY__.setIcon(pngDataUrl);  // set this app's icon from inside the app
  __LIBRARY__.appId;                // stable id for this app
  __LIBRARY__.ignoredInsets;        // e.g. ['top','left','right','bottom'] — edges Library owns
  __LIBRARY__.orientation;          // 'auto' | 'portrait' | 'landscape'
}
```

CSS hook: `<html>` gets the class `in-library`, so you can hide standalone-only chrome:

```css
html.in-library .only-standalone { display: none; }
```

### Head tags Library reads on import

| Tag | Effect |
|---|---|
| `<meta name="library-name" content="…">` | Tile name (else `apple-mobile-web-app-title`, else `<title>`) |
| `<meta name="library-icon" content="🎲">` | Tile icon: one or two emoji, **or** a `data:image/…` URL |
| `<meta name="library-folder" content="Games">` | Import straight into that folder (created if needed) |
| `<meta name="library-orientation" content="portrait">` | Lock this app to `portrait` / `landscape` |
| `<meta name="library-home-button" content="off">` | Don't draw the floating ⌂ (you supply your own) |
| `<meta name="library-fill-bottom" content="off">` | Keep the app's own bottom safe-area padding |
| `<meta name="theme-color" content="#0b0d12">` | Colour behind the app while it launches |

### Icons — what Library expects

In priority order Library uses: `library-icon` → `<link rel="apple-touch-icon">` →
`<link rel="icon">` → a coloured letter tile.

- Must be a **`data:` URL** (`data:image/png;base64,…`) — a file path can't be resolved.
- **Square**, ideally **512 × 512** (180 × 180 is fine). Non-square images are centre-cropped.
- PNG or JPEG. SVG data URLs work but don't animate. Keep it under ~150 KB; anything larger is
  re-encoded to a 256 px PNG/JPEG automatically.
- It's masked into a rounded-square tile, so keep the important content inside the middle ~80%
  and **don't** pre-round the corners.
- Emoji (`content="🎲"`) is the cheapest option and looks fine — use it when you don't have art.

---

## 8. Saving state

`localStorage` is **private to your app** inside Library (its own namespace, persisted to the
Library's database) and behaves normally when the file is opened standalone. Same for
`sessionStorage`, `indexedDB` and `caches`.

```js
const KEY = 'myapp.save.v1';
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s && s.v === 1) Object.assign(state, s);
  } catch (e) {}
}
// Save whenever the app goes away — Library suspends you with a visibilitychange,
// and iOS can kill a backgrounded web app without any further warning.
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
window.addEventListener('pagehide', save);
```

- Version your save (`v: 1`) and merge missing fields on load so an updated app can read an old save.
- Keep it to **one key** with a JSON blob if you can; it makes export/import in Library meaningful.
- Don't poll-save every frame — save on change (debounced ~1 s), on hide, and on pagehide.
- `storage` events do **not** fire inside Library.

---

## 9. Performance

```js
// Cap the canvas backing store — 3× DPR on a 430×932 screen is 3.6 M pixels.
const dpr = Math.min(window.devicePixelRatio || 1, 2);
canvas.width = Math.round(rect.width * dpr);
canvas.height = Math.round(rect.height * dpr);
ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

// Stop animating when hidden (Library suspends the app this way too).
document.addEventListener('visibilitychange', () => {
  if (document.hidden) cancelAnimationFrame(raf); else raf = requestAnimationFrame(tick);
});
```

- One `requestAnimationFrame` loop; never `setInterval` for animation.
- Prefer `transform`/`opacity` for animation; avoid animating `width`, `top`, `box-shadow`, or
  `filter: blur()` on large areas.
- `backdrop-filter` is expensive — a handful of small elements at most.
- Batch DOM writes; don't read `offsetWidth` inside a loop that also writes styles.
- For idle/incremental games, store a timestamp and compute progress on return instead of
  ticking in the background — a backgrounded web app gets no frames.

---

## 10. Minimal starter file

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Starter">
<meta name="theme-color" content="#0b0d12">
<meta name="color-scheme" content="dark">
<meta name="library-name" content="Starter">
<meta name="library-icon" content="✳️">
<title>Starter</title>
<style>
:root { --safe-top: env(safe-area-inset-top,0px); --safe-l: env(safe-area-inset-left,0px); --safe-r: env(safe-area-inset-right,0px); }
* { box-sizing: border-box; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
html, body { position: fixed; inset: 0; margin: 0; overflow: hidden; overscroll-behavior: none;
  -webkit-text-size-adjust: 100%; background: #0b0d12; color: #e8ecf5;
  font: 15px/1.4 -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
#app { position: absolute; inset: 0; display: flex; flex-direction: column;
  padding: var(--safe-top) var(--safe-r) 0 var(--safe-l); }
header { flex: none; padding: 10px 14px; font-weight: 700; letter-spacing: .02em; }
#scroll { flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain; padding: 0 14px; }
#dock { flex: none; display: flex; gap: 8px; padding: 8px 14px 12px; }
button.big { flex: 1; min-height: 52px; border: 0; border-radius: 14px; font-size: 16px;
  font-weight: 700; background: #263042; color: #e8ecf5; }
button.big:active { background: #34405a; }
#home { position: fixed; top: calc(var(--safe-top) + 8px); left: 10px; z-index: 99;
  padding: 6px 10px; border-radius: 999px; border: 1px solid rgba(255,255,255,.2);
  background: rgba(0,0,0,.55); color: #fff; font: 600 13px system-ui; }
</style>
</head>
<body>
<div id="app">
  <header>Starter</header>
  <div id="scroll"><p>Taps: <b id="n">0</b></p></div>
  <div id="dock"><button class="big" id="tap">Tap me</button></div>
</div>
<button id="home" data-library-home hidden>⌂ Library</button>
<script>
'use strict';
['gesturestart','gesturechange','gestureend'].forEach(function (t) {
  document.addEventListener(t, function (e) { e.preventDefault(); }, { passive: false });
});
var KEY = 'starter.save.v1', state = { v: 1, n: 0 };
try { var s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && s.v === 1) state = s; } catch (e) {}
var nEl = document.getElementById('n');
function draw() { nEl.textContent = state.n; }
function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
document.getElementById('tap').addEventListener('pointerdown', function () { state.n++; draw(); save(); });
document.addEventListener('visibilitychange', function () { if (document.hidden) save(); });
window.addEventListener('pagehide', save);
draw();
</script>
</body>
</html>
```

---

## 11. Checklist before handing the file over

- [ ] One file, opens correctly by double-clicking it — no console errors, no network requests.
- [ ] No horizontal scrollbar; nothing clipped at 430 × 932 **or** 375 × 667.
- [ ] Pinch, double-tap and focus-zoom all do nothing.
- [ ] Nothing important in the top 59 pt unless offset by `env(safe-area-inset-top)`.
- [ ] Content reaches the bottom edge; the bottom inset is applied at most once (ideally not at all).
- [ ] Every control is ≥ 44 pt, responds on `pointerdown`, and handles `pointercancel`.
- [ ] State survives closing and reopening; it saves on `visibilitychange` → hidden.
- [ ] `<title>`, `library-icon` (or an `apple-touch-icon` data URL), and `theme-color` are set.
- [ ] `<button data-library-home hidden>⌂ Library</button>` present (or `library-home-button: off`).
