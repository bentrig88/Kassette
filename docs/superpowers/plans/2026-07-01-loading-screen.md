# Loading Screen Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain "Loading your library…" card with a two-state animated loading screen — a floating red `cassette0` tape (spinning reels, live now/next LCD, logo, loading bar) that fades in on red, crossfades to concrete with a heading + drop-shadow, and holds until the library **and** all assets are ready, then crossfades to the player.

**Architecture:** A `LoadingScreen` orchestrator owns a `red → concrete` phase machine and feeds a presentational `LoadingTape`, which reuses the **exact** now/next LCD (`TrackScreen`, newly extracted from `CassettePlayer` and shared by both). A `useAssetPreloader` hook preloads all UI images in parallel; `fetchLibraryTracks` is extended to stream partial tracks so the LCD shows real songs live; `App.tsx` gates the player reveal on library-done **and** assets-done.

**Tech Stack:** Vite + React 19 + TypeScript (`verbatimModuleSyntax` — always `import type` for type-only imports), Zustand v5, Framer Motion v12.

## Global Constraints

- `verbatimModuleSyntax` is on: type-only imports MUST use `import type`.
- **No test runner exists** in this project (no vitest/jest, no test files). The established verification gates are `npm run build` (`tsc -b && vite build`) and `npm run lint` (`eslint .`), plus manual visual verification for anything requiring Apple Music auth / live browser. Pure helpers are written in isolation so they *could* be tested, but tasks verify via build + lint + manual — do NOT stand up a test framework for this feature.
- Fonts: **Kode Mono** only for the LCD/player (`.np-*`); **Afacad** (700 heaviest) for the heading and general UI.
- Brand red is `#E20025`.
- Concrete background image is `src/assets/auth/auth-background.jpg`.
- The loading tape uses `src/assets/tapes/cassette0-body-flat.png` with **no genre sticker** (kassette logo + LCD + bar instead).
- Do NOT delete the existing `.loading-screen` / `.loading-card` / `.loading-title` / `.loading-hint` CSS — the App error branch still uses those classes. New loading-screen styles use the `.ls-*` prefix.
- Commit after each task. Do not push (the user pushes explicitly).
- Commit message trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: Extract `TrackScreen` component + refactor `CassettePlayer`

Pull the now/next LCD markup out of `CassettePlayer` into a purely presentational component so the loading tape can render the identical LCD. No visual change to the player.

**Files:**
- Create: `src/components/TrackScreen.tsx`
- Modify: `src/components/CassettePlayer.tsx` (remove local `formatTime` at lines 34-38; replace the `.np-screen` block at lines 512-582; add `nowMeta`/`nextMeta` computation)

**Interfaces:**
- Produces:
  - `interface ScreenTrack { name: string; artistName: string }`
  - `interface ScreenMeta { bpm: number; nrg: number; mood: number }`
  - `function TrackScreen(props: { now: ScreenTrack | null; nowTime: number; nowDuration: number; nowProgress: number; nowMeta: ScreenMeta | null; next: ScreenTrack | null; nextMeta: ScreenMeta | null }): JSX.Element`
  - `export function formatTime(sec: number): string`

- [ ] **Step 1: Create `src/components/TrackScreen.tsx`**

```tsx
import { imgLine14 } from '../assets/player/playerAssets'

export interface ScreenTrack {
  name: string
  artistName: string
}
export interface ScreenMeta {
  bpm: number
  nrg: number
  mood: number
}

export function formatTime(sec: number) {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

interface Props {
  now: ScreenTrack | null
  nowTime: number
  nowDuration: number
  nowProgress: number
  nowMeta: ScreenMeta | null
  next: ScreenTrack | null
  nextMeta: ScreenMeta | null
}

/**
 * Presentational now/next LCD — the exact markup shared by CassettePlayer and
 * the loading-screen tape. No store access; all data comes in via props.
 */
export function TrackScreen({ now, nowTime, nowDuration, nowProgress, nowMeta, next, nextMeta }: Props) {
  return (
    <div className="np-screen">
      <div className="np-screen-inner">
        {/* NEXT column */}
        <div className="np-screen-col np-screen-col--next">
          <div className="np-screen-header">
            <span className="np-screen-label">NEXT</span>
          </div>
          {next ? (
            <>
              <div className="np-screen-progress-track np-screen-progress-track--empty" />
              <div className="np-screen-title np-screen-title--dim">{next.name}</div>
              <div className="np-screen-artist np-screen-artist--dim">{next.artistName}</div>
            </>
          ) : (
            <div className="np-screen-artist np-screen-artist--dim">—</div>
          )}
          {nextMeta ? (
            <div className="np-screen-meta np-screen-meta--dim">
              <span>{nextMeta.bpm} BPM</span>
              <img src={imgLine14} alt="" className="np-meta-sep" />
              <span>NRG {nextMeta.nrg}</span>
              <img src={imgLine14} alt="" className="np-meta-sep" />
              <span>MOOD {nextMeta.mood}</span>
            </div>
          ) : (
            <div className="np-screen-meta np-screen-meta--placeholder" />
          )}
        </div>

        <div className="np-screen-divider" />

        {/* NOW column */}
        <div className="np-screen-col np-screen-col--now">
          <div className="np-screen-header">
            <span className="np-screen-label">NOW</span>
            {now && (
              <span className="np-screen-time">{formatTime(nowTime)} / {formatTime(nowDuration)}</span>
            )}
          </div>
          {now ? (
            <>
              <div className="np-screen-progress-track">
                <div className="np-screen-progress-fill" style={{ width: `${nowProgress * 100}%` }} />
              </div>
              <div className="np-screen-title">{now.name}</div>
              <div className="np-screen-artist">{now.artistName}</div>
            </>
          ) : (
            <div className="np-screen-idle">INSERT TAPE</div>
          )}
          {nowMeta ? (
            <div className="np-screen-meta">
              <span>{nowMeta.bpm} BPM</span>
              <img src={imgLine14} alt="" className="np-meta-sep" />
              <span>NRG {nowMeta.nrg}</span>
              <img src={imgLine14} alt="" className="np-meta-sep" />
              <span>MOOD {nowMeta.mood}</span>
            </div>
          ) : (
            <div className="np-screen-meta np-screen-meta--empty">NO DATA</div>
          )}
        </div>
      </div>
      {/* Glass reflection */}
      <div className="np-screen-glass" />
    </div>
  )
}
```

- [ ] **Step 2: In `CassettePlayer.tsx`, delete the local `formatTime` helper (lines 34-38)**

Remove exactly:

```tsx
function formatTime(sec: number) {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
```

(It was only used by the LCD block, which is being replaced. `TrackScreen` now owns time formatting.)

- [ ] **Step 3: Add the `TrackScreen` import to `CassettePlayer.tsx`**

Add after the existing `import { CassetteTapeBody } from './CassetteTapeBody'` line:

```tsx
import { TrackScreen } from './TrackScreen'
```

- [ ] **Step 4: Replace the `.np-screen` block (lines 512-582) with a `<TrackScreen>` render**

The current block computes `nextFeatures`/`nextNorm` inline via an IIFE. Replace the **entire** `{/* ── Screen ── */}` `<div className="np-screen">…</div>` block with:

```tsx
      {/* ── Screen ───────────────────────────────────────── */}
      {(() => {
        const nextFeatures = nextTrack ? featuresMap.get(nextTrack.id) : undefined
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
      })()}
```

(`currentTrack`, `currentFeatures`, `currentNorm`, `nextTrack`, `currentTime`, `duration`, `progress`, `featuresMap`, `normalizer` are all already defined in `CassettePlayer` — see lines 266-288. No new state needed.)

- [ ] **Step 5: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: both exit 0. No "formatTime is declared but never used" and no unused-import errors.

- [ ] **Step 6: Manual visual check**

Run: `npm run dev`, load the player (needs Apple Music auth), confirm the NOW/NEXT LCD looks **identical** to before — title, artist, time, progress bar, `BPM / NRG / MOOD` row, "NO DATA"/"—" placeholders. Report any pixel difference.

- [ ] **Step 7: Commit**

```bash
git add src/components/TrackScreen.tsx src/components/CassettePlayer.tsx
git commit -m "Extract TrackScreen LCD component, reuse in CassettePlayer"
```

---

### Task 2: `useAssetPreloader` hook

Preload every UI image (player + cassette + backgrounds + logo + loading tape) in parallel, reporting 0–1 progress. Never blocks: failures count as loaded, and a safety timeout forces completion.

**Files:**
- Create: `src/hooks/useAssetPreloader.ts`

**Interfaces:**
- Produces: `function useAssetPreloader(): { progress: number; done: boolean }` (progress 0–1)

- [ ] **Step 1: Create `src/hooks/useAssetPreloader.ts`**

```ts
import { useEffect, useRef, useState } from 'react'
import * as PlayerAssets from '../assets/player/playerAssets'
import * as CassetteAssets from '../assets/tapes/cassetteAssets'
import { genreBackgroundMap } from '../assets/background/genreBackgrounds'
import cassette0 from '../assets/tapes/cassette0-body-flat.png'
import bgGeneric from '../assets/background/background-generic.jpg'
import obj1 from '../assets/background/object-generic-1.png'
import obj2 from '../assets/background/object-generic-2.png'
import obj3 from '../assets/background/object-generic-3.png'
import authBg from '../assets/auth/auth-background.jpg'
import logoUrl from '../assets/misc/logo.svg'

/** Flatten a module's exports (and any nested record-of-strings) to image URLs. */
function collectUrls(mod: Record<string, unknown>): string[] {
  const out: string[] = []
  for (const v of Object.values(mod)) {
    if (typeof v === 'string') out.push(v)
    else if (v && typeof v === 'object') {
      for (const inner of Object.values(v as Record<string, unknown>)) {
        if (typeof inner === 'string') out.push(inner)
      }
    }
  }
  return out
}

const SAFETY_MS = 15000

/**
 * Preloads all UI images in parallel. Returns { progress: 0–1, done }.
 * A failed image counts as loaded (never blocks); a safety timeout forces done.
 */
export function useAssetPreloader(): { progress: number; done: boolean } {
  const [loaded, setLoaded] = useState(0)
  const [done, setDone] = useState(false)
  const totalRef = useRef(0)

  useEffect(() => {
    const urls = Array.from(new Set([
      ...collectUrls(PlayerAssets as Record<string, unknown>),
      ...collectUrls(CassetteAssets as Record<string, unknown>),
      ...Object.values(genreBackgroundMap),
      cassette0, bgGeneric, obj1, obj2, obj3, authBg, logoUrl,
    ].filter((u): u is string => typeof u === 'string' && u.length > 0)))

    totalRef.current = urls.length
    if (urls.length === 0) { setDone(true); return }

    let settled = 0
    let cancelled = false
    const bump = () => {
      if (cancelled) return
      settled += 1
      setLoaded(settled)
      if (settled >= urls.length) setDone(true)
    }
    for (const url of urls) {
      const img = new Image()
      img.onload = bump
      img.onerror = bump
      img.src = url
    }
    const safety = setTimeout(() => { if (!cancelled) setDone(true) }, SAFETY_MS)
    return () => { cancelled = true; clearTimeout(safety) }
  }, [])

  const total = totalRef.current
  const progress = done ? 1 : (total > 0 ? loaded / total : 0)
  return { progress, done }
}
```

- [ ] **Step 2: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: both exit 0. (Confirms all import paths resolve — including `cassette0-body-flat.png`, which exists in `src/assets/tapes/`.)

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useAssetPreloader.ts
git commit -m "Add useAssetPreloader hook for background image preloading"
```

---

### Task 3: `LoadingTape` component + styles

The `cassette0` tape composition — spinning reels, body PNG, window, kassette logo, scaled `TrackScreen`, and a loading bar — mirroring `CassetteTapeBody`'s layer stack under a `.loading-tape` scope.

**Files:**
- Create: `src/components/LoadingTape.tsx`
- Modify: `src/index.css` (append `.loading-tape*` rules)

**Interfaces:**
- Consumes: `TrackScreen`, `ScreenTrack`, `ScreenMeta` from Task 1.
- Produces: `function LoadingTape(props: { progress: number; now: ScreenTrack | null; next: ScreenTrack | null; nowMeta: ScreenMeta | null; nextMeta: ScreenMeta | null }): JSX.Element`

- [ ] **Step 1: Create `src/components/LoadingTape.tsx`**

```tsx
import { useEffect, useRef } from 'react'
import { imgLeftReelTape, imgRightReelTape } from '../assets/tapes/cassetteAssets'
import cassette0 from '../assets/tapes/cassette0-body-flat.png'
import logoUrl from '../assets/misc/logo.svg'
import { TrackScreen } from './TrackScreen'
import type { ScreenTrack, ScreenMeta } from './TrackScreen'

interface Props {
  progress: number // 0–1
  now: ScreenTrack | null
  next: ScreenTrack | null
  nowMeta: ScreenMeta | null
  nextMeta: ScreenMeta | null
}

/**
 * The loading-screen cassette. Same layer stack as CassetteTapeBody (reels
 * behind a body PNG + window) but with the kassette logo, the shared LCD, and
 * a loading bar instead of the genre sticker. Reels spin endlessly (~90°/s).
 */
export function LoadingTape({ progress, now, next, nowMeta, nextMeta }: Props) {
  const leftReelRef = useRef<HTMLImageElement>(null)
  const rightReelRef = useRef<HTMLImageElement>(null)
  const angleRef = useRef(0)

  useEffect(() => {
    let lastTime: number | null = null
    let rafId: number
    function frame(time: number) {
      if (lastTime !== null) {
        const dt = Math.min((time - lastTime) / 1000, 0.1)
        angleRef.current += 90 * dt // 90°/s clockwise
      }
      lastTime = time
      const t = `rotate(${angleRef.current}deg)`
      if (leftReelRef.current) leftReelRef.current.style.transform = t
      if (rightReelRef.current) rightReelRef.current.style.transform = t
      rafId = requestAnimationFrame(frame)
    }
    rafId = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(rafId)
  }, [])

  return (
    <div className="loading-tape">
      <div className="ct-body">
        {/* Reels — behind the body, visible through the window */}
        <img ref={leftReelRef} src={imgLeftReelTape} alt="" className="ct-abs ct-reel-left" draggable={false} />
        <img ref={rightReelRef} src={imgRightReelTape} alt="" className="ct-abs ct-reel-right" draggable={false} />

        {/* Body */}
        <div className="ct-abs ct-swapable">
          <img src={cassette0} alt="" draggable={false}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />
        </div>

        {/* Window */}
        <div className="ct-abs ct-window" />

        {/* Shared LCD, scaled into the tape's screen area */}
        <div className="loading-tape-screen">
          <TrackScreen
            now={now}
            nowTime={0}
            nowDuration={0}
            nowProgress={0}
            nowMeta={nowMeta}
            next={next}
            nextMeta={nextMeta}
          />
        </div>

        {/* kassette logo */}
        <img src={logoUrl} alt="Kassette" className="loading-tape-logo" draggable={false} />

        {/* Loading bar */}
        <div className="loading-tape-bar">
          <div className="loading-tape-bar-fill" style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }} />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Append `.loading-tape*` styles to `src/index.css`**

These reuse the existing `.ct-body` / `.ct-abs` / `.ct-reel-*` / `.ct-window` rules (already in `index.css` at ~line 753). The `.loading-tape` sets the tape size via `--cw`/`--ch` (same variables `.cassette-body` uses). Positions are starting values to be tuned in the browser (Task 5, Step 6).

```css
/* ── Loading-screen tape ─────────────────────────────────── */
.loading-tape {
  --cw: 495px;   /* 330 * 1.5 */
  --ch: 330px;   /* 220 * 1.5 */
  position: relative;
  width: var(--cw);
  height: var(--ch);
}
.loading-tape .ct-body {
  position: absolute;
  inset: 0;
}

/* Shared LCD, shrunk from its 410×67 player size into the tape screen area.
   410 * 0.62 ≈ 254px wide. Positions are tuned in the browser. */
.loading-tape-screen {
  position: absolute;
  left: 50%;
  top: 20%;
  transform: translateX(-50%) scale(0.62);
  transform-origin: top center;
  z-index: 5;
}

.loading-tape-logo {
  position: absolute;
  left: 12%;
  bottom: 20%;
  width: 26%;
  height: auto;
  z-index: 5;
}

.loading-tape-bar {
  position: absolute;
  left: 22%;
  right: 22%;
  bottom: 14%;
  height: 6px;
  background: rgba(0, 0, 0, 0.35);
  border-radius: 3px;
  overflow: hidden;
  z-index: 5;
}
.loading-tape-bar-fill {
  height: 100%;
  background: #ffd34d; /* amber, matches the Figma bar */
  border-radius: 3px;
  transition: width 0.25s ease;
}
```

- [ ] **Step 3: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/components/LoadingTape.tsx src/index.css
git commit -m "Add LoadingTape component (cassette0 tape with reels, LCD, logo, bar)"
```

---

### Task 4: `LoadingScreen` orchestrator + styles

The full loading screen: phase machine (`red → concrete` after ~1s), background crossfade, heading, drifting/rotating tape with animated drop-shadow, fast LCD track cycling (real-if-cached meta else random), combined progress, and `onComplete` when everything's ready.

**Files:**
- Create: `src/components/LoadingScreen.tsx`
- Modify: `src/index.css` (append `.ls-*` rules)

**Interfaces:**
- Consumes: `LoadingTape` (Task 3); `ScreenTrack`/`ScreenMeta` (Task 1); `useAssetPreloader` (Task 2); `buildNormalizer` from `../services/featureNormalize`; `Track` from `../types/music`; `TrackFeatures` from `../services/featureCache`.
- Produces: `function LoadingScreen(props: { libraryProgress: number; libraryDone: boolean; tracksPool: Track[]; featuresMap: Map<string, TrackFeatures>; onComplete: () => void }): JSX.Element`

- [ ] **Step 1: Create `src/components/LoadingScreen.tsx`**

```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import type { Track } from '../types/music'
import type { TrackFeatures } from '../services/featureCache'
import { buildNormalizer } from '../services/featureNormalize'
import { useAssetPreloader } from '../hooks/useAssetPreloader'
import { LoadingTape } from './LoadingTape'
import type { ScreenTrack, ScreenMeta } from './TrackScreen'
import authBg from '../assets/auth/auth-background.jpg'

const INTRO_MS = 1000        // red phase duration before crossfade to concrete
const CYCLE_MS = 450         // LCD track cycle interval

interface Props {
  libraryProgress: number   // 0–100
  libraryDone: boolean
  tracksPool: Track[]
  featuresMap: Map<string, TrackFeatures>
  onComplete: () => void
}

/** A random integer in [min, max]. Index-free, purely visual. */
function randInt(min: number, max: number) {
  return Math.floor(min + Math.random() * (max - min + 1))
}

export function LoadingScreen({ libraryProgress, libraryDone, tracksPool, featuresMap, onComplete }: Props) {
  const [phase, setPhase] = useState<'red' | 'concrete'>('red')
  const [exiting, setExiting] = useState(false)
  const [now, setNow] = useState<ScreenTrack | null>(null)
  const [next, setNext] = useState<ScreenTrack | null>(null)
  const [nowMeta, setNowMeta] = useState<ScreenMeta | null>(null)
  const [nextMeta, setNextMeta] = useState<ScreenMeta | null>(null)

  const { progress: assetProgress, done: assetDone } = useAssetPreloader()
  const normalizer = useMemo(() => buildNormalizer(featuresMap), [featuresMap])

  // Keep the latest pool/features/normalizer in refs so the cycle interval
  // (set up once) always reads fresh values without resetting.
  const poolRef = useRef(tracksPool)
  const featRef = useRef(featuresMap)
  const normRef = useRef(normalizer)
  poolRef.current = tracksPool
  featRef.current = featuresMap
  normRef.current = normalizer

  // Phase: red → concrete after the intro beat.
  useEffect(() => {
    const t = setTimeout(() => setPhase('concrete'), INTRO_MS)
    return () => clearTimeout(t)
  }, [])

  // Fast LCD cycling — real meta if cached, else random.
  useEffect(() => {
    function metaFor(track: Track | undefined): ScreenMeta {
      if (track) {
        const f = featRef.current.get(track.id)
        if (f) {
          const n = normRef.current.normalize(f)
          return { bpm: f.bpm, nrg: n.energy, mood: n.mood }
        }
      }
      return { bpm: randInt(60, 180), nrg: randInt(0, 100), mood: randInt(0, 100) }
    }
    function toScreen(t: Track | undefined): ScreenTrack | null {
      return t ? { name: t.name, artistName: t.artistName } : null
    }
    function tick() {
      const pool = poolRef.current
      if (pool.length === 0) return
      const a = pool[randInt(0, pool.length - 1)]
      const b = pool[randInt(0, pool.length - 1)]
      setNow(toScreen(a)); setNowMeta(metaFor(a))
      setNext(toScreen(b)); setNextMeta(metaFor(b))
    }
    tick()
    const id = setInterval(tick, CYCLE_MS)
    return () => clearInterval(id)
  }, [])

  // Begin the exit fade when library + assets are ready AND the intro elapsed.
  // The player is already mounted underneath (App renders it once cassettes
  // exist), so fading .ls-root out crossfades to it.
  const firedRef = useRef(false)
  useEffect(() => {
    if (firedRef.current) return
    if (libraryDone && assetDone && phase === 'concrete') {
      firedRef.current = true
      setExiting(true)
    }
  }, [libraryDone, assetDone, phase])

  const combined = 0.5 * (Math.min(100, libraryProgress) / 100) + 0.5 * assetProgress
  const concrete = phase === 'concrete'

  return (
    <motion.div
      className="ls-root"
      initial={{ opacity: 1 }}
      animate={{ opacity: exiting ? 0 : 1 }}
      transition={{ duration: 0.45, ease: 'easeInOut' }}
      onAnimationComplete={() => { if (exiting) onComplete() }}
    >
      {/* Background layers: red (state 1) crossfades to concrete (state 2). */}
      <div className="ls-bg ls-bg-red" style={{ opacity: concrete ? 0 : 1 }} />
      <div className="ls-bg ls-bg-concrete" style={{ opacity: concrete ? 1 : 0, backgroundImage: `url(${authBg})` }} />

      {/* Heading — fades in with the concrete phase. */}
      <div className="ls-heading" style={{ opacity: concrete ? 1 : 0 }}>
        <div className="ls-heading-top">LOADING YOUR LIBRARY</div>
        <div className="ls-heading-main">BUILDING YOUR KASSETTES</div>
      </div>

      {/* Tape — fades in on mount, drifts + rotates, shadow animates in on concrete. */}
      <motion.div
        className="ls-tape-wrap"
        initial={{ opacity: 0 }}
        animate={{
          opacity: 1,
          x: [-10, 12],
          y: [-8, 10],
          rotate: [-2, 2.5],
        }}
        transition={{
          opacity: { duration: 0.6, ease: 'easeOut' },
          x: { duration: 5, ease: 'easeInOut', repeat: Infinity, repeatType: 'reverse' },
          y: { duration: 6, ease: 'easeInOut', repeat: Infinity, repeatType: 'reverse' },
          rotate: { duration: 7, ease: 'easeInOut', repeat: Infinity, repeatType: 'reverse' },
        }}
      >
        <motion.div
          animate={{ filter: concrete ? 'drop-shadow(0 40px 55px rgba(0,0,0,0.5))' : 'drop-shadow(0 0px 0px rgba(0,0,0,0))' }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        >
          <LoadingTape progress={combined} now={now} next={next} nowMeta={nowMeta} nextMeta={nextMeta} />
        </motion.div>
      </motion.div>
    </motion.div>
  )
}
```

- [ ] **Step 2: Append `.ls-*` styles to `src/index.css`**

```css
/* ── Loading screen (post-auth library load) ─────────────── */
.ls-root {
  position: fixed;
  inset: 0;
  z-index: 50;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ls-bg {
  position: absolute;
  inset: 0;
  transition: opacity 0.6s ease;
}
.ls-bg-red {
  background: linear-gradient(180deg, #E20025 0%, #ff2937 100%);
}
.ls-bg-concrete {
  background-size: cover;
  background-position: center;
}
.ls-heading {
  position: absolute;
  top: 12%;
  left: 0;
  right: 0;
  text-align: center;
  transition: opacity 0.6s ease;
  pointer-events: none;
}
.ls-heading-top {
  font-family: 'Afacad', sans-serif;
  font-weight: 700;
  font-size: 1rem;
  letter-spacing: 0.08em;
  color: #E20025;
  text-transform: uppercase;
}
.ls-heading-main {
  font-family: 'Afacad', sans-serif;
  font-weight: 700;
  font-size: clamp(2rem, 4vw, 3.25rem);
  letter-spacing: 0.01em;
  color: #1a1414;
  text-transform: uppercase;
  line-height: 1.05;
}
.ls-tape-wrap {
  position: relative;
  z-index: 2;
}
```

- [ ] **Step 3: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/components/LoadingScreen.tsx src/index.css
git commit -m "Add LoadingScreen orchestrator (phase machine, crossfade, drift, LCD cycling)"
```

---

### Task 5: Stream library tracks + wire `LoadingScreen` into `App`

Extend `fetchLibraryTracks` to stream partial tracks, then swap the old loading card for `<LoadingScreen>`, gating the player reveal on library-done **and** assets-done. Full-flow verification.

**Files:**
- Modify: `src/services/appleMusic.ts:54-90` (`onProgress` signature + call sites)
- Modify: `src/App.tsx` (loading branch, `loadingComplete` + `tracksSoFar` state, sign-out reset)

**Interfaces:**
- Consumes: `LoadingScreen` (Task 4).
- Produces: `fetchLibraryTracks(onProgress?: (loaded: number, total: number, tracksSoFar: Track[]) => void): Promise<Track[]>`

- [ ] **Step 1: Extend `fetchLibraryTracks`'s `onProgress` in `src/services/appleMusic.ts`**

Change the signature (line 54-56) to:

```ts
export async function fetchLibraryTracks(
  onProgress?: (loaded: number, total: number, tracksSoFar: Track[]) => void
): Promise<Track[]> {
```

And replace the progress-firing block (currently lines 75-80) so it fires on **every** batch (including the last) and passes the accumulating array:

```ts
    if (response.data.next && items.length === limit) {
      offset += limit
      onProgress?.(tracks.length, tracks.length + limit, tracks)
    } else {
      hasMore = false
      onProgress?.(tracks.length, tracks.length, tracks)
    }
```

- [ ] **Step 2: Add loading state to `App.tsx`**

Add alongside the existing `const [introDone, setIntroDone] = useState(false)` (line 50):

```tsx
  const [loadingComplete, setLoadingComplete] = useState(false)
  const [tracksSoFar, setTracksSoFar] = useState<Track[]>([])
```

Add the `Track` type import to the top of `App.tsx` (it has no type imports yet):

```tsx
import type { Track } from './types/music'
```

- [ ] **Step 3: Feed streamed tracks into state inside `loadLibrary`**

In the `loadLibrary` function (lines 81-100), change the `fetchLibraryTracks` call so its callback also stores the partial tracks:

```tsx
        const tracks = await fetchLibraryTracks((loaded, est, soFar) => {
          setLoadingProgress(Math.min(95, (loaded / est) * 95))
          setTracksSoFar([...soFar])
        })
```

(Spreading `soFar` gives React a new array reference each tick so `LoadingScreen`'s `tracksPool` prop updates.)

- [ ] **Step 4: Render `<LoadingScreen>` as a fading overlay above the player**

For a real *crossfade* (not an instant cut) the player must already be mounted **underneath** the loading screen when it fades out. So `LoadingScreen` becomes an **overlay** rendered alongside `screen` (the same pattern `AuthIntro` uses over `AuthScreen`), and the base `screen` renders the player as soon as cassettes exist.

Add the import near the other component imports:

```tsx
import { LoadingScreen } from './components/LoadingScreen'
```

Add store selectors near the other `App` store reads (line ~38-48):

```tsx
  const featuresMap = usePlayerStore((s) => s.featuresMap)
  const cassettes = useMusicStore((s) => s.cassettes)
```

Rewrite the `screen` branch chain (currently `if (!isAuthenticated) … else if (isLoading) … else if (error) … else …`, lines 105-177) so the loading card is **removed** from `screen` and the player renders once cassettes are built:

```tsx
  let screen
  if (!isAuthenticated) {
    screen = (
      <>
        <AuthScreen vhs={vhsVals} />
        {!introDone && <AuthIntro onDone={() => setIntroDone(true)} />}
      </>
    )
  } else if (error) {
    screen = (
      /* …existing error card, unchanged… */
    )
  } else if (cassettes.length > 0) {
    screen = (
      /* …existing player screen (SceneBackground + .app …), unchanged… */
    )
  }
  // While the library is still fetching (authed, no error, cassettes not built
  // yet), `screen` stays undefined — the opaque LoadingScreen overlay covers the
  // viewport. Gating the player on cassettes.length > 0 also avoids a one-render
  // race where the player would mount before loadLibrary populates the store.
```

Then render `LoadingScreen` as an overlay in the return, between `{screen}` and `<VhsOverlay />`:

```tsx
  return (
    <>
      {screen}
      {isAuthenticated && !error && !loadingComplete && (
        <LoadingScreen
          libraryProgress={loadingProgress}
          libraryDone={!isLoading && loadingProgress >= 100}
          tracksPool={tracksSoFar}
          featuresMap={featuresMap}
          onComplete={() => setLoadingComplete(true)}
        />
      )}
      {/* VHS overlay + tuning panel — on top of every screen, click-through */}
      <VhsOverlay />
      <VhsDebug vals={vhsVals} onChange={setVhs} />
    </>
  )
```

Flow: authed → overlay shows (red) while fetching → library builds cassettes → player mounts under the still-opaque overlay → assets finish → `LoadingScreen` fades `.ls-root` out (crossfade to the player) → `onComplete` sets `loadingComplete`, unmounting the overlay. A fetch `error` is checked first, so it still routes to the error card (and the overlay hides because `!error` is false).

- [ ] **Step 5: Reset loading state on sign-out**

In the sign-out `onClick` (currently sets `setIntroDone(false)` at line 157), also reset:

```tsx
              setIntroDone(false) // replay the intro loader next time auth is shown
              setLoadingComplete(false)
              setTracksSoFar([])
```

- [ ] **Step 6: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: both exit 0.

- [ ] **Step 7: Full-flow manual verification**

Run: `npm run dev`, sign in with Apple Music, and confirm:
1. Immediately after connect: the red screen shows with the tape fading in, reels spinning, LCD cycling **real** song names/artists fast, meta numbers present.
2. After ~1s: red crossfades to concrete; the "LOADING YOUR LIBRARY / BUILDING YOUR KASSETTES" heading fades in; a drop-shadow appears under the tape; the tape drifts + rotates slightly.
3. The loading bar fills toward 100% as the library + assets load.
4. Only after both the library is done AND assets are preloaded does it crossfade to the player (no asset pop-in on the player).
5. Sign out, sign back in → the loading screen replays cleanly.

Report the tape/LCD/logo/bar placement — expect to tune `.loading-tape-screen`, `.loading-tape-logo`, `.loading-tape-bar`, and `.loading-tape` `--cw/--ch` in `index.css` to match the Figma (nodes `75:136` / `75:15`).

- [ ] **Step 8: Commit**

```bash
git add src/services/appleMusic.ts src/App.tsx
git commit -m "Wire LoadingScreen into App; stream library tracks to the LCD"
```

---

## Notes for the implementer

- After Task 5, expect a **visual tuning pass** (the user will nudge pixel values in `index.css` for the tape internals). The plan gets placement close; exact Figma match is a follow-up conversation, not part of these tasks.
- If `npm run lint` flags `react-hooks/exhaustive-deps` on `LoadingScreen`'s cycle effect (it intentionally reads refs and runs once), prefer the ref pattern already used (do not add `tracksPool`/`featuresMap` to the deps — that would reset the interval every stream tick). Match the existing codebase convention: an `// eslint-disable-next-line react-hooks/exhaustive-deps` above the dep array is used elsewhere (e.g. `CassettePlayer.tsx:190`) and is acceptable here.
- SFX preloading is intentionally out of scope (only images cause visible pop-in).
