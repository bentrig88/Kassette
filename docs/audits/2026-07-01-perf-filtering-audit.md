# Kassette — Performance & Filtering Audit (2026-07-01)

Branch: `perf-filtering-audit`. Read-only audit across three domains (filtering/analysis pipeline, React render performance, assets/bundle/network). Every item notes **visual/UX safety**. Ranked into tiers by impact ÷ effort and by whether they change behavior.

Measured baseline: **~16.6 MB** of assets+JS shipped; JS bundle 831 KB raw / 228 KB gzip; images ~15.8 MB.

---

## TIER 1 — High impact, visually/behaviorally neutral (recommended first batch)

### A. Convert images to WebP (saves ~11.6 MB, ~70% of total weight)
- **Cassette body PNGs** (9 files, 6.04 MB → ~1.34 MB, −4.7 MB) — `cwebp -q 90`; update `cassetteAssets.ts` `genreBodyMap`, `LoadingTape.tsx`, `flatten-cassette-body.mjs`. q90 is perceptually lossless at display size; alpha (window cutout) preserved.
- **Genre background JPGs** (8 files, 5.73 MB → ~1.95 MB, −3.8 MB) — `cwebp -q 82 -resize 2000 0`; 2000px keeps the `PARALLAX_SCALE 1.1` + 3% shift headroom. They're blurred + scrim-darkened, so invisible loss.
- **Auth/scene/generic PNGs+JPG** (4.05 MB → ~0.87 MB, −3.2 MB) — `auth-tape.png`, `background-generic.jpg`(=`auth-background.jpg`, deduped by Vite), `loading_tape_back.png`, `object-generic-1/2/3`, `auth-tape-shadow`. Update imports in `AuthIntro/AuthScreen/LoadingScreen/SceneBackground/useAssetPreloader`.
- **Effort:** S each (shell loop + import renames). **Safety:** visually identical at q82–90. Browser support fine (Safari 14+/Chrome 32+).

### B. Kill the analysis re-render cascade (Zustand selector granularity)
On every analyzed track, `addFeatures` makes a new `Map`, which currently ripples through much of the tree during the background pass.
- **`App.tsx:52`** subscribes to `featuresMap` and passes it to `LoadingScreen`, re-rendering App (and thus carousel/player/controller/scene/vhs) on every analysis update. → Move the `featuresMap` subscription *into* `LoadingScreen`; App shouldn't subscribe. **High / S.**
- **`CassettePlayer.tsx:36-56`** destructures the whole store (`usePlayerStore()` with no selector) → the 713-line component re-renders on `currentTime` (2 Hz), every analysis update, every slider drag. → Granular per-field selectors; ideally extract a `TrackDisplay` subcomponent owning `featuresMap`/`normalizer`. **High / S–M.**
- **`PlaylistController.tsx:44`** subscribes to `featuresMap` and `.filter()`s upcoming on every render → subscribe to the `analyzedCount` primitive (or a count selector) instead. **Medium / S.**
- **Safety:** pure selector refactors; identical output.

### C. IndexedDB connection cache + bulk key check (analysis startup)
- **`featureCache.ts`** calls `openDB()` fresh on every read/write. `useBackgroundAnalysis.ts:33-37` then serially `await getFeatures(t.id)` over the **entire library** (up to 3000 sequential round-trips) before the pool even starts. → Memoize one `IDBDatabase` promise at module level; add a bulk `getAllKeys()` existence check (or filter against the in-memory `featuresMap`) so the pre-filter is one call, not N. **Large / S.**
- **Safety:** pure I/O optimization; identical results, background analysis starts near the 10s mark instead of after a long serial drain.

### D. Stop rebuilding the normalizer on every slider tick
- **`appleMusic.ts:236` (`sortTracksByFilters`)** calls `buildNormalizer(featuresMap)` (3 full sorts) + builds a norm cache **on every slider `onChange`** (`PlaylistController.tsx:98`, dozens/sec during drag). The memoized normalizer at `CassettePlayer.tsx:263` isn't reused. → Thread the memoized normalizer in; precompute candidate percentiles once per cassette/featuresMap change. **Large during interaction / M.**
- **Safety:** identical output, smoother sliders.

### E. Cheap render-hot-path fixes
- **`usePreviewAnalysis.ts:28`** — `idKey` (map+sort+join over ~100 tracks) recomputed every `CassettePlayer` render → `useMemo([tracks])`. **S.**
- **`PlaylistController.tsx:77` (`applyAll`)** — 9 deps incl. `queuedTracks`/`featuresMap` recreate the callback (and slider `onChange`s) constantly → read via `usePlayerStore.getState()`, drop reactive deps. **S.**
- **`CassetteCarousel.tsx` `CassetteItem`** — 24 instances, none memoized; all re-render on each nav step → `React.memo` (props are primitives). **S.**
- **`TrackScreen`** rendered via inline IIFE in `CassettePlayer:507` → extract + `React.memo`. **S.**
- **`LoadingScreen.tsx:36`** rebuilds the normalizer on every `featuresMap` change during load (~167 sort cycles) though it's only read in the 450ms tick → read `getState()` in the tick / gate on `analyzedCount`. **S.**
- **Safety:** all identical output.

---

## TIER 2 — Solid wins, neutral, slightly more work or need a quick test

### F. Lazy-load non-active assets (shortens the loading bar)
- **`useAssetPreloader.ts`** eagerly preloads all 9 cassette bodies + all 8 backgrounds. User inserts one genre/session. → Preload only `cassette0` + the initially-focused background; hover/±1-prefetch the rest in `CassetteCarousel`/`GenreBackground`. Cuts critical-path preload from ~4.2 MB (post-WebP) to ~0.4–0.7 MB. **Medium / M.** Safety: images load before they're reachable (wipe/hover cover the decode); add a graceful fallback if one isn't ready.

### G. Worker/analysis throughput
- **`analysisClient.ts`** — 6 fetch/decode lanes funnel into **one** DSP worker (serial FFT). → Small worker pool (`hardwareConcurrency`-bounded) and/or move decode+resample into the worker. ~2× faster full-library coverage, less main-thread jank. **Medium–Large / M–L.** Keep single-worker fallback.
- **`usePreviewAnalysis`/`useBackgroundAnalysis`** each `new AudioContext()` per run and can analyze the **same** track twice. → One shared long-lived context + a module-level in-flight `Set<trackId>` to dedup across the two passes. **Medium / S.**
- Safety: same features, faster.

### H. Bundle/network hygiene
- **`vite.config.ts`** — single 831 KB chunk. Add `manualChunks` (react / framer / lottie / zustand) → better long-term caching, clears the >500 kB warning. **S.** No first-load change.
- **`index.html`** — MusicKit CDN `<script>` is render-blocking → add `defer` (~100–400 ms FCP on slow links). **XS + test** the auth flow (medium confidence).
- **`lottie-web` → `lottie_light` alias** — both our Lotties are pure shape layers (no expressions) → −137 KB raw / −40 KB gzip. **S + visual test** of both animations (medium confidence).
- **Delete `cassette-body-flat-vector.png`** — 353 KB orphan, unimported. **XS.**
- **`matchesGenre`** lowercases `genreNames` per (genre×track) at load → precompute per track once. **S, tiny.**

---

## TIER 3 — Behavior/visual-changing → opt-in, confirm before doing

- **F2 — Real Fisher–Yates shuffle** (`appleMusic.ts:178`): current `sort(() => Math.random()-0.5)` is a biased shuffle (and CLAUDE.md already *claims* Fisher–Yates). Strictly an improvement, but output order changes. **S.** *(Borderline — arguably belongs in Tier 1; only "changes" because randomness differs.)*
- **F1 — Persistent filters across tracks** (`CassettePlayer.tsx:272-281`): auto-snap resets sliders to each new track's values, overriding a user's set filter. Add a "user adjusted" flag to suppress snap. Changes the snap feel (this is the documented future-work fix). **M.**
- **F3 — Slider unlock threshold** (`PlaylistController.tsx:132`): `Math.min(5, upcoming.length)` can enable sliders with too little data to actually sort (normalizer returns neutral 50). Gate on `normalizer.count >= 5`. Enables sliders slightly later. **S.**
- **F6 — 3000-track cap** (`fetchLibraryTracks:85`): silently truncates large libraries. Raise/remove, or surface "showing first 3000 of N". **S–M.**
- **P8 — Pause VHS grain/glitch motion off the auth screen**: biggest continuous repaint; on player/loading it'd become a static overlay (scanlines/vignette unchanged). Mild visual change. **S.**
- **F7 — DSP tuning / tempo confidence / Essentia.js**: quality R&D, changes feature values → changes sort/snap. **L.**
- **Slider debounce/rAF-coalesce** on drag (part of D): behaviorally neutral for the queue but could feel marginally less "live"; prefer rAF-coalescing over a long debounce.

---

## Already optimal (no change)
- Library-relative percentile normalization is conceptually correct.
- `mapPool` bounded-concurrency pool is clean; worker RPC `reqId` correlation is sound.
- Vite hash-dedup of the duplicated `auth-background.jpg`/`background-generic.jpg` works.

## Suggested sequencing
1. **Tier 1 A** (WebP) — biggest single win, isolated, zero risk.
2. **Tier 1 B + C** (render cascade + IDB) — the runtime responsiveness wins during analysis.
3. **Tier 1 D + E** — filtering interaction smoothness + cheap hot-path fixes.
4. **Tier 2** as desired (F lazy-load pairs naturally with the WebP work; H is quick hygiene).
5. **Tier 3** only after you pick which behavior changes you actually want.
