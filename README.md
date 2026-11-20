# Recipe Box

A personal recipe app (PWA). Everything is stored on your phone in IndexedDB. There's no backend and no account.

**Files to upload:** `index.html`, `styles.css`, `app.js`, `manifest.json`, `service-worker.js`, `icons/`
(`visual style.png` and this README don't need to be uploaded.)

## Deploy

The app must be served over **HTTPS**, because service workers and the clipboard require it. Both options below are free.

### Option A: Netlify (easiest)
1. Go to <https://app.netlify.com/drop>.
2. Drag the folder containing the files above onto the page.
3. Netlify gives you a `https://something.netlify.app` URL. You can rename it under *Site settings*.
4. To update later: *Deploys → drag the folder again*.

### Option B: GitHub Pages
1. Create a new repository on GitHub (it can be private if you have Pro; otherwise public).
2. Upload the files (*Add file → Upload files*) to the root of the `main` branch.
3. *Settings → Pages → Build and deployment → Source: Deploy from a branch → `main` / `root` → Save*.
4. After about a minute the site is live at `https://<user>.github.io/<repo>/`. All paths are relative, so the subfolder works.

### Shipping an update
Edit the files, **bump `CACHE_VERSION`** in `service-worker.js` (e.g. `recipe-box-v2`), and redeploy.
Phones pick up the new version in the background; close the app fully and reopen it to see it.
Your recipes are not affected because they live in IndexedDB, not in the cache.

## Install on iPhone
1. Open the URL in **Safari** (it must be Safari, not Chrome).
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Launch it from the home-screen icon. It opens full-screen with no Safari bars.

> Important: home-screen apps on iOS have **their own storage, separate from Safari**. Recipes you add
> in a Safari tab won't appear in the installed app. Always use the home-screen icon.

## Using it
- **Pinch** the grid to zoom: big cards (title, description, photo) ⇄ photo-only tiles. You can also use *⋯ → Card size*.
- **Tap** a card to open it. **Tap** the recipe again to unfold the ingredients and method. **Swipe** left/right between recipes.
- In *Description & method*, the **first paragraph** is the short description shown on the card.
  Leave a blank line and everything after it becomes the method.
- **⋯ → Export backup** saves a single `.json` file with all recipes and photos. Save it to Files or iCloud Drive.

## Test checklist

**Offline**
- [ ] Open the installed app once while online (this caches the app).
- [ ] Turn on Airplane Mode, force-quit the app (swipe it away), and reopen it. The grid and photos should load.
- [ ] While offline: add a recipe with a photo, edit it, delete it. Everything should work.
- [ ] Turn Airplane Mode off.

**Persistence**
- [ ] Add 2–3 recipes with photos. Force-quit the app and reopen it. They should still be there.
- [ ] Restart the iPhone and open the app. The recipes should still be there.
- [ ] Open *⋯*. The storage note shows how much space is used.
- [ ] **Export backup** → *Save to Files*. Check that the file appears in the Files app.
- [ ] Delete a recipe, then **Import backup** → *Add to my recipes*. It should come back and no duplicates should appear.
- [ ] (Optional) Import → *Replace everything* asks a second time before wiping anything.

**Feel**
- [ ] Swiping horizontally pages between recipes, and scrolling vertically never triggers a page change.
- [ ] On a recipe with several photos, swiping the photo moves through the photos first, then on to the next recipe.
- [ ] Swiping past the last recipe shows the “+” page.
- [ ] *Copy ingredients* → paste into Notes gives a `- ` list.
- [ ] Switch iOS to Dark Mode and check that the colours adapt.
- [ ] Turn on *Settings → Accessibility → Motion → Reduce Motion* and check that animations become instant fades.

**Good habit:** iOS can evict website data if the phone runs critically low on storage, and the app asks
for persistent storage to reduce that risk. Still, export a backup now and then.

## Restyling
All colours, radii, gaps and timing are CSS variables at the top of `styles.css`. Card colours are the
`--pairN-bg` / `--pairN-fg` pairs, with separate values for dark mode. `--squircle` sets the photo corner size.
