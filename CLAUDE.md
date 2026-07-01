# Kassette — Project Brief & Development Log

## Concept
An online Cassette Tape Player connected to the user's Apple Music library.
The UI consists of three zones stacked vertically:
1. **Cassette Carousel** — genre cassettes float across the top, the user drags or uses arrow keys to browse and clicks "Insert Tape" to load one into the player.
2. **Cassette Player** — a hardware-inspired player with VU meter, volume slider, LCD track display, audio quality selector, and transport controls.
3. **Playlist Controller** — three sliders (Pace, Energy, Mood) that will filter the queue in Phase 2.

---

## Tech Stack
- **Vite + React 19 + TypeScript** (`verbatimModuleSyntax` enabled — always use `import type` for type-only imports)
- **Zustand v5** — state management
- **Framer Motion v12** — carousel drag + cassette insert animation
- **MusicKit JS v3** — loaded via CDN script tag in `index.html` (NOT via npm)
- **Web Audio API** — tape quality filter (low-pass) + VU meter simulation
- **lottie-react** — plays the pre-auth loader Lottie animations
- Custom type declarations in `src/types/musickit.d.ts` for MusicKit v3 API

---

## Project Structure
```
src/
  types/
    musickit.d.ts       MusicKit v3 type declarations (custom, not @types/musickit-js)
    music.ts            App types: Genre, Cassette, Track, PlaybackState, AudioQuality
  store/
    musicStore.ts       Auth state, cassettes array, selected carousel index, loading
    playerStore.ts      Playback state, inserted cassette, queuedTracks, baseQueue (full shuffled queue for subgenre re-filtering), volume, quality, filter sliders
  services/
    appleMusic.ts       MusicKit configure/auth, library fetch, cassette builder, queue loader, sortTracksByFilters
    audioAnalysis.ts    analyzePCM() — raw BPM/energy/mood DSP (FFT, spectral flux + tempo prior, centroid, chroma, KS key); runs in the worker
    analysisClient.ts   Main-thread worker owner: resample (11kHz mono) + RPC → analyzeAudioBuffer()
    featureCache.ts     IndexedDB cache (kassette-features v5) for raw TrackFeatures
    featureNormalize.ts buildNormalizer() — raw features → library-relative percentiles
  workers/
    analysis.worker.ts  Dedicated worker: runs analyzePCM off the main thread
  lib/
    mapPool.ts          Bounded-concurrency async pool (used by the analysis hooks)
  hooks/
    useKeyboardNav.ts   Left/right arrow key navigation for carousel
    useVUMeter.ts       Simulated animated VU meter bars
    useAudioFilter.ts   Web Audio low-pass filter for tape quality simulation
    usePreviewAnalysis.ts   Analyzes the active queue's previews (concurrency pool)
    useBackgroundAnalysis.ts Analyzes the rest of the library after a 10s delay (concurrency pool)
    useRewindSFX.ts     SFX chain for fast-backward (start → loop → end)
    useButtonSFX.ts     One-shot SFX for transport button presses (reg + eject variants)
    useMotorSFX.ts      Looping motor SFX that runs while playbackState is playing or loading
    useDoorSFX.ts       One-shot SFX for door opening and tape inserting
    useVhsParams.ts     Shared VHS overlay/displacement params (CSS vars + SVG attrs, localStorage)
  components/
    AuthScreen.tsx          Apple Music connect UI — Figma diagonal layout + tape hero + displacement
    AuthIntro.tsx           Pre-auth Lottie loader (loading → reveal → red diagonal slides away)
    CassetteCarousel.tsx    Draggable genre cassette carousel (+ "CHOOSE YOUR GENRE" title)
    CassettePlayer.tsx      Main player: VU meter, tape bay, track display, controls
    PlaylistController.tsx  3 sliders: tempo/energy/mood (Phase 2: Essentia.js)
    SceneBackground.tsx     Persistent generic background + decorative objects (playback)
    GenreBackground.tsx     Per-genre tape-selection photo + diagonal wipe + mouse parallax
    VhsOverlay.tsx          App-wide CSS/SVG VHS overlay (grain/scanlines/glitch/vignette/flicker)
    VhsDebug.tsx            Dev 📼 panel: all VHS + displacement-band sliders (bottom-left)
    BackgroundDebug.tsx     Dev ⚙ panel: blur + dark-overlay sliders (CSS vars, localStorage)
    SubgenreSelect.tsx      Checkbox multi-select dropdown for the Mixtape Filters subgenre picker
  assets/
    tapes/
      cassette-body-flat.png        Flattened PNG composite of all static cassette body layers (@2x)
      cassette2-body-flat.png       … cassette style variants (2–8, one per genre)
      cassette3-body-flat.png
      cassette4-body-flat.png
      cassette5-body-flat.png
      cassette6-body-flat.png
      cassette7-body-flat.png
      cassette8-body-flat.png
      cassette-reel-left.svg
      cassette-reel-right.svg
      cassetteAssets.ts             Imports + genreBodyMap (genre → body PNG)
    player/
      player-*.svg / player-*.png   32 player UI assets
      playerAssets.ts
    misc/
      logo.svg                      Player bottom-left logo (replaces 3-stripe composite)
    auth/
      auth-background.jpg           Concrete hero background (right side of auth screen)
      auth-tape.png                 Red cassette + pencil hero
      auth-tape-shadow.png          Tape ground shadow
      auth-red-back.svg             Diagonal red gradient panel (auth + intro cover)
      auth-logo.svg                 Kassette wordmark
      logo_loading.json             Lottie — looping loader (solid red/cream, no gradient)
      logo_reveal.json              Lottie — one-shot reveal (gradient stops recolored to brand)
    background/
      background-generic.jpg
      object-generic-1/2/3.png
      tape_back_<genre>.jpg          Per-genre tape-selection backgrounds (8)
      genreBackgrounds.ts            genre→photo map + getWipeDirection helper
    sfx/
      SFX-rewinding-start.aac
      SFX-rewinding-loop-2.aac
      SFX-rewinding-end.aac
      SFX-kassette-button-reg-pressed.aac
      SFX-kassette-button-eject-pressed.aac
      SFX-kassette-player-motor-loop.aac
      SFX-kassette-tape-door-openning.aac
      SFX-kassette-tape-inserting.aac
    SFX-kassette-player-motor-loop.aac
  App.tsx     Auth gate, library loading, layout orchestration
  index.css   All styles (CSS custom properties, dark hardware theme)
```

---

## Environment Setup
Copy `.env.local.example` to `.env.local` and add your Apple Music developer token:
```
VITE_APPLE_MUSIC_DEVELOPER_TOKEN=your_jwt_here
```

### Generating the token
Run `node generate-token.mjs` (fill in KEY_ID, TEAM_ID, and .p8 path first).
The .p8 file, .env.local, and generate-token.mjs are all gitignored.

### Apple Developer Portal setup
- Create a **Media ID** (not App ID) under Identifiers
- Enable MusicKit under the Media ID's App Services tab
- Create a Key with **Media Services (MusicKit)** capability
- The key must be associated with a Media ID — not an App ID

---

## Key Technical Decisions & Findings

### MusicKit v3 queue — critical finding
`setQueue` silently ignores manually constructed `MediaItem` objects (queue stays at 0).
The root cause: manually constructed items have `cloudId: undefined`.
**Fix:** cache the original `MusicKit.MediaItem` objects from the API response during library fetch and reuse them in `setQueue`. These carry the internal `cloudId` that MusicKit needs for playback.
See `rawItemCache` in `src/services/appleMusic.ts`.

### setQueue sequence
After `setQueue`, do NOT call `changeToMediaAtIndex(0)` before `play()`.
This triggers an internal `stop()` inside MusicKit which puts the state machine into an invalid state, causing: *"The play() method was called without a previous stop() or pause() call"*.
Just call `music.play()` directly after `setQueue`.

### Tape audio quality filter
Web Audio `createMediaElementSource()` is attempted on MusicKit's `<audio>` element.
Apple Music DRM may block this in some browsers — the hook fails silently and the selector becomes visual-only. When active, three presets are applied:
- **LO**: 1800 Hz low-pass, Q 2.0 — heavy tape muffle with resonance
- **MID**: 5500 Hz low-pass, Q 1.2 — noticeably degraded
- **HI**: 20000 Hz — full quality bypass

### Fast Forward / Fast Backward
- **FF**: sets `audioElement.playbackRate = 8` on mousedown, restores to `1` on mouseup. Produces the classic chipmunk tape sound.
- **FB**: records playback position and timestamp on press. On release, calculates rewind distance at 8x rate and calls `seekToTime()` once. Audio is muted during hold. SFX chain plays around the interaction.

### Rewind SFX chain
Three `.aac` files sequenced in `useRewindSFX`:
1. `SFX-rewinding-start.aac` — plays once on button press
2. `SFX-rewinding-loop-2.aac` — loops while button is held
3. `SFX-rewinding-end.aac` — plays on release; seek + unmute happen in its `onended` callback

### Button press SFX (`useButtonSFX`)
Two `new Audio()` elements (not in the DOM), lazily initialised on first press.
- `SFX-kassette-button-reg-pressed.aac` — all transport buttons except eject
- `SFX-kassette-button-eject-pressed.aac` — eject button only
Each press resets `currentTime = 0` before calling `.play()` so rapid clicks re-trigger cleanly.

### Motor SFX (`useMotorSFX`)
`SFX-kassette-player-motor-loop.aac` loops at `volume: 0.4` whenever `isPlaying || playbackState === 'loading'`.
Starts as soon as the track begins buffering (not just when audio starts) for a realistic feel.
Plain `new Audio()` — not routed through Web Audio, so it plays independently of the tape quality filter.

### VU meter
DRM blocks real Web Audio analysis so the VU meter is a visual simulation.
A pseudo-random LCG seeded by `performance.now()` generates bar heights at 80ms intervals, shaped to peak in mid frequencies.

### Shuffle
Tracks are shuffled (Fisher-Yates via `sort(() => Math.random() - 0.5)`) before queuing.
The shuffled slice is stored in `playerStore.queuedTracks` so the LCD display matches what MusicKit is actually playing.

---

## Genres
Eight cassettes (added Jazz and Pop in Phase 2), matched by keyword against `track.genreNames`:
| Genre | Color | Keywords (sample) |
|---|---|---|
| Rock | #c0392b | rock, metal, punk, grunge, alternative, indie rock |
| Hip-Hop | #8e44ad | hip-hop, rap, trap, r&b, soul |
| Electronic | #2980b9 | electronic, techno, house, edm, dance, ambient |
| Reggae | #27ae60 | reggae, dancehall, ska, dub, afrobeat |
| Classical | #d4a017 | classical, orchestra, symphony, piano, soundtrack |
| Folk | #e67e22 | folk, country, bluegrass, acoustic, singer-songwriter |
| Jazz | #1a6b8a | jazz, fusion, bebop, swing, bossa nova |
| Pop | #e91e8c | pop, french pop, synth-pop, indie pop |

---

## Phase 2 — Audio Analysis & Smart Sliders

### Overview
Three sliders (Pace/Tempo, Energy, Mood) dynamically re-sort the upcoming queue based on per-track audio features (BPM, energy, mood/valence).

### Audio Feature Extraction
Apple Music API does **not** expose audio features to developers (400 error on the audio-features endpoint). Instead, features are extracted from **30-second preview clips** attached to each catalog song:
1. `fetchPreviewUrls(tracks)` — batch-fetches catalog songs (300/req) and extracts `attributes.previews[0].url`
2. The clip is fetched + `decodeAudioData`'d on the main thread, then **resampled to mono 11.025 kHz** (`OfflineAudioContext`) and the raw PCM is **transferred to a Web Worker** (`analysisClient.ts` → `workers/analysis.worker.ts`). Downsampling cuts the sample count ~4× and is plenty for these features.
3. `analyzePCM(id, samples, sampleRate)` (`audioAnalysis.ts`, runs **in the worker**, off the main thread) returns **RAW** measurements (no fixed 0–100 scaling):
   - **energyRaw**: linear RMS of the whole clip (loudness/intensity proxy)
   - **moodRaw**: 0–1 blend of **brightness** (mean spectral centroid via a hand-rolled radix-2 FFT) and **musical mode** (major→happier / minor→darker), where mode comes from an FFT **chroma** vector matched against **Krumhansl–Schmuckler** key profiles. Weighting: `0.6·brightness + 0.4·mode`. (Replaced the old zero-crossing-rate proxy.)
   - **bpm**: autocorrelation of a **spectral-flux** onset novelty curve (sum of positive bin-to-bin magnitude changes), each lag's score weighted by a **log-Gaussian tempo prior** (~120 BPM) to resolve half/double-tempo octave errors, clamped to 50–200 (no lossy folding)
4. Results cached in IndexedDB (`kassette-features`, **v6** — bumped when BPM moved to spectral-flux + tempo prior) via `featureCache.ts`
5. On startup, cached features are loaded via `getAllFeatures()` and bulk-loaded into `playerStore.featuresMap`

The worker is a singleton owned by `analysisClient.ts`, which correlates requests/responses by an incrementing `reqId` (promise map). The concurrency pool (below) parallelizes network + decode + resample on the main thread; the single worker serializes the heavy DSP so the UI never janks.

### Library-Relative Normalization (`featureNormalize.ts`)
Raw measurements have no meaningful absolute 0–100 mapping — a fixed constant makes most tracks cluster in a narrow band and the sliders feel dead. Instead `buildNormalizer(featuresMap)` converts each raw value to its **percentile rank within the user's own analyzed library** → `{ pace, energy, mood }` (0 = lowest in library, 100 = highest). This self-calibrates so the sliders always span the full range. The normalizer is cheap (one sort per metric) and rebuilt as analysis fills in more tracks (memoized on `featuresMap` at call sites). With ≤1 analyzed track, all metrics return a neutral 50.

### Analysis Priority & Background Processing
Both passes use a **bounded concurrency pool** (`lib/mapPool.ts`, `CONCURRENCY = 6`) — up to 6 clips fetched + decoded + analyzed in parallel. (Previously each pass was a sequential loop with an artificial per-track delay — 100ms active / 1s background — which made full-library coverage take 30+ minutes; the pool removes that.)
- **Active cassette**: `usePreviewAnalysis(displayQueue)` analyzes the active queue. It **re-runs when the track SET changes** (keyed on the sorted track ids), NOT on reorder — so subgenre filtering triggers fresh analysis of the newly-eligible tracks (cancelling the in-flight run), while slider re-sorts don't restart it.
- **All other tracks**: `useBackgroundAnalysis(allTracks)` starts after a 10s delay (so the active cassette gets priority) and analyzes the rest of the library, skipping already-cached entries.
Both cancel cleanly on unmount / queue change (a `cancelled` flag passed to `mapPool`'s `shouldStop`).

### Sorting Logic
`sortTracksByFilters(tracks, featuresMap, tempo, energy, mood)` in `appleMusic.ts`:
- Builds a `buildNormalizer` over `featuresMap` and precomputes each analyzed track's percentile `{ pace, energy, mood }` once (comparator stays O(1) per pair).
- Each slider (0–100) is a **directional weight**, not a target: slider 0 = want lowest, slider 100 = want highest, slider 50 = neutral (no effect)
- Only the **upcoming tracks** (after currentTrackIndex) are re-sorted — the current track is never affected
- Unanalyzed tracks go to the end, preserving their shuffled order
- The sort runs when any slider is changed; `currentTrackIndex` is NOT updated (stays pointing at current track)

### Queue Management
`playQueueFrom(tracks, startIndex)` in `appleMusic.ts`:
- Loads a 20-track window from the sorted queue into MusicKit's internal queue via `setQueue`, then `play()` — **no `stop()`** (a `stop()` after `setQueue` hits MusicKit's "play() without stop/pause" invalid state and silently fails).
- Used by the **Next** button, the `completed` auto-advance handler, AND `handlePlay`'s fresh start from `stopped` (so Play always plays our — possibly subgenre-filtered — `queuedTracks` from `currentTrackIndex`, not MusicKit's stale internal queue). Resuming from `paused` just calls `music.play()`.
- Keeps MusicKit's queue in sync with our sorted `queuedTracks` so auto-advance and manual skip both follow the correct order.

### Slider Auto-Snap
When a new track starts, the three sliders automatically move to reflect that track's **library-relative percentile** (`pace`/`energy`/`mood`) position. This is purely visual — it does NOT re-trigger the sort. The snap only fires on track change (`currentTrack.id`), not when analysis data arrives mid-play (to avoid overriding the user's intentional drag).

### Sliders Disabled State
If fewer than 5 upcoming tracks have analysis data, the sliders are grayed out (`pointer-events: none`) with the message "Analyzing your tape… N/20 tracks ready". They unlock automatically as analysis progresses.

### Track Display
The CassettePlayer LCD screen shows `BPM / NRG / MOD` for the current (and next) track. **BPM is the actual detected tempo**; **NRG and MOD are the library-relative percentiles** (0–100) from the normalizer, not raw values.

### Known Limitations / Future Work
- BPM uses spectral-flux onsets + a tempo prior over a 30s preview — solid on clear-beat genres (verified exact on synthetic 80–160 BPM click tracks), still imperfect on rubato/ambient material.
- Mood is now brightness (spectral centroid) + major/minor mode (chroma + Krumhansl key profiles) — a real musical signal, though still a heuristic proxy for valence (no trained model). Energy is still raw RMS (could add spectral flux / loudness for a better "energy" sense).
- Best overall future upgrade: Essentia.js in the worker (RhythmExtractor2013 for BPM+confidence, KeyExtractor, loudness) — the worker plumbing is already in place.
- The real-time `AnalyserNode` analysis path (`feedFrame`/`computeFeatures`/`useTrackAnalysis`) was dead code and has been **removed** — only the preview-clip worker path runs.
- Sliders reset to track values on track change, which can conflict with user-set filters if user wants persistent filtering across tracks
- Phase 3 will redesign the full UI

---

## Key Technical Decisions & Findings (Phase 2 additions)

### MusicKit play() after setQueue
After calling `setQueue`, call `music.play()` directly — do NOT call `music.stop()` first. `setQueue` already resets internal state; an explicit `stop()` puts MusicKit into an invalid state causing *"play() was called without a previous stop() or pause() call"* on the subsequent `play()`.

### Apple Music Audio Features API
`GET /v1/catalog/{storefront}/songs/{id}/audio-features` returns 400 "No relationship found matching 'audio-features'". The `include=audio-features` parameter on the songs endpoint is also silently ignored. Audio features are NOT available to standard Apple developer accounts.

### Preview Audio CORS
Apple's preview URLs (`audio-ssl.itunes.apple.com`) support CORS browser fetch. Decoding with `AudioContext.decodeAudioData()` works. ~30s AAC clips, ~1-2MB each.

### MusicKit nowPlayingItemDidChange — track index sync
`music.queue.position` reflects MusicKit's internal queue order, which diverges from `queuedTracks` after a re-sort. Fix: look up `music.nowPlayingItem?.id` in `queuedTracks` by ID to get the correct index. See `onNowPlayingChange` in `CassettePlayer.tsx`.

---

## Dev Commands
```bash
npm run dev      # start dev server (http://localhost:5173)
npm run build    # production build
```

---

## Phase 3 — Visual Redesign (In Progress)

### Asset Pipeline
All player and cassette images are Figma exports stored **locally** in `src/assets/` and imported via Vite module imports in `playerAssets.ts` and `cassetteAssets.ts`. They no longer depend on expiring Figma CDN URLs.

**Player assets** (`player-*.svg/.png`): 32 files — player body, buttons, reels, volume slider, tape type selector, etc.
**Cassette assets** (`cassette-*.svg/.png`): 14 files — TDK-style cassette body layers.

Most assets are SVG (vector exports from Figma). Five are PNG (rasterized exports).

To re-export after a Figma design change:
1. Use the Figma MCP `get_design_context` on the updated node to get a fresh asset URL
2. `curl -o src/assets/<filename> "<url>"` — file command will tell you if it's SVG or PNG
3. Rename to `.svg` or `.png` accordingly — no code changes needed

Figma file: `8Q9h4JkKgL8ota7JdW7qrX`, main player node: `40:1219`.

### Critical: SVG url(#id) in CSS background-image (Chrome bug)
SVGs exported from Figma use internal `url(#id)` references for gradients and filters (e.g. `fill="url(#paint0_linear_0_193)"`). When an SVG is used as CSS `background-image: url(file.svg)`, Chrome resolves `url(#id)` against the **page document** instead of the SVG file — all gradients and filters silently fail, rendering the layer transparent.

**Fix**: Use stacked `<img src={url}>` elements instead of CSS `background-image`. Each `<img>` loads the SVG as its own document where `url(#id)` resolves correctly.

This is why `ct-swapable` in `CassetteTapeBody.tsx` renders as a `<div>` containing absolutely-positioned `<img>` elements (one per layer) rather than a single `<div>` with a multi-layer `background-image` inline style. The positioning math is identical — `left/top/width/height` via `calc(var(--cw/ch) * fraction)` — just applied as img styles instead of background-size/position.

**Important:** Some Figma layers carry a 180° flip internally. When exported the flip is baked into the PNG pixels. If a CSS `transform: rotate(180deg)` is also applied in code, the asset double-flips (inner shadows appear on wrong side). Fix: remove the flip from the Figma layer first, re-export, then remove the CSS transform.

### Figma coordinate conversion
- Canvas origin: `(451, 354)` — subtract from Figma absolute coords to get player-relative position
- Player size: `865 × 551 px`
- Bottom-anchored elements: `player_y = canvas_h - bottom - height - 354`

### Button Press Animation
Transport buttons have a layered structure inside `.np-btn-slot`:
1. `.np-btn-offset` — always-visible depth layer behind the button (represents physical thickness). `transform-origin: top center` so it compresses upward on press.
2. `.np-btn-inner` — the moving button cap. `transform-origin: top center`, `scaleY(0.85) + translateY(3px)` on press.
3. `.np-btn-gradient` — overlay image that fades in to `opacity: 0.6` on press (`mix-blend-mode: multiply`).

Press state is tracked via `pressedBtn` state + `np-btn-slot--pressed` CSS class on the slot.
Spring easing: `cubic-bezier(0.34, 1.9, 0.64, 1)` at 180ms for a physical bounce feel.

### Play / Pause Toggle Behaviour
- **Play**: latches pressed while `playbackState === 'playing'` OR `'paused'`. Clicking while playing calls `music.stop()` (not pause) to avoid accidentally latching the pause button.
- **Pause**: latches pressed while `playbackState === 'paused'`. Clicking while playing pauses; clicking while paused resumes. Both play + pause can appear pressed simultaneously.
- **No-flicker rule**: `onMouseUp` only clears `pressedBtn` when the current state is the *source* state (e.g. pause button's mouseup clears only when `playbackState === 'paused'`). Otherwise the state machine transition takes over before pressedBtn is cleared.

### setQueue / play() sequence (updated finding)
Do NOT call `music.stop()` before `music.play()` after `setQueue`. `setQueue` resets internal state — an explicit `stop()` puts MusicKit into an invalid state, causing "play() called without stop/pause". Call `music.play()` directly.

### Audio Filter (useAudioFilter)
`createMediaElementSource` is attempted 300ms after `isPlaying` becomes true (delay lets MusicKit finish its own audio setup). Never permanently blocks on error — retries each time `isPlaying` transitions. Detects element swaps between tracks via element reference comparison.
MutationObserver approach was tried but broke MusicKit's DRM init by firing during `setQueue`. The 300ms delayed `isPlaying` trigger is the correct approach.
Element selection uses `document.querySelectorAll('audio')[0]` (not `querySelector`) so the list can be inspected for debugging.

### Play button loading latch (`pendingPlay`)
MusicKit fires state transitions in this order on first play: `playing → waiting → loading → playing`.
The transient `playing` event clears any "button pressed" flag, then `waiting/loading` drops `playbackState` to `'loading'`, leaving the button unpressed during buffering.
Fix: `pendingPlay` boolean state in `CassettePlayer`.
- Set `true` in `handlePlay` (when not resuming from pause)
- Re-set `true` whenever `loading` or `waiting` state fires (re-latches after the transient `playing`)
- Cleared only when a stable `playing` state fires, or explicitly on Stop/Eject
- Play button pressed condition: `pressedBtn === 'play' || pendingPlay || playbackState === 'playing' || playbackState === 'paused'`

### In-bay cassette sizing
`.np-cassette-in-bay .cassette-body` must use `--ch: 220px` (fixed player-coordinate pixels).
Do **not** multiply by `--player-scale` — the parent `.np-player-wrapper` already applies `transform: scale(--player-scale)`, so multiplying again double-scales the cassette relative to the back tape image.
Position `left: 39px; top: 11px` is correct (centres the 330×220 cassette over the 350×220 back tape).
Do NOT add `transform: translate(-50%, -50%)` — Framer Motion overrides `transform` on `layoutId` elements for the fly-in animation.

---

## Cassette Insert FLIP Animation

### Overview
When the user clicks "Insert Tape", the selected cassette animates from its lifted carousel position into the player's tape bay via a manual FLIP animation (no Framer Motion `layoutId`).

### Implementation
1. **Source rect capture**: Before the lift starts, `[data-insert-target]` (the `.cassette-item` wrapper) is measured for `liftY`. After the 500ms lift animation, `[data-flip-source]` (the `motion.div` that includes the translateY) is measured for the FLIP source rect and stored in `playerStore.insertSourceRect`.
2. **Target rect + FLIP**: In a `useLayoutEffect` in `CassettePlayer`, the bay element (`bayRef`) is measured. Center-based dx/dy are computed (not top-left), and `bayX`, `bayY`, `bayScale` motion values are set to the delta, then animated to 0/0/1.
3. **Carousel instant exit**: `carousel-wrapper` exits with `transition: { duration: 0 }` so it disappears the moment `isInserted` becomes true, avoiding overlap with the FLIP.
4. **Easing**: `{ duration: 0.3, ease: [0, 0, 0.58, 1] }` — pure ease-out.

### Key values
- Source scale baked in at 1.1 (`bayScale.set(1.1)`)
- `bayY` offset: `sourceCY - targetCY + 97` (empirically tuned for the visual center of the tape bay)
- `data-flip-source` on the `motion.div` (includes lift transform), `data-insert-target` on the static `.cassette-item` wrapper

### Known issue — ct-reel compositing
During the FLIP animation, the reel images (visible through the cassette window) temporarily disappear and reappear when the animation ends. Root cause: `np-cassette-in-bay` gets a GPU compositing layer from Framer Motion's transform. Within that layer, the transparent PNG cutout in `ct-swapable` can fail to composite correctly against the reel images below it. Attempted fixes: CSS animation → Framer Motion motion values → rAF-driven `style.transform` → `will-change: transform` on `.np-cassette-in-bay .ct-body`. Issue is pending a Layers panel inspection in Chrome DevTools to confirm which element is being unexpectedly promoted.

### Reel animation
CSS `animation: ct-spin-cw` was replaced with a `requestAnimationFrame` loop in `CassetteTapeBody` that directly sets `img.style.transform = rotate(Xdeg)`. This avoids CSS animation's implicit GPU layer promotion. When `reelSpeed === 0` (always during FLIP), the transform is cleared entirely so no compositing layer is created on the reel elements.

---

## Scene Background System

### Overview
A full-screen background layer rendered behind all UI, with per-cassette/genre background image and decorative PNG objects positioned around the player.

### Files
- `src/assets/background/background-generic.jpg` — generic background (1376×1046)
- `src/assets/background/object-generic-1.png` — decorative object 1 (880×1204)
- `src/assets/background/object-generic-2.png` — decorative object 2 (689×989)
- `src/assets/background/object-generic-3.png` — decorative object 3 (482×1048)
- `src/components/SceneBackground.tsx` — renders the background + 3 objects

### CSS structure
```css
.scene-root   /* position: fixed; inset: 0; z-index: 0; pointer-events: none */
.scene-bg     /* position: absolute; inset: 0; background-size: cover */
.scene-obj    /* position: absolute; bottom: 0; width: auto */
.scene-obj-1/2/3  /* individual positioning per object */
```

### Scaling
Objects use `calc(var(--player-scale, 1) * Xpx)` for `height` so they resize proportionally with the player on every viewport size. `--player-scale` is set by `usePlayerScale()` in `App.tsx` as `(window.innerHeight * 0.5) / 530`.

### Positioning pattern
Each object has `left`/`right`, `top`, `bottom: auto`, `height` (player-scale relative), and `rotate` properties. Horizontal offset combines a viewport-percentage and a player-scale-relative offset:
```css
left: calc(60% + var(--player-scale, 1) * 410px);
```

### App header
Updated to `background: rgba(0,0,0,0.45)` with `backdrop-filter: blur(8px)` so the background image shows through.

---

## Cassette Body System

### Flattened PNG approach
The cassette body (`ct-swapable`) is rendered as a single pre-composited PNG instead of 15 stacked SVG `<img>` elements. This reduces DOM nodes, eliminates per-cassette layer compositing overhead, and fixes the Chrome `url(#id)` gradient resolution bug.

To regenerate the flat PNG after a Figma design change:
```bash
node scripts/flatten-cassette-body.mjs
```
Script reads SVGs from `src/assets/tapes/`, composites them at 2× (1100×684px) using `sips`, and writes `cassette-body-flat.png`.

### Genre → style mapping
`src/assets/tapes/cassetteAssets.ts` is the single source of truth for which body PNG each genre uses:
```ts
export const genreBodyMap: Record<string, string> = {
  'Rock':       cassette1,
  'Hip-Hop':    cassette2,
  ...
}
```
**Only edit this file** to reassign styles. All 8 genres now have a dedicated flattened body PNG (`cassette1`–`cassette8`): Rock→1, Hip-Hop→2, Electronic→3, Reggae→4, **Folk→5**, **Classical→6**, **Jazz→7**, **Pop→8**. (Classical/Folk were swapped; Jazz/Pop moved off shared styles onto `cassette7`/`cassette8`.)

### Door SFX (`useDoorSFX`)
Two one-shot sounds wired into the door animation `useEffect` in `CassettePlayer`:
- `SFX-kassette-tape-door-openning.aac` — fires immediately when `isInserted` becomes false (eject)
- `SFX-kassette-tape-inserting.aac` — fires after 300ms when `isInserted` becomes true (aligned with FLIP end + door close)

---

## Mixtape Filters UI (Phase 3)

`PlaylistController` — titled **"MIXTAPE FILTERS"** (renamed from "Playlist Filters").

### Layout & container
`.pf-container`: `backdrop-filter: blur(20px)`, `background: rgba(255,255,255,0.1)`, `border-radius: 36px`, `box-shadow: 0 12px 12px rgba(0,0,0,0.25)`, `padding: 20px 24px`.
Header (`.pf-header`) is a row: a left `.pf-header-titles` column ("MIXTAPE FILTERS" 24px Afacad 700 with the "N upcoming tracks analyzed" line **stacked below it**, Afacad 12px/400, dimmed) + the subgenre dropdown on the right.

### Custom slider
Each filter uses `.pf-slider-track` (glass pill) containing a native `<input type="range">` styled with `appearance: none`.
- Fill + thumb: brand red `#E20025` (matched to the Insert Tape button). `--pf-fill` inline var drives the fill %.
- Filter label: Afacad 700, 20px. End labels (Slow/Fast etc.): Afacad 400, 14px, pulled ~6px closer to the slider.
- Disabled (grayed, `pointer-events:none`) until ≥5 upcoming tracks are analyzed.

### Subgenre multi-select (`SubgenreSelect.tsx`)
Custom checkbox dropdown (native `<select>` can't do checkboxes) in the header's top-right; **opens upward** (`bottom: 100%`).
- Options = distinct `genreNames` across `currentCassette.tracks` (the FULL cassette), sorted; "All" is added by the component. Closes on outside click. Pill label shows `All` / the single name / `N subgenres`.
- Selection is a `string[]` in `PlaylistController` (empty = All). Resets to All on cassette change (adjust-state-on-render pattern, not an effect).

### Filtering logic (`applyAll`)
Rebuilds the upcoming queue: `played = queuedTracks[0..currentTrackIndex]`, then candidates from a pool minus played, optionally filtered to tracks whose `genreNames` intersect the selected subgenres (ANY match), then `sortTracksByFilters`.
- **Pool:** when subgenres are selected → the FULL `currentCassette.tracks` (so niche subgenres beyond the shuffled 100-track queue still surface). When "All" → `baseQueue` (the full shuffled queue captured at insert — `playerStore.baseQueue`), preserving the per-insert shuffle. Options come from the full cassette to match the subgenre pool (avoids listing subgenres that would filter to empty).
- **"Now" refresh when stopped:** a subgenre change while `playbackState === 'stopped'` rebuilds the WHOLE queue (played = []) and resets `currentTrackIndex` to 0, so the NOW track reflects the new selection; the next Play re-syncs MusicKit via `playQueueFrom`. While playing/paused the current track is preserved and only the upcoming list changes. Slider drags never trigger a MusicKit re-sync (avoids thrash).

---

## Typography
Two web fonts loaded from Google Fonts in `index.html`:
- **Kode Mono** (400/700) — the player + LCD aesthetic ONLY: `.np-*` (LCD screen title/artist, dB numbers, player label/logo text, transport-button captions, tape-type selector). Do not change these to a sans face.
- **Afacad** (400/500/600/700) — everything else (general UI + playlist filters): the carousel title, Insert Tape button, Sign Out button, and all `.pf-*` text. Afacad's heaviest weight is **700** (no 900).

Montserrat was fully removed during the Afacad switch.

---

## Tape-Selection Backgrounds (Phase 3)
Spec: `docs/superpowers/specs/2026-06-30-genre-backgrounds-design.md`. Component: `src/components/GenreBackground.tsx`; genre→photo map + `getWipeDirection` in `src/assets/background/genreBackgrounds.ts`; photos `src/assets/background/tape_back_<genre>.jpg` (note `Hip-Hop→hiphop`, `Electronic→electro`).

Replaces the old blur/white carousel overlays. Behaviour:
- Full-screen per-genre photo (z-index 20, above the player, below the carousel at 30) with a dark scrim for legibility.
- **Diagonal directional wipe** on tape change: an incoming photo layer animates a 4-vertex `clip-path` (constant vertex count so Framer interpolates without jumps); direction from `getWipeDirection` (shortest path around the ring; wrap last→first reads "right"). `SLANT` controls the diagonal angle. Duration 0.3s.
- **Mouse parallax**: the photo layer is scaled `PARALLAX_SCALE` (1.1) and translated up to `±MAX_SHIFT%` (3%) opposite the cursor, spring-smoothed. Scale overflow (5%) > shift (3%) so an edge can never be exposed. Scrim sits outside the parallax wrapper.
- **Blur + scrim are CSS-variable driven** (see debug panel): `.genre-bg-photo` uses `filter: blur(var(--genre-bg-blur, 2px))`; the scrim is a **uniform black** layer with `opacity: var(--genre-bg-overlay, 0.4)` (0 = transparent … 1 = solid black — replaced the fixed gradient so the darkness spans the full range).
- Fades out (0.4s) on insert, gated on `!isInserted && !isInserting`.
- **Critical:** ref bookkeeping (`prevIndexRef`/`prevSrcRef`) lives in the effect body, NOT inside the `setLayers` updater — StrictMode double-invokes updaters in dev and would collapse every wipe to "right". Layer prune keys on the stable `layer.id`.

### Background debug panel (`BackgroundDebug.tsx`)
Dev tuning tool, bottom-right ⚙ in the tape-selection state only. Popup with two sliders that live-drive the CSS vars above — **Blur** (0–20px) → `--genre-bg-blur`; **Dark overlay** (0–100%) → `--genre-bg-overlay`. Values persist to `localStorage` (`kassette-dbg-blur`, `kassette-dbg-darkness`).

### Carousel header
Stacked column centered above the tapes (`.carousel-header`, fades with the carousel on insert):
- **`.carousel-title`** — "CHOOSE YOUR GENRE", small uppercase Afacad 600 label.
- **`.carousel-genre`** — the focused tape's genre in big (6rem Afacad 700, uppercase), fading on each tape change (keyed `motion.span`).

### Button hovers (unified)
- **Insert Tape** (`.insert-button`) — solid red `#E20025`, no border, Afacad 700 ~1.85rem uppercase pill. Hover: lighter red `#ff2a4c` + `scale(1.06)` (overshoot ease) + shadow softens (`0 6px 18px` → `0 16px 38px`, lower alpha).
- **Nav arrows** (`.nav-arrow`) — full circles (`3.85rem`), flex-centered glyphs (3rem); `‹`/`›` optically re-centered via inner-edge padding on `:first-child`/`:last-child` + 2px `padding-bottom`; `gap: 1.25rem`.
- **Nav arrows + Sign Out** share the Sign Out glass fill (`rgba(255,255,255,0.12)` + `backdrop-filter: blur(20px)`) and one hover: brighten to `rgba(255,255,255,0.24)` + `scale(1.06)`.
- **Carousel drag fixes** — `dragMomentum={false}` so hard flicks snap deterministically; `onDragStart` stops any in-flight snap animation; cassette `<img>`s use `draggable={false}` + `-webkit-user-drag:none` to stop the native image-drag ghost.

### Player logo & chrome
- Player logo (`.np-logo`, bottom-left) is now a single `src/assets/misc/logo.svg` (`width:120px; left:17px; top:465px`), replacing the old 3-stripe (reel-icon + KASSETTE text) composite.
- **Top nav bar removed** (`.app-header`/`.app-logo` deleted). Sign Out is now a floating `.signout-btn--floating` (`position:fixed`, top-right, `z-index:40`): bigger uppercase Afacad pill (`border-radius:9999px`) with a strong `backdrop-filter: blur(20px)` translucent fill.

---

## Auth Screen (Phase 3 — Figma node 49:2)
Full-bleed diagonal layout (assets in `src/assets/auth/`, exported via Figma MCP):
- **Left**: diagonal red gradient panel (`auth-red-back.svg`, `#E20025→#FF2937`) at `.auth-red` width 54%. On top, `.auth-content` (centered in the red at `left:27%`) holds the Kassette wordmark, the big uppercase Afacad headline "ANALOG SOUL FOR A DIGITAL STREAM", body copy (`#2f0004`), and the connect button.
- **Right**: concrete `auth-background.jpg` (opacity 0.4 + white top gradient) with the `auth-tape.png` cassette-and-pencil hero centered in the right half; the tape **levitates** (5s ease-in-out) and its shadow (`.auth-tape-shadow`, anchored in `.auth-tape-wrap`) shrinks/fades in sync.
- **Connect button** (`.auth-button`): white pill, red text, hover = lighter + `scale(1.06)` + softer shadow. Label is **"CONNECT WITH  MUSIC"** — an inline Apple-logo SVG (`fill: currentColor`) sits between "with" and "Music" since Afacad has no Apple glyph.
- Sizing is responsive via `clamp()`/`vw`. Auth+reload flow unchanged (see the 403 fix note below).

### Pre-auth intro loader (`AuthIntro.tsx`, lottie-react)
Shown over the auth screen on first load and after Sign Out (App `introDone` state):
1. Full-red diagonal cover (`auth-red-back.svg` sized `116vw × 215vh` — same 54:100 ratio as `.auth-red` so the **diagonal angle matches**, scaled to cover the screen) with `logo_loading` Lottie centered, looping.
2. Meanwhile the auth assets preload (`new Image()`), with a 6s safety timeout.
3. When ready, the loading loop finishes then swaps to `logo_reveal` (played once).
4. On reveal complete: the Lottie **fades + scales to 2×** (ease-out), then the red cover **slides left** (diagonal wipe) revealing the auth screen; then it unmounts.
- **Lottie color note**: `logo_reveal` shipped with grayscale (white→black) gradient stops on the mark; recolored per shape layer to brand — Shape Layer 7 `E20025→FFFDBC`, "top and bottom 2" 3-stop `FFFDBC→E20025→FFFDBC`, Shape Layer 4 `EC585A→FFFDBC`. `logo_loading` uses solid fills (no gradient).

## VHS Effect
Two independent effects, both authored in this session:
- **Overlay** (`VhsOverlay.tsx`) — **app-wide** (rendered at App root, `z-index:60`, `pointer-events:none`). Pure CSS/SVG layers: SVG-turbulence grain, colored glitch tear-bands, fine scanlines, vignette, flicker. Every value is a CSS var (`--vhs-*`) so it's tunable. (Was originally WebGL — dropped because repeated HMR exhausted the browser's WebGL context limit, breaking shader compiles.)
- **Displacement** (`AuthScreen` only) — real pixel warping via SVG `feDisplacementMap` (`colorInterpolationFilters="sRGB"` — critical, else mid-gray linearizes and offsets everything):
  - `#vhs-global` — gentle always-on wobble on the base `.auth-stage`.
  - `#vhs-shift` — strong displacement on a **duplicated** `.auth-stage--glitch` copy, revealed only inside a horizontal band via `clip-path` (`--vhs-band-top`/`--vhs-band-h`). The band's position + thickness are driven by a **JS random state machine** in AuthScreen (move/hold/reverse/slip-off-screen) via rAF. Kept auth-only: the band needs a duplicated static copy and a full-app displacement filter would break the player's glass panels + offset click targets.
- **Params + debug**: `useVhsParams` (shared hook) writes CSS-var params to `:root` and exposes SVG-only params (displacement scale/roughness, band speed/thickness min-max) to AuthScreen; persists to localStorage. `VhsDebug` (📼, bottom-left) is the tuning panel for all of them.

## Key finding — 403 on library load right after connect
In the session where the user just authorized, MusicKit's `api` pipeline doesn't attach the Music User Token to `/v1/me/library/*` requests (immediate fetch → 403; re-authorizing in-session doesn't help — only a full page load does). Fix: `AuthScreen.handleConnect` calls `window.location.reload()` right after `authorize()` — the token is already persisted, so the reload restores the session via the known-good path.

---

## Phases
- **Phase 1** ✅ — Auth, genre cassettes, player controls, queue, VU meter, tape filter, SFX
- **Phase 2** ✅ — Preview-based audio analysis, BPM/energy/mood sliders, background analysis, smart queue sorting
- **Phase 3** 🚧 — Visual redesign: Figma-matched pixel-perfect UI, physical button animations, asset refresh pipeline, scene background system
