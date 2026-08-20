/* Library — a home screen for single-file HTML apps.
   Everything lives in IndexedDB. Each imported app runs in a same-origin
   iframe with an injected shim that redirects localStorage / sessionStorage /
   indexedDB / caches to a per-app namespace, so apps never see each other's
   data (or the Library's). */
'use strict';

const APP_VERSION = '1.1.1';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ============================================================
   Small helpers
   ============================================================ */
function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else if (v !== null && v !== undefined && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const byteLen = (s) => new Blob([s]).size;
function fmtBytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1048576).toFixed(n < 10485760 ? 2 : 1) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
}
const fmtDate = (t) => t ? new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const stripExt = (f) => (f || '').replace(/\.(html?|txt)$/i, '').replace(/[-_]+/g, ' ').trim();
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const graphemes = (str) => { try { if (Intl.Segmenter) return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(str)].map((x) => x.segment); } catch (e) { } return [...str]; };
const IS_IOS = /iP(hone|ad|od)/.test(navigator.platform) || (navigator.userAgent.includes('Mac') && 'ontouchend' in document);
const IS_STANDALONE = window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

let toastTimer = null;
function toast(msg, opts = {}) {
  const t = $('#toast');
  t.innerHTML = '';
  t.append(document.createTextNode(msg));
  t.classList.toggle('action', !!opts.action);
  if (opts.action) t.append(el('button', { onclick: () => { hideToast(); opts.action.fn(); } }, opts.action.label));
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, opts.duration || (opts.action ? 8000 : 2600));
}
function hideToast() { $('#toast').classList.remove('on'); }

/* ============================================================
   Dialogs (confirm / prompt / choose) — promise based
   ============================================================ */
let dialogResolve = null;
function openDialog({ title, text, input, buttons }) {
  const d = $('#dialog'), s = $('#scrim2');
  d.innerHTML = '';
  if (title) d.append(el('h3', null, title));
  if (text) d.append(el('p', null, text));
  let inp = null;
  if (input) { inp = el('input', { type: 'text', value: input.value || '', placeholder: input.placeholder || '', autocapitalize: 'sentences' }); d.append(inp); }
  if (dialogResolve) { const prev = dialogResolve; dialogResolve = null; prev(null); } // a dialog was already open — cancel it
  let done = false;
  const finish = (v) => { if (done) return; done = true; d.classList.remove('on'); s.classList.remove('on'); s.onclick = null; if (dialogResolve) { const r = dialogResolve; dialogResolve = null; r(v); } };
  const btns = el('div', { class: 'btns' });
  for (const b of buttons) btns.append(el('button', { class: b.style || '', onclick: () => finish(b.value === '__input' ? (inp ? inp.value.trim() : '') : b.value) }, b.label));
  d.append(btns);
  d.classList.add('on'); s.classList.add('on');
  if (inp) { setTimeout(() => { inp.focus(); inp.select(); }, 60); inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(inp.value.trim()); }); }
  return new Promise((res) => {
    dialogResolve = res;
    s.onclick = () => finish(null);
  });
}
const confirmDialog = ({ title, text, ok = 'OK', danger = false, cancel = 'Cancel' }) => openDialog({ title, text, buttons: [{ label: ok, value: true, style: danger ? 'danger' : 'primary' }, { label: cancel, value: false, style: 'plain' }] }).then((v) => v === true);
const promptDialog = ({ title, text, value = '', placeholder = '', ok = 'Save' }) => openDialog({ title, text, input: { value, placeholder }, buttons: [{ label: ok, value: '__input', style: 'primary' }, { label: 'Cancel', value: null, style: 'plain' }] });
const chooseDialog = ({ title, text, options }) => openDialog({ title, text, buttons: options });

/* ============================================================
   IndexedDB
   ============================================================ */
const DB_NAME = 'html-library', DB_VER = 1;
let dbPromise = null;
function db() {
  if (!dbPromise) dbPromise = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const n of ['apps', 'files', 'state', 'folders']) if (!d.objectStoreNames.contains(n)) d.createObjectStore(n, { keyPath: 'id' });
      if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings', { keyPath: 'key' });
    };
    r.onsuccess = () => {
      const d = r.result;
      d.onversionchange = () => { d.close(); dbPromise = null; };
      // iOS 17/18 sometimes drops the IDB connection ("Connection to Indexed Database server lost");
      // forget the handle so the next operation reopens instead of failing forever.
      d.onclose = () => { dbPromise = null; };
      res(d);
    };
    r.onerror = () => { dbPromise = null; rej(r.error); };
  });
  return dbPromise;
}
const reqp = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const isConnError = (e) => e && (e.name === 'UnknownError' || e.name === 'InvalidStateError' || /database server|closing/i.test(String(e.message || '')));
async function op(store, mode, fn, retried) {
  const d = await db();
  try { const t = d.transaction(store, mode); return await reqp(fn(t.objectStore(store))); }
  catch (e) { if (!retried && isConnError(e)) { dbPromise = null; return op(store, mode, fn, true); } throw e; }
}
const DB = {
  get: (s, k) => op(s, 'readonly', (o) => o.get(k)),
  all: (s) => op(s, 'readonly', (o) => o.getAll()),
  keys: (s) => op(s, 'readonly', (o) => o.getAllKeys()),
  put: (s, v) => op(s, 'readwrite', (o) => o.put(v)),
  del: (s, k) => op(s, 'readwrite', (o) => o.delete(k)),
  clear: (s) => op(s, 'readwrite', (o) => o.clear()),
  multi: async (names, fn, retried) => {
    const d = await db();
    try {
      return await new Promise((res, rej) => {
        const t = d.transaction(names, 'readwrite');
        const stores = {}; for (const n of names) stores[n] = t.objectStore(n);
        t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('aborted'));
        try { fn(stores); } catch (e) { try { t.abort(); } catch (_) { } rej(e); }
      });
    } catch (e) { if (!retried && isConnError(e)) { dbPromise = null; return DB.multi(names, fn, true); } throw e; }
  },
};

/* ============================================================
   In-memory model
   ============================================================ */
let apps = [];        // {id,name,icon,themeColor,folderId,createdAt,updatedAt,lastOpened,htmlBytes,sourceName,auto:{safeArea,homeButton},settings:{homeButton,safeArea,homeBtnPos}}
let folders = [];     // {id,name,createdAt}
let settings = {};    // key → value
const stateBytes = new Map(); // appId → bytes of saved localStorage snapshot
let view = { folder: null };
let editMode = false;

async function setSetting(key, value) { settings[key] = value; await DB.put('settings', { key, value }); }
async function saveApp(app) { app.updatedAt = Date.now(); await DB.put('apps', app); }
const appById = (id) => apps.find((a) => a.id === id);
const folderById = (id) => folders.find((f) => f.id === id);
const appStorageBytes = (a) => (a.htmlBytes || 0) + (stateBytes.get(a.id) || 0) + iconBytes(a.icon);
function iconBytes(icon) { return icon && icon.type === 'img' && icon.src ? Math.round(icon.src.length * 0.75) : 0; }

/* ============================================================
   HTML metadata extraction & icons
   ============================================================ */
function looksLikeHtml(s) { return /<\s*(!doctype\s+html|html|head|body|script|div|main|canvas|style|meta|title)\b/i.test(s.slice(0, 4000)) || /<\/(html|body|script|div)\s*>/i.test(s.slice(-4000)); }
function parseAppMeta(html, filename) {
  let doc = null;
  try { doc = new DOMParser().parseFromString(html, 'text/html'); } catch (e) { }
  const q = (sel) => (doc ? doc.querySelector(sel) : null);
  const metaC = (n) => { const m = q(`meta[name="${n}" i]`); return m ? (m.getAttribute('content') || '').trim() : ''; };
  const titleTxt = (q('title') ? q('title').textContent : '').replace(/\s+/g, ' ').trim();
  const name = metaC('library-name') || metaC('apple-mobile-web-app-title') || metaC('application-name') || titleTxt || stripExt(filename) || 'Untitled app';
  let icon = null;
  const li = metaC('library-icon');
  if (li) {
    if (/^data:image\//i.test(li)) icon = { type: 'img', src: li, from: 'html' };
    else if (graphemes(li).length <= 2) icon = { type: 'emoji', value: li, from: 'html' };
  }
  if (!icon && doc) {
    for (const sel of ['link[rel~="apple-touch-icon" i]', 'link[rel~="apple-touch-icon-precomposed" i]', 'link[rel~="icon" i]']) {
      const hit = [...doc.querySelectorAll(sel)].find((x) => /^data:image\//i.test((x.getAttribute('href') || '').trim()));
      if (hit) { icon = { type: 'img', src: hit.getAttribute('href').trim(), from: 'html' }; break; }
    }
  }
  const themeColor = metaC('theme-color') || null;
  const safeArea = /safe-area-inset|viewport-fit\s*=\s*cover/i.test(html) ? 'full' : 'pad';
  const homeButton = !/^(off|false|no|0|hidden)$/i.test(metaC('library-home-button') || 'on');
  const fillBottom = !/^(off|false|no|0)$/i.test(metaC('library-fill-bottom') || 'on');
  const o = (metaC('library-orientation') || '').toLowerCase();
  const orientation = /portrait/.test(o) ? 'portrait' : /landscape/.test(o) ? 'landscape' : 'auto';
  const folder = metaC('library-folder') || '';
  return { name, icon, themeColor, safeArea, homeButton, fillBottom, orientation, folder, title: titleTxt };
}
const PALETTE = [['#3a6df0', '#7aa2ff'], ['#f0663a', '#ffb03a'], ['#2fbf71', '#63f2a0'], ['#b04ae0', '#e08cff'], ['#e04a7a', '#ff8cb0'], ['#20a4b8', '#5fe3ff'], ['#c9a227', '#ffe27a'], ['#5b6478', '#9aa4b8']];
function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
function iconNode(app, extraClass = '') {
  const ic = el('div', { class: 'ic ' + extraClass });
  const icon = app.icon;
  if (icon && icon.type === 'img' && icon.src) { ic.append(el('img', { src: icon.src, alt: '', draggable: 'false' })); }
  else if (icon && icon.type === 'emoji' && icon.value) { ic.append(el('span', { class: 'emoji' }, icon.value)); }
  else {
    const p = PALETTE[hashStr(app.id || app.name || '') % PALETTE.length];
    ic.style.background = `linear-gradient(145deg, ${p[0]}, ${p[1]})`;
    ic.append(el('span', { class: 'letter' }, (app.name || '?').trim().charAt(0).toUpperCase() || '?'));
  }
  return ic;
}
function loadImage(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('bad image')); i.src = src; }); }
async function normalizeIconDataUrl(src, size = 256, forceRaster = false) {
  // Keep small icons as-is (SVGs included); rasterize/downscale big ones.
  if (!forceRaster && src.length < 120000) return src;
  try {
    const img = await loadImage(src);
    const c = document.createElement('canvas'); c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    const s = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height) || size;
    const sx = ((img.naturalWidth || img.width) - s) / 2, sy = ((img.naturalHeight || img.height) - s) / 2;
    ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size);
    const png = c.toDataURL('image/png');
    const jpg = c.toDataURL('image/jpeg', 0.88);
    return jpg.length < png.length * 0.6 ? jpg : png;
  } catch (e) { return (!forceRaster && src.length < 2000000) ? src : null; }
}
function fileToDataUrl(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file); }); }

/* ============================================================
   Import / create / update apps
   ============================================================ */
async function ensureFolder(name) {
  const f = folders.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (f) return f;
  const nf = { id: uid(), name, createdAt: Date.now() };
  folders.push(nf); await DB.put('folders', nf); return nf;
}
async function createApp(html, filename, meta) {
  meta = meta || parseAppMeta(html, filename);
  const app = {
    id: uid(), name: meta.name, icon: meta.icon ? { ...meta.icon } : { type: 'letter' }, themeColor: meta.themeColor,
    folderId: meta.folder ? (await ensureFolder(meta.folder)).id : (view.folder || null),
    createdAt: Date.now(), updatedAt: Date.now(), lastOpened: 0, htmlBytes: byteLen(html), sourceName: filename || '',
    auto: { safeArea: meta.safeArea, homeButton: meta.homeButton },
    settings: { homeButton: meta.homeButton, safeArea: 'auto', homeBtnPos: null, fillBottom: meta.fillBottom, orientation: meta.orientation },
  };
  if (app.icon.type === 'img') { const n = await normalizeIconDataUrl(app.icon.src); if (n) app.icon.src = n; else app.icon = { type: 'letter' }; }
  await DB.multi(['apps', 'files', 'state'], (s) => { s.apps.put(app); s.files.put({ id: app.id, html }); s.state.put({ id: app.id, ls: {}, updatedAt: Date.now() }); });
  apps.push(app); stateBytes.set(app.id, 2);
  return app;
}
async function replaceAppHtml(app, html, filename) {
  const meta = parseAppMeta(html, filename);
  app.htmlBytes = byteLen(html); app.sourceName = filename || app.sourceName; app.themeColor = meta.themeColor;
  app.auto = { safeArea: meta.safeArea, homeButton: meta.homeButton };
  if (meta.homeButton === false) app.settings.homeButton = false; // the file explicitly opts out
  if (meta.fillBottom === false) app.settings.fillBottom = false;
  if (meta.orientation && meta.orientation !== 'auto') app.settings.orientation = meta.orientation;
  if ((!app.icon || app.icon.type === 'letter' || app.icon.from === 'html') && meta.icon) {
    app.icon = { ...meta.icon };
    if (app.icon.type === 'img') { const n = await normalizeIconDataUrl(app.icon.src); if (n) app.icon.src = n; else app.icon = { type: 'letter' }; }
  }
  app.updatedAt = Date.now();
  await DB.multi(['apps', 'files'], (s) => { s.apps.put(app); s.files.put({ id: app.id, html }); });
  return app;
}
function uniqueName(base) {
  if (!apps.some((a) => a.name.toLowerCase() === base.toLowerCase())) return base;
  for (let n = 2; ; n++) { const c = `${base} (${n})`; if (!apps.some((a) => a.name.toLowerCase() === c.toLowerCase())) return c; }
}
async function importHtmlText(html, filename, nameOverride) {
  if (!looksLikeHtml(html)) { toast(`${filename || 'That'} doesn't look like an HTML file`); return null; }
  const meta = parseAppMeta(html, filename);
  if (nameOverride) meta.name = nameOverride;
  const existing = apps.find((a) => a.name.toLowerCase() === meta.name.toLowerCase());
  if (existing) {
    const c = await chooseDialog({
      title: `“${meta.name}” already exists`, text: 'Update the existing app with this file (its saved data is kept), or add a separate copy?',
      options: [{ label: 'Update existing', value: 'update', style: 'primary' }, { label: 'Add as a copy', value: 'new' }, { label: 'Skip', value: null, style: 'plain' }],
    });
    if (c === null) return null;
    if (c === 'update') { if (RT.app && RT.app.id === existing.id) await quitApp(); await replaceAppHtml(existing, html, filename); toast(`Updated ${existing.name}`); return existing; }
    meta.name = uniqueName(meta.name);
  }
  const app = await createApp(html, filename, meta);
  toast(`Added ${app.name}`);
  return app;
}
async function importFiles(files) {
  let n = 0;
  for (const f of files) {
    try { const text = await f.text(); if (await importHtmlText(text, f.name)) n++; }
    catch (e) { console.error(e); toast(`Couldn't read ${f.name}`); }
  }
  render();
  return n;
}
async function deleteApp(app) {
  if (RT.app && RT.app.id === app.id) await quitApp();
  await DB.multi(['apps', 'files', 'state'], (s) => { s.apps.delete(app.id); s.files.delete(app.id); s.state.delete(app.id); });
  apps = apps.filter((a) => a.id !== app.id); stateBytes.delete(app.id);
  // Remove namespaced IndexedDB databases / caches the app may have created via the shim.
  const prefix = 'lib.' + app.id + '.';
  try { if (indexedDB.databases) { const list = await indexedDB.databases(); for (const d of list) if (d.name && d.name.startsWith(prefix)) indexedDB.deleteDatabase(d.name); } } catch (e) { }
  try { if (window.caches) { const ks = await caches.keys(); for (const k of ks) if (k.startsWith(prefix)) await caches.delete(k); } } catch (e) { }
}
async function appExtraDbs(app) {
  try { if (indexedDB.databases) { const list = await indexedDB.databases(); const p = 'lib.' + app.id + '.'; return list.filter((d) => d.name && d.name.startsWith(p)).map((d) => d.name.slice(p.length)); } } catch (e) { }
  return [];
}

/* ============================================================
   Home screen rendering
   ============================================================ */
function sortedApps(list) {
  const s = settings.sort || 'recent';
  const c = list.slice();
  if (s === 'name') c.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  else if (s === 'added') c.sort((a, b) => b.createdAt - a.createdAt);
  else c.sort((a, b) => (b.lastOpened || b.createdAt) - (a.lastOpened || a.createdAt));
  return c;
}
function render() {
  const grid = $('#grid'); grid.innerHTML = '';
  const q = $('#search').value.trim().toLowerCase();
  const titleEl = $('#title'); titleEl.innerHTML = '';
  const folder = view.folder ? folderById(view.folder) : null;
  if (!folder) view.folder = null;
  if (folder) {
    titleEl.append(el('button', { class: 'iconbtn', style: 'width:32px;height:32px;font-size:20px', onclick: () => { view.folder = null; render(); } }, '‹'), el('span', { class: 'name' }, folder.name));
  } else titleEl.append(el('span', { class: 'name' }, 'Library'));
  let tiles = [];
  if (q) {
    tiles = sortedApps(apps.filter((a) => a.name.toLowerCase().includes(q))).map((a) => appTile(a));
  } else if (folder) {
    tiles = sortedApps(apps.filter((a) => a.folderId === folder.id)).map((a) => appTile(a));
  } else {
    const fs = folders.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    tiles = fs.map((f) => folderTile(f)).concat(sortedApps(apps.filter((a) => !a.folderId || !folderById(a.folderId))).map((a) => appTile(a)));
  }
  for (const t of tiles) grid.append(t);
  $('#empty').classList.toggle('hidden', !(apps.length === 0 && !q));
  if (q && tiles.length === 0) grid.append(el('div', { class: 'empty', style: 'grid-column:1/-1;padding:30px' }, 'No matches'));
  if (folder && tiles.length === 0) grid.append(el('div', { class: 'empty', style: 'grid-column:1/-1;padding:30px' }, 'This folder is empty. Long-press an app → Folder to move it here.'));
  $$('#sortRow [data-sort]').forEach((b) => b.classList.toggle('on', b.dataset.sort === (settings.sort || 'recent')));
  renderRunningBar();
  updateStoragePill();
  document.body.classList.toggle('edit', editMode);
  $('#editBtn').classList.toggle('primary', editMode);
}
function attachPress(tile, onTap, onLong) {
  let timer = null, sx = 0, sy = 0, longFired = false;
  tile.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.isPrimary === false) return;
    sx = e.clientX; sy = e.clientY; longFired = false;
    clearTimeout(timer); timer = setTimeout(() => { longFired = true; if (navigator.vibrate) navigator.vibrate(10); onLong(); }, 450);
  });
  tile.addEventListener('pointermove', (e) => { if (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10) clearTimeout(timer); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((n) => tile.addEventListener(n, () => clearTimeout(timer)));
  tile.addEventListener('click', (e) => { e.preventDefault(); if (longFired) { longFired = false; return; } onTap(); });
  tile.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!longFired) { longFired = true; onLong(); } });
}
function appTile(app) {
  const t = el('button', { class: 'tile', 'aria-label': app.name });
  const ic = iconNode(app);
  if (RT.app && RT.app.id === app.id) t.append(el('span', { class: 'dot' }));
  t.append(ic, el('span', { class: 'lbl' }, app.name), el('span', { class: 'more' }, '⋯'));
  attachPress(t, () => (editMode ? openAppSheet(app) : launchApp(app.id)), () => openAppSheet(app));
  return t;
}
function folderTile(f) {
  const t = el('button', { class: 'tile', 'aria-label': f.name });
  const ic = el('div', { class: 'ic folder' });
  const inside = sortedApps(apps.filter((a) => a.folderId === f.id)).slice(0, 4);
  for (const a of inside) { const m = iconNode(a); m.className = 'mini'; ic.append(m); }
  for (let i = inside.length; i < 4; i++) ic.append(el('div', { class: 'mini', style: 'background:rgba(255,255,255,.06)' }));
  t.append(ic, el('span', { class: 'lbl' }, f.name), el('span', { class: 'more' }, '⋯'));
  attachPress(t, () => { if (editMode) openFolderSheet(f); else { view.folder = f.id; render(); window.scrollTo(0, 0); } }, () => openFolderSheet(f));
  return t;
}
function updateStoragePill() {
  const total = apps.reduce((n, a) => n + appStorageBytes(a), 0);
  $('#storagePill').textContent = `${apps.length} app${apps.length === 1 ? '' : 's'} · ${fmtBytes(total)}`;
}
let reopenApp = null; // app that was open when the page last unloaded (iOS may kill the process in the background)
function renderRunningBar() {
  const bar = $('#runningBar');
  const app = (RT.app && RT.suspended) ? RT.app : (!RT.app && reopenApp ? reopenApp : null);
  bar.classList.toggle('hidden', !app);
  if (!app) return;
  const n = iconNode(app); n.id = 'runningIcon'; $('#runningIcon').replaceWith(n); $('#runningName').textContent = app.name;
  const isReopen = !RT.app;
  $('#runningSub').textContent = isReopen ? 'Was open when the Library was last closed' : 'Running in background';
  $('#resumeBtn').textContent = isReopen ? 'Reopen' : 'Resume';
  $('#quitBtn').textContent = isReopen ? 'Dismiss' : 'Quit';
}

/* ============================================================
   Sheets
   ============================================================ */
let sheetOnClose = null, sheetSeq = 0;
function openSheet(title, build, onClose) {
  const sh = $('#sheet'), body = $('#sheetBody');
  $('#sheetTitle').textContent = title;
  body.innerHTML = ''; body.scrollTop = 0;
  sheetOnClose = onClose || null;
  sheetSeq++;
  build(body, sheetSeq);
  sh.classList.add('on'); $('#scrim').classList.add('on');
  lockScroll();
}
let lockY = 0, locked = false;
function lockScroll() {
  if (locked || document.body.classList.contains('stage-open')) return;
  locked = true; lockY = window.scrollY; document.body.style.top = -lockY + 'px'; document.body.classList.add('lock');
}
function unlockScroll() {
  if (!locked) return;
  locked = false; document.body.classList.remove('lock'); document.body.style.top = ''; window.scrollTo(0, lockY);
}
function closeSheet() {
  sheetSeq++;
  $('#sheet').classList.remove('on'); $('#scrim').classList.remove('on');
  unlockScroll();
  const f = sheetOnClose; sheetOnClose = null; if (f) f();
}
function section(...rows) { return el('div', { class: 'section' }, rows); }
function row(k, v, opts = {}) {
  const r = el('div', { class: 'row' + (opts.btn ? ' btn' : '') + (opts.danger ? ' danger' : '') });
  if (typeof k === 'string') r.append(el('div', { class: 'k' }, k, opts.sub ? el('small', null, opts.sub) : null)); else r.append(k);
  if (v !== undefined && v !== null) r.append(typeof v === 'string' ? el('div', { class: 'v' }, v) : v);
  if (opts.onclick) r.addEventListener('click', opts.onclick);
  return r;
}
function switchBtn(on, onchange) {
  const b = el('button', { class: 'switch' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false' });
  b.addEventListener('click', () => { const v = !b.classList.contains('on'); b.classList.toggle('on', v); b.setAttribute('aria-pressed', v); onchange(v); });
  return b;
}
function segControl(options, value, onchange) {
  const s = el('div', { class: 'seg' });
  for (const o of options) {
    const b = el('button', { class: o.value === value ? 'on' : '' }, o.label);
    b.addEventListener('click', () => { $$('button', s).forEach((x) => x.classList.remove('on')); b.classList.add('on'); onchange(o.value); });
    s.append(b);
  }
  return s;
}
function codeBox(code) {
  const box = el('div', { class: 'codebox' });
  const pre = el('pre', null, code);
  const btn = el('button', { class: 'copy' }, 'Copy');
  btn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(code); btn.textContent = 'Copied'; }
    catch (e) { const r = document.createRange(); r.selectNodeContents(pre); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); try { document.execCommand('copy'); btn.textContent = 'Copied'; } catch (_) { btn.textContent = 'Select & copy'; } }
    setTimeout(() => (btn.textContent = 'Copy'), 1500);
  });
  box.append(pre, btn);
  return box;
}

/* ---------- Import sheet ---------- */
function openImportSheet() {
  openSheet('Add app', (b) => {
    b.append(
      el('button', { class: 'bigbtn', onclick: () => $('#fileInput').click() }, 'Choose .html file(s)…'),
      el('div', { class: 'hint' }, 'Pick one or more HTML files from the Files app (iCloud Drive / Downloads / On My iPhone). To pick several at once tap Select in the Files picker first. Single-file apps work best — everything they need must be inside the file.'),
      el('button', { class: 'bigbtn secondary', onclick: openPasteSheet }, 'Paste HTML'),
      el('button', { class: 'bigbtn secondary', onclick: openUrlSheet }, 'Import from URL'),
      el('div', { class: 'hint' }, 'Tip: if a file has the same name as an app that\'s already here, you can update it in place and keep its saved data.'),
    );
  });
}
function openPasteSheet() {
  openSheet('Paste HTML', (b) => {
    const ta = el('textarea', { class: 'paste', placeholder: '<!DOCTYPE html>\n<html>…', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
    const name = el('input', { type: 'text', placeholder: 'Name (optional — taken from <title> if empty)', enterkeyhint: 'done' });
    const nameRow = section(row(name));
    const go = el('button', { class: 'bigbtn' }, 'Import');
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } });
    go.addEventListener('click', async () => {
      const html = ta.value; if (!html.trim()) return;
      go.disabled = true;
      const nm = name.value.trim();
      await importHtmlText(html, nm ? nm + '.html' : 'pasted.html', nm || undefined);
      render(); closeSheet();
    });
    b.append(ta, el('div', { style: 'height:10px' }), nameRow, go);
  });
}
function openUrlSheet() {
  openSheet('Import from URL', (b) => {
    const url = el('input', { type: 'url', placeholder: 'https://…/app.html', autocapitalize: 'off', autocorrect: 'off', inputmode: 'url', enterkeyhint: 'go' });
    const go = el('button', { class: 'bigbtn' }, 'Fetch & import');
    url.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go.click(); } });
    go.addEventListener('click', async () => {
      const u = url.value.trim(); if (!u) return;
      go.disabled = true; go.textContent = 'Fetching…';
      try {
        const r = await fetch(u, { cache: 'no-store' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const html = await r.text();
        const fname = decodeURIComponent((u.split('#')[0].split('?')[0].split('/').pop() || 'app.html'));
        await importHtmlText(html, fname); render(); closeSheet();
      } catch (e) { toast('Could not fetch: ' + (e.message || e)); go.disabled = false; go.textContent = 'Fetch & import'; }
    });
    b.append(section(row(url)), go, el('div', { class: 'hint' }, 'The server must allow cross-origin requests (GitHub Pages and raw.githubusercontent.com do). You need to be online for this one.'));
  });
}

/* ---------- App sheet ---------- */
async function openAppSheet(app) {
  const st = await DB.get('state', app.id).catch(() => null);
  const file = await DB.get('files', app.id).catch(() => null); // prefetched so Share runs synchronously in the tap (iOS needs the user gesture)
  const dbs = await appExtraDbs(app);
  const sBytes = st && st.ls ? byteLen(JSON.stringify(st.ls)) : 0; stateBytes.set(app.id, sBytes);
  const isRunning = RT.app && RT.app.id === app.id;
  openSheet('App', (b) => {
    // header
    const ic = iconNode(app); ic.append(el('div', { class: 'edit' }, 'EDIT'));
    ic.addEventListener('click', () => openIconPicker(app));
    const nameIn = el('input', { type: 'text', value: app.name, autocapitalize: 'words' });
    const commitName = async () => { const v = nameIn.value.trim(); if (v && v !== app.name) { app.name = v; await saveApp(app); render(); } else nameIn.value = app.name; };
    nameIn.addEventListener('change', commitName); nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameIn.blur(); });
    b.append(el('div', { class: 'apphead' }, ic, el('div', { class: 'meta' }, nameIn, el('small', null, `Added ${fmtDate(app.createdAt)} · ${fmtBytes(appStorageBytes(app))}${isRunning ? ' · running' : ''}`))));
    // open
    b.append(el('button', { class: 'bigbtn', onclick: () => { closeSheet(); launchApp(app.id); } }, isRunning && RT.suspended ? 'Resume' : 'Open'));
    // folder / settings
    const sel = el('select');
    sel.append(el('option', { value: '' }, 'None (home screen)'));
    for (const f of folders.slice().sort((a, b2) => a.name.localeCompare(b2.name))) sel.append(el('option', { value: f.id, selected: app.folderId === f.id ? true : null }, f.name));
    sel.append(el('option', { value: '__new' }, '＋ New folder…'));
    sel.addEventListener('change', async () => {
      if (sel.value === '__new') { const nm = await promptDialog({ title: 'New folder', placeholder: 'Folder name', ok: 'Create' }); if (nm) { const f = await ensureFolder(nm); app.folderId = f.id; await saveApp(app); render(); openAppSheet(app); } else sel.value = app.folderId || ''; return; }
      app.folderId = sel.value || null; await saveApp(app); render();
    });
    const eff = effectiveSafeArea(app);
    b.append(section(
      row('Folder', sel),
      row('Floating home button', switchBtn(app.settings.homeButton !== false, async (v) => { app.settings.homeButton = v; await saveApp(app); if (isRunning) updateHomeBtn(); }), { sub: 'A draggable ⌂ button over the app. Emergency exit while it is off: hold two fingers still on the app for 1.5s.' }),
      row('Top inset', segControl([{ label: 'Auto', value: 'auto' }, { label: 'Full', value: 'full' }, { label: 'Pad', value: 'pad' }], app.settings.safeArea || 'auto', async (v) => { app.settings.safeArea = v; await saveApp(app); if (isRunning) { applyOrientation(app); applyStageMode(app); } openAppSheet(app); }), { sub: `Keeps the app clear of the Dynamic Island. Auto → ${eff === 'full' ? 'full (this app handles the notch itself)' : 'pad (the Library holds it below the notch)'}. The bottom edge is always full-bleed.` }),
      row('Fill bottom edge', switchBtn(app.settings.fillBottom !== false, async (v) => { app.settings.fillBottom = v; await saveApp(app); if (isRunning) applyStageMode(app); }), { sub: 'Ignores the app\'s own home-indicator padding so it reaches the bottom of the screen. Turn off if an app\'s bottom controls end up under the home bar.' }),
      row('Orientation', segControl([{ label: 'Auto', value: 'auto' }, { label: 'Portrait', value: 'portrait' }, { label: 'Landscape', value: 'landscape' }], app.settings.orientation || 'auto', async (v) => { app.settings.orientation = v; await saveApp(app); if (isRunning) { tryNativeLock(v); applyOrientation(app); applyStageMode(app); positionHomeBtn(); } }), { sub: 'iOS can\'t lock a web app to one orientation, so the Library rotates the app itself when you turn the phone. Safe-area padding is off while rotated.' }),
    ));
    b.append(section(
      row('HTML file', fmtBytes(app.htmlBytes || 0), { sub: app.sourceName || '' }),
      row('Saved data', fmtBytes(sBytes), { sub: st && st.ls ? `${Object.keys(st.ls).length} localStorage key${Object.keys(st.ls).length === 1 ? '' : 's'}` : 'none yet' }),
      dbs.length ? row('Databases', `${dbs.length}`, { sub: dbs.join(', ') }) : null,
      row('Last opened', app.lastOpened ? fmtDate(app.lastOpened) : 'never'),
      row('Theme color', app.themeColor || '—'),
    ));
    b.append(section(
      row('Update HTML file…', el('span', { class: 'chev' }, '›'), { btn: true, sub: 'Replace the file with a new version. Saved data is kept.', onclick: () => { replaceTarget = app; $('#replaceInput').click(); } }),
      row('Share / export HTML file', el('span', { class: 'chev' }, '›'), { btn: true, onclick: () => { if (!file) { toast('HTML missing'); return; } saveFile(new Blob([file.html], { type: 'text/html' }), (app.sourceName && /\.html?$/i.test(app.sourceName) ? app.sourceName : app.name.replace(/[\\/:*?"<>|]+/g, '_') + '.html')); } }),
      row('Export saved data', el('span', { class: 'chev' }, '›'), { btn: true, sub: 'JSON of this app\'s localStorage', onclick: async () => { const s2 = await DB.get('state', app.id); await saveFile(new Blob([JSON.stringify({ format: 'html-library-appdata', app: app.name, exportedAt: new Date().toISOString(), localStorage: (s2 && s2.ls) || {} }, null, 2)], { type: 'application/json' }), app.name.replace(/[\\/:*?"<>|]+/g, '_') + '.savedata.json'); } }),
      row('Import saved data…', el('span', { class: 'chev' }, '›'), { btn: true, onclick: () => { jsonTarget = { kind: 'appdata', app }; $('#jsonInput').click(); } }),
      row('Reset saved data', null, { btn: true, danger: true, onclick: async () => { if (await confirmDialog({ title: 'Reset saved data?', text: `This erases everything ${app.name} has saved (localStorage, databases). The app itself stays.`, ok: 'Reset', danger: true })) { await resetAppData(app); toast('Saved data reset'); openAppSheet(app); } } }),
    ));
    b.append(section(row('Delete app', null, { btn: true, danger: true, onclick: async () => { if (await confirmDialog({ title: `Delete ${app.name}?`, text: 'The HTML file and all of its saved data will be removed from this Library.', ok: 'Delete', danger: true })) { await deleteApp(app); closeSheet(); render(); toast('Deleted'); } } })));
  });
}
async function resetAppData(app) {
  if (RT.app && RT.app.id === app.id) await quitApp();
  await DB.put('state', { id: app.id, ls: {}, updatedAt: Date.now() }); stateBytes.set(app.id, 2);
  const prefix = 'lib.' + app.id + '.';
  try { if (indexedDB.databases) { const list = await indexedDB.databases(); for (const d of list) if (d.name && d.name.startsWith(prefix)) indexedDB.deleteDatabase(d.name); } } catch (e) { }
  try { if (window.caches) { const ks = await caches.keys(); for (const k of ks) if (k.startsWith(prefix)) await caches.delete(k); } } catch (e) { }
}
function openIconPicker(app) {
  openSheet('App icon', (b) => {
    const grid = el('div', { class: 'iconpick' });
    const back = () => openAppSheet(app);
    grid.append(el('button', { onclick: () => { iconTarget = app; $('#iconInput').click(); } }, el('span', null, '🖼️'), 'Upload image'));
    grid.append(el('button', { onclick: () => { emojiBox.classList.remove('hidden'); emojiIn.focus(); } }, el('span', null, '😀'), 'Emoji'));
    grid.append(el('button', { onclick: async () => { const f = await DB.get('files', app.id); const m = parseAppMeta(f.html, app.sourceName); if (m.icon) { app.icon = { ...m.icon }; if (app.icon.type === 'img') app.icon.src = (await normalizeIconDataUrl(app.icon.src)) || app.icon.src; await saveApp(app); render(); back(); } else toast('No icon found in the HTML (needs a data: URL <link rel="apple-touch-icon"> or <meta name="library-icon">)'); } }, el('span', null, '📄'), 'From HTML'));
    grid.append(el('button', { onclick: async () => { app.icon = { type: 'letter' }; await saveApp(app); render(); back(); } }, el('span', null, 'A'), 'Letter tile'));
    const emojiIn = el('input', { type: 'text', placeholder: '🚀', maxlength: '8', autocomplete: 'off' });
    const emojiBox = el('div', { class: 'emojirow hidden' }, emojiIn, el('button', { class: 'pill on', onclick: async () => { const v = emojiIn.value.trim(); if (!v) return; app.icon = { type: 'emoji', value: graphemes(v).slice(0, 2).join('') }; await saveApp(app); render(); back(); } }, 'Use emoji'));
    b.append(el('div', { class: 'apphead' }, iconNode(app), el('div', { class: 'meta' }, el('b', null, app.name))), grid, emojiBox, el('button', { class: 'bigbtn secondary', onclick: back }, 'Back'));
  });
}
function openFolderSheet(f) {
  openSheet('Folder', (b) => {
    const nameIn = el('input', { type: 'text', value: f.name, autocapitalize: 'words' });
    nameIn.addEventListener('change', async () => { const v = nameIn.value.trim(); if (v) { f.name = v; await DB.put('folders', f); render(); } else nameIn.value = f.name; });
    const inside = apps.filter((a) => a.folderId === f.id);
    b.append(section(row(nameIn)), section(row('Apps inside', String(inside.length))));
    b.append(el('button', { class: 'bigbtn secondary', onclick: () => { closeSheet(); view.folder = f.id; render(); } }, 'Open folder'));
    b.append(section(row('Delete folder', null, { btn: true, danger: true, sub: 'Apps inside move back to the home screen.', onclick: async () => { if (await confirmDialog({ title: `Delete folder “${f.name}”?`, text: 'The apps inside are kept.', ok: 'Delete', danger: true })) { for (const a of inside) { a.folderId = null; await saveApp(a); } folders = folders.filter((x) => x.id !== f.id); await DB.del('folders', f.id); if (view.folder === f.id) view.folder = null; closeSheet(); render(); } } })));
  });
}

/* ---------- Storage sheet ---------- */
async function openStorageSheet() {
  openSheet('Storage', async (b, seq) => {
    b.append(el('div', { class: 'hint' }, 'Measuring…'));
    let est = null, persisted = null;
    try { if (navigator.storage && navigator.storage.estimate) est = await navigator.storage.estimate(); } catch (e) { }
    try { if (navigator.storage && navigator.storage.persisted) persisted = await navigator.storage.persisted(); } catch (e) { }
    const states = await DB.all('state').catch(() => []);
    for (const s of states) stateBytes.set(s.id, byteLen(JSON.stringify(s.ls || {})));
    let shell = 0;
    try { const ks = await caches.keys(); for (const k of ks) { if (!k.startsWith('html-library')) continue; const c = await caches.open(k); for (const req of await c.keys()) { const r = await c.match(req); if (r) shell += (await r.blob()).size; } } } catch (e) { }
    const html = apps.reduce((n, a) => n + (a.htmlBytes || 0), 0);
    const data = apps.reduce((n, a) => n + (stateBytes.get(a.id) || 0), 0);
    const icons = apps.reduce((n, a) => n + iconBytes(a.icon), 0);
    const total = shell + html + data + icons;
    if (seq !== sheetSeq) return; // user opened something else while we were measuring
    b.innerHTML = '';
    // device
    const dev = section();
    if (est && est.quota) {
      const pct = Math.min(100, (est.usage || 0) / est.quota * 100);
      dev.append(row(el('div', { class: 'k' }, `Used by this site: ${fmtBytes(est.usage || 0)}`, el('small', null, `of ${fmtBytes(est.quota)} available to it (${pct.toFixed(pct < 1 ? 2 : 0)}%)`), el('div', { class: 'bar' }, el('span', { style: `width:${Math.max(0.5, pct)}%;background:var(--accent)` })))));
    } else dev.append(row('Used by this site', 'unavailable', { sub: 'This browser doesn\'t report storage usage.' }));
    const pRow = row('Persistent storage', persisted === null ? 'unknown' : persisted ? 'granted' : 'not granted', { sub: persisted ? 'The browser promises not to evict this data without asking.' : 'Ask the browser to protect this data from automatic cleanup. On iOS, apps installed to the Home Screen keep their data as long as they stay installed.' });
    if (persisted === false && navigator.storage && navigator.storage.persist) pRow.append(el('button', { class: 'pill on', onclick: async () => { const ok = await navigator.storage.persist().catch(() => false); toast(ok ? 'Persistent storage granted' : 'Not granted (browser decision)'); openStorageSheet(); } }, 'Request'));
    dev.append(pRow);
    b.append(dev);
    // breakdown
    const seg = (n, color) => el('span', { style: `width:${total ? (n / total * 100) : 0}%;background:${color}` });
    b.append(section(row(el('div', { class: 'k' }, `Library total: ${fmtBytes(total)}`,
      el('div', { class: 'bar' }, seg(shell, '#8e97ab'), seg(html, '#7aa2ff'), seg(data, '#4fd28a'), seg(icons, '#ffb84a')),
      el('div', { class: 'legend' }, el('span', null, el('i', { style: 'background:#8e97ab' }), `Library app ${fmtBytes(shell)}`), el('span', null, el('i', { style: 'background:#7aa2ff' }), `HTML files ${fmtBytes(html)}`), el('span', null, el('i', { style: 'background:#4fd28a' }), `Saved data ${fmtBytes(data)}`), el('span', null, el('i', { style: 'background:#ffb84a' }), `Icons ${fmtBytes(icons)}`)),
      el('small', null, 'Sizes are the raw bytes stored; the browser adds a little overhead. Databases created by apps aren\'t counted individually.')))));
    // per app
    const list = el('div', { class: 'section stlist' });
    for (const a of apps.slice().sort((x, y) => appStorageBytes(y) - appStorageBytes(x))) {
      const r = row(el('div', { class: 'k' }, a.name, el('small', null, `HTML ${fmtBytes(a.htmlBytes || 0)} · data ${fmtBytes(stateBytes.get(a.id) || 0)}${iconBytes(a.icon) ? ' · icon ' + fmtBytes(iconBytes(a.icon)) : ''}`)), fmtBytes(appStorageBytes(a)), { btn: true, onclick: () => openAppSheet(a) });
      r.prepend(iconNode(a)); r.style.color = 'var(--text)';
      list.append(r);
    }
    if (apps.length) b.append(list);
    b.append(section(
      row('Back up everything', el('span', { class: 'chev' }, '›'), { btn: true, sub: 'One JSON file with every app\'s HTML + its saved (localStorage) data. Keep it in iCloud/Files.', onclick: backupAll }),
      row('Restore from backup…', el('span', { class: 'chev' }, '›'), { btn: true, onclick: () => { jsonTarget = { kind: 'backup' }; $('#jsonInput').click(); } }),
    ));
    updateStoragePill();
  });
}

/* ---------- Settings sheet ---------- */
/* What the page can actually see of the screen. If the web view is laid out inside the
   safe area (iOS not honouring viewport-fit=cover) the insets read 0 and innerHeight is
   short of screen.height — no CSS can reach those strips, they're outside the page. */
function displayInfo() {
  const vv = window.visualViewport;
  const ins = { top: safeInset('top'), right: safeInset('right'), bottom: safeInset('bottom'), left: safeInset('left') };
  const sw = screen.width, sh = screen.height;
  const portrait = window.innerHeight >= window.innerWidth;
  const screenLong = Math.max(sw, sh), screenShort = Math.min(sw, sh);
  const expectH = portrait ? screenLong : screenShort;
  const missing = Math.max(0, expectH - window.innerHeight);
  const fullBleed = missing <= 2;
  return {
    standalone: IS_STANDALONE, ios: IS_IOS,
    inner: [window.innerWidth, window.innerHeight],
    screen: [sw, sh],
    visual: vv ? [Math.round(vv.width), Math.round(vv.height), Math.round(vv.offsetTop)] : null,
    insets: ins, dpr: window.devicePixelRatio || 1,
    missing, fullBleed,
  };
}
function diagnosticsText() {
  const d = displayInfo();
  return [
    'Library ' + APP_VERSION,
    'standalone: ' + d.standalone + '   iOS: ' + d.ios,
    'viewport:   ' + d.inner[0] + ' x ' + d.inner[1],
    'screen:     ' + d.screen[0] + ' x ' + d.screen[1] + '   dpr ' + d.dpr,
    'visual vp:  ' + (d.visual ? d.visual[0] + ' x ' + d.visual[1] + ' @' + d.visual[2] : 'n/a'),
    'safe areas: top ' + d.insets.top + '  bottom ' + d.insets.bottom + '  left ' + d.insets.left + '  right ' + d.insets.right,
    'unreachable: ' + d.missing + 'pt',
    'full-bleed: ' + (d.fullBleed ? 'YES' : 'NO'),
  ].join('\n');
}
function openViewportTest() {
  const d = displayInfo(), o = $('#vptest');
  sizeStage();
  const good = d.fullBleed && (!d.standalone || d.insets.top > 0 || !IS_IOS);
  o.innerHTML = '';
  o.append(el('div', { class: 'band top' }, `safe-area-inset-top = ${d.insets.top}pt`));
  const mid = el('div', { class: 'mid' });
  mid.append(
    el('div', { class: 'verdict ' + (good ? 'ok' : 'bad') }, good
      ? 'Full-bleed ✓ — the pink border should touch all four screen edges.'
      : 'Not full-bleed — iOS is keeping ' + d.missing + 'pt of the screen outside the page. Black strips outside the pink border cannot be reached by any app.'),
    el('div', null, 'If you see black OUTSIDE the pink border, the web view does not cover the screen.'),
    el('pre', null, diagnosticsText()),
    el('button', { onclick: async () => { try { await navigator.clipboard.writeText(diagnosticsText()); toast('Diagnostics copied'); } catch (e) { toast('Select the text above to copy'); } } }, 'Copy diagnostics'),
    el('button', { onclick: () => o.classList.remove('on') }, 'Close'),
  );
  o.append(mid);
  o.append(el('div', { class: 'band bot' }, `safe-area-inset-bottom = ${d.insets.bottom}pt`));
  o.classList.add('on');
}
function openSettingsSheet() {
  openSheet('Settings', (b) => {
    b.append(section(
      row('Installed as app', IS_STANDALONE ? 'yes' : 'no', { sub: IS_STANDALONE ? 'Running from the Home Screen.' : 'In Safari: Share → Add to Home Screen. The installed copy has its own storage, so import your apps there.' }),
      row('Version', APP_VERSION + (SW.reg ? '' : ' (no service worker)'), { sub: 'Files are cached for offline use.' }),
      row('Full-screen test', el('span', { class: 'chev' }, '›'), { btn: true, sub: 'Draws a border on the true edges of the app and reports the viewport / safe-area numbers.', onclick: openViewportTest }),
      row('Check for updates', el('span', { class: 'chev' }, '›'), { btn: true, onclick: async () => { if (!SW.reg) { toast('Service worker not registered'); return; } toast('Checking…'); try { SW.updateShown = false; await SW.reg.update(); setTimeout(() => { if (SW.reg.waiting) SW.offer(SW.reg.waiting); else if (!SW.updateShown) toast('You have the latest version'); }, 1500); } catch (e) { toast('Update check failed (offline?)'); } } }),
    ));
    b.append(section(
      row('Storage & backups', el('span', { class: 'chev' }, '›'), { btn: true, onclick: openStorageSheet }),
    ));
    b.append(el('h3', { style: 'font-size:14px;color:var(--muted);margin:18px 2px 8px;text-transform:uppercase;letter-spacing:.06em' }, 'For your HTML apps'));
    b.append(section(row('Design guide for LLMs', el('span', { class: 'chev' }, '›'), { btn: true, sub: 'Everything an LLM needs to build apps that fit this phone and talk to the Library. Copy it and paste it into your prompt.', onclick: openGuideSheet })));
    b.append(el('div', { class: 'hint' }, 'Add a "back to Library" button to any app. Paste this anywhere in the page — it stays hidden when the file is opened on its own, and appears (and turns off the floating ⌂) when the app runs inside the Library:'));
    b.append(codeBox(SNIPPET_BUTTON));
    b.append(el('div', { class: 'hint' }, 'Or call it from your own UI / JS:'));
    b.append(codeBox(SNIPPET_JS));
    b.append(el('div', { class: 'hint' }, 'Optional <head> tags the Library reads when importing:'));
    b.append(codeBox(SNIPPET_META));
    b.append(el('div', { class: 'hint' }, 'The Library also reads <title>, <meta name="apple-mobile-web-app-title">, <meta name="theme-color"> and a data: URL <link rel="apple-touch-icon"> / <link rel="icon"> as the icon.'));
    b.append(section(row('Reset the whole Library', null, { btn: true, danger: true, sub: 'Deletes every app and all saved data.', onclick: async () => { if (await confirmDialog({ title: 'Reset the Library?', text: 'Every imported app and all their saved data will be deleted. This cannot be undone.', ok: 'Delete everything', danger: true })) { await resetLibrary(); closeSheet(); toast('Library reset'); } } })));
    b.append(el('div', { class: 'hint', style: 'text-align:center;margin-top:16px' }, `Library ${APP_VERSION}`));
  });
}
let guideText = null;
async function loadGuide() {
  if (guideText) return guideText;
  const r = await fetch('./LIBRARY-APP-GUIDE.md', { cache: 'no-cache' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  guideText = await r.text();
  return guideText;
}
function openGuideSheet() {
  openSheet('App design guide', async (b, seq) => {
    b.append(el('div', { class: 'hint' }, 'Loading…'));
    let text;
    try { text = await loadGuide(); }
    catch (e) { if (seq !== sheetSeq) return; b.innerHTML = ''; b.append(el('div', { class: 'hint' }, 'Could not load the guide (LIBRARY-APP-GUIDE.md is missing from this deployment).')); return; }
    if (seq !== sheetSeq) return;
    b.innerHTML = '';
    b.append(el('div', { class: 'hint' }, 'Paste this into an LLM before asking it for a single-file HTML app. It covers this phone\'s size and notch, blocking zoom, touch controls, icons, saving state, and the ⌂ button contract.'));
    const copy = el('button', { class: 'bigbtn' }, `Copy all (${Math.round(text.length / 1024)} KB)`);
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(text); copy.textContent = 'Copied ✓'; }
      catch (e) { copy.textContent = 'Copy blocked — use Share below'; }
      setTimeout(() => { copy.textContent = `Copy all (${Math.round(text.length / 1024)} KB)`; }, 2000);
    });
    b.append(copy);
    b.append(el('button', { class: 'bigbtn secondary', onclick: () => saveFile(new Blob([text], { type: 'text/markdown' }), 'LIBRARY-APP-GUIDE.md') }, 'Share / save as a file'));
    const box = el('div', { class: 'codebox', style: 'max-height:50vh;overflow:auto' });
    box.append(el('pre', { style: 'white-space:pre-wrap' }, text));
    b.append(box);
  });
}
const SNIPPET_BUTTON = `<button data-library-home hidden
  style="position:fixed;top:calc(env(safe-area-inset-top) + 8px);left:10px;z-index:9999;
         padding:6px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.2);
         background:rgba(0,0,0,.55);color:#fff;font:600 13px system-ui;">
  ⌂ Library
</button>`;
const SNIPPET_JS = `// true only when running inside the Library
if (window.__LIBRARY__) {
  __LIBRARY__.home();          // go back to the Library (app keeps running)
  __LIBRARY__.homeButton(false); // hide the Library's floating ⌂ (you provide your own)
  __LIBRARY__.setIcon(dataUrl);  // set this app's icon from inside the app
  __LIBRARY__.setName('Name');   // rename this app in the Library
}
// CSS hook: <html class="in-library"> is set when running inside the Library.
// Any element with data-library-home returns to the Library when tapped.`;
const SNIPPET_META = `<meta name="library-name" content="My App">
<meta name="library-icon" content="🚀">            <!-- emoji, or a data:image/... URL -->
<meta name="library-folder" content="Games">
<meta name="library-orientation" content="portrait">  <!-- or landscape -->
<meta name="library-home-button" content="off">   <!-- you supply your own button -->
<meta name="library-fill-bottom" content="off">   <!-- keep your own home-indicator padding -->`;

/* ============================================================
   Backup / restore / files
   ============================================================ */
async function saveFile(blob, filename) {
  try {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: filename }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.style.display = 'none';
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
}
async function backupAll() {
  toast('Building backup…');
  const files = await DB.all('files'), states = await DB.all('state');
  const fm = new Map(files.map((f) => [f.id, f.html])), sm = new Map(states.map((s) => [s.id, s.ls || {}]));
  const out = { format: 'html-library-backup', version: 1, exportedAt: new Date().toISOString(), settings: { sort: settings.sort, homeBtnPos: settings.homeBtnPos }, folders, apps: apps.map((a) => ({ ...a, html: fm.get(a.id) || '', localStorage: sm.get(a.id) || {} })) };
  const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
  await saveFile(blob, `library-backup-${new Date().toISOString().slice(0, 10)}.json`);
}
async function restoreBackup(text) {
  let data; try { data = JSON.parse(text); } catch (e) { toast('Not a valid backup file'); return; }
  if (!data || data.format !== 'html-library-backup' || !Array.isArray(data.apps)) { toast('Not a Library backup'); return; }
  const ok = await confirmDialog({ title: 'Restore backup?', text: `${data.apps.length} app(s) from ${fmtDate(Date.parse(data.exportedAt))}.\nApps with the same id are overwritten (including their saved data); others are added.`, ok: 'Restore' });
  if (!ok) return;
  if (RT.app) await quitApp();
  for (const f of data.folders || []) { if (!folderById(f.id)) { folders.push(f); } else Object.assign(folderById(f.id), f); await DB.put('folders', folderById(f.id)); }
  let n = 0, failed = 0;
  for (const a of data.apps) {
    try {
      const { html, localStorage: ls, ...meta } = a;
      if (typeof html !== 'string' || !meta.id || !meta.name) { failed++; continue; }
      meta.settings = meta.settings || { homeButton: true, safeArea: 'auto' };
      if (meta.settings.fillBottom === undefined) meta.settings.fillBottom = true;
      if (!meta.settings.orientation) meta.settings.orientation = 'auto'; meta.auto = meta.auto || parseAppMeta(html, meta.sourceName);
      meta.htmlBytes = byteLen(html);
      await DB.multi(['apps', 'files', 'state'], (s) => { s.apps.put(meta); s.files.put({ id: meta.id, html }); s.state.put({ id: meta.id, ls: ls || {}, updatedAt: Date.now() }); });
      const i = apps.findIndex((x) => x.id === meta.id); if (i >= 0) apps[i] = meta; else apps.push(meta);
      stateBytes.set(meta.id, byteLen(JSON.stringify(ls || {}))); n++;
    } catch (e) { console.error('restore failed for', a && a.name, e); failed++; }
  }
  if (data.settings && typeof data.settings === 'object') for (const [k, v] of Object.entries(data.settings)) if (k === 'sort' || k === 'homeBtnPos') await setSetting(k, v);
  render(); toast(`Restored ${n} app${n === 1 ? '' : 's'}${failed ? ` · ${failed} failed (storage full?)` : ''}`);
}
async function importAppData(app, text) {
  let data; try { data = JSON.parse(text); } catch (e) { toast('Not valid JSON'); return; }
  const ls = data && data.format === 'html-library-appdata' ? data.localStorage : (data && typeof data === 'object' ? data : null);
  if (!ls || typeof ls !== 'object') { toast('No saved data found in that file'); return; }
  if (RT.app && RT.app.id === app.id) await quitApp();
  const clean = Object.create(null); for (const [k, v] of Object.entries(ls)) clean[k] = (typeof v === 'string') ? v : JSON.stringify(v);
  await DB.put('state', { id: app.id, ls: clean, updatedAt: Date.now() }); stateBytes.set(app.id, byteLen(JSON.stringify(clean)));
  toast(`Imported ${Object.keys(clean).length} keys`); openAppSheet(app);
}
async function resetLibrary() {
  if (RT.app) await quitApp();
  for (const a of apps.slice()) await deleteApp(a);
  for (const s of ['apps', 'files', 'state', 'folders']) await DB.clear(s);
  apps = []; folders = []; stateBytes.clear(); view.folder = null; render();
}

/* ============================================================
   Runtime — the injected shim (runs INSIDE each app's iframe)
   ============================================================
   NOTE: this function is stringified and injected; it must be
   self-contained (no references to outer variables). */
function libraryShim(cfg) {
  'use strict';
  var w = window;
  if (w.__LIBRARY__) return;
  function post(msg) { try { msg.__lib = true; msg.app = cfg.appId; w.parent.postMessage(msg, '*'); } catch (e) { } }

  /* --- Storage-like object backed by an in-memory map --- */
  function makeStorage(initial, notify) {
    var data = Object.create(null), keys = [];
    if (initial) for (var k in initial) if (Object.prototype.hasOwnProperty.call(initial, k)) { data[k] = String(initial[k]); keys.push(k); }
    var api = {};
    function def(name, fn) { Object.defineProperty(api, name, { value: fn, writable: true, configurable: true, enumerable: false }); }
    def('getItem', function (k) { k = String(k); return (k in data) ? data[k] : null; });
    def('setItem', function (k, v) {
      if (arguments.length < 2) throw new TypeError("Failed to execute 'setItem' on 'Storage': 2 arguments required, but only " + arguments.length + " present.");
      k = String(k); v = String(v); if (!(k in data)) keys.push(k); data[k] = v; if (notify) notify('set', k, v);
    });
    def('removeItem', function (k) { k = String(k); if (k in data) { delete data[k]; var i = keys.indexOf(k); if (i > -1) keys.splice(i, 1); if (notify) notify('remove', k); } });
    def('clear', function () { data = Object.create(null); keys = []; if (notify) notify('clear'); });
    def('key', function (i) { i = Number(i) >>> 0; return i < keys.length ? keys[i] : null; });
    Object.defineProperty(api, 'length', { get: function () { return keys.length; }, configurable: true, enumerable: false });
    var proxy = new Proxy(api, {
      get: function (t, p) { if (typeof p === 'symbol' || p in t) return t[p]; return (p in data) ? data[p] : undefined; },
      set: function (t, p, v) { if (typeof p === 'symbol') { t[p] = v; return true; } if (p in t) return true; t.setItem(p, v); return true; },
      has: function (t, p) { return (p in t) || (typeof p === 'string' && (p in data)); },
      deleteProperty: function (t, p) { if (typeof p === 'string' && (p in data)) t.removeItem(p); return true; },
      ownKeys: function () { return keys.slice(); },
      getOwnPropertyDescriptor: function (t, p) { if (typeof p === 'string' && (p in data)) return { value: data[p], writable: true, enumerable: true, configurable: true }; return Object.getOwnPropertyDescriptor(t, p); }
    });
    return { proxy: proxy, api: api, snapshot: function () { var o = Object.create(null); for (var i = 0; i < keys.length; i++) o[keys[i]] = data[keys[i]]; return o; } };
  }
  function install(name, value) {
    try { Object.defineProperty(w, name, { get: function () { return value; }, set: function () { }, configurable: true, enumerable: true }); if (w[name] === value) return true; } catch (e) { }
    try {
      var proto = Object.getPrototypeOf(w);
      while (proto) { var d = Object.getOwnPropertyDescriptor(proto, name); if (d) { if (d.configurable) Object.defineProperty(proto, name, { get: function () { return value; }, set: function () { }, configurable: true }); break; } proto = Object.getPrototypeOf(proto); }
      if (w[name] === value) return true;
    } catch (e) { }
    return false;
  }
  // The snapshot baked into cfg.initial is from launch time; if the app reloads itself later, ask the parent
  // for the live state instead (same-origin, synchronous) so nothing stale gets resurrected.
  var initial = cfg.initial || {};
  try { var getInit = w.parent && w.parent.__libInitial; if (typeof getInit === 'function') { var live = getInit(cfg.appId); if (live && typeof live === 'object') initial = live; } } catch (e) { }
  var ls = makeStorage(initial, function (op, k, v) { post({ type: 'ls', op: op, key: k, value: v }); });
  var ss = makeStorage({}, null);
  var realLS = null; try { realLS = w.localStorage; } catch (e) { }
  var okLS = install('localStorage', ls.proxy);
  if (!okLS && realLS && w.Storage && w.Storage.prototype) {
    // Belt and braces: if the window property can't be replaced, route method calls on the real object to the shim.
    try {
      ['getItem', 'setItem', 'removeItem', 'clear', 'key'].forEach(function (m) {
        var orig = w.Storage.prototype[m];
        w.Storage.prototype[m] = function () { if (this === realLS) return ls.api[m].apply(ls.api, arguments); return orig.apply(this, arguments); };
      });
      var ld = Object.getOwnPropertyDescriptor(w.Storage.prototype, 'length');
      if (ld && ld.get) Object.defineProperty(w.Storage.prototype, 'length', { get: function () { return this === realLS ? ls.api.length : ld.get.call(this); }, configurable: true });
      okLS = 'methods';
    } catch (e) { }
  }
  if (!okLS) post({ type: 'shimFailed', what: 'localStorage' });
  install('sessionStorage', ss.proxy);

  /* --- indexedDB: prefix database names so apps can't collide --- */
  var P = 'lib.' + cfg.appId + '.';
  try {
    var realIDB = w.indexedDB;
    if (realIDB) {
      var pn = function (name) { name = String(name); return name.indexOf(P) === 0 ? name : P + name; }; // idempotent: apps may reuse db.name
      var idb = {
        open: function (name, v) { return arguments.length > 1 ? realIDB.open(pn(name), v) : realIDB.open(pn(name)); },
        deleteDatabase: function (name) { return realIDB.deleteDatabase(pn(name)); },
        cmp: function (a, b) { return realIDB.cmp(a, b); },
        databases: function () { return realIDB.databases ? realIDB.databases().then(function (l) { return l.filter(function (d) { return d.name && d.name.indexOf(P) === 0; }).map(function (d) { return { name: d.name.slice(P.length), version: d.version }; }); }) : Promise.reject(new Error('indexedDB.databases() unsupported')); }
      };
      install('indexedDB', idb);
    }
  } catch (e) { }
  /* --- caches: same idea --- */
  try {
    var realCaches = w.caches;
    if (realCaches) {
      var cs = {
        open: function (n) { return realCaches.open(P + n); },
        has: function (n) { return realCaches.has(P + n); },
        'delete': function (n) { return realCaches['delete'](P + n); },
        keys: function () { return realCaches.keys().then(function (ks) { return ks.filter(function (k) { return k.indexOf(P) === 0; }).map(function (k) { return k.slice(P.length); }); }); },
        match: function (req, opts) { if (opts && opts.cacheName) { return realCaches.open(P + opts.cacheName).then(function (c) { return c.match(req, opts); }); } return cs.keys().then(function (ks) { var i = 0; function next() { if (i >= ks.length) return undefined; return realCaches.open(P + ks[i++]).then(function (c) { return c.match(req, opts); }).then(function (r) { return r || next(); }); } return next(); }); }
      };
      install('caches', cs);
    }
  } catch (e) { }
  /* --- history.pushState/replaceState with a path throws inside a blob: document; retry without the URL --- */
  try {
    var HP = w.History && w.History.prototype;
    ['pushState', 'replaceState'].forEach(function (m) {
      var orig = HP && HP[m]; if (typeof orig !== 'function') return;
      HP[m] = function (state, title, url) {
        try { return url === undefined ? orig.call(this, state, title) : orig.call(this, state, title, url); }
        catch (e) { return orig.call(this, state, title); }
      };
    });
  } catch (e) { }
  /* --- service workers can't be scoped per app; make register() fail softly --- */
  try {
    if (w.navigator && w.navigator.serviceWorker) {
      var swc = w.navigator.serviceWorker;
      var fail = function () { return Promise.reject(new DOMException('Service workers are managed by the Library', 'SecurityError')); };
      try { Object.defineProperty(swc, 'register', { value: fail, configurable: true, writable: true }); } catch (e) { try { swc.register = fail; } catch (e2) { } }
    }
  } catch (e) { }

  /* --- Safe-area control ------------------------------------------------
     The Library decides which screen edges the APP is responsible for.
     Insets it takes over (or wants ignored, e.g. the bottom, so apps reach the
     screen edge) are neutralised by re-declaring every rule that mentions them
     with the inset replaced by 0px. Because a page's `--x: env(safe-area-inset-*)`
     custom properties are re-declared too, indirect uses (var(--sab), calc(...))
     collapse as well. Rules that don't mention the inset are untouched. */
  var SA = { kill: (cfg.killInsets || []).slice(), el: null };
  function insetRe() {
    if (!SA.kill.length) return null;
    return new RegExp('env\\(\\s*safe-area-inset-(?:' + SA.kill.join('|') + ')\\s*(?:,(?:[^()]|\\([^()]*\\))*)?\\)', 'gi');
  }
  function collectRules(rules, re, out) {
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i], txt;
      try { txt = r.cssText; } catch (e) { continue; }
      if (!txt || txt.toLowerCase().indexOf('safe-area-inset') < 0) continue;
      if (r.cssRules && r.cssRules.length) {          // @media / @supports / @layer …
        var inner = []; collectRules(r.cssRules, re, inner);
        if (inner.length) out.push(txt.slice(0, txt.indexOf('{') + 1) + inner.join('') + '}');
      } else if (r.selectorText) {
        re.lastIndex = 0;
        if (re.test(txt)) { re.lastIndex = 0; out.push(txt.replace(re, '0px')); }
      }
    }
  }
  function applySafeArea() {
    var re = insetRe();
    if (SA.el) { try { SA.el.remove(); } catch (e) { } SA.el = null; }
    if (!re || !document.documentElement) return;
    var out = [];
    var sheets = document.styleSheets;
    for (var i = 0; i < sheets.length; i++) {
      try { if (sheets[i].ownerNode && sheets[i].ownerNode.id === '__lib_sa') continue; collectRules(sheets[i].cssRules, re, out); } catch (e) { }
    }
    // inline style="" attributes that use the insets directly
    try {
      var inl = document.querySelectorAll('[style*="safe-area-inset"]');
      for (var k = 0; k < inl.length; k++) { re.lastIndex = 0; var t = inl[k].getAttribute('style'); if (t && re.test(t)) { re.lastIndex = 0; inl[k].setAttribute('style', t.replace(re, '0px')); } }
    } catch (e) { }
    if (!out.length) return;
    var st = document.createElement('style');
    st.id = '__lib_sa'; st.textContent = out.join('\n');
    document.documentElement.appendChild(st);   // last in the cascade → wins ties
    SA.el = st;
  }
  function scheduleSafeArea() { try { applySafeArea(); } catch (e) { } setTimeout(function () { try { applySafeArea(); } catch (e) { } }, 400); }

  /* --- public API for apps --- */
  var LIB = {
    inLibrary: true, appId: cfg.appId, name: cfg.name, version: cfg.version, storageShim: okLS,
    orientation: cfg.orientation || 'auto',
    home: function () { post({ type: 'home' }); },
    setIcon: function (src) { post({ type: 'setIcon', value: String(src) }); },
    setName: function (n) { post({ type: 'setName', value: String(n) }); },
    homeButton: function (show) { post({ type: 'homeButton', value: !!show }); },
    exportStorage: function () { return ls.snapshot(); }
  };
  /* Screen edges the Library owns (or wants full-bleed); these read as 0px inside the app.
     A getter so it stays correct when the setting is changed while the app is running. */
  try { Object.defineProperty(LIB, 'ignoredInsets', { get: function () { return SA.kill.slice(); }, enumerable: true, configurable: true }); } catch (e) { }
  try { Object.defineProperty(w, '__LIBRARY__', { value: Object.freeze(LIB), configurable: true, writable: false }); } catch (e) { w.__LIBRARY__ = LIB; }

  /* --- DOM hooks: html.in-library, [data-library-home] elements, emergency exit --- */
  try { document.documentElement.classList.add('in-library'); } catch (e) { } // synchronously, so CSS keyed on it doesn't flash
  var lastOwnHome = null, syncQueued = false;
  var revealed = (typeof WeakSet === 'function') ? new WeakSet() : null;
  function reveal(elm) {
    // Undo the snippet's initial `hidden` / display:none exactly once; after that the app controls visibility.
    if (revealed) { if (revealed.has(elm)) return; revealed.add(elm); }
    try { if (elm.hidden) elm.hidden = false; if (elm.style && elm.style.display === 'none') elm.style.display = ''; } catch (e) { }
  }
  function syncOwnHome() {
    // Tell the parent whether the app currently RENDERS its own home button, so the floating one can hide/return.
    syncQueued = false;
    var has = false;
    try { var list = document.querySelectorAll('[data-library-home]'); for (var i = 0; i < list.length; i++) { reveal(list[i]); if (!has && list[i].isConnected && list[i].getClientRects().length > 0) has = true; } } catch (e) { }
    if (has !== lastOwnHome) { lastOwnHome = has; post({ type: 'ownHome', value: has }); }
  }
  function queueSync() { if (syncQueued) return; syncQueued = true; (w.requestAnimationFrame || w.setTimeout)(syncOwnHome, 16); }
  function onReady() {
    try { document.documentElement.classList.add('in-library'); } catch (e) { }
    scheduleSafeArea();
    syncOwnHome();
    try { new MutationObserver(queueSync).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'style', 'class', 'data-library-home'] }); } catch (e) { }
    post({ type: 'ready', title: document.title });
  }
  document.addEventListener('click', function (e) { var t = e.target && e.target.closest ? e.target.closest('[data-library-home]') : null; if (t) { e.preventDefault(); post({ type: 'home' }); } }, true);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady); else onReady();
  // Emergency exit (only armed while the Library's floating button is hidden): hold two fingers STILL for 1.5s.
  var exitArmed = false, twoTimer = null, twoStart = null;
  function clearTwo() { clearTimeout(twoTimer); twoTimer = null; twoStart = null; }
  document.addEventListener('touchstart', function (e) {
    if (!exitArmed || !e.touches || e.touches.length !== 2) { clearTwo(); return; }
    twoStart = [[e.touches[0].clientX, e.touches[0].clientY], [e.touches[1].clientX, e.touches[1].clientY]];
    twoTimer = setTimeout(function () { clearTwo(); post({ type: 'home' }); }, 1500);
  }, { passive: true, capture: true });
  document.addEventListener('touchmove', function (e) {
    if (!twoTimer || !twoStart || !e.touches || e.touches.length !== 2) { clearTwo(); return; }
    for (var i = 0; i < 2; i++) { if (Math.abs(e.touches[i].clientX - twoStart[i][0]) > 12 || Math.abs(e.touches[i].clientY - twoStart[i][1]) > 12) { clearTwo(); return; } }
  }, { passive: true, capture: true });
  ['touchend', 'touchcancel'].forEach(function (n) { document.addEventListener(n, clearTwo, { passive: true, capture: true }); });
  w.addEventListener('error', function (e) { post({ type: 'error', message: String(e && e.message || e) }); });
  w.addEventListener('resize', function () { try { applySafeArea(); } catch (e) { } });
  w.addEventListener('load', scheduleSafeArea);

  /* --- Suspended by the Library? Pretend the page is hidden so autosave-on-hide code runs. --- */
  var libHidden = false;
  try {
    var hd = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden'), vd = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
    if (hd && hd.get && vd && vd.get) {
      Object.defineProperty(document, 'hidden', { get: function () { return libHidden || hd.get.call(document); }, configurable: true });
      Object.defineProperty(document, 'visibilityState', { get: function () { return libHidden ? 'hidden' : vd.get.call(document); }, configurable: true });
    }
  } catch (e) { }
  w.addEventListener('message', function (e) {
    var d = e.data; if (!d || d.__lib !== true || e.source !== w.parent) return;
    if (d.type === 'safeArea') { SA.kill = (d.kill || []).slice(); scheduleSafeArea(); return; }
    if (d.type === 'visibility') {
      var next = !!d.hidden; if (next === libHidden) return; libHidden = next;
      try { document.dispatchEvent(new Event('visibilitychange', { bubbles: true })); } catch (e2) { }
    } else if (d.type === 'exitGesture') { exitArmed = !!d.on; }
  });
}

/* ============================================================
   Runtime — parent side
   ============================================================ */
const RT = { app: null, iframe: null, url: null, state: null, dirty: false, timer: null, suspended: false, ownHome: false, hideBtn: false, navigated: false, rotated: false, scrollY: 0, loadTimer: null };
const nullObj = (src) => Object.assign(Object.create(null), src || {});
window.__libInitial = (id) => (RT.app && RT.app.id === id && RT.state) ? nullObj(RT.state) : null;
function buildRunnableHtml(html, cfg) {
  const json = JSON.stringify(cfg).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const script = '<script>(' + libraryShim.toString() + ')(' + json + ');<' + '/script>';
  // Prefer right after <head ...>; if there's no real <head> before <body>, put it right after the doctype /
  // leading comments (the parser then creates the implicit <html><head> around it, ahead of any app script).
  const headM = html.match(/<head(?=[\s>\/])[^>]*>/i);
  const bodyIdx = html.search(/<body(?=[\s>\/])/i);
  if (headM && (bodyIdx < 0 || headM.index < bodyIdx)) return html.slice(0, headM.index + headM[0].length) + script + html.slice(headM.index + headM[0].length);
  const lead = html.match(/^(?:\s|<!--[\s\S]*?-->|<\?[^>]*>)*(?:<!doctype[^>]*>)?/i);
  const at = lead ? lead[0].length : 0;
  return html.slice(0, at) + script + html.slice(at);
}
function effectiveSafeArea(app) { const s = app.settings && app.settings.safeArea; return s && s !== 'auto' ? s : ((app.auto && app.auto.safeArea) || 'pad'); }
/* Which safe-area insets the APP should ignore because the Library owns that edge
   (or because we want it full-bleed). See the shim's applySafeArea(). */
function killInsets(app) {
  if (RT.rotated) return ['top', 'bottom', 'left', 'right']; // rotated: device insets don't line up with the app's edges
  const k = [];
  if (effectiveSafeArea(app) === 'pad') k.push('top', 'left', 'right');
  if (!app.settings || app.settings.fillBottom !== false) k.push('bottom');
  return k;
}
/* The stage is sized from innerWidth/innerHeight rather than inset:0 so it always
   covers the whole screen, whatever iOS does with fixed positioning. */
function sizeStage() {
  const r = document.documentElement.style;
  r.setProperty('--vpw', window.innerWidth + 'px');
  r.setProperty('--vph', window.innerHeight + 'px');
}
function deviceAngle() {
  try { if (screen.orientation && typeof screen.orientation.angle === 'number') return ((screen.orientation.angle % 360) + 360) % 360; } catch (e) { }
  return typeof window.orientation === 'number' ? ((window.orientation % 360) + 360) % 360 : 0;
}
/* iOS can't lock a web app's orientation, so when the device doesn't match we rotate
   the app ourselves — the same result the OS lock would give; the app just sees a
   portrait (or landscape) viewport. Native lock is attempted first where it exists. */
function applyOrientation(app) {
  const wrap = $('#frameWrap'), stage = $('#stage');
  const want = (app && app.settings && app.settings.orientation) || 'auto';
  const W = window.innerWidth, H = window.innerHeight, isPortrait = H >= W;
  const wantPortrait = want === 'portrait' ? true : want === 'landscape' ? false : isPortrait;
  const rot = wantPortrait !== isPortrait;
  RT.rotated = rot;
  stage.classList.toggle('rot', rot);
  if (!rot) { wrap.style.cssText = ''; return; }
  const deg = [90, 180].includes(deviceAngle()) ? -90 : 90;
  wrap.style.cssText = 'position:absolute;left:' + (W - H) / 2 + 'px;top:' + (H - W) / 2 + 'px;width:' + H + 'px;height:' + W + 'px;transform:rotate(' + deg + 'deg);transform-origin:center center;';
}
function tryNativeLock(want) {
  try {
    if (!screen.orientation) return;
    if (want && want !== 'auto' && screen.orientation.lock) { const p = screen.orientation.lock(want); if (p && p.catch) p.catch(() => { }); }
    else if (screen.orientation.unlock) screen.orientation.unlock();
  } catch (e) { }
}
function isLightColor(c) {
  try { const ctx = document.createElement('canvas').getContext('2d'); ctx.fillStyle = '#000'; ctx.fillStyle = c; const m = /^#([0-9a-f]{6})$/i.exec(ctx.fillStyle); if (!m) return false; const n = parseInt(m[1], 16); return (0.2126 * (n >> 16 & 255) + 0.7152 * (n >> 8 & 255) + 0.0722 * (n & 255)) / 255 > 0.45; } catch (e) { return false; }
}
function applyStageMode(app) {
  const stage = $('#stage');
  const pad = effectiveSafeArea(app) === 'pad' && !RT.rotated;
  stage.classList.toggle('pad', pad);
  tellApp({ type: 'safeArea', kill: killInsets(app) });
  // The status bar glyphs are always white (black-translucent), so only paint the padding with dark theme colors.
  stage.style.background = pad && app.themeColor && !isLightColor(app.themeColor) ? app.themeColor : '#000';
}
let launching = null;
function launchApp(id) {
  if (launching) return launching; // ignore double taps / launches while another is in flight
  launching = (async () => {
    const app = appById(id); if (!app) return;
    if (quitting) await quitting;
    if (RT.app && RT.app.id === id) { resumeApp(); return; }
    if (RT.app) await quitApp();
    const file = await DB.get('files', id).catch(() => null);
    if (!file) { toast('The HTML for this app is missing'); return; }
    const st = await DB.get('state', id).catch(() => null);
    if (RT.app) return; // something else started meanwhile
    await startApp(app, file, st);
  })().finally(() => { launching = null; });
  return launching;
}
async function startApp(app, file, st) {
  RT.app = app; RT.state = nullObj(st && st.ls); RT.dirty = false; RT.suspended = false; RT.ownHome = false; RT.hideBtn = false; RT.navigated = false;
  app.lastOpened = Date.now(); saveApp(app);
  setSetting('running', app.id); // so a background process kill → reload can offer to reopen it
  // stage
  const li = $('#loadingIcon'); li.innerHTML = ''; li.append(iconNode(app)); $('#loadingName').textContent = app.name;
  $('#loading').classList.remove('off');
  sizeStage();
  tryNativeLock(app.settings.orientation);
  applyOrientation(app);
  applyStageMode(app);
  showStage();
  const cfg = { appId: app.id, name: app.name, version: APP_VERSION, initial: RT.state, killInsets: killInsets(app), orientation: app.settings.orientation || 'auto' };
  const html = buildRunnableHtml(file.html, cfg);
  RT.url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const f = document.createElement('iframe');
  f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads');
  f.setAttribute('allow', 'autoplay; fullscreen; clipboard-read; clipboard-write; web-share; accelerometer; gyroscope; camera; microphone; geolocation');
  f.setAttribute('allowfullscreen', '');
  f.title = app.name;
  f.addEventListener('load', () => {
    // If the document inside no longer carries our shim, the app navigated somewhere
    // else (external link etc.) — force the ⌂ button back on so the user isn't stranded.
    let navigated = false;
    try { const cw = f.contentWindow; navigated = !!(cw && cw.location && cw.location.href !== 'about:blank' && !cw.__LIBRARY__); } catch (e) { navigated = true; }
    // Either way this is a fresh document: reset per-document flags (a shim'd doc re-posts ownHome/homeButton itself).
    RT.navigated = navigated; RT.ownHome = false; RT.hideBtn = false; updateHomeBtn();
    hideLoading();
  });
  RT.iframe = f;
  f.src = RT.url;
  $('#frameWrap').append(f);
  clearTimeout(RT.loadTimer); RT.loadTimer = setTimeout(hideLoading, 5000);
  updateHomeBtn(); positionHomeBtn();
  render();
}
function hideLoading() { $('#loading').classList.add('off'); }
function showStage() {
  closeSheet(); // first: unlocks page scroll so we capture the real position
  RT.scrollY = window.scrollY;
  document.body.classList.add('stage-open');
  $('#stage').classList.add('on');
}
function hideStage() {
  const wasOpen = document.body.classList.contains('stage-open');
  $('#stage').classList.remove('on');
  document.body.classList.remove('stage-open');
  if (wasOpen) window.scrollTo(0, RT.scrollY || 0);
}
function tellApp(msg) { try { if (RT.iframe && RT.iframe.contentWindow) RT.iframe.contentWindow.postMessage({ __lib: true, ...msg }, '*'); } catch (e) { } }
function suspendApp() {
  if (!RT.app || RT.suspended) return;
  RT.suspended = true; hideStage(); updateHomeBtn(); tellApp({ type: 'visibility', hidden: true }); render();
  setTimeout(flushState, 150); // let the app's visibilitychange handlers save first
}
function resumeApp() {
  if (!RT.app || !RT.suspended || quitting) return;
  RT.suspended = false; sizeStage(); applyOrientation(RT.app); applyStageMode(RT.app); showStage(); positionHomeBtn(); updateHomeBtn(); tellApp({ type: 'visibility', hidden: false }); render();
}
let quitting = null;
function quitApp() {
  if (quitting) return quitting;
  if (!RT.app) return Promise.resolve();
  quitting = (async () => {
    // 1) tell the app it's going away so save-on-hide code runs, 2) unload it (fires pagehide/unload
    // synchronously), 3) read the shim's storage snapshot directly — catches saves made during unload
    // that would otherwise arrive as postMessages after we stopped listening.
    tellApp({ type: 'visibility', hidden: true });
    await new Promise((r) => setTimeout(r, 120));
    let lib = null;
    try { lib = RT.iframe && RT.iframe.contentWindow && RT.iframe.contentWindow.__LIBRARY__; } catch (e) { }
    try { if (RT.iframe) RT.iframe.remove(); } catch (e) { }
    try { const snap = lib && lib.exportStorage(); if (snap && typeof snap === 'object') { RT.state = nullObj(snap); RT.dirty = true; } } catch (e) { }
    await flushState();
    try { if (RT.url) URL.revokeObjectURL(RT.url); } catch (e) { }
    clearTimeout(RT.timer); clearTimeout(RT.loadTimer);
    RT.app = null; RT.iframe = null; RT.url = null; RT.state = null; RT.dirty = false; RT.suspended = false; RT.timer = null;
    RT.rotated = false; $('#stage').classList.remove('rot'); $('#frameWrap').style.cssText = ''; tryNativeLock('auto');
    setSetting('running', null);
    hideStage(); updateHomeBtn(); render();
  })().finally(() => { quitting = null; });
  return quitting;
}
function scheduleFlush() {
  RT.dirty = true;
  // While the PWA is backgrounded iOS may freeze/kill us any moment — write immediately instead of coalescing.
  if (document.visibilityState === 'hidden') { clearTimeout(RT.timer); RT.timer = null; flushState(); return; }
  if (RT.timer) return;
  RT.timer = setTimeout(() => { RT.timer = null; flushState(); }, 400);
}
let flushChain = Promise.resolve();
function flushState() {
  if (!RT.app || !RT.dirty) return flushChain;
  RT.dirty = false;
  const id = RT.app.id, snap = { id, ls: { ...RT.state }, updatedAt: Date.now() };
  stateBytes.set(id, byteLen(JSON.stringify(snap.ls)));
  flushChain = flushChain.then(() => DB.put('state', snap)).catch((e) => { console.error('state write failed', e); toast('Could not save app data (storage full?)'); });
  return flushChain;
}
window.addEventListener('message', (e) => {
  const d = e.data; if (!d || d.__lib !== true) return;
  if (!RT.iframe || e.source !== RT.iframe.contentWindow) return;
  const app = RT.app; if (!app) return;
  switch (d.type) {
    case 'ls':
      if (d.op === 'set') RT.state[String(d.key)] = String(d.value);
      else if (d.op === 'remove') delete RT.state[String(d.key)];
      else if (d.op === 'clear') RT.state = Object.create(null);
      scheduleFlush(); break;
    case 'home': suspendApp(); break;
    case 'ready': hideLoading(); updateHomeBtn(); break; // re-sends exitGesture arming now that the shim is listening
    case 'ownHome': RT.ownHome = d.value !== false; updateHomeBtn(); break;
    case 'shimFailed': console.warn(`[${app.name}] storage shim could not be installed — this app is using the shared browser storage`); toast(`${app.name}: storage isolation unavailable in this browser`); break;
    case 'homeButton': RT.hideBtn = !d.value; updateHomeBtn(); break;
    case 'setName': if (d.value && d.value.trim()) { app.name = d.value.trim().slice(0, 60); saveApp(app); render(); } break;
    case 'setIcon': if (typeof d.value === 'string' && /^data:image\//i.test(d.value)) normalizeIconDataUrl(d.value).then((src) => { if (src) { app.icon = { type: 'img', src, from: 'app' }; saveApp(app); render(); } }); break;
    case 'error': console.warn(`[${app.name}]`, d.message); break;
  }
});
window.addEventListener('pagehide', () => { flushState(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushState(); });

/* ---------- Floating home button (owned by the Library, sits above the iframe) ---------- */
const homeBtn = $('#homeBtn');
let dimTimer = null;
function updateHomeBtn() {
  const show = !!(RT.app && !RT.suspended && RT.app.settings.homeButton !== false && !RT.ownHome && !RT.hideBtn) || !!(RT.app && !RT.suspended && RT.navigated);
  homeBtn.classList.toggle('on', show);
  if (show) { positionHomeBtn(); armDim(); }
  tellApp({ type: 'exitGesture', on: !show }); // two-finger hold is only needed when there's no ⌂ to tap
}
function armDim() { homeBtn.classList.remove('dim'); clearTimeout(dimTimer); dimTimer = setTimeout(() => homeBtn.classList.add('dim'), 2500); }
function positionHomeBtn() {
  const pos = (RT.app && RT.app.settings.homeBtnPos) || settings.homeBtnPos || { side: 'right', y: 0.6 };
  const W = window.innerWidth, H = window.innerHeight, S = 40, m = 6;
  const sat = safeInset('top'), sab = safeInset('bottom');
  const y = Math.min(H - sab - S - m, Math.max(sat + m, pos.y * H));
  homeBtn.style.top = y + 'px';
  homeBtn.style.left = pos.side === 'left' ? (safeInset('left') + m) + 'px' : (W - safeInset('right') - S - m) + 'px';
}
function safeInset(side) {
  const probe = document.createElement('div'); probe.style.cssText = `position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;padding-${side}:env(safe-area-inset-${side})`;
  document.body.appendChild(probe); const v = parseFloat(getComputedStyle(probe)['padding' + side[0].toUpperCase() + side.slice(1)]) || 0; probe.remove(); return v;
}
(function setupHomeBtnDrag() {
  let dragging = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0, pid = null;
  homeBtn.addEventListener('pointerdown', (e) => {
    if (e.isPrimary === false) return;
    dragging = true; moved = false; sx = e.clientX; sy = e.clientY; ox = homeBtn.offsetLeft; oy = homeBtn.offsetTop; pid = e.pointerId;
    homeBtn.setPointerCapture(pid); homeBtn.classList.add('drag'); armDim(); e.preventDefault();
  });
  homeBtn.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!moved && Math.hypot(dx, dy) < 6) return;
    moved = true; homeBtn.style.left = (ox + dx) + 'px'; homeBtn.style.top = (oy + dy) + 'px';
  });
  const end = async (e) => {
    if (!dragging) return; dragging = false; homeBtn.classList.remove('drag');
    try { homeBtn.releasePointerCapture(pid); } catch (_) { }
    if (!moved) { suspendApp(); return; }
    const W = window.innerWidth, H = window.innerHeight;
    const cx = homeBtn.offsetLeft + 20;
    const pos = { side: cx < W / 2 ? 'left' : 'right', y: Math.min(0.95, Math.max(0.02, homeBtn.offsetTop / H)) };
    if (RT.app) { RT.app.settings.homeBtnPos = pos; saveApp(RT.app); }
    setSetting('homeBtnPos', pos);
    positionHomeBtn();
  };
  homeBtn.addEventListener('pointerup', end);
  homeBtn.addEventListener('pointercancel', () => { if (!dragging) return; dragging = false; homeBtn.classList.remove('drag'); try { homeBtn.releasePointerCapture(pid); } catch (_) { } positionHomeBtn(); });
  homeBtn.addEventListener('contextmenu', (e) => e.preventDefault());
})();
function onViewportChange() {
  sizeStage();
  if (!RT.app) return;
  applyOrientation(RT.app); applyStageMode(RT.app); positionHomeBtn();
}
window.addEventListener('resize', onViewportChange);
window.addEventListener('orientationchange', () => setTimeout(onViewportChange, 60));
sizeStage();
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && RT.app && !RT.suspended) suspendApp(); });

/* ============================================================
   Service worker
   ============================================================ */
const SW = { reg: null, updateShown: false, reloadRequested: false, lastCheck: 0 };
async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
    SW.reg = reg;
    const offer = SW.offer = (worker) => {
      if (!worker || SW.updateShown) return; SW.updateShown = true;
      toast('Update available', { action: { label: 'Reload', fn: async () => { if (RT.app) await quitApp(); SW.reloadRequested = true; worker.postMessage({ type: 'SKIP_WAITING' }); setTimeout(() => location.reload(), 1500); } }, duration: 15000 });
      setTimeout(() => { SW.updateShown = false; }, 16000); // allow re-offering (Check for updates / next foreground)
    };
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => { const nw = reg.installing; if (!nw) return; nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) offer(nw); }); });
    // Only reload when the user asked for the update — a first install also fires controllerchange (clients.claim()).
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (SW.reloadRequested) { SW.reloadRequested = false; location.reload(); } });
    // Home-screen apps are resumed far more often than navigated, so re-check on foreground (at most every 15 min).
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - SW.lastCheck > 15 * 60 * 1000) { SW.lastCheck = Date.now(); reg.update().catch(() => { }); } });
    SW.lastCheck = Date.now();
  } catch (e) { console.warn('Service worker registration failed', e); }
}

/* ============================================================
   Wiring & init
   ============================================================ */
let iconTarget = null, jsonTarget = null, replaceTarget = null;
$('#addBtn').addEventListener('click', openImportSheet);
$('#settingsBtn').addEventListener('click', openSettingsSheet);
$('#storagePill').addEventListener('click', openStorageSheet);
$('#editBtn').addEventListener('click', () => { editMode = !editMode; render(); if (editMode) toast('Tap an app to edit it. Tap ✎ again when done.'); });
$('#sheetClose').addEventListener('click', closeSheet);
$('#scrim').addEventListener('click', closeSheet);
$('#search').addEventListener('input', render);
$('#search').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
// Lift bottom sheets above the iOS keyboard (the layout viewport doesn't shrink; the visual one does).
if (window.visualViewport) {
  const vv = window.visualViewport;
  const upd = () => document.documentElement.style.setProperty('--kb', Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) + 'px');
  vv.addEventListener('resize', upd); vv.addEventListener('scroll', upd); upd();
}
$('#resumeBtn').addEventListener('click', () => { if (RT.app) resumeApp(); else if (reopenApp) { const a = reopenApp; reopenApp = null; launchApp(a.id); } });
$('#quitBtn').addEventListener('click', () => { if (RT.app) quitApp(); else { reopenApp = null; setSetting('running', null); render(); } });
$('#newFolderBtn').addEventListener('click', async () => { const nm = await promptDialog({ title: 'New folder', placeholder: 'Folder name', ok: 'Create' }); if (nm) { await ensureFolder(nm); render(); } });
$$('#sortRow [data-sort]').forEach((b) => b.addEventListener('click', () => { setSetting('sort', b.dataset.sort); render(); }));
$('#installBannerX').addEventListener('click', () => { setSetting('installBannerDismissed', true); $('#installBanner').classList.add('hidden'); });
$('#fileInput').addEventListener('change', async (e) => { const files = [...e.target.files]; e.target.value = ''; if (!files.length) return; closeSheet(); await importFiles(files); });
$('#replaceInput').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f || !replaceTarget) return;
  const app = replaceTarget; replaceTarget = null;
  const text = await f.text(); if (!looksLikeHtml(text)) { toast('That doesn\'t look like an HTML file'); return; }
  if (RT.app && RT.app.id === app.id) await quitApp();
  await replaceAppHtml(app, text, f.name); render(); toast(`Updated ${app.name}`); openAppSheet(app);
});
$('#iconInput').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f || !iconTarget) return;
  const app = iconTarget; iconTarget = null;
  try { const src = await normalizeIconDataUrl(await fileToDataUrl(f), 256, true); if (!src) throw new Error('bad'); app.icon = { type: 'img', src, from: 'upload' }; await saveApp(app); render(); openAppSheet(app); }
  catch (err) { toast('Could not use that image'); }
});
$('#jsonInput').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f || !jsonTarget) return;
  const t = jsonTarget; jsonTarget = null;
  const text = await f.text();
  if (t.kind === 'backup') await restoreBackup(text); else if (t.kind === 'appdata') await importAppData(t.app, text);
});
// Drag & drop (desktop convenience)
window.addEventListener('dragover', (e) => { e.preventDefault(); });
window.addEventListener('drop', async (e) => { e.preventDefault(); const files = [...(e.dataTransfer && e.dataTransfer.files || [])].filter((f) => /\.(html?|txt)$/i.test(f.name) || f.type === 'text/html'); if (files.length) await importFiles(files); });

async function init() {
  registerSW();
  try {
    const [a, f, s, st] = await Promise.all([DB.all('apps'), DB.all('folders'), DB.all('settings'), DB.all('state')]);
    apps = a || []; folders = f || []; settings = Object.fromEntries((s || []).map((x) => [x.key, x.value]));
    for (const x of st || []) stateBytes.set(x.id, byteLen(JSON.stringify(x.ls || {})));
    for (const app of apps) {
      app.settings = app.settings || { homeButton: true, safeArea: 'auto' };
      if (app.settings.fillBottom === undefined) app.settings.fillBottom = true;
      if (!app.settings.orientation) app.settings.orientation = 'auto';
      app.auto = app.auto || { safeArea: 'pad', homeButton: true };
    }
  } catch (e) {
    console.error(e);
    $('#home').prepend(el('div', { class: 'banner' }, el('div', null, '⚠️'), el('div', null, el('b', null, 'Storage unavailable'), el('br'), 'This browser blocked IndexedDB (private browsing?). The Library needs it to keep your apps.')));
  }
  if (IS_IOS && !IS_STANDALONE && !settings.installBannerDismissed) $('#installBanner').classList.remove('hidden');
  if (settings.running && appById(settings.running)) reopenApp = appById(settings.running);
  render();
  // Cheap belt-and-braces: on iOS this is granted only for installed Home Screen apps; re-asking each launch just refreshes the marker.
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => false);
}
init();

// Expose a little for debugging / tests
window.Library = { importHtmlText, importFiles, launchApp, suspendApp, resumeApp, quitApp, apps: () => apps, folders: () => folders, DB, RT, render, parseAppMeta, buildRunnableHtml, backupAll, applyStageMode, applyOrientation, killInsets, sizeStage, saveApp };
