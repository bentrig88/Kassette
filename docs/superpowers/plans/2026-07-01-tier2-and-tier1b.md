# Tier 2 + Tier 1B Optimizations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship the audit's Tier 2 wins (bundle hygiene, analysis throughput, conservative asset lazy-loading, MusicKit `defer` + `lottie_light`) plus the two deferred Tier 1B refactors (extract `TrackDisplay`, `applyAll` via `getState`) — all visually/behaviorally identical, except two items the user will verify in-browser.

**Architecture:** Independent optimizations: (1) Vite `manualChunks` + orphan/genre-match cleanup; (2) an analysis worker pool + shared `AudioContext` + cross-pass dedup; (3) drop genre backgrounds from eager preload and prefetch the current/adjacent ones in `GenreBackground`; (4) extract the LCD into a `TrackDisplay` that owns the `featuresMap` subscription so the player shell stops re-rendering on analysis; (5) `applyAll` reads via `usePlayerStore.getState()` to drop its dep cascade; (6) `defer` the MusicKit script + alias `lottie-web` → `lottie_light`.

**Tech Stack:** Vite + React 19 + TS (`verbatimModuleSyntax` on), Zustand v5, Framer Motion, `lottie-react` (bundles `lottie-web`), MusicKit JS v3 (CDN). `lottie_light` builds exist at `node_modules/lottie-web/build/player/lottie_light.min.js`.

## Global Constraints

- `verbatimModuleSyntax` is ON — type-only imports MUST use `import type`.
- **No test runner.** ONLY gates: `npm run build` (`tsc -b && vite build`) and `npm run lint` (`eslint .`), both exit 0. No TDD/test framework. Each task has a manual visual note.
- **Visually/behaviorally identical** is required for every task EXCEPT Task 6 (MusicKit `defer` + `lottie_light`), which the user will verify in-browser (auth connect flow + both intro Lottie animations) — flag those verification steps explicitly.
- Conservative lazy-load (Task 3): keep ALL cassette bodies + player/auth/scene/loader assets eagerly preloaded; only genre tape-selection backgrounds move to on-demand. The `GenreBackground` fade-in (0.4s) covers a brief first-photo load; prefetch adjacent (±1) so navigation is seamless.
- `src/assets/player/*` untouched.
- Commit after each task. Do NOT push. Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Anchor edits on quoted code strings, not line numbers (earlier tasks shift lines).

---

### Task 1: Safe bundle hygiene — manualChunks, orphan cleanup, genre-match micro-opt

**Files:**
- Modify: `vite.config.ts`
- Delete: `src/assets/tapes/cassette-body-flat-vector.png`
- Modify: `src/services/appleMusic.ts` (`matchesGenre`)

- [ ] **Step 1: Add `manualChunks` to `vite.config.ts`**

Replace the whole config with:
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-framer': ['framer-motion'],
          'vendor-lottie': ['lottie-react'],
          'vendor-zustand': ['zustand'],
        },
      },
    },
  },
})
```

- [ ] **Step 2: Delete the orphan PNG**

```bash
cd /Users/benjamintrigalou/github.com/Kassette
git rm src/assets/tapes/cassette-body-flat-vector.png
```
(Confirmed unimported — grep `src` for `cassette-body-flat-vector` returns nothing before deleting.)

- [ ] **Step 3: Precompute lowercased genres in `matchesGenre`**

Current (`appleMusic.ts`):
```ts
function matchesGenre(track: Track, genre: Genre): boolean {
  const keywords = GENRE_KEYWORDS[genre]
  const trackGenres = track.genreNames.map((g) => g.toLowerCase())
  return keywords.some((kw) => trackGenres.some((tg) => tg.includes(kw)))
}
```
The `buildCassettes` loop calls this 8× per track, re-lowercasing each time. Refactor so lowercasing happens once per track. Change `matchesGenre` to accept pre-lowercased genres, and lowercase once in `buildCassettes`:
```ts
function matchesGenre(lowerGenres: string[], genre: Genre): boolean {
  const keywords = GENRE_KEYWORDS[genre]
  return keywords.some((kw) => lowerGenres.some((tg) => tg.includes(kw)))
}
```
In `buildCassettes`, replace the per-genre `tracks.filter((t) => matchesGenre(t, genre))` with a single pass that lowercases each track's genres once:
```ts
export function buildCassettes(tracks: Track[]): Cassette[] {
  const lowered = tracks.map((t) => ({ track: t, lower: t.genreNames.map((g) => g.toLowerCase()) }))
  const cassettes: Cassette[] = []
  for (const genre of GENRES) {
    const matched = lowered.filter((x) => matchesGenre(x.lower, genre)).map((x) => x.track)
    if (matched.length > 0) {
      cassettes.push({ id: genre, genre, tracks: matched, color: GENRE_COLORS[genre] })
    }
  }
  return cassettes
}
```
(Output is identical — same tracks matched per genre, same order.)

- [ ] **Step 4: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: both exit 0. The build output should now show separate `vendor-*` chunks and NO ">500 kB chunk" warning (or a smaller main chunk).

- [ ] **Step 5: Commit**

```bash
git add vite.config.ts src/services/appleMusic.ts
git commit -m "Bundle: manualChunks vendor split, drop orphan PNG, precompute genre lowercasing"
```

---

### Task 2: Analysis throughput — worker pool + shared AudioContext + cross-pass dedup

**Files:**
- Create: `src/lib/analysisShared.ts`
- Modify: `src/services/analysisClient.ts` (worker pool)
- Modify: `src/hooks/usePreviewAnalysis.ts`, `src/hooks/useBackgroundAnalysis.ts` (shared ctx + dedup)

**Interfaces:**
- Produces: `getSharedAudioContext(): AudioContext`, `beginAnalysis(id: string): boolean`, `endAnalysis(id: string): void` from `analysisShared.ts`.

- [ ] **Step 1: Create `src/lib/analysisShared.ts`**

```ts
// Shared analysis resources so the active-queue pass and the background pass
// don't each spin up their own AudioContext or double-analyze the same track.

let ctx: AudioContext | null = null

/** One long-lived AudioContext for decoding preview clips (never closed). */
export function getSharedAudioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext()
  return ctx
}

const inFlight = new Set<string>()

/** Claim a track for analysis. Returns false if another pass is already on it. */
export function beginAnalysis(id: string): boolean {
  if (inFlight.has(id)) return false
  inFlight.add(id)
  return true
}

/** Release a track once analysis (or its failure) is done. */
export function endAnalysis(id: string): void {
  inFlight.delete(id)
}
```

- [ ] **Step 2: Worker pool in `analysisClient.ts`**

Replace the single-worker `getWorker()` + module state with a small pool. Keep the global `pending` map keyed by `reqId` (unique across the pool) and route responses via each worker's own `onmessage`:
```ts
const POOL_SIZE = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1))
let workers: Worker[] | null = null
let rr = 0

function makeWorker(): Worker {
  const w = new Worker(new URL('../workers/analysis.worker.ts', import.meta.url), { type: 'module' })
  w.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const { reqId, features, error } = e.data
    const entry = pending.get(reqId)
    if (!entry) return
    pending.delete(reqId)
    if (features) entry.resolve(features)
    else entry.reject(new Error(error ?? 'analysis failed'))
  }
  w.onerror = (e) => {
    // A worker-level failure can't be tied to one request — fail them all.
    for (const { reject } of pending.values()) reject(e.error ?? new Error('analysis worker error'))
    pending.clear()
  }
  return w
}

function nextWorker(): Worker {
  if (!workers) workers = Array.from({ length: POOL_SIZE }, makeWorker)
  const w = workers[rr % workers.length]
  rr += 1
  return w
}
```
Then in `analyzeAudioBuffer`, replace `getWorker().postMessage(...)` with `nextWorker().postMessage(...)`. Remove the old `worker`/`getWorker` singleton. Keep `toMonoPCM`, the `pending` map, `seq`, and the transfer list `[samples.buffer]` unchanged.

- [ ] **Step 3: Use the shared context + dedup in `usePreviewAnalysis.ts`**

Add `import { getSharedAudioContext, beginAnalysis, endAnalysis } from '../lib/analysisShared'`. Replace `const audioCtx = new AudioContext()` with `const audioCtx = getSharedAudioContext()` and REMOVE the `await audioCtx.close().catch(() => {})` line (the shared context is never closed). Wrap the per-track work in the mapPool body with the dedup guard:
```ts
      await mapPool(uncached, CONCURRENCY, async (track) => {
        const url = previewMap.get(track.id)
        if (!url) return
        if (!beginAnalysis(track.id)) return   // another pass owns it
        try {
          const res = await fetch(url)
          if (!res.ok) return
          const arrayBuffer = await res.arrayBuffer()
          const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
          const features = await analyzeAudioBuffer(track.id, audioBuffer)
          await setFeatures(features)
          addFeatures(features)
        } catch {/* skip on CORS or decode error */}
        finally { endAnalysis(track.id) }
      }, () => cancelled)
```

- [ ] **Step 4: Same in `useBackgroundAnalysis.ts`**

Add the same import. Replace `const audioCtx = new AudioContext()` with `const audioCtx = getSharedAudioContext()` and remove the `await audioCtx.close().catch(() => {})`. Add the dedup guard to its mapPool body (it already re-checks `getFeatures` — keep that; add `beginAnalysis`/`endAnalysis` around the work):
```ts
      await mapPool(uncached, CONCURRENCY, async (track) => {
        if (await getFeatures(track.id) !== null) return
        const url = previewMap.get(track.id)
        if (!url) return
        if (!beginAnalysis(track.id)) return
        try {
          const res = await fetch(url)
          if (!res.ok) return
          const buf = await audioCtx.decodeAudioData(await res.arrayBuffer())
          const features = await analyzeAudioBuffer(track.id, buf)
          await setFeatures(features)
          addFeatures(features)
        } catch {/* skip on CORS or decode error */}
        finally { endAnalysis(track.id) }
      }, () => cancelled)
```

- [ ] **Step 5: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: both exit 0.

- [ ] **Step 6: Manual verification note**

Analysis correctness needs a live run (Apple Music): after insert, the LCD `BPM/NRG/MOOD` still populates for the active cassette, and the background pass still fills the rest (watch the `[Kassette] Background analysis: N tracks` log). Results identical, just faster / no duplicate work.

- [ ] **Step 7: Commit**

```bash
git add src/lib/analysisShared.ts src/services/analysisClient.ts src/hooks/usePreviewAnalysis.ts src/hooks/useBackgroundAnalysis.ts
git commit -m "Analysis: worker pool + shared AudioContext + cross-pass dedup"
```

---

### Task 3: Conservative lazy-load of genre backgrounds

Drop the 8 genre tape-selection backgrounds from the eager preload set (they're not shown during the loading screen), and prefetch the current + adjacent (±1) ones in `GenreBackground` so browsing stays seamless. Cassette bodies and everything else stay eager.

**Files:**
- Modify: `src/hooks/useAssetPreloader.ts`
- Modify: `src/components/GenreBackground.tsx`

- [ ] **Step 1: Remove genre backgrounds from the eager preload**

In `useAssetPreloader.ts`, remove `genreBackgroundMap` from the imports and from the `urls` array. The `urls` set should still include all `PlayerAssets`, all `CassetteAssets` (bodies + reels), `cassette0`, `bgGeneric`, `obj1/2/3`, `authBg`, `logoUrl`. Delete the `import { genreBackgroundMap } from '../assets/background/genreBackgrounds'` line and the `...Object.values(genreBackgroundMap),` spread.

- [ ] **Step 2: Prefetch current + adjacent backgrounds in `GenreBackground.tsx`**

Add an effect that preloads the focused genre's background and its ±1 neighbors (ring wrap) whenever the focused index changes. `backgroundForGenre` is ALREADY imported — the effect needs nothing new from that module (do NOT add `genreBackgroundMap`). Add, after the existing parallax `useEffect`:
```ts
  // Prefetch the focused background + its ring neighbors so navigation is
  // seamless (these are no longer eagerly preloaded during the loading screen).
  useEffect(() => {
    if (n === 0) return
    for (const di of [0, -1, 1]) {
      const g = cassettes[((selectedIndex + di) % n + n) % n]?.genre
      const url = g ? backgroundForGenre(g) : null
      if (url) { const img = new Image(); img.src = url }
    }
  }, [cassettes, selectedIndex, n])
```

- [ ] **Step 3: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: both exit 0. No unused-import warning for `genreBackgroundMap`.

- [ ] **Step 4: Manual visual note**

`npm run dev` → sign in. The loading screen should still complete (it no longer waits on the 8 backgrounds). On the tape-selection view, the focused genre's photo appears (its 0.4s fade covers the brief first load), and arrow/drag navigation to adjacent genres shows their photos with no lag (prefetched).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAssetPreloader.ts src/components/GenreBackground.tsx
git commit -m "Lazy-load genre backgrounds (prefetch current + adjacent), off the loader critical path"
```

---

### Task 4: Extract `TrackDisplay` so the player shell stops re-rendering on analysis

The now/next LCD needs `featuresMap` (which gets a new `Map` on every analyzed track). Today `CassettePlayer` subscribes to `featuresMap` directly, so the whole 713-line shell re-renders during the background-analysis pass. Move the `featuresMap` subscription + meta computation into a dedicated `TrackDisplay` component; the shell passes only track + time props and no longer subscribes to `featuresMap`.

**Files:**
- Create: `src/components/TrackDisplay.tsx`
- Modify: `src/components/CassettePlayer.tsx`

**Interfaces:**
- Consumes: `TrackScreen`, `ScreenTrack`/`ScreenMeta` from `./TrackScreen`; `buildNormalizer` from `../services/featureNormalize`; `usePlayerStore`; `TrackFeatures` type.
- Produces: `TrackDisplay(props: { currentTrack: Track | undefined; nextTrack: Track | undefined; currentTime: number; duration: number; progress: number }): JSX.Element`.

- [ ] **Step 1: Create `src/components/TrackDisplay.tsx`**

```tsx
import { memo, useMemo } from 'react'
import { usePlayerStore } from '../store/playerStore'
import { buildNormalizer } from '../services/featureNormalize'
import { TrackScreen } from './TrackScreen'
import type { Track } from '../types/music'
import type { TrackFeatures } from '../services/featureCache'

interface Props {
  currentTrack: Track | undefined
  nextTrack: Track | undefined
  currentTime: number
  duration: number
  progress: number
}

/**
 * Owns the featuresMap subscription + normalizer so the player shell doesn't
 * re-render on every analyzed track. Renders the shared now/next LCD.
 */
function TrackDisplayBase({ currentTrack, nextTrack, currentTime, duration, progress }: Props) {
  const featuresMap = usePlayerStore((s) => s.featuresMap)
  const normalizer = useMemo(() => buildNormalizer(featuresMap), [featuresMap])

  const currentFeatures: TrackFeatures | undefined = currentTrack ? featuresMap.get(currentTrack.id) : undefined
  const currentNorm = currentFeatures ? normalizer.normalize(currentFeatures) : undefined
  const nextFeatures: TrackFeatures | undefined = nextTrack ? featuresMap.get(nextTrack.id) : undefined
  const nextNorm = nextFeatures ? normalizer.normalize(nextFeatures) : undefined

  return (
    <TrackScreen
      now={currentTrack ? { name: currentTrack.name, artistName: currentTrack.artistName } : null}
      nowTime={currentTime}
      nowDuration={duration}
      nowProgress={progress}
      nowMeta={currentFeatures && currentNorm
        ? { bpm: currentFeatures.bpm, nrg: currentNorm.energy, mood: currentNorm.mood }
        : null}
      next={nextTrack ? { name: nextTrack.name, artistName: nextTrack.artistName } : null}
      nextMeta={nextFeatures && nextNorm
        ? { bpm: nextFeatures.bpm, nrg: nextNorm.energy, mood: nextNorm.mood }
        : null}
    />
  )
}

export const TrackDisplay = memo(TrackDisplayBase)
```

- [ ] **Step 2: In `CassettePlayer.tsx`, remove the featuresMap/normalizer/meta from the shell**

Delete these lines (they move into `TrackDisplay`):
```ts
  const featuresMap = usePlayerStore((s) => s.featuresMap)
  // Library-relative normalizer — rebuilt as analysis fills in more tracks.
  const normalizer = useMemo(() => buildNormalizer(featuresMap), [featuresMap])
```
```ts
  const currentFeatures: TrackFeatures | undefined = currentTrack ? featuresMap.get(currentTrack.id) : undefined
  const currentNorm = currentFeatures ? normalizer.normalize(currentFeatures) : undefined
```
Keep `displayQueue`, `usePreviewAnalysis(displayQueue)`, `currentTrack`, `nextTrack`, `progress`, and the `currentTime`/`duration` selectors (the shell still uses `currentTime` for rewind and computes `progress`).

- [ ] **Step 3: Update the snap effect to read featuresMap via getState**

The slider auto-snap effect currently reads `featuresMap`/`normalizer` from the shell. Change it to read the store imperatively (runs only on `currentTrack.id` change, so building a normalizer here is cheap):
```ts
  // Snap sliders to current track's features (library-relative) on track change
  useEffect(() => {
    if (!currentTrack) return
    const fm = usePlayerStore.getState().featuresMap
    const f = fm.get(currentTrack.id)
    if (!f) return
    const n = buildNormalizer(fm).normalize(f)
    setTempoFilter(n.pace)
    setEnergyFilter(n.energy)
    setMoodFilter(n.mood)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id, setTempoFilter, setEnergyFilter, setMoodFilter])
```
(`buildNormalizer` and `usePlayerStore` are already imported in `CassettePlayer`.)

- [ ] **Step 4: Replace the inline `<TrackScreen>` IIFE with `<TrackDisplay>`**

Add `import { TrackDisplay } from './TrackDisplay'` near the other component imports. Replace the whole `{(() => { const nextFeatures = … return (<TrackScreen … />) })()}` block with:
```tsx
      <TrackDisplay
        currentTrack={currentTrack}
        nextTrack={nextTrack}
        currentTime={currentTime}
        duration={duration}
        progress={progress}
      />
```
If removing the IIFE leaves `TrackScreen` unimported/unused in `CassettePlayer`, remove its now-unused `import { TrackScreen }` line (TrackDisplay imports it now). Verify `TrackFeatures` is still used elsewhere in `CassettePlayer`; if not, remove its unused import too.

- [ ] **Step 5: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: both exit 0. No unused-import/var errors (`featuresMap`, `normalizer`, `currentFeatures`, `currentNorm`, possibly `TrackScreen`/`TrackFeatures`, `useMemo` if now unused in the shell — check and remove any that became unused).

- [ ] **Step 6: Manual visual note**

`npm run dev` → player LCD must be identical: NOW/NEXT title/artist/time/progress + `BPM/NRG/MOOD`, the "NO DATA"/"—" placeholders, and slider auto-snap on track change. The change is a re-render optimization only.

- [ ] **Step 7: Commit**

```bash
git add src/components/TrackDisplay.tsx src/components/CassettePlayer.tsx
git commit -m "Extract TrackDisplay; player shell no longer re-renders on analysis updates"
```

---

### Task 5: `applyAll` reads via `getState()` to break its dependency cascade

`applyAll` in `PlaylistController` has 9 reactive deps (incl. `queuedTracks`, which it also sets), so it — and the `handleTempo/Energy/Mood` handlers and the Slider `onChange` props — get recreated on every slider drag and analysis update. Read the needed state via `usePlayerStore.getState()` inside the callback so it can have a minimal dep set.

**Files:**
- Modify: `src/components/PlaylistController.tsx`

- [ ] **Step 1: Rewrite `applyAll` to read state imperatively**

Replace the `applyAll` `useCallback` body's store reads with `usePlayerStore.getState()` and shrink the dep array. The current callback reads `isInserted, playbackState, queuedTracks, currentTrackIndex, currentCassette, baseQueue, featuresMap` (reactive) and calls `setQueuedTracks`/`setCurrentTrackIndex`. New version:
```ts
  const applyAll = useCallback(
    (tempo: number, energy: number, mood: number, subs: string[], rebuildNow = false) => {
      const s = usePlayerStore.getState()
      if (!s.isInserted) return

      const rebuild = rebuildNow && s.playbackState === 'stopped'
      const played = rebuild ? [] : s.queuedTracks.slice(0, s.currentTrackIndex + 1)
      const playedIds = new Set(played.map((t) => t.id))

      const pool = subs.length > 0
        ? (s.currentCassette?.tracks ?? [])
        : (s.baseQueue.length > 0 ? s.baseQueue : (s.currentCassette?.tracks ?? []))
      if (pool.length === 0) return

      let candidates = pool.filter((t) => !playedIds.has(t.id))
      if (subs.length > 0) candidates = candidates.filter((t) => t.genreNames.some((g) => subs.includes(g)))
      const sortedUpcoming = sortTracksByFilters(candidates, s.featuresMap, tempo, energy, mood, buildNormalizer(s.featuresMap))
      s.setQueuedTracks([...played, ...sortedUpcoming])

      if (rebuild) s.setCurrentTrackIndex(0)
    },
    [],
  )
```
Notes:
- Reading everything from `getState()` means the callback is stable (empty deps) and always sees the latest committed state — behavior identical to the reactive version, since `applyAll` is only ever invoked from event handlers (slider/subgenre change), never during render.
- `buildNormalizer(s.featuresMap)` here matches Task-5-Tier-1's threading (build once per call from the same `featuresMap`). If a memoized `normalizer` is still in scope from the earlier Tier-1 change, you may pass that instead — but since the callback now avoids reactive deps, building from `s.featuresMap` inside keeps it self-contained and correct. Do NOT reintroduce a reactive `normalizer` dep.
- The empty dep array is intentional; if `react-hooks/exhaustive-deps` complains, add `// eslint-disable-next-line react-hooks/exhaustive-deps` above the `[]` (matches the codebase convention).

- [ ] **Step 2: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: both exit 0.

- [ ] **Step 3: Manual visual note**

`npm run dev` → sliders + subgenre dropdown must re-sort the upcoming queue exactly as before; the "now"-refresh-when-stopped behavior on subgenre change must still fire; the "N analyzed"/disabled gate unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/components/PlaylistController.tsx
git commit -m "PlaylistController: applyAll reads via getState (drop dep cascade)"
```

---

### Task 6: `defer` the MusicKit script + alias `lottie-web` → `lottie_light` (USER-VERIFIED)

Both reduce load cost but touch the auth-critical MusicKit load and the Lottie renderer, so they can't be verified headlessly — the user confirms in-browser.

**Files:**
- Modify: `index.html`
- Modify: `vite.config.ts`

- [ ] **Step 1: `defer` the MusicKit CDN script**

In `index.html`, change:
```html
    <script src="https://js-cdn.music.apple.com/musickit/v3/musickit.js" crossorigin></script>
```
to:
```html
    <script src="https://js-cdn.music.apple.com/musickit/v3/musickit.js" crossorigin defer></script>
```
(`defer` lets HTML parsing continue; the script still executes before `DOMContentLoaded` and before the `type="module"` app script that uses `window.MusicKit`.)

- [ ] **Step 2: Alias `lottie-web` to the light build**

In `vite.config.ts`, add a `resolve.alias` (alongside the `build` block from Task 1):
```ts
  resolve: {
    alias: {
      'lottie-web': 'lottie-web/build/player/lottie_light.min.js',
    },
  },
```
(Both intro Lotties are pure shape layers with no AE expressions, so the light build renders them identically — but this must be visually confirmed.)

- [ ] **Step 3: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: both exit 0.

- [ ] **Step 4: Manual verification (REQUIRED — user confirms before trusting this task)**

`npm run dev` and confirm BOTH:
1. **Auth connect flow** — the "Connect with Music" button opens the MusicKit auth popup and the connect→reload→library-load path works (the `defer` didn't break `window.MusicKit` availability).
2. **Both intro Lottie animations** — `logo_loading` loops and `logo_reveal` plays (with correct brand colors) through the pre-auth loader, unchanged by the `lottie_light` renderer.
Report the outcome; if either regresses, revert the offending change (they're independent — the `index.html` line and the alias).

- [ ] **Step 5: Commit**

```bash
git add index.html vite.config.ts
git commit -m "defer MusicKit script + alias lottie-web to lottie_light (user-verified)"
```

---

## Notes for the implementer / reviewer

- Tasks 1–5 must be visually/behaviorally identical. Task 6 is the only one with in-browser verification gating trust (auth + Lottie) — do not treat its manual step as optional.
- No test runner — build + lint + the manual notes are the gates.
- Tasks touch overlapping large files across the set (`appleMusic.ts`, `PlaylistController.tsx`, `CassettePlayer.tsx`) but never the same lines in the same task; anchor on quoted strings.
- Task 4 (TrackDisplay) and the earlier Tier-1 `TrackScreen` extraction compose: `TrackScreen` stays the presentational LCD; `TrackDisplay` is the data wrapper that owns `featuresMap`.
