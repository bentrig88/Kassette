# Loading Screen Redesign — Design Spec

**Date:** 2026-07-01
**Status:** Approved, ready for planning
**Figma:** file `kpieuG5gz88n5VO4Yy8UVZ` — state 1 = node `75:136` (tape on red), state 2 = node `75:15` (tape on concrete + heading + shadow + bar)

## Goal

Replace the plain "Loading your library…" card (the `isLoading` branch in `App.tsx`)
with a two-state animated loading screen: a floating red `cassette0` tape — spinning
reels, live now/next LCD, kassette logo, loading bar — that fades in on a solid red
field (**state 1**), then the red crossfades to the concrete background while a
drop-shadow, heading text, and the loading bar appear (**state 2**). The screen holds
in state 2 until the library **and** all UI assets are ready, then crossfades to the
player.

## User-approved decisions

1. **LCD meta data (BPM/NRG/MOOD):** real if cached (from `featuresMap` + normalizer),
   otherwise random placeholder numbers. Song name + artist are real, pulled from the
   library as it streams in.
2. **State 1 → state 2 transition:** after a short intro (~1s). Tape fades in on red,
   brief beat, then crossfade to concrete + shadow/text/bar appear; holds for the rest
   of loading.
3. **Reveal gate:** wait for BOTH the library fetch AND all asset preloading before
   revealing the player (no asset pop-in later).
4. **Loading bar:** combined readiness — `0.5·(library%) + 0.5·(asset%)`; reaches 100%
   as the player is about to appear.
5. **Exit:** simple crossfade (loading screen fades out, player fades in).

## Architecture

A dedicated `LoadingScreen` orchestrator owns a small phase machine and feeds a
presentational `LoadingTape`, which in turn reuses the **exact** now/next LCD component
(`TrackScreen`) shared with `CassettePlayer`. Asset preloading runs in parallel via a
hook. The library fetch is extended to stream partial tracks so the LCD shows real
songs in real time. `App.tsx` gates the player reveal on a combined "loading complete"
signal.

### Component / file structure

- **`src/components/TrackScreen.tsx`** *(new — extracted from `CassettePlayer`)*
  Purely presentational now/next LCD. No store access. Props:
  - `now: { name: string; artistName: string } | null`
  - `nowTime: number`, `nowDuration: number`, `nowProgress: number` (0–1)
  - `nowMeta: { bpm: number; nrg: number; mood: number } | null`
  - `next: { name: string; artistName: string } | null`
  - `nextMeta: { bpm: number; nrg: number; mood: number } | null`
  Renders the existing `.np-screen*` markup + classes verbatim (NEXT column, divider,
  NOW column, glass reflection). Uses `A.imgLine14` separator and a local `formatTime`.
  `CassettePlayer` is refactored to render `<TrackScreen … />` with its real player
  data — same visual output, no behavior change.

- **`src/components/LoadingTape.tsx`** *(new)*
  The `cassette0-body-flat.png` composition, mirroring `CassetteTapeBody`'s layer stack
  under a `.loading-tape` scope:
  - reels (`imgLeftReelTape`/`imgRightReelTape`) behind the body, endless CW spin via a
    self-contained `requestAnimationFrame` loop (~90°/s, i.e. reelSpeed ≈ 1);
  - body PNG (`cassette0-body-flat.png`);
  - `ct-window` (CSS);
  - `logo.svg` (from `src/assets/misc/`) bottom-left;
  - `<TrackScreen>` scaled into the tape's LCD area via a wrapper (`transform: scale()`);
  - a loading bar near the bottom.
  Props: `progress: number` (0–1), plus the `TrackScreen` data (`now`, `next`, metas,
  time/duration/progress). No genre sticker (unlike `CassetteTapeBody`).

- **`src/hooks/useAssetPreloader.ts`** *(new)*
  Collects every image URL from `playerAssets`, `cassetteAssets` (all body PNGs + reel
  SVGs), `genreBackgrounds` (`genreBackgroundMap`), the background objects/generic, and
  `misc/logo`. Preloads each via `new Image()`. Returns `{ progress: number (0–1), done: boolean }`.
  A failed load counts as loaded (never blocks), and a safety timeout (e.g. 15s) forces
  `done = true` so the screen can never hang.

- **`src/components/LoadingScreen.tsx`** *(new — orchestrator)*
  Props:
  - `libraryProgress: number` (0–100)
  - `libraryDone: boolean`
  - `tracksPool: Track[]` (grows as the library streams in)
  - `featuresMap: Map<string, TrackFeatures>`
  - `onComplete: () => void`
  Behavior:
  - **Phase machine:** `'red'` on mount → after ~1000ms → `'concrete'`.
  - **Background:** red field (state 1) crossfades to `auth-background.jpg` concrete
    (state 2) on entering `'concrete'`.
  - **Tape:** drifts using the carousel pattern — Framer keyframes
    `x: [x1, x2]`, `y: [y1, y2]`, `rotate: [r1, r2]`, each `repeat: Infinity`,
    `repeatType: 'reverse'`, staggered 3–5s durations. Drop-shadow (`filter:
    drop-shadow(...)`) animates from none → full on entering `'concrete'`.
  - **Heading:** fades in with `'concrete'` — "LOADING YOUR LIBRARY" (small, red,
    Afacad 700 uppercase) above "BUILDING YOUR KASSETTES" (large, dark, Afacad 700
    uppercase).
  - **LCD cycling:** every ~450ms, pick a random `now` and `next` track from
    `tracksPool` (if non-empty); meta = normalize(featuresMap.get(id)) if cached, else
    freshly-random `{bpm 60–180, nrg 0–100, mood 0–100}`. `nowProgress`/time can be
    randomized or fixed (visual only).
  - **Loading bar:** `progress = 0.5·(libraryProgress/100) + 0.5·(assetProgress)`
    from `useAssetPreloader`, passed to `LoadingTape`.
  - **Completion:** call `onComplete()` once `libraryDone && assetDone && phase === 'concrete'`
    (the ~1s intro guarantees a minimum display so a fast load never flashes).

### Wiring changes

- **`src/services/appleMusic.ts`** — extend `fetchLibraryTracks`'s `onProgress`
  signature to `(loaded: number, total: number, tracksSoFar: Track[])`, passing the
  accumulating `tracks` array on each tick (and firing at least once on the first
  batch) so the LCD can show real songs as they arrive.

- **`src/App.tsx`**
  - Replace the inline `.loading-screen` card markup with `<LoadingScreen …>`.
  - Add state: `loadingComplete: boolean` and `tracksSoFar: Track[]`.
  - In `loadLibrary`, the fetch callback updates both `loadingProgress` and `tracksSoFar`.
  - Show `<LoadingScreen>` while `isAuthenticated && !error && !loadingComplete`; on
    `onComplete`, set `loadingComplete = true` and crossfade to the player.
  - Pass `libraryDone` = `!isLoading && loadingProgress >= 100` (or a dedicated flag).
  - Reset `loadingComplete = false` (and `tracksSoFar = []`) on sign-out.
  - Error branch unchanged: a fetch error still routes to the existing error card
    (LoadingScreen unmounts).

- **`src/index.css`** — add `.loading-*` styles: background layers (red + concrete
  crossfade), heading typography, the `TrackScreen` scale wrapper inside the tape, and
  the loading bar. Reuse the existing `.ct-*` reel/body/window rules.

## Data flow

```
auth
  └─ App.loadLibrary
       └─ fetchLibraryTracks(onProgress → setLoadingProgress + setTracksSoFar)
            └─ resolve → buildCassettes + setAllTracks + libraryDone

App renders <LoadingScreen> throughout:
  - preloads all UI assets in parallel (useAssetPreloader)
  - cycles real tracks from tracksSoFar into the LCD
  - phase red → (1s) → concrete
  - when libraryDone && assetDone && phase===concrete → onComplete()
       └─ App: loadingComplete = true → crossfade to player
```

## Error handling

- **Library fetch error:** existing behavior — `error` set, `<LoadingScreen>` unmounts,
  the error card renders with a "Try again" button.
- **Asset preload failures:** counted as loaded; never block the reveal.
- **Preload hang:** safety timeout forces `done = true`.
- **Fast load:** the ~1s intro phase guarantees a minimum display so the animation
  never flashes.

## Testing

- Mostly visual — full flow needs Apple Music auth and a live browser (flag for manual
  verification, as with prior Figma work).
- Unit-testable pure units:
  - `useAssetPreloader` progress math (N loaded / total, failures count, timeout).
  - Combined-progress calculation (`0.5·lib + 0.5·asset`).
  - Random-meta generator (ranges, real-if-cached branch).
  - `TrackScreen` render with given props (snapshot / presence of NOW + NEXT fields).
- Gates: `npm run build` (tsc -b && vite build) and `npm run lint` must pass.

## Out of scope / notes

- Exact placement of the LCD, logo, and loading bar within the tape coordinate space
  needs a browser tuning pass after the plan lands (the plan gets it close).
- SFX preloading is not included (only images cause visible pop-in). Can be added later.
- No change to the analysis pipeline or the player itself beyond the `TrackScreen`
  extraction refactor.
