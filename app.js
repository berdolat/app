/* Recipe Box — a local-only recipe PWA. Plain JS, no build step.
 *
 * Sections:
 *   1. Helpers            5. Grid + pinch zoom      9. Backup (export / import)
 *   2. IndexedDB layer    6. Recipe viewer          10. Dialog + toast
 *   3. Images             7. Editor                 11. Startup
 *   4. State              8. Clipboard
 */
'use strict';

/* ============================== 1. Helpers ============================== */

const $ = (sel, root = document) => root.querySelector(sel);
const PALETTE_SIZE = 8;               // number of colour pairs in styles.css
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const reducedMotionQuery = matchMedia('(prefers-reduced-motion: reduce)');
const reducedMotion = () => reducedMotionQuery.matches;
const duration = (ms = 280) => (reducedMotion() ? 1 : ms);

/** Errors whose message is safe and friendly to show to the user as-is. */
class UserError extends Error {}

/** Tiny DOM builder: h('p', {class: 'x', text: 'hi'}, child, …) */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children) if (child != null) el.append(child);
  return el;
}

const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M7 7l10 10M17 7L7 17"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
};
function icon(name, size = 22, stroke = 2) {
  const span = h('span', { class: 'icon', 'aria-hidden': 'true' });
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return span;
}

function uid() {
  return crypto.randomUUID ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** First paragraph = short description (shown on cards); the rest = method. */
function splitDescription(text = '') {
  const parts = text.trim().split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return { summary: parts[0] || '', method: parts.slice(1) };
}

/** One ingredient per line; strips bullets people paste in ("- ", "• ", "* "). */
function parseIngredients(text) {
  return text.split('\n')
    .map((line) => line.replace(/^\s*[-•*·▪–]\s+/, '').trim())
    .filter(Boolean);
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(hash);
}
function colorIndex(recipe) {
  return Number.isInteger(recipe.color) ? recipe.color % PALETTE_SIZE : hashString(recipe.id) % PALETTE_SIZE;
}
const colorClass = (recipe) => `c${colorIndex(recipe) + 1}`;

function storageErrorMessage(err, action = 'save') {
  const name = err && err.name;
  if (name === 'QuotaExceededError' || /quota|space/i.test((err && err.message) || '')) {
    return 'Not enough storage space for this. Remove some photos or recipes, or free up space on your phone, and try again.';
  }
  if (err instanceof UserError) return err.message;
  return `Couldn't ${action}: ${(err && (err.message || err.name)) || 'unknown error'}.`;
}

/* ========================== 2. IndexedDB layer ========================== */

const DB_NAME = 'recipe-box';
const DB_VERSION = 1;
const STORE = 'recipes';
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new UserError('This browser can’t store recipes (IndexedDB is unavailable). Private Browsing may be on.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      db.onclose = () => { dbPromise = null; };   // iOS can drop the connection in the background
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new UserError('Storage is busy in another tab. Close other copies of the app and retry.'));
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

/** Runs fn(store) inside a transaction; resolves with the returned request's result when committed. */
function runTx(mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    let tx;
    try { tx = db.transaction(STORE, mode); } catch (err) { reject(err); return; }
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new DOMException('Transaction aborted', 'AbortError'));
  }));
}

/** Retries once with a fresh connection: iOS Safari sometimes loses the IDB connection after backgrounding. */
async function tx(mode, fn) {
  try {
    return await runTx(mode, fn);
  } catch (err) {
    if (err && (err.name === 'InvalidStateError' || err.name === 'UnknownError')) {
      dbPromise = null;
      return runTx(mode, fn);
    }
    throw err;
  }
}

const db = {
  all: () => tx('readonly', (s) => s.getAll()),
  put: (recipe) => tx('readwrite', (s) => s.put(recipe)),
  delete: (id) => tx('readwrite', (s) => s.delete(id)),
  /** Writes many recipes in one atomic transaction, optionally clearing the store first. */
  bulkPut: (recipes, { replace = false } = {}) => tx('readwrite', (s) => {
    if (replace) s.clear();
    recipes.forEach((r) => s.put(r));
  }),
};

/* ============================== 3. Images =============================== */

const MAX_EDGE = 1200;
const JPEG_QUALITY = 0.8;

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new UserError(`“${blob.name || 'This file'}” isn’t an image this device can read.`)); };
    img.src = url;
  });
}

/** Resizes to MAX_EDGE on the long side and re-encodes as JPEG. Returns a Blob. */
async function compressImage(file) {
  const looksLikeImage = (file.type && file.type.startsWith('image/')) || /\.(jpe?g|png|gif|webp|heic|heif|avif)$/i.test(file.name || '');
  if (!looksLikeImage) throw new UserError(`“${file.name}” isn’t an image.`);

  const img = await loadImage(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';                 // transparent PNGs get a white background in JPEG
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height); // browsers apply EXIF orientation automatically

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  canvas.width = canvas.height = 0;       // free canvas memory right away (iOS is strict)
  if (!blob) throw new UserError('Couldn’t process that photo. Try a different one.');
  return blob;
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function dataURLToBlob(dataURL) {
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataURL || '');
  if (!match) return null;
  const type = match[1] || 'image/jpeg';
  if (!match[2]) return new Blob([decodeURIComponent(match[3])], { type });
  const binary = atob(match[3]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

/* =============================== 4. State =============================== */

const ZOOM_KEY = 'recipe-box:zoom';
// Each zoom level is a minimum column width; the column count follows from the screen width.
const ZOOM_MIN_WIDTHS = [340, 160, 110, 84, 64];
const CARD_MODE_MIN_WIDTH = 150;   // narrower columns show photo-only tiles

const state = {
  recipes: [],          // sorted by createdAt (grid order)
  zoom: readZoom(),
  viewer: { open: false, index: 0, slots: [], busy: false },
  editor: null,
};

function readZoom() {
  try {
    const z = Number(localStorage.getItem(ZOOM_KEY));
    return Number.isInteger(z) && z >= 0 && z < ZOOM_MIN_WIDTHS.length && localStorage.getItem(ZOOM_KEY) !== null ? z : 1;
  } catch { return 1; }
}
function saveZoom() {
  try { localStorage.setItem(ZOOM_KEY, String(state.zoom)); } catch { /* not important */ }
}

function normalizeRecipe(r) {
  return {
    ...r,
    title: r.title || 'Untitled',
    description: r.description || '',
    ingredients: Array.isArray(r.ingredients) ? r.ingredients : [],
    photos: Array.isArray(r.photos) ? r.photos.filter((p) => p instanceof Blob) : [],
  };
}

async function loadRecipes() {
  const all = await db.all();
  state.recipes = all.map(normalizeRecipe).sort((a, b) => a.createdAt - b.createdAt);
}

/* Object URLs for photo Blobs, cached per recipe and released when the photos change. */
const urlCache = new Map();
function photoURL(recipe, i) {
  let entry = urlCache.get(recipe.id);
  if (!entry || entry.photos !== recipe.photos) {
    if (entry) entry.urls.forEach((u) => u && URL.revokeObjectURL(u));
    entry = { photos: recipe.photos, urls: [] };
    urlCache.set(recipe.id, entry);
  }
  if (!entry.urls[i]) entry.urls[i] = URL.createObjectURL(recipe.photos[i]);
  return entry.urls[i];
}
function releaseURLs(id) {
  const entry = urlCache.get(id);
  if (entry) entry.urls.forEach((u) => u && URL.revokeObjectURL(u));
  urlCache.delete(id);
}

/* ========================= 5. Grid + pinch zoom ========================= */

const els = {
  scroller: $('#grid-scroll'),
  grid: $('#grid'),
  empty: $('#empty'),
  count: $('#count'),
  viewer: $('#viewer'),
  bar: $('#viewer-bar'),
  pager: $('#pager'),
  copyBtn: $('#copy-btn'),
  editBtn: $('#edit-btn'),
  editor: $('#editor'),
  form: $('#editor-form'),
  editorTitle: $('#editor-title'),
  saveBtn: $('#save-btn'),
  deleteBtn: $('#delete-btn'),
  strip: $('#photo-strip'),
  photoHint: $('#photo-hint'),
  titleError: $('#title-error'),
  swatches: $('#swatches'),
  photoInput: $('#photo-input'),
  importInput: $('#import-input'),
  dialog: $('#dialog'),
  toast: $('#toast'),
  themeMeta: $('meta[name="theme-color"]'),
};

function photoBox(recipe, className) {
  const box = h('div', { class: `${className} squircle` });
  if (recipe.photos.length) {
    box.append(h('img', { src: photoURL(recipe, 0), alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' }));
  } else {
    box.append(h('span', { class: 'initial', text: (recipe.title.trim()[0] || '?').toUpperCase() }));
  }
  return box;
}

function recipeCard(recipe, index) {
  const { summary } = splitDescription(recipe.description);
  const n = recipe.ingredients.length;
  return h('button', { class: `card ${colorClass(recipe)}`, type: 'button', 'data-index': index, 'aria-label': recipe.title },
    h('div', { class: 'card-inner' },
      h('div', { class: 'card-text' },
        h('h2', { class: 'card-title', text: recipe.title }),
        n ? h('p', { class: 'card-sub', text: `${plural(n, 'ingredient')} —` }) : null,
        summary ? h('p', { class: 'card-summary', text: summary }) : null),
      photoBox(recipe, 'card-photo')));
}

function plusCard() {
  const photo = h('div', { class: 'card-photo squircle is-plus' }, icon('plus', 40, 1.8));
  return h('button', { class: 'card plus', type: 'button', 'data-plus': '', 'aria-label': 'Add a recipe' },
    h('div', { class: 'card-inner' },
      h('div', { class: 'card-text' },
        h('h2', { class: 'card-title', text: 'New recipe' }),
        h('p', { class: 'card-summary', text: 'Add a photo, ingredients and method.' })),
      photo));
}

function renderGrid() {
  const frag = document.createDocumentFragment();
  state.recipes.forEach((r, i) => frag.append(recipeCard(r, i)));
  frag.append(plusCard());
  els.grid.replaceChildren(frag);

  const n = state.recipes.length;
  els.empty.hidden = n > 0;
  els.count.textContent = n ? plural(n, 'recipe') : '';
}

function cssNumber(name, fallback) {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(v) ? v : fallback;
}

/** Sets the column count and card/photo-only mode for the current zoom level. */
function applyZoom() {
  const width = els.grid.clientWidth - parseFloat(getComputedStyle(els.grid).paddingLeft) - parseFloat(getComputedStyle(els.grid).paddingRight);
  const gap = cssNumber('--gap-card', 10);
  const min = ZOOM_MIN_WIDTHS[state.zoom];
  const cols = Math.max(1, Math.floor((width + gap) / (min + gap)));
  const colWidth = (width - (cols - 1) * gap) / cols;
  els.grid.style.setProperty('--cols', cols);
  els.grid.classList.toggle('compact', colWidth < CARD_MODE_MIN_WIDTH);
}

/** Changes zoom level and animates cards from old to new positions (FLIP),
 *  keeping the card under `anchor` (finger / pointer) roughly in place. */
function setZoom(level, anchor) {
  level = Math.max(0, Math.min(ZOOM_MIN_WIDTHS.length - 1, level));
  if (level === state.zoom) return false;

  // "First" positions are measured as seen (including any live pinch scale) so the animation is continuous.
  const cards = [...els.grid.children];
  const viewH = window.innerHeight;
  const first = new Map();
  for (const card of cards) {
    const r = card.getBoundingClientRect();
    if (r.bottom > -100 && r.top < viewH + 100) first.set(card, r);
  }

  let anchorCard = null;
  if (anchor) {
    const hit = document.elementFromPoint(anchor.x, anchor.y);
    anchorCard = hit && hit.closest('.card');
  }
  if (!anchorCard) anchorCard = [...first.keys()].find((c) => first.get(c).top >= 0) || cards[0];
  const anchorTop = anchorCard.getBoundingClientRect().top;

  els.grid.style.transform = '';
  state.zoom = level;
  saveZoom();
  applyZoom();

  // Keep the anchor card at the same vertical position after the reflow.
  els.scroller.scrollTop += anchorCard.getBoundingClientRect().top - anchorTop;

  if (reducedMotion()) return true;
  for (const card of cards) {
    const last = card.getBoundingClientRect();
    if (last.bottom < 0 || last.top > viewH) continue;
    const prev = first.get(card);
    if (!prev) {
      card.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: EASE });
      continue;
    }
    const scale = prev.width / last.width;   // uniform scale keeps text from stretching
    card.animate([
      { transformOrigin: '0 0', transform: `translate(${prev.left - last.left}px, ${prev.top - last.top}px) scale(${scale})` },
      { transformOrigin: '0 0', transform: 'none' },
    ], { duration: 320, easing: EASE });
  }
  return true;
}

// --- Pinch to zoom (touch). Spreading fingers = bigger cards, pinching = more columns.
const pinch = { active: false, startDist: 0, justEnded: false };
const touchDist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
const touchMid = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });

els.scroller.addEventListener('touchstart', (e) => {
  if (e.touches.length !== 2) return;
  pinch.active = true;
  pinch.startDist = touchDist(e.touches);
  const mid = touchMid(e.touches);
  const rect = els.grid.getBoundingClientRect();
  els.grid.style.transformOrigin = `${mid.x - rect.left}px ${mid.y - rect.top}px`;
}, { passive: true });

els.scroller.addEventListener('touchmove', (e) => {
  if (!pinch.active || e.touches.length < 2) return;
  e.preventDefault();
  const ratio = touchDist(e.touches) / pinch.startDist;
  if (ratio > 1.3 || ratio < 0.77) {
    const changed = setZoom(state.zoom + (ratio > 1 ? -1 : 1), touchMid(e.touches));
    if (changed) pinch.startDist = touchDist(e.touches);
    else els.grid.style.transform = `scale(${ratio > 1 ? 1.04 : 0.96})`;   // at the limit: small rubber band
  } else {
    // Live feedback while the gesture hasn't crossed a threshold yet.
    els.grid.style.transform = `scale(${1 + (ratio - 1) * 0.3})`;
  }
}, { passive: false });

function endPinch(e) {
  if (!pinch.active || e.touches.length >= 2) return;
  pinch.active = false;
  pinch.justEnded = true;                 // swallow the click that may follow the gesture
  setTimeout(() => { pinch.justEnded = false; }, 400);
  if (els.grid.style.transform) {
    const from = els.grid.style.transform;
    els.grid.style.transform = '';
    if (!reducedMotion()) els.grid.animate([{ transform: from }, { transform: 'none' }], { duration: 220, easing: EASE });
  }
}
els.scroller.addEventListener('touchend', endPinch);
els.scroller.addEventListener('touchcancel', endPinch);

// iOS fires proprietary gesture events for pinch; cancelling them stops page zoom.
['gesturestart', 'gesturechange', 'gestureend'].forEach((type) =>
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false }));

// Trackpad pinch / ctrl+scroll on desktop.
let wheelAccum = 0;
let wheelLock = 0;
els.scroller.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  if (e.timeStamp < wheelLock) return;
  wheelAccum += e.deltaY;
  if (Math.abs(wheelAccum) > 30) {
    setZoom(state.zoom + (wheelAccum < 0 ? -1 : 1), { x: e.clientX, y: e.clientY });
    wheelAccum = 0;
    wheelLock = e.timeStamp + 280;
  }
}, { passive: false });

els.grid.addEventListener('click', (e) => {
  if (pinch.justEnded) return;
  const card = e.target.closest('.card');
  if (!card) return;
  if (card.hasAttribute('data-plus')) openEditor(null);
  else openViewer(Number(card.dataset.index), card);
});

$('#add-btn').addEventListener('click', () => openEditor(null));
$('#menu-btn').addEventListener('click', openMenu);

function cardForIndex(index) {
  return index < state.recipes.length
    ? els.grid.querySelector(`.card[data-index="${index}"]`)
    : els.grid.querySelector('.card.plus');
}

/** Scrolls a grid card into view (below the sticky header) if it isn't already. */
function revealCard(card, smooth = false) {
  const header = $('.topbar').getBoundingClientRect().bottom;
  const r = card.getBoundingClientRect();
  if (r.top < header || r.bottom > window.innerHeight) {
    card.scrollIntoView({ block: 'center', behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' });
  }
}

/* =========================== 6. Recipe viewer =========================== */

function setThemeColor(el) {
  const color = getComputedStyle(el || document.body).backgroundColor;
  if (color) els.themeMeta.setAttribute('content', color);
}

function clipForRect(r) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const radius = cssNumber('--card-radius', 10);
  return `inset(${r.top}px ${W - r.right}px ${H - r.bottom}px ${r.left}px round ${radius}px)`;
}
const FULL_CLIP = 'inset(0px 0px 0px 0px round 0px)';

function openViewer(index, originEl) {
  const v = state.viewer;
  v.open = true;
  v.index = index;
  els.viewer.hidden = false;
  buildPager();
  syncViewerBar();

  if (originEl && !reducedMotion()) {
    // Grow the viewer out of the tapped card by animating its clip-path.
    els.viewer.animate([{ clipPath: clipForRect(originEl.getBoundingClientRect()) }, { clipPath: FULL_CLIP }],
      { duration: 380, easing: EASE });
    const content = v.slots[1] && v.slots[1].firstElementChild;
    if (content) {
      content.animate([{ opacity: 0, transform: 'translateY(18px) scale(0.97)' }, { opacity: 1, transform: 'none' }],
        { duration: 380, easing: EASE });
    }
    els.bar.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 80, fill: 'backwards' });
  } else {
    els.viewer.animate([{ opacity: 0 }, { opacity: 1 }], { duration: duration(200) });
  }
}

async function closeViewer({ fade = false } = {}) {
  const v = state.viewer;
  if (!v.open) return;
  v.open = false;

  const card = fade ? null : cardForIndex(v.index);
  let anim;
  if (card && !reducedMotion()) {
    revealCard(card);
    anim = els.viewer.animate([{ clipPath: FULL_CLIP }, { clipPath: clipForRect(card.getBoundingClientRect()) }],
      { duration: 320, easing: EASE });
    const content = v.slots[1] && v.slots[1].firstElementChild;
    if (content) content.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(0.97)' }], { duration: 200, fill: 'forwards' });
    els.bar.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: 'forwards' });
  } else {
    anim = els.viewer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: duration(200) });
  }
  await anim.finished.catch(() => {});
  els.viewer.hidden = true;
  els.pager.replaceChildren();
  v.slots = [];
  els.bar.getAnimations().forEach((a) => a.cancel());
  setThemeColor();
}

function recipePage(recipe, index) {
  const { summary, method } = splitDescription(recipe.description);
  const n = recipe.ingredients.length;
  const inner = h('div', { class: 'page-inner' },
    h('h1', { class: 'page-title', text: recipe.title }),
    n ? h('p', { class: 'page-sub', text: `${plural(n, 'ingredient')} —` }) : null,
    summary ? h('p', { class: 'page-summary', text: summary }) : null);

  if (recipe.photos.length) inner.append(carousel(recipe));

  inner.append(h('button', { class: 'fold-hint', type: 'button', 'data-fold': '', 'aria-expanded': 'false' },
    h('span', { text: n || method.length ? 'Ingredients & method' : 'More' }), icon('chevron', 18, 2.4)));

  const foldInner = h('div', { class: 'fold-inner' });
  if (n) {
    foldInner.append(h('h3', { class: 'section-title', text: 'Ingredients' }),
      h('ul', { class: 'ingredients' }, ...recipe.ingredients.map((item) => h('li', { text: item }))));
  }
  if (method.length) {
    foldInner.append(h('h3', { class: 'section-title', text: 'Method' }),
      h('div', { class: 'method' }, ...method.map((p) => h('p', { text: p }))));
  }
  if (!n && !method.length) {
    foldInner.append(h('p', { class: 'fold-empty', text: 'No ingredients or method yet. Tap the pencil to add them.' }));
  }
  inner.append(h('div', { class: 'fold' }, foldInner));

  return h('article', { class: `page ${colorClass(recipe)}`, 'data-index': index }, inner);
}

function plusPage() {
  return h('article', { class: 'page plus-page neutral', 'data-plus': '' },
    h('div', { class: 'plus-wrap' },
      h('div', { class: 'plus-big squircle' }, icon('plus', 56, 1.6)),
      h('p', { class: 'plus-title', text: 'Add a recipe' }),
      h('p', { class: 'plus-sub', text: 'Tap to create a new card' })));
}

function carousel(recipe) {
  const track = h('div', { class: 'track' },
    ...recipe.photos.map((_, k) => h('img', { src: photoURL(recipe, k), alt: k === 0 ? recipe.title : '', draggable: 'false', decoding: 'async' })));
  const box = h('div', { class: 'carousel squircle', 'data-i': '0', 'data-count': recipe.photos.length }, track);
  const wrap = h('div', { class: 'carousel-wrap' }, box);
  if (recipe.photos.length > 1) {
    wrap.append(h('div', { class: 'dots' },
      ...recipe.photos.map((_, k) => h('button', {
        class: 'dot', type: 'button', 'data-dot': k, 'aria-label': `Photo ${k + 1} of ${recipe.photos.length}`,
        'aria-current': k === 0 ? 'true' : 'false',
      }))));
  }
  return wrap;
}

function setCarousel(box, i, animate = true) {
  const count = Number(box.dataset.count);
  i = Math.max(0, Math.min(count - 1, i));
  box.dataset.i = i;
  const track = box.firstElementChild;
  track.style.transition = animate ? `transform ${duration()}ms ${EASE}` : 'none';
  track.style.transform = `translate3d(${-i * 100}%, 0, 0)`;
  box.parentElement.querySelectorAll('.dot').forEach((d, k) => d.setAttribute('aria-current', String(k === i)));
}

function makePage(i) {
  const n = state.recipes.length;
  if (i < 0 || i > n) return null;
  return i === n ? plusPage() : recipePage(state.recipes[i], i);
}

/* The pager keeps three slots: previous, current, next. Swiping moves all three. */
function buildPager() {
  const v = state.viewer;
  v.slots = [makePage(v.index - 1), makePage(v.index), makePage(v.index + 1)];
  els.pager.replaceChildren(...v.slots.filter(Boolean));
  layoutSlots(0, false);
}

function layoutSlots(dx, animate) {
  const w = els.pager.clientWidth;
  state.viewer.slots.forEach((el, k) => {
    if (!el) return;
    el.style.transition = animate ? `transform ${duration()}ms ${EASE}` : 'none';
    el.style.transform = `translate3d(${(k - 1) * w + dx}px, 0, 0)`;
    el.inert = k !== 1;
  });
}

function commitPage(dir) {
  const v = state.viewer;
  v.busy = true;
  layoutSlots(-dir * els.pager.clientWidth, true);
  setTimeout(() => {
    if (dir > 0) {
      if (v.slots[0]) v.slots[0].remove();
      v.index += 1;
      v.slots = [v.slots[1], v.slots[2], makePage(v.index + 1)];
      if (v.slots[2]) els.pager.append(v.slots[2]);
    } else {
      if (v.slots[2]) v.slots[2].remove();
      v.index -= 1;
      v.slots = [makePage(v.index - 1), v.slots[0], v.slots[1]];
      if (v.slots[0]) els.pager.prepend(v.slots[0]);
    }
    layoutSlots(0, false);
    syncViewerBar();
    v.busy = false;
  }, duration() + 20);
}

function syncViewerBar() {
  const v = state.viewer;
  const recipe = state.recipes[v.index];
  els.bar.className = `viewer-bar ${recipe ? colorClass(recipe) : 'neutral'}`;
  els.copyBtn.hidden = !recipe;
  els.editBtn.hidden = !recipe;
  if (v.slots[1]) setThemeColor(v.slots[1]);
}

function toggleFold(page) {
  const open = !page.classList.contains('open');
  page.classList.toggle('open', open);
  const hint = page.querySelector('.fold-hint');
  if (hint) hint.setAttribute('aria-expanded', String(open));
  if (open) {
    // If the unfolded content starts low on screen, glide it into view.
    setTimeout(() => {
      const top = page.querySelector('.fold').getBoundingClientRect().top;
      if (top > window.innerHeight * 0.55) {
        page.scrollBy({ top: top - window.innerHeight * 0.3, behavior: reducedMotion() ? 'auto' : 'smooth' });
      }
    }, 80);
  } else if (page.scrollTop > 0) {
    page.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }
}

// --- Swipe gestures (pointer events). We lock to an axis after a few pixels:
// vertical → let the browser scroll; horizontal → drag the photo carousel or the pager.
const gesture = { id: null, suppressClick: false };
const SWIPE_VELOCITY = 0.35;  // px/ms (~350px/s) counts as a flick
const SWIPE_DISTANCE = 0.3;   // or dragged 30% of the width

els.pager.addEventListener('pointerdown', (e) => {
  gesture.suppressClick = false;
  if (state.viewer.busy || gesture.id !== null) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  Object.assign(gesture, {
    id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, lock: null, mode: null,
    box: e.target.closest('.carousel'), samples: [{ x: e.clientX, t: e.timeStamp }],
  });
});

els.pager.addEventListener('pointermove', (e) => {
  const g = gesture;
  if (e.pointerId !== g.id) return;
  const dx = e.clientX - g.x0;
  const dy = e.clientY - g.y0;

  if (!g.lock) {
    if (Math.hypot(dx, dy) < 8) return;
    g.lock = Math.abs(dx) > Math.abs(dy) * 1.15 ? 'x' : 'y';
    if (g.lock === 'y') { g.id = null; return; }      // native vertical scroll takes over
    try { els.pager.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    g.mode = pickDragTarget(g.box, dx);
  }

  g.dx = dx;
  g.samples.push({ x: e.clientX, t: e.timeStamp });
  while (g.samples.length > 2 && e.timeStamp - g.samples[0].t > 100) g.samples.shift();

  if (g.mode === 'carousel') {
    const track = g.box.firstElementChild;
    track.style.transition = 'none';
    track.style.transform = `translate3d(calc(${-Number(g.box.dataset.i) * 100}% + ${dx}px), 0, 0)`;
  } else {
    layoutSlots(resistance(dx), false);
  }
});

/** The photo carousel gets the drag unless it's already at its first/last photo. */
function pickDragTarget(box, dx) {
  if (box && Number(box.dataset.count) > 1) {
    const i = Number(box.dataset.i);
    if ((dx < 0 && i < Number(box.dataset.count) - 1) || (dx > 0 && i > 0)) return 'carousel';
  }
  return 'pager';
}

/** Rubber-band effect when there's nothing to swipe to. */
function resistance(dx) {
  const [prev, , next] = state.viewer.slots;
  return (dx > 0 && !prev) || (dx < 0 && !next) ? dx * 0.3 : dx;
}

function endSwipe(e, cancelled) {
  const g = gesture;
  if (e.pointerId !== g.id) return;
  g.id = null;
  if (g.lock !== 'x') return;
  g.suppressClick = true;

  const first = g.samples[0];
  const last = g.samples[g.samples.length - 1];
  const velocity = cancelled || last.t === first.t ? 0 : (last.x - first.x) / (last.t - first.t);
  const dx = cancelled ? 0 : g.dx;

  if (g.mode === 'carousel') {
    const w = g.box.clientWidth;
    const i = Number(g.box.dataset.i);
    let next = i;
    if (dx < 0 && (dx < -w * 0.25 || velocity < -SWIPE_VELOCITY)) next = i + 1;
    else if (dx > 0 && (dx > w * 0.25 || velocity > SWIPE_VELOCITY)) next = i - 1;
    setCarousel(g.box, next);
    return;
  }

  const w = els.pager.clientWidth;
  const [prev, , next] = state.viewer.slots;
  if (next && dx < 0 && (dx < -w * SWIPE_DISTANCE || velocity < -SWIPE_VELOCITY)) commitPage(1);
  else if (prev && dx > 0 && (dx > w * SWIPE_DISTANCE || velocity > SWIPE_VELOCITY)) commitPage(-1);
  else layoutSlots(0, true);
}
els.pager.addEventListener('pointerup', (e) => endSwipe(e, false));
els.pager.addEventListener('pointercancel', (e) => endSwipe(e, true));

// Taps: dots switch photos, the "+" page adds a recipe, anywhere else on a recipe (un)folds it.
els.pager.addEventListener('click', (e) => {
  if (gesture.suppressClick) { gesture.suppressClick = false; return; }
  const dot = e.target.closest('[data-dot]');
  if (dot) {
    setCarousel(dot.closest('.carousel-wrap').querySelector('.carousel'), Number(dot.dataset.dot));
    return;
  }
  const page = e.target.closest('.page');
  if (!page || page.inert) return;
  if (page.hasAttribute('data-plus')) openEditor(null);
  else toggleFold(page);
});

$('#close-btn').addEventListener('click', () => closeViewer());
els.copyBtn.addEventListener('click', () => {
  const recipe = state.recipes[state.viewer.index];
  if (recipe) copyIngredients(recipe);
});
els.editBtn.addEventListener('click', () => {
  const recipe = state.recipes[state.viewer.index];
  if (recipe) openEditor(recipe);
});

/* =============================== 7. Editor ============================== */

function editorSnapshot() {
  const ed = state.editor;
  const f = els.form.elements;
  return JSON.stringify([f.title.value, f.description.value, f.ingredients.value, ed.color, ed.photos.map((p) => p.blob.size)]);
}

function openEditor(recipe) {
  state.editor = {
    recipe,
    photos: recipe ? recipe.photos.map((blob) => ({ blob, url: URL.createObjectURL(blob) })) : [],
    color: recipe ? colorIndex(recipe) : state.recipes.length % PALETTE_SIZE,
    pending: 0,
    saving: false,
  };
  const f = els.form.elements;
  f.title.value = recipe ? recipe.title : '';
  f.description.value = recipe ? recipe.description : '';
  f.ingredients.value = recipe ? recipe.ingredients.join('\n') : '';
  els.editorTitle.textContent = recipe ? 'Edit recipe' : 'New recipe';
  els.deleteBtn.hidden = !recipe;
  els.saveBtn.disabled = false;
  els.saveBtn.textContent = 'Save';
  setTitleError('');
  renderPhotoStrip();
  renderSwatches();
  state.editor.snapshot = editorSnapshot();

  els.form.scrollTop = 0;
  els.editor.hidden = false;
  // Next frame(s): add the class so the slide-up transition runs.
  requestAnimationFrame(() => requestAnimationFrame(() => els.editor.classList.add('is-open')));
  setThemeColor(els.editor);
}

function closeEditor() {
  const ed = state.editor;
  if (!ed) return;
  state.editor = null;
  document.activeElement && document.activeElement.blur();
  els.editor.classList.remove('is-open');
  setTimeout(() => {
    if (!state.editor) els.editor.hidden = true;
    ed.photos.forEach((p) => URL.revokeObjectURL(p.url));
  }, duration(340));
  if (state.viewer.open && state.viewer.slots[1]) setThemeColor(state.viewer.slots[1]);
  else setThemeColor();
}

async function cancelEditor() {
  const ed = state.editor;
  if (!ed || ed.saving) return;
  if (editorSnapshot() !== ed.snapshot) {
    const choice = await ask({
      title: 'Discard changes?',
      message: 'Your edits to this recipe haven’t been saved.',
      actions: [
        { label: 'Discard', value: 'discard', style: 'danger' },
        { label: 'Keep editing', value: 'cancel', style: 'cancel' },
      ],
    });
    if (choice !== 'discard') return;
  }
  closeEditor();
}

function renderPhotoStrip() {
  const ed = state.editor;
  const items = ed.photos.map((p, k) => {
    const item = h('div', { class: `thumb${k === 0 ? ' is-cover' : ''}` },
      h('button', {
        class: 'thumb-img squircle', type: 'button', 'data-cover': k,
        'aria-label': k === 0 ? 'Cover photo' : `Make photo ${k + 1} the cover`,
      }, h('img', { src: p.url, alt: '' })),
      k === 0 ? h('span', { class: 'badge', text: 'Cover' }) : null,
      h('button', { class: 'thumb-remove', type: 'button', 'data-remove': k, 'aria-label': `Remove photo ${k + 1}` }, icon('x', 16, 2.6)));
    return item;
  });
  for (let i = 0; i < ed.pending; i++) {
    items.push(h('div', { class: 'thumb' }, h('div', { class: 'thumb-img squircle is-busy' }, h('span', { class: 'spinner' }))));
  }
  items.push(h('button', { class: 'add-photo squircle', type: 'button', 'data-add': '' },
    icon('plus', 26, 2), h('span', { text: ed.photos.length ? 'Add more' : 'Add photo' })));
  els.strip.replaceChildren(...items);
  els.photoHint.hidden = ed.photos.length > 0;
}

function renderSwatches() {
  const ed = state.editor;
  els.swatches.replaceChildren(...Array.from({ length: PALETTE_SIZE }, (_, k) =>
    h('button', {
      class: `swatch c${k + 1}`, type: 'button', role: 'radio', 'data-color': k,
      'aria-checked': String(k === ed.color), 'aria-label': `Colour ${k + 1}`, text: 'Aa',
    })));
}

els.strip.addEventListener('click', (e) => {
  const ed = state.editor;
  if (!ed) return;
  const remove = e.target.closest('[data-remove]');
  const cover = e.target.closest('[data-cover]');
  if (remove) {
    const [removed] = ed.photos.splice(Number(remove.dataset.remove), 1);
    URL.revokeObjectURL(removed.url);
    renderPhotoStrip();
  } else if (cover && Number(cover.dataset.cover) > 0) {
    const [chosen] = ed.photos.splice(Number(cover.dataset.cover), 1);
    ed.photos.unshift(chosen);   // first photo is the cover
    renderPhotoStrip();
    els.strip.scrollTo({ left: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
  } else if (e.target.closest('[data-add]')) {
    els.photoInput.click();
  }
});

els.swatches.addEventListener('click', (e) => {
  const swatch = e.target.closest('[data-color]');
  if (!swatch || !state.editor) return;
  state.editor.color = Number(swatch.dataset.color);
  renderSwatches();
});

// Photos are compressed as soon as they're picked, so Save is instant and memory stays low.
els.photoInput.addEventListener('change', async () => {
  const files = [...els.photoInput.files];
  els.photoInput.value = '';
  const ed = state.editor;
  if (!ed || !files.length) return;
  ed.pending += files.length;
  renderPhotoStrip();
  for (const file of files) {
    try {
      const blob = await compressImage(file);
      if (state.editor === ed) ed.photos.push({ blob, url: URL.createObjectURL(blob) });
    } catch (err) {
      toast(err instanceof UserError ? err.message : `Couldn’t read “${file.name}”.`, { error: true });
    } finally {
      ed.pending -= 1;
      if (state.editor === ed) renderPhotoStrip();
    }
  }
});

function setTitleError(message) {
  els.titleError.textContent = message;
  els.titleError.hidden = !message;
  els.form.elements.title.setAttribute('aria-invalid', message ? 'true' : 'false');
}
els.form.elements.title.addEventListener('input', () => setTitleError(''));
els.form.addEventListener('submit', (e) => { e.preventDefault(); saveEditor(); });

async function saveEditor() {
  const ed = state.editor;
  if (!ed || ed.saving) return;
  if (ed.pending) { toast('Still processing photos…'); return; }

  const f = els.form.elements;
  const title = f.title.value.trim();
  if (!title) {
    setTitleError('Give your recipe a title.');
    f.title.focus();
    return;
  }

  ed.saving = true;
  els.saveBtn.disabled = true;
  els.saveBtn.textContent = 'Saving…';

  const now = Date.now();
  const recipe = {
    id: ed.recipe ? ed.recipe.id : uid(),
    title,
    description: f.description.value.trim(),
    ingredients: parseIngredients(f.ingredients.value),
    photos: ed.photos.map((p) => p.blob),
    color: ed.color,
    createdAt: ed.recipe ? ed.recipe.createdAt : now,
    updatedAt: now,
  };

  try {
    await db.put(recipe);
  } catch (err) {
    toast(storageErrorMessage(err, 'save the recipe'), { error: true });
    ed.saving = false;
    els.saveBtn.disabled = false;
    els.saveBtn.textContent = 'Save';
    return;
  }

  const existing = state.recipes.findIndex((r) => r.id === recipe.id);
  if (existing >= 0) state.recipes[existing] = recipe;
  else state.recipes.push(recipe);
  state.recipes.sort((a, b) => a.createdAt - b.createdAt);
  renderGrid();

  const index = state.recipes.findIndex((r) => r.id === recipe.id);
  if (state.viewer.open) {
    state.viewer.index = index;     // also turns the "+" page into the new recipe
    buildPager();
    syncViewerBar();
  }
  closeEditor();
  toast(existing >= 0 ? 'Saved' : 'Recipe added');

  if (!state.viewer.open) {
    const card = cardForIndex(index);
    if (card) {
      setTimeout(() => {
        revealCard(card, true);
        if (!reducedMotion()) card.animate([{ transform: 'scale(0.9)', opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: 420, easing: EASE });
      }, duration(250));
    }
  }
}

async function deleteCurrentRecipe() {
  const ed = state.editor;
  const recipe = ed && ed.recipe;
  if (!recipe) return;
  const choice = await ask({
    title: 'Delete recipe?',
    message: `“${recipe.title}” and its photos will be removed from this device. This can’t be undone.`,
    actions: [
      { label: 'Delete', value: 'delete', style: 'danger' },
      { label: 'Cancel', value: 'cancel', style: 'cancel' },
    ],
  });
  if (choice !== 'delete') return;
  try {
    await db.delete(recipe.id);
  } catch (err) {
    toast(storageErrorMessage(err, 'delete the recipe'), { error: true });
    return;
  }
  state.recipes = state.recipes.filter((r) => r.id !== recipe.id);
  releaseURLs(recipe.id);
  renderGrid();
  closeEditor();
  if (state.viewer.open) closeViewer({ fade: true });
  toast('Recipe deleted');
}

els.saveBtn.addEventListener('click', saveEditor);
$('#cancel-btn').addEventListener('click', cancelEditor);
els.deleteBtn.addEventListener('click', deleteCurrentRecipe);

/* ============================= 8. Clipboard ============================= */

async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to the legacy path */ }

  // Fallback for older iOS: select a hidden textarea and use execCommand.
  const ta = h('textarea', { readonly: true, 'aria-hidden': 'true' });
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px;';
  document.body.append(ta);
  const range = document.createRange();
  range.selectNodeContents(ta);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  sel.removeAllRanges();
  ta.remove();
  return ok;
}

async function copyIngredients(recipe) {
  if (!recipe.ingredients.length) {
    toast('This recipe has no ingredients yet');
    return;
  }
  const text = recipe.ingredients.map((i) => `- ${i}`).join('\n');
  const ok = await copyText(text);
  toast(ok ? 'Copied' : 'Couldn’t copy. Your browser blocked clipboard access.', { error: !ok });
}

/* ========================= 9. Backup (export / import) ========================= */

async function exportBackup() {
  let file;
  let count = 0;
  try {
    const recipes = await db.all();
    count = recipes.length;
    if (!count) { toast('There are no recipes to export yet'); return; }
    const data = {
      app: 'recipe-box',
      version: 1,
      exportedAt: new Date().toISOString(),
      recipes: await Promise.all(recipes.map(async (r) => ({
        ...r,
        photos: await Promise.all((r.photos || []).map(blobToDataURL)),
      }))),
    };
    const name = `recipe-box-backup-${new Date().toISOString().slice(0, 10)}.json`;
    file = new File([JSON.stringify(data)], name, { type: 'application/json' });
  } catch (err) {
    toast(storageErrorMessage(err, 'create the backup'), { error: true });
    return;
  }
  // A second tap is needed: iOS only opens the share sheet straight from a user gesture.
  await ask({
    title: 'Backup ready',
    message: `${plural(count, 'recipe')} · ${formatBytes(file.size)}. Save it to Files or iCloud Drive, or send it to yourself.`,
    actions: [
      { label: 'Save backup', value: 'save', style: 'primary', run: () => saveFile(file) },
      { label: 'Cancel', value: 'cancel', style: 'cancel' },
    ],
  });
}

function saveFile(file) {
  const touch = matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file], title: 'Recipe Box backup' }).catch((err) => {
      if (err.name !== 'AbortError') downloadFile(file);
    });
  } else {
    downloadFile(file);
  }
}

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = h('a', { href: url, download: file.name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

/** Validates a parsed backup file and converts it back into recipes with Blob photos. */
function parseBackup(data) {
  const list = Array.isArray(data) ? data : data && data.recipes;
  if (!Array.isArray(list)) throw new UserError('That file isn’t a Recipe Box backup.');
  return list
    .filter((r) => r && typeof r.title === 'string')
    .map((r) => ({
      id: typeof r.id === 'string' && r.id ? r.id : uid(),
      title: r.title.trim() || 'Untitled',
      description: typeof r.description === 'string' ? r.description : '',
      ingredients: Array.isArray(r.ingredients) ? r.ingredients.map(String).filter(Boolean) : [],
      photos: (Array.isArray(r.photos) ? r.photos : []).map((p) => {
        try { return typeof p === 'string' ? dataURLToBlob(p) : null; } catch { return null; }
      }).filter(Boolean),
      color: Number.isInteger(r.color) ? r.color : undefined,
      createdAt: Number(r.createdAt) || Date.now(),
      updatedAt: Number(r.updatedAt) || Date.now(),
    }));
}

els.importInput.addEventListener('change', async () => {
  const file = els.importInput.files[0];
  els.importInput.value = '';
  if (!file) return;

  let incoming;
  try {
    incoming = parseBackup(JSON.parse(await file.text()));
  } catch (err) {
    toast(err instanceof UserError ? err.message : 'That file isn’t a valid Recipe Box backup.', { error: true });
    return;
  }
  if (!incoming.length) { toast('That backup has no recipes in it.'); return; }

  const existing = state.recipes.length;
  let mode = 'merge';
  if (existing) {
    mode = await ask({
      title: 'Import backup',
      message: `The backup has ${plural(incoming.length, 'recipe')}. You have ${existing} on this device. Adding keeps everything you have; recipes that exist in both keep the newest version.`,
      actions: [
        { label: 'Add to my recipes', value: 'merge', style: 'primary' },
        { label: 'Replace everything…', value: 'replace', style: 'danger' },
        { label: 'Cancel', value: 'cancel', style: 'cancel' },
      ],
    });
    if (mode === 'cancel') return;
    if (mode === 'replace') {
      const sure = await ask({
        title: 'Replace all recipes?',
        message: `This permanently deletes the ${plural(existing, 'recipe')} on this device and replaces them with the backup.`,
        actions: [
          { label: 'Delete and replace', value: 'yes', style: 'danger' },
          { label: 'Cancel', value: 'cancel', style: 'cancel' },
        ],
      });
      if (sure !== 'yes') return;
    }
  }

  let toWrite = incoming;
  if (mode === 'merge') {
    const byId = new Map(state.recipes.map((r) => [r.id, r]));
    toWrite = incoming.filter((r) => !byId.has(r.id) || r.updatedAt > (byId.get(r.id).updatedAt || 0));
  }

  try {
    await db.bulkPut(toWrite, { replace: mode === 'replace' });
    await loadRecipes();
  } catch (err) {
    toast(storageErrorMessage(err, 'import the backup'), { error: true });
    return;
  }
  renderGrid();
  toast(mode === 'replace' ? `Restored ${plural(toWrite.length, 'recipe')}`
    : toWrite.length ? `Imported ${plural(toWrite.length, 'recipe')}` : 'Everything was already up to date');
});

async function storageSummary() {
  try {
    const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
    const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
    const used = est && est.usage ? `Using ${formatBytes(est.usage)}. ` : '';
    return used + (persisted
      ? 'Storage is marked persistent.'
      : 'iOS may clear storage if the phone runs very low on space. Export a backup now and then.');
  } catch {
    return 'Export a backup now and then to keep your recipes safe.';
  }
}

async function openMenu() {
  const note = h('p', { class: 'dialog-note', text: ' ' });
  storageSummary().then((text) => { note.textContent = text; });

  const smaller = h('button', { type: 'button', 'aria-label': 'Smaller cards', text: '−' });
  const bigger = h('button', { type: 'button', 'aria-label': 'Bigger cards', text: '+' });
  const syncZoomButtons = () => {
    bigger.disabled = state.zoom === 0;
    smaller.disabled = state.zoom === ZOOM_MIN_WIDTHS.length - 1;
  };
  smaller.addEventListener('click', () => { setZoom(state.zoom + 1); syncZoomButtons(); });
  bigger.addEventListener('click', () => { setZoom(state.zoom - 1); syncZoomButtons(); });
  syncZoomButtons();

  await ask({
    title: 'Recipe Box',
    body: h('div', {},
      h('div', { class: 'zoom-row' }, h('span', { text: 'Card size' }), h('div', { class: 'segmented' }, smaller, bigger)),
      note),
    actions: [
      { label: 'Export backup', value: 'export', run: () => exportBackup() },
      // The file picker must open synchronously inside the tap (iOS rule), hence `run`.
      { label: 'Import backup', value: 'import', run: () => els.importInput.click() },
      { label: 'Done', value: 'cancel', style: 'cancel' },
    ],
  });
}

/* ========================== 10. Dialog + toast ========================== */

/** Shows a modal and resolves with the chosen action's value ('cancel' if dismissed).
 *  An action's `run` callback is called synchronously inside the tap (needed for iOS APIs). */
function ask({ title, message, body, actions }) {
  const dialog = els.dialog;
  if (typeof dialog.showModal !== 'function') {
    // Very old browsers: fall back to a native confirm.
    const primary = actions[0];
    const ok = window.confirm([title, message].filter(Boolean).join('\n\n'));
    if (ok && primary.run) primary.run();
    return Promise.resolve(ok ? primary.value : 'cancel');
  }
  settleDialog('cancel');   // a newer dialog replaces any open one

  return new Promise((resolve) => {
    const box = h('div', {},
      title ? h('h2', { class: 'dialog-title', text: title }) : null,
      message ? h('p', { class: 'dialog-msg', text: message }) : null,
      body || null,
      h('div', { class: 'dialog-actions' }, ...actions.map((a) => h('button', {
        class: `dialog-btn ${a.style || ''}`, type: 'button', text: a.label,
        onclick: () => {
          settleDialog(a.value);
          dialog.close();
          if (a.run) a.run();
        },
      }))));
    dialog.replaceChildren(box);
    dialogResolve = resolve;
    if (!dialog.open) dialog.showModal();
  });
}

let dialogResolve = null;
function settleDialog(value) {
  const resolve = dialogResolve;
  dialogResolve = null;
  if (resolve) resolve(value);
}
// Escape / backdrop closes resolve as 'cancel'. (Ignored if a new dialog already reopened it.)
els.dialog.addEventListener('close', () => { if (!els.dialog.open) settleDialog('cancel'); });
els.dialog.addEventListener('click', (e) => { if (e.target === els.dialog) els.dialog.close(); });

let toastTimer = 0;
function toast(message, { error = false } = {}) {
  const t = els.toast;
  t.textContent = message;
  t.classList.toggle('is-error', error);
  t.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-visible'), error ? 5000 : 1800);
}
els.toast.addEventListener('click', () => els.toast.classList.remove('is-visible'));

/* ============================== 11. Startup ============================= */

document.addEventListener('keydown', (e) => {
  if (els.dialog.open) return;
  if (e.key === 'Escape') {
    if (state.editor) cancelEditor();
    else if (state.viewer.open) closeViewer();
    return;
  }
  const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement && document.activeElement.tagName);
  if (typing || state.editor) return;
  if (state.viewer.open && !state.viewer.busy) {
    if (e.key === 'ArrowRight' && state.viewer.slots[2]) commitPage(1);
    if (e.key === 'ArrowLeft' && state.viewer.slots[0]) commitPage(-1);
  } else if (!state.viewer.open) {
    if (e.key === '+' || e.key === '=') setZoom(state.zoom - 1);
    if (e.key === '-') setZoom(state.zoom + 1);
  }
});

window.addEventListener('resize', () => {
  applyZoom();
  if (state.viewer.open) layoutSlots(0, false);
});

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  requestAnimationFrame(() => {
    if (state.editor) setThemeColor(els.editor);
    else if (state.viewer.open && state.viewer.slots[1]) setThemeColor(state.viewer.slots[1]);
    else setThemeColor();
  });
});

window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
  toast(storageErrorMessage(e.reason, 'finish that'), { error: true });
});

async function requestPersistentStorage() {
  try {
    if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch { /* best effort */ }
}

async function init() {
  applyZoom();
  setThemeColor();
  renderGrid();   // show the "+" card immediately
  try {
    await loadRecipes();
    renderGrid();
  } catch (err) {
    console.error(err);
    els.empty.hidden = false;
    els.empty.querySelector('h2').textContent = 'Couldn’t open your recipes';
    els.empty.querySelector('p').textContent = storageErrorMessage(err, 'open storage') +
      ' If Private Browsing is on, turn it off. Otherwise close and reopen the app.';
  }
  requestPersistentStorage();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch((err) => console.warn('Service worker failed', err));
  }
}

init();
