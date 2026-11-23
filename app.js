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
const PALETTE_SIZE = 15;              // number of colour pairs in styles.css
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

/* Food icons for recipes without a photo (24×24, stroked). */
const FOOD_ICONS = {
  soup: '<path d="M3 12h18a9 8 0 0 1-18 0z"/><path d="M9 20h6"/><path d="M9 8c-1-1 1-2 0-3.5M12.5 8c-1-1 1-2 0-3.5M16 8c-1-1 1-2 0-3.5"/>',
  pot: '<path d="M4 10h16v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"/><path d="M2 12h2M20 12h2M5 7h14M12 4.5V7"/>',
  curry: '<path d="M3 13h18a9 7 0 0 1-18 0z"/><path d="M6.5 13a5.5 4.5 0 0 1 11 0"/><path d="M16 6.5c1.5-1.5 3.5-1.5 5-1-.5 2-2.5 3-5 2.5"/><path d="M16 7.5l-2 2"/>',
  pasta: '<path d="M3 15h18a9 5.5 0 0 1-18 0z"/><path d="M5.5 15c0-3.5 3-5 6.5-5s6.5 1.5 6.5 5"/><path d="M8.5 15c0-2 1.5-3 3.5-3s3.5 1 3.5 3M11 15c0-1 2-1 2 0"/><path d="M14 3l-2 8.5M12 3.3l-.9 3.6a1.6 1.6 0 0 0 3.1.7l.9-3.6"/>',
  lasagna: '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M3 12h18M3 16h18"/><path d="M5 8c1-2 2.5-2 3.5 0s2.5 2 3.5 0 2.5-2 3.5 0 2.5 2 3.5 0"/>',
  salad: '<path d="M3 12h18a9 8 0 0 1-18 0z"/><path d="M8 12c-1.5-3 0-6.5 4-7 .5 3.5-1.5 6-4 7z"/><path d="M13 12c0-3 2.5-5.5 7-4.5-1 3-3.5 4.5-7 4.5z"/>',
  wrap: '<path d="M5 9l7 12 7-12"/><path d="M5 9c0-3 3-5 7-5s7 2 7 5"/><path d="M7.5 8.5c1-1.5 2 .5 3-.5s2 .5 3-.5 2 .5 3 0"/>',
  cabbage: '<circle cx="12" cy="13" r="8"/><path d="M12 5c-3 3-3 12 0 16M12 5c3 3 3 12 0 16"/><path d="M4.5 11c3 1 5.5 4 7.5 10M19.5 11c-3 1-5.5 4-7.5 10"/>',
  pumpkin: '<path d="M12 7.5C6.5 7 3.5 10 3.5 14s3.5 6.5 8.5 6.5 8.5-2.5 8.5-6.5-3-7-8.5-6.5z"/><path d="M12 7.5c-2.5 2-2.5 11 0 13M12 7.5c2.5 2 2.5 11 0 13"/><path d="M12 7.5c0-2 1-3.5 3-4"/>',
  fish: '<path d="M2.5 12c3-5.5 10.5-6.5 14.5 0-4 6.5-11.5 5.5-14.5 0z"/><path d="M17 12l4.5-4v8z"/><path d="M7 11h.01" stroke-width="2.6"/>',
  potato: '<path d="M6 7c3.5-4 11.5-3 13.5 2.5S19 20 12.5 20 3 17 3 13s1-4 3-6z"/><path d="M9 11h.01M14 9h.01M13.5 15h.01M8.5 16h.01" stroke-width="2.4"/>',
  bread: '<path d="M5 20v-8.5A3.5 3.5 0 0 1 6.5 5h11a3.5 3.5 0 0 1 1.5 6.5V20z"/><path d="M9 13l2-2M13 15l2-2M9 17l2-2"/>',
  mushroom: '<path d="M3 12a9 8 0 0 1 18 0z"/><path d="M9 12v6a3 3 0 0 0 6 0v-6"/><path d="M8 8.5h.01M14 7h.01M16.5 10h.01" stroke-width="2.4"/>',
  meatballs: '<path d="M2 19h20"/><circle cx="7" cy="15" r="3.2"/><circle cx="17" cy="15" r="3.2"/><circle cx="12" cy="9.5" r="3.2"/>',
  cauliflower: '<path d="M6.5 13a3 3 0 0 1 1-6 4.5 4.5 0 0 1 9 0 3 3 0 0 1 1 6z"/><path d="M6.5 13c0 5 3 8 5.5 8s5.5-3 5.5-8"/><path d="M12 13v8M9 13.5c.5 2 1.5 3.5 3 4.5M15 13.5c-.5 2-1.5 3.5-3 4.5"/>',
  egg: '<path d="M12 3.5c4.5 0 8.5 3 7.5 8s-2.5 8.5-7.5 8.5S3.5 17 3.5 12 7.5 3.5 12 3.5z"/><circle cx="12" cy="12" r="3"/>',
  pepper: '<path d="M8 9c-3.5 0-4.5 4.5-3.5 8s4 4.5 7.5 4.5 6.5-1 7.5-4.5S19.5 9 16 9c-1.5 0-2 1-4 1s-2.5-1-4-1z"/><path d="M12 10V7c0-1.5 1-3 3.5-3"/>',
  aubergine: '<path d="M14 6.5c3.5 1 5 5 2.5 9S9 21.5 6 20s-2-6 1.5-9 4-5.5 6.5-4.5z"/><path d="M14 6.5c0-1.5.5-3 2-4M12 7.5c1.5.5 3 .5 4.5-.5"/>',
  dumplings: '<path d="M2 19h20"/><path d="M3.5 15.5a3.5 3 0 0 1 7 0v.5h-7z"/><path d="M13.5 15.5a3.5 3 0 0 1 7 0v.5h-7z"/><path d="M8.5 10a3.5 3 0 0 1 7 0v.5h-7z"/><path d="M6 13.5v1M17 13.5v1M12 8v1"/>',
  chicken: '<ellipse cx="15" cy="9" rx="6.5" ry="4.8" transform="rotate(-45 15 9)"/><path d="M10.6 13.4L6.3 17.7"/><circle cx="4.6" cy="17.9" r="1.7"/><circle cx="6.1" cy="19.4" r="1.7"/>',
  tomato: '<circle cx="12" cy="13.5" r="7.5"/><path d="M8.5 6.5L12 8l3.5-1.5M12 8V4"/>',
  dish: '<path d="M3 18h18"/><path d="M5 18a7 7 0 0 1 14 0"/><path d="M12 11V8.5M10 8.5h4"/>',
};

/* First match wins, so more specific dishes come first. Covers English, German and Dutch words. */
const FOOD_RULES = [
  ['fish', /salmon|lachs|zalm|fish|fisch|\bvis\b|tuna|thunfisch|tonijn|\bcod\b|kabeljau|shrimp|garnel/],
  ['egg', /\beggs?\b|\beier\b|\bei\b|shakshuka|omelet|frittata|\beieren\b/],
  ['meatballs', /k[öo]ttbullar|meatball|frikadell|gehaktbal|bitterbal|hackbällchen/],
  ['wrap', /d[öo]ner|kebab|kebap|wrap|burrito|taco|gyros|pita|falafel|shawarma/],
  ['lasagna', /lasagn/],
  ['aubergine', /aubergin|eggplant/],
  ['pepper', /paprika|bell pepper|stuffed pepper|poivron/],
  ['cauliflower', /cauliflower|blumenkohl|bloemkool|broccoli/],
  ['cabbage', /wirsing|cabbage|kohl\b|savoy|\bkool\b|sauerkraut|zuurkool|spitzkohl/],
  ['pumpkin', /pumpkin|k[üu]rbis|pompoen|squash|butternut/],
  ['mushroom', /mushroom|pilz|champignon|paddenstoel/],
  ['soup', /soup|suppe|soep|broth|ramen|\bpho\b|chowder|bisque/],
  ['pasta', /pasta|spaghetti|bolognese|penne|noodle|nudel|carbonara|pesto|ravioli|tagliatelle|macaroni|mac and cheese|spätzle|orzo/],
  ['dumplings', /gnocchi|kn[öo]del|dumpling|pierogi|kl[öo][ßs]e|gyoza|maultasche/],
  ['salad', /salad|salat|salade|couscous|bowl|quark|veggies|gem[üu]se|groente|tabouleh|bulgur/],
  ['chicken', /chicken|h[äa]hnchen|\bhuhn\b|\bkip\b|poulet|drumstick/],
  ['curry', /curry|dahl|\bdal\b|masala|tikka|korma|biryani|risotto|\brice\b|\breis\b|rijst|paella/],
  ['potato', /potato|kartoffel|aardappel|kumpir|fries|frites|r[öo]sti|pommes|stamppot/],
  ['bread', /bread|\bbrot\b|brood|focaccia|toast|pizza|naan|sandwich|bruschetta|baguette|flammkuchen/],
  ['pot', /chili|goulash|gulasch|gulyas|stew|eintopf|ratatouille|stoofpot|ragout|rag[uù]|tajine|casserole|chili/],
  ['tomato', /tomat/],
];

function foodIconName(title = '') {
  const t = title.toLowerCase();
  const rule = FOOD_RULES.find(([, re]) => re.test(t));
  return rule ? rule[0] : 'dish';
}

/** A large stroked food icon that scales with its box (used where a recipe has no photo). */
function foodIcon(recipe) {
  const span = h('span', { class: 'food-icon', 'aria-hidden': 'true' });
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${FOOD_ICONS[foodIconName(recipe.title)]}</svg>`;
  return span;
}
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

/** First paragraph = short description (shown on cards); the rest = the recipe steps. */
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
// How recipes without a photo look: 'title' (big type fills the card) or 'icon' (food icon).
const NOPHOTO_KEY = 'recipe-box:nophoto';
function readNoPhotoStyle() {
  try { return localStorage.getItem(NOPHOTO_KEY) === 'icon' ? 'icon' : 'title'; } catch { return 'title'; }
}
function applyNoPhotoStyle(style) {
  document.body.classList.toggle('nophoto-title', style === 'title');
  fitTitles(els.grid);
  els.pager.querySelectorAll('[data-fit]').forEach((el) => { delete el.dataset.fit; });
  fitTitles(els.pager);
  try { localStorage.setItem(NOPHOTO_KEY, style); } catch { /* not important */ }
}
// Each zoom level is a minimum column width; the column count follows from the screen width.
const ZOOM_MIN_WIDTHS = [340, 160, 110, 84, 64];
const CARD_MODE_MIN_WIDTH = 150;   // narrower columns show photo-only tiles

const state = {
  recipes: [],          // sorted by createdAt (grid order)
  zoom: readZoom(),
  viewer: { open: false, index: 0 },
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
    box.append(foodIcon(recipe));
  }
  return box;
}

function recipeCard(recipe, index) {
  const { summary } = splitDescription(recipe.description);
  return h('button', { class: `card ${colorClass(recipe)}${recipe.photos.length ? '' : ' no-photo'}`, type: 'button', 'data-index': index, 'aria-label': recipe.title },
    h('div', { class: 'card-inner' },
      h('div', { class: 'card-text' },
        h('h2', { class: 'card-title', text: recipe.title }),
        summary ? h('p', { class: 'card-summary', text: summary }) : null),
      photoBox(recipe, 'card-photo')));
}

function plusCard() {
  const photo = h('div', { class: 'card-photo squircle is-plus' }, icon('plus', 40, 1.8));
  return h('button', { class: 'card plus', type: 'button', 'data-plus': '', 'aria-label': 'Add a recipe' },
    h('div', { class: 'card-inner' },
      h('div', { class: 'card-text' },
        h('h2', { class: 'card-title', text: 'New recipe' }),
        h('p', { class: 'card-summary', text: 'Add a photo, ingredients and the recipe.' })),
      photo));
}

function renderGrid() {
  const frag = document.createDocumentFragment();
  state.recipes.forEach((r, i) => frag.append(recipeCard(r, i)));
  frag.append(plusCard());
  els.grid.replaceChildren(frag);
  fitTitles(els.grid);

  const n = state.recipes.length;
  els.empty.hidden = n > 0;
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
  const isCarousel = state.zoom === 0;       // fully zoomed in: swipeable full-width cards
  els.grid.style.setProperty('--cols', cols);
  els.grid.dataset.zoom = state.zoom;
  els.grid.classList.toggle('carousel', isCarousel);
  els.scroller.classList.toggle('is-carousel', isCarousel);
  els.grid.classList.toggle('compact', !isCarousel && colWidth < CARD_MODE_MIN_WIDTH);
  fitTitles(els.grid);
}

/* --- Big title on the recipe page for recipes without a photo ---
 * Sized so its longest word fits on one line. (Cards use one fixed size, set in CSS.) */
function fitTitle(el, maxPx, minPx = 12) {
  el.style.fontSize = '';
  if (!el.clientWidth) return;
  // Words never break inside (CSS: overflow-wrap: normal), so a too-long word shows up as
  // horizontal overflow. Binary-search the largest size where nothing overflows.
  const fits = (px) => {
    el.style.fontSize = `${px}px`;
    return el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + px * 0.3;
  };
  let lo = minPx, hi = maxPx;
  if (!fits(hi)) {
    for (let i = 0; i < 9; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid; else hi = mid;
    }
    hi = lo;
  }
  // A little breathing room: bold glyphs can overhang their measured width.
  el.style.fontSize = `${Math.max(minPx, hi * 0.94)}px`;
}
function fitTitles(root) {
  const on = document.body.classList.contains('nophoto-title');
  root.querySelectorAll('.page.no-photo .page-title').forEach((el) => {
    const key = on ? String(window.innerWidth) : '';
    if (el.dataset.fit === key) return;      // already fitted at this width
    el.dataset.fit = key;
    if (!on) { el.style.fontSize = ''; return; }
    fitTitle(el, Math.min(96, window.innerWidth * 0.17), 34);
  });
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

  const wasCarousel = state.zoom === 0;
  let anchorCard = null;
  if (wasCarousel) anchorCard = centeredCard();
  else if (anchor) {
    const hit = document.elementFromPoint(anchor.x, anchor.y);
    anchorCard = hit && hit.closest('.card');
  }
  if (!anchorCard) anchorCard = [...first.keys()].find((c) => first.get(c).top >= 0) || cards[0];
  const anchorTop = anchorCard.getBoundingClientRect().top;

  els.grid.style.transform = '';
  state.zoom = level;
  saveZoom();
  applyZoom();

  // Switching between the carousel and the grid: jump to the same card and cross-fade.
  if (wasCarousel !== (level === 0)) {
    if (level === 0) {
      els.grid.scrollLeft = anchorCard.offsetLeft - (els.grid.clientWidth - anchorCard.offsetWidth) / 2;
    } else {
      els.scroller.scrollTop = 0;
      els.scroller.scrollTop = anchorCard.getBoundingClientRect().top - window.innerHeight / 3;
    }
    if (!reducedMotion()) {
      els.grid.animate([{ opacity: 0, transform: `scale(${level === 0 ? 0.92 : 1.06})` }, { opacity: 1, transform: 'none' }],
        { duration: 300, easing: EASE });
    }
    return true;
  }

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

$('#menu-btn').addEventListener('click', openMenu);

function cardForIndex(index) {
  return index < state.recipes.length
    ? els.grid.querySelector(`.card[data-index="${index}"]`)
    : els.grid.querySelector('.card.plus');
}

/** Scrolls a grid card into view if it isn't already (sideways in the carousel). */
function revealCard(card, smooth = false) {
  const behavior = smooth && !reducedMotion() ? 'smooth' : 'auto';
  if (els.grid.classList.contains('carousel')) {
    const left = card.offsetLeft - (els.grid.clientWidth - card.offsetWidth) / 2;
    if (Math.abs(els.grid.scrollLeft - left) > 2) els.grid.scrollTo({ left, behavior });
    return;
  }
  const r = card.getBoundingClientRect();
  if (r.top < 0 || r.bottom > window.innerHeight) card.scrollIntoView({ block: 'center', behavior });
}

/** The card closest to the middle of the carousel. */
function centeredCard() {
  const mid = els.grid.scrollLeft + els.grid.clientWidth / 2;
  let best = null, dist = Infinity;
  for (const c of els.grid.children) {
    const d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid);
    if (d < dist) { dist = d; best = c; }
  }
  return best;
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
    const content = currentPage() && currentPage().firstElementChild;
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
    const content = currentPage() && currentPage().firstElementChild;
    if (content) content.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(0.97)' }], { duration: 200, fill: 'forwards' });
    els.bar.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: 'forwards' });
  } else {
    anim = els.viewer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: duration(200) });
  }
  await anim.finished.catch(() => {});
  els.viewer.hidden = true;
  els.pager.replaceChildren();
  els.bar.getAnimations().forEach((a) => a.cancel());
  setThemeColor();
}

function recipePage(recipe, index) {
  const { summary, method } = splitDescription(recipe.description);
  const n = recipe.ingredients.length;
  const inner = h('div', { class: 'page-inner' },
    h('h1', { class: 'page-title', 'data-edit': 'title', text: recipe.title }),
    n ? h('p', { class: 'page-sub', 'data-edit': 'ingredients', text: `${plural(n, 'ingredient')} —` }) : null,
    summary ? h('p', { class: 'page-summary', 'data-edit': 'summary', text: summary }) : null);

  // No photo: the recipe's food icon takes the photo's place.
  inner.append(recipe.photos.length ? carousel(recipe)
    : h('div', { class: 'carousel-wrap icon-wrap' }, photoBox(recipe, 'carousel no-photo')));

  // Ingredients and the recipe are always shown; no tap to unfold.
  const details = h('div', { class: 'details' });
  if (n) {
    details.append(h('h3', { class: 'section-title', 'data-edit': 'ingredients', text: 'Ingredients' }),
      h('ul', { class: 'ingredients' }, ...recipe.ingredients.map((item, k) =>
        h('li', { 'data-edit': 'ingredients', 'data-line': k, text: item }))));
  }
  if (method.length) {
    details.append(h('h3', { class: 'section-title', 'data-edit': 'recipe', text: 'Recipe' }),
      h('div', { class: 'method' }, ...method.map((p, k) => h('p', { 'data-edit': 'recipe', 'data-line': k, text: p }))));
  }
  if (!n && !method.length) {
    details.append(h('p', { class: 'fold-empty', 'data-edit': 'ingredients', text: 'No ingredients or recipe yet. Tap here to add them.' }));
  }
  inner.append(details);

  return h('article', { class: `page ${colorClass(recipe)}${recipe.photos.length ? '' : ' no-photo'}`, 'data-index': index }, inner);
}

function plusPage() {
  return h('article', { class: 'page plus-page neutral', 'data-plus': '' },
    h('div', { class: 'plus-wrap' },
      h('div', { class: 'plus-big squircle' }, icon('plus', 56, 1.6)),
      h('p', { class: 'plus-title', text: 'Add a recipe' }),
      h('p', { class: 'plus-sub', text: 'Tap to create a new card' })));
}

function carousel(recipe) {
  // A natively scrolling strip of photos that snaps one photo at a time.
  const box = h('div', { class: 'carousel squircle', 'data-i': '0', 'data-count': recipe.photos.length },
    ...recipe.photos.map((_, k) => h('img', {
      src: photoURL(recipe, k), alt: k === 0 ? recipe.title : '', draggable: 'false', decoding: 'async', loading: k ? 'lazy' : 'eager',
    })));
  if (recipe.photos.length > 1) box.addEventListener('scroll', () => syncDots(box), { passive: true });
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

function setCarousel(box, i) {
  const count = Number(box.dataset.count);
  i = Math.max(0, Math.min(count - 1, i));
  box.scrollTo({ left: i * box.clientWidth, behavior: reducedMotion() ? 'auto' : 'smooth' });
}

/** Keeps the photo dots in step with the photo strip's scroll position. */
function syncDots(box) {
  const i = Math.round(box.scrollLeft / Math.max(1, box.clientWidth));
  if (String(i) === box.dataset.i) return;
  box.dataset.i = i;
  box.parentElement.querySelectorAll('.dot').forEach((d, k) => d.setAttribute('aria-current', String(k === i)));
}

function makePage(i) {
  const n = state.recipes.length;
  if (i < 0 || i > n) return null;
  return i === n ? plusPage() : recipePage(state.recipes[i], i);
}

/* The viewer is one horizontal, natively scrolling strip with a page per recipe (plus the "+" page),
 * snapping one page at a time. Native scrolling is what makes swiping feel right on iOS. */
function currentPage() {
  return els.pager.children[state.viewer.index] || null;
}

function buildPager() {
  const v = state.viewer;
  const pages = [];
  for (let i = 0; i <= state.recipes.length; i++) pages.push(makePage(i));
  els.pager.replaceChildren(...pages);
  scrollToPage(v.index, false);
  fitTitles(els.pager);
}

function scrollToPage(index, smooth) {
  const w = els.pager.clientWidth;
  els.pager.scrollTo({ left: index * w, behavior: smooth && !reducedMotion() ? 'smooth' : 'instant' });
}

/** Which page is (mostly) on screen; updates the toolbar colour as you swipe. */
function onPagerScroll() {
  const v = state.viewer;
  if (!v.open) return;
  const i = Math.round(els.pager.scrollLeft / Math.max(1, els.pager.clientWidth));
  if (i === v.index || i < 0 || i > state.recipes.length) return;
  v.index = i;
  syncViewerBar();
}
let pagerTick = 0;
els.pager.addEventListener('scroll', () => {
  if (pagerTick) return;
  pagerTick = requestAnimationFrame(() => { pagerTick = 0; onPagerScroll(); });
}, { passive: true });

function syncViewerBar() {
  const v = state.viewer;
  const recipe = state.recipes[v.index];
  els.bar.className = `viewer-bar ${recipe ? colorClass(recipe) : 'neutral'}`;
  els.copyBtn.hidden = !recipe;
  els.editBtn.hidden = !recipe;
  if (currentPage()) setThemeColor(currentPage());
}

// Taps: dots switch photos, the "+" page adds a recipe.
els.pager.addEventListener('click', (e) => {
  const dot = e.target.closest('[data-dot]');
  if (dot) {
    setCarousel(dot.closest('.carousel-wrap').querySelector('.carousel'), Number(dot.dataset.dot));
    return;
  }
  const page = e.target.closest('.page');
  if (!page) return;
  if (page.hasAttribute('data-plus')) { openEditor(null); return; }
  // Tapping any text jumps straight into editing that text.
  const target = e.target.closest('[data-edit]');
  const recipe = state.recipes[Number(page.dataset.index)];
  if (target && recipe) {
    openEditor(recipe);
    focusEditorField(target.dataset.edit, target.dataset.line === undefined ? -1 : Number(target.dataset.line));
  }
});

/** Puts the cursor in an editor field: at the end of line/paragraph `line` (or of the whole field).
 *  Runs inside the tap, so iOS also opens the keyboard. */
function focusEditorField(name, line = -1) {
  const field = els.form.elements[name];
  if (!field) return;
  let pos = field.value.length;
  if (line >= 0) {
    const sep = name === 'recipe' ? '\n\n' : '\n';
    const parts = field.value.split(sep);
    if (line < parts.length) pos = parts.slice(0, line + 1).join(sep).length;
  }
  field.focus({ preventScroll: true });
  try { field.setSelectionRange(pos, pos); } catch { /* not a text field */ }
  // Once the sheet has slid up and fields have grown to fit, bring the field into view.
  setTimeout(() => {
    const top = field.getBoundingClientRect().top - els.form.getBoundingClientRect().top + els.form.scrollTop;
    els.form.scrollTo({ top: Math.max(0, top - 120), behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, duration(360));
}

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
  return JSON.stringify([f.title.value, f.summary.value, f.recipe.value, f.ingredients.value, ed.color, ed.photos.map((p) => p.blob.size)]);
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
  const { summary, method } = splitDescription(recipe ? recipe.description : '');
  f.title.value = recipe ? recipe.title : '';
  f.summary.value = summary;
  f.recipe.value = method.join('\n\n');
  f.ingredients.value = recipe ? recipe.ingredients.join('\n') : '';
  els.editorTitle.textContent = recipe ? 'Edit recipe' : 'New recipe';
  els.deleteBtn.hidden = !recipe;
  els.saveBtn.disabled = false;
  els.saveBtn.textContent = 'Save';
  setTitleError('');
  renderPhotoStrip();
  renderSwatches();
  applyEditorColor();
  state.editor.snapshot = editorSnapshot();

  els.form.scrollTop = 0;
  els.editor.hidden = false;
  // Next frame(s): add the class so the slide-up transition runs.
  requestAnimationFrame(() => requestAnimationFrame(() => els.editor.classList.add('is-open')));
  requestAnimationFrame(autosizeAll);
}

/** The editor takes on the colour of the card being edited, and changes live with the swatches. */
function applyEditorColor() {
  const ed = state.editor;
  for (let k = 1; k <= PALETTE_SIZE; k++) els.editor.classList.toggle(`c${k}`, k === ed.color + 1);
  const bg = getComputedStyle(els.editor).getPropertyValue('--c-bg').trim();
  if (bg) els.themeMeta.setAttribute('content', bg);
}

/** Text fields grow with their content, so the page reads like a card rather than a form. */
function autosize(el) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight + 2}px`;
}
function autosizeAll() { els.form.querySelectorAll('textarea').forEach(autosize); }
els.form.addEventListener('input', (e) => { if (e.target.matches('textarea')) autosize(e.target); });
window.addEventListener('resize', () => { if (state.editor) autosizeAll(); });

// The title and short description are single paragraphs: Return moves on instead of adding a line.
els.form.elements.title.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); els.form.elements.summary.focus(); }
});
els.form.elements.summary.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); els.form.elements.ingredients.focus(); }
});

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
  if (state.viewer.open && currentPage()) setThemeColor(currentPage());
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
      'aria-checked': String(k === ed.color), 'aria-label': `Colour ${k + 1}`,
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
  applyEditorColor();
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
  const title = f.title.value.replace(/\s+/g, ' ').trim();
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
    description: [f.summary.value.replace(/\s+/g, ' ').trim(), f.recipe.value.trim()].filter(Boolean).join('\n\n'),
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

/** Adds the bundled starter recipes (starter-recipes.json). Fixed ids mean it never
 *  duplicates: recipes already on the device are skipped, so it's safe to tap twice. */
const OLD_STARTER_STAMP = 1763596800000;
async function addStarterRecipes() {
  let starters;
  try {
    const res = await fetch('starter-recipes.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    starters = parseBackup(await res.json());
  } catch (err) {
    toast('Couldn’t load the starter recipes. Open the app once while online, then try again.', { error: true });
    return;
  }
  // The first starter list (ids "starter-NN") was replaced. Old starters you never edited or
  // added photos to are removed; ones you changed are kept.
  const outdated = state.recipes.filter((r) => /^starter-\d+$/.test(r.id)
    && r.updatedAt === OLD_STARTER_STAMP && !r.photos.length);
  const have = new Set(state.recipes.map((r) => r.id));
  const missing = starters.filter((r) => !have.has(r.id));
  if (!missing.length && !outdated.length) { toast('All starter recipes are already here'); return; }
  try {
    for (const r of outdated) await db.delete(r.id);
    if (missing.length) await db.bulkPut(missing);
    await loadRecipes();
  } catch (err) {
    toast(storageErrorMessage(err, 'add the starter recipes'), { error: true });
    return;
  }
  renderGrid();
  toast(`Added ${plural(missing.length, 'recipe')}`);
}
$('#starter-btn').addEventListener('click', addStarterRecipes);

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

  const styleBtn = (style, label) => {
    const b = h('button', { type: 'button', text: label, 'aria-pressed': String(readNoPhotoStyle() === style) });
    b.addEventListener('click', () => {
      applyNoPhotoStyle(style);
      b.parentNode.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    });
    return b;
  };

  await ask({
    title: 'Recipe Box',
    body: h('div', {},
      h('div', { class: 'zoom-row' }, h('span', { text: 'Card size' }), h('div', { class: 'segmented' }, smaller, bigger)),
      h('div', { class: 'zoom-row' }, h('span', { text: 'No photo' }),
        h('div', { class: 'segmented text', role: 'group', 'aria-label': 'Recipes without a photo show' },
          styleBtn('icon', 'Icon'), styleBtn('title', 'Title'))),
      note),
    actions: [
      { label: 'Export backup', value: 'export', run: () => exportBackup() },
      // The file picker must open synchronously inside the tap (iOS rule), hence `run`.
      { label: 'Import backup', value: 'import', run: () => els.importInput.click() },
      { label: 'Add starter recipes', value: 'starter', run: () => addStarterRecipes() },
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
  if (state.viewer.open) {
    const v = state.viewer;
    if (e.key === 'ArrowRight' && v.index < state.recipes.length) scrollToPage(v.index + 1, true);
    if (e.key === 'ArrowLeft' && v.index > 0) scrollToPage(v.index - 1, true);
  } else if (!state.viewer.open) {
    if (e.key === '+' || e.key === '=') setZoom(state.zoom - 1);
    if (e.key === '-') setZoom(state.zoom + 1);
  }
});

window.addEventListener('resize', () => {
  applyZoom();
  if (state.viewer.open) { scrollToPage(state.viewer.index, false); fitTitles(els.pager); }
});

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  requestAnimationFrame(() => {
    if (state.editor) setThemeColor(els.editor);
    else if (state.viewer.open && currentPage()) setThemeColor(currentPage());
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
  applyNoPhotoStyle(readNoPhotoStyle());
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
