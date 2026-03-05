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
    playerStore.ts      Playback state, inserted cassette, queuedTracks, volume, quality, filter sliders
  services/
    appleMusic.ts       MusicKit configure/auth, library fetch, cassette builder, queue loader
  hooks/
    useKeyboardNav.ts   Left/right arrow key navigation for carousel
    useVUMeter.ts       Simulated animated VU meter bars
    useAudioFilter.ts   Web Audio low-pass filter for tape quality simulation
    useRewindSFX.ts     SFX chain for fast-backward (start → loop → end)
  components/
    AuthScreen.tsx          Apple Music connect UI
    CassetteCarousel.tsx    Draggable genre cassette carousel
    CassettePlayer.tsx      Main player: VU meter, tape bay, track display, controls
    PlaylistController.tsx  3 sliders: tempo/energy/mood (Phase 2: Essentia.js)
  assets/
    SFX-rewinding-start.aac
    SFX-rewinding-loop-2.aac
    SFX-rewinding-end.aac
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

### VU meter
DRM blocks real Web Audio analysis so the VU meter is a visual simulation.
A pseudo-random LCG seeded by `performance.now()` generates bar heights at 80ms intervals, shaped to peak in mid frequencies.

### Shuffle
Tracks are shuffled (Fisher-Yates via `sort(() => Math.random() - 0.5)`) before queuing.
The shuffled slice is stored in `playerStore.queuedTracks` so the LCD display matches what MusicKit is actually playing.

---

## Genres
Six cassettes, matched by keyword against `track.genreNames`:
| Genre | Keywords |
|---|---|
| Rock | rock, metal, punk, grunge, alternative |
| Hip-Hop | hip-hop, rap, trap, r&b |
| Electronic | electronic, techno, house, edm, dance |
| Reggae | reggae, dancehall, ska, dub |
| Classical | classical, orchestra, symphony, opera |
| Folk | folk, country, bluegrass, acoustic |

---

## Dev Commands
```bash
npm run dev      # start dev server (http://localhost:5173)
npm run build    # production build
```

---

## Phases
- **Phase 1** ✅ — Auth, genre cassettes, player controls, queue, VU meter, tape filter, SFX
- **Phase 2** — Essentia.js in-browser audio analysis → tempo/energy/mood sliders functional
- **Phase 3** — Full visual redesign: proper cassette artwork, insert animation, retro aesthetics
