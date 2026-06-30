# Per-Genre Tape-Selection Backgrounds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the blur/white overlays behind the cassette carousel with a per-genre photo background that diagonal-wipes between tapes (direction follows navigation) and fades out on insert.

**Architecture:** A new always-mounted `GenreBackground` component renders the selected genre's photo in the z-band the old overlays used. It keeps a small stack of photo layers; on genre change it pushes an incoming layer that animates a slanted `clip-path` from a sliver to full coverage, then drops the layers beneath. Whole-layer visibility (fade in/out) is driven by `AnimatePresence` keyed on `!isInserted && !isInserting`, exactly like the overlays it replaces.

**Tech Stack:** React 19 + TypeScript (`verbatimModuleSyntax` — use `import type`), Zustand v5, Framer Motion v12, Vite. No test runner exists; verification is `npm run build` (tsc + vite) + `npm run lint` + manual browser checks on the running dev server.

## Global Constraints

- TypeScript `verbatimModuleSyntax` is enabled — type-only imports MUST use `import type`.
- MusicKit/assets are imported as Vite module imports (no CDN/Figma URLs) — follow the existing pattern in `cassetteAssets.ts`.
- Genre names are the exact `Genre` union values from `src/types/music.ts`: `'Rock' | 'Hip-Hop' | 'Electronic' | 'Reggae' | 'Classical' | 'Folk' | 'Jazz' | 'Pop'`.
- Background files already exist in `src/assets/background/`: `tape_back_{rock,hiphop,electro,reggae,classical,folk,jazz,pop}.jpg`. Note the two name mismatches: `Hip-Hop → hiphop`, `Electronic → electro`.
- The dev server is started with `npm run dev` (http://localhost:5173). Apple Music auth + a loaded library is required to see the carousel.

---

### Task 1: Genre→background map and pure wipe-direction helper

**Files:**
- Create: `src/assets/background/genreBackgrounds.ts`
- Verify (throwaway, not committed): `scratchpad/verify-direction.ts`

**Interfaces:**
- Consumes: `Genre` type and `tape_back_*.jpg` assets.
- Produces:
  - `backgroundForGenre(genre: string): string` — returns the imported asset URL for the genre, or the generic background as fallback.
  - `getWipeDirection(prev: number, next: number, n: number): 'left' | 'right'` — shortest-path-around-the-ring direction for a carousel index change.
  - `genreBackgroundMap: Record<string, string>` — single source of truth for genre→photo.

- [ ] **Step 1: Create the map + helpers**

Create `src/assets/background/genreBackgrounds.ts`:

```ts
// Single source of truth for genre → tape-selection background photo.
// Edit genreBackgroundMap to reassign a photo to a genre.
import bgGeneric from './background-generic.jpg'
import tapeBackRock from './tape_back_rock.jpg'
import tapeBackHiphop from './tape_back_hiphop.jpg'
import tapeBackElectro from './tape_back_electro.jpg'
import tapeBackReggae from './tape_back_reggae.jpg'
import tapeBackClassical from './tape_back_classical.jpg'
import tapeBackFolk from './tape_back_folk.jpg'
import tapeBackJazz from './tape_back_jazz.jpg'
import tapeBackPop from './tape_back_pop.jpg'

export const genreBackgroundMap: Record<string, string> = {
  'Rock': tapeBackRock,
  'Hip-Hop': tapeBackHiphop,
  'Electronic': tapeBackElectro,
  'Reggae': tapeBackReggae,
  'Classical': tapeBackClassical,
  'Folk': tapeBackFolk,
  'Jazz': tapeBackJazz,
  'Pop': tapeBackPop,
}

export function backgroundForGenre(genre: string): string {
  return genreBackgroundMap[genre] ?? bgGeneric
}

// Direction of the wipe when the carousel moves from index `prev` to `next`
// across `n` genres, taking the shortest path around the ring so wrapping
// from the last tape to the first still reads as "right".
export function getWipeDirection(prev: number, next: number, n: number): 'left' | 'right' {
  if (n <= 1 || prev === next) return 'right'
  const rightDist = (((next - prev) % n) + n) % n
  const leftDist = (((prev - next) % n) + n) % n
  return rightDist <= leftDist ? 'right' : 'left'
}
```

- [ ] **Step 2: Write a throwaway verification for the pure helper**

Create `scratchpad/verify-direction.ts` (uses the scratchpad dir — never committed):

```ts
import { getWipeDirection } from '../src/assets/background/genreBackgrounds'

const cases: Array<[number, number, number, 'left' | 'right']> = [
  [0, 1, 8, 'right'],   // step forward
  [1, 0, 8, 'left'],    // step back
  [7, 0, 8, 'right'],   // wrap forward (last → first)
  [0, 7, 8, 'left'],    // wrap back (first → last)
  [0, 4, 8, 'right'],   // exactly halfway → tie resolves right
  [0, 5, 8, 'left'],    // past halfway → left
  [3, 3, 8, 'right'],   // no move
]
let ok = true
for (const [p, nx, n, want] of cases) {
  const got = getWipeDirection(p, nx, n)
  const pass = got === want
  ok = ok && pass
  console.log(`${pass ? 'PASS' : 'FAIL'} getWipeDirection(${p},${nx},${n}) = ${got} (want ${want})`)
}
process.exit(ok ? 0 : 1)
```

- [ ] **Step 3: Run the verification and confirm it fails to import nothing / passes**

Run from the repo root: `npx tsx scratchpad/verify-direction.ts`
Expected: seven `PASS` lines and exit 0. (`npx tsx` may download `tsx` on first run; if offline, instead reason through the truth table above — each line states the expected output.)

- [ ] **Step 4: Run the build to confirm the new module type-checks**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors. (This confirms all eight asset imports resolve.)

- [ ] **Step 5: Commit**

```bash
git add src/assets/background/genreBackgrounds.ts
git commit -m "Add genre background map and wipe-direction helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: GenreBackground component (static photo + scrim + fade), wired into the carousel

This task makes the genre photo replace the old overlays — static (no wipe yet), with the
correct fade-in on appear and fade-out on insert. The wipe is added in Task 3.

**Files:**
- Create: `src/components/GenreBackground.tsx`
- Modify: `src/components/CassetteCarousel.tsx` (remove the two overlay blocks, render `<GenreBackground />`)
- Modify: `src/index.css` (remove `.carousel-blur-overlay` + `.carousel-white-overlay`, add `.genre-bg-*`)

**Interfaces:**
- Consumes: `backgroundForGenre`, `getWipeDirection` from Task 1; `useMusicStore` (`cassettes`, `selectedCassetteIndex`); `usePlayerStore` (`isInserted`).
- Produces: `GenreBackground` React component taking `{ isInserting: boolean }`.

- [ ] **Step 1: Confirm player and insert-button z-indexes are below the carousel and the planned z-index 20**

Run: `grep -n "z-index" src/index.css`
Expected: confirm the player wrapper sits below `20` (the old `.carousel-blur-overlay` used `z-index: 20` and already covered the player) and that `.carousel-wrapper` (`z-index: 30`) and the floating insert button sit above `20`. If the insert button is at or below `20`, note its actual value — the `.genre-bg-root` must stay below it. Adjust `.genre-bg-root` z-index in Step 4 only if this check shows a conflict; otherwise use `20`.

- [ ] **Step 2: Create the component (static, no wipe yet)**

Create `src/components/GenreBackground.tsx`:

```tsx
import { motion, AnimatePresence } from 'framer-motion'
import { useMusicStore } from '../store/musicStore'
import { usePlayerStore } from '../store/playerStore'
import { backgroundForGenre } from '../assets/background/genreBackgrounds'

interface GenreBackgroundProps {
  isInserting: boolean
}

export function GenreBackground({ isInserting }: GenreBackgroundProps) {
  const cassettes = useMusicStore((s) => s.cassettes)
  const selectedIndex = useMusicStore((s) => s.selectedCassetteIndex)
  const isInserted = usePlayerStore((s) => s.isInserted)

  const genre = cassettes[selectedIndex]?.genre
  const src = genre ? backgroundForGenre(genre) : null
  const visible = !isInserted && !isInserting

  return (
    <AnimatePresence>
      {visible && src && (
        <motion.div
          key="genre-bg"
          className="genre-bg-root"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
        >
          <img src={src} alt="" className="genre-bg-photo" />
          <div className="genre-bg-scrim" />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
```

- [ ] **Step 3: Wire it into the carousel and remove the old overlays**

In `src/components/CassetteCarousel.tsx`:

Add the import near the other component imports (after the `CassetteTapeBody` import):

```tsx
import { GenreBackground } from './GenreBackground'
```

Delete BOTH overlay blocks — the entire `<AnimatePresence>` wrapping `key="blur-overlay"` and the entire `<AnimatePresence>` wrapping `key="white-overlay"` (lines ~170–194 in the current file). Replace them with a single line as the first child inside the returned `<>`:

```tsx
      <GenreBackground isInserting={isInserting} />
```

Leave the `carousel-wrapper` `AnimatePresence` and the `insert-btn` `AnimatePresence` unchanged.

- [ ] **Step 4: Replace the overlay CSS with genre-bg styles**

In `src/index.css`, delete the `.carousel-blur-overlay { ... }` rule (with its comment) and the `.carousel-white-overlay { ... }` rule (with its comment), then add in their place:

```css
/* ─── Genre background — per-tape photo behind the carousel ─── */
.genre-bg-root {
  position: fixed;
  inset: 0;
  z-index: 20;
  pointer-events: none;
  overflow: hidden;
}

.genre-bg-photo {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
}

/* Subtle dark scrim so white cassettes + Insert Tape button stay legible */
.genre-bg-scrim {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0.45) 0%,
    rgba(0, 0, 0, 0.22) 40%,
    rgba(0, 0, 0, 0.5) 100%
  );
}
```

(If Step 1 found the insert button at z-index ≤ 20, set `.genre-bg-root` z-index to one less than the button instead — it must cover the player but stay below the button and carousel.)

- [ ] **Step 5: Build and lint**

Run: `npm run build && npm run lint`
Expected: both succeed with no errors. (`tsc` confirms the prop type and store selectors; eslint confirms no unused imports — the removed overlays leave no dangling references.)

- [ ] **Step 6: Manual browser verification**

Start the dev server if not running: `npm run dev`, open http://localhost:5173, connect Apple Music, and reach the carousel.
Confirm, with your own eyes:
- The selected tape's genre photo fills the screen behind the floating cassettes (no blur), with a subtle dark scrim — cassettes and the "Insert Tape" button are clearly legible.
- Arrowing/dragging to another tape swaps the photo (it will hard-cut for now — the wipe comes in Task 3).
- Clicking "Insert Tape" fades the photo out as the cassette flies into the player, revealing the player (generic scene background + decorative objects).
- Ejecting fades a genre photo back in.

- [ ] **Step 7: Commit**

```bash
git add src/components/GenreBackground.tsx src/components/CassetteCarousel.tsx src/index.css
git commit -m "Replace carousel blur overlays with per-genre photo background

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Diagonal directional wipe between genre photos

Upgrade `GenreBackground` to keep a stack of photo layers and animate a slanted
`clip-path` on the incoming layer, with direction from `getWipeDirection`.

**Files:**
- Modify: `src/components/GenreBackground.tsx`

**Interfaces:**
- Consumes: `getWipeDirection` from Task 1 (already importable).
- Produces: no new exports — same `GenreBackground` component, now animating.

- [ ] **Step 1: Replace the component body with the layered wipe implementation**

Rewrite `src/components/GenreBackground.tsx` to:

```tsx
import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useMusicStore } from '../store/musicStore'
import { usePlayerStore } from '../store/playerStore'
import { backgroundForGenre, getWipeDirection } from '../assets/background/genreBackgrounds'

interface GenreBackgroundProps {
  isInserting: boolean
}

type WipeDir = 'left' | 'right' | 'none'
interface Layer {
  id: number
  src: string
  direction: WipeDir
}

// Slant of the diagonal seam, as a percentage of width.
const SLANT = 18

// clip-path polygon for the incoming photo. Each polygon has 4 vertices so
// Framer can interpolate start → end vertex-by-vertex, sweeping the seam.
function clipPath(direction: WipeDir, phase: 'start' | 'end'): string {
  const full = 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)'
  if (direction === 'none') return full
  if (direction === 'right') {
    // Visible (new) region is to the RIGHT of the seam; seam sweeps right → left.
    return phase === 'start'
      ? `polygon(${100 + SLANT}% 0%, 100% 0%, 100% 100%, 100% 100%)`
      : `polygon(0% 0%, 100% 0%, 100% 100%, ${-SLANT}% 100%)`
  }
  // left: visible region is to the LEFT of the seam; seam sweeps left → right.
  return phase === 'start'
    ? `polygon(0% 0%, ${-SLANT}% 0%, 0% 100%, 0% 100%)`
    : `polygon(0% 0%, 100% 0%, ${100 + SLANT}% 100%, 0% 100%)`
}

export function GenreBackground({ isInserting }: GenreBackgroundProps) {
  const cassettes = useMusicStore((s) => s.cassettes)
  const selectedIndex = useMusicStore((s) => s.selectedCassetteIndex)
  const isInserted = usePlayerStore((s) => s.isInserted)

  const n = cassettes.length
  const genre = cassettes[selectedIndex]?.genre
  const src = genre ? backgroundForGenre(genre) : null

  const prevIndexRef = useRef(selectedIndex)
  const idRef = useRef(0)
  const [layers, setLayers] = useState<Layer[]>([])

  // Seed the first layer, and push an incoming wipe layer on each genre change.
  useEffect(() => {
    if (!src || n === 0) return
    setLayers((prev) => {
      if (prev.length === 0) {
        prevIndexRef.current = selectedIndex
        return [{ id: ++idRef.current, src, direction: 'none' }]
      }
      // Same genre (e.g. two genres share a photo) → no new layer.
      if (prev[prev.length - 1].src === src) {
        prevIndexRef.current = selectedIndex
        return prev
      }
      const direction = getWipeDirection(prevIndexRef.current, selectedIndex, n)
      prevIndexRef.current = selectedIndex
      return [...prev, { id: ++idRef.current, src, direction }]
    })
  }, [src, selectedIndex, n])

  const visible = !isInserted && !isInserting

  return (
    <AnimatePresence>
      {visible && layers.length > 0 && (
        <motion.div
          key="genre-bg"
          className="genre-bg-root"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
        >
          {layers.map((layer, i) => {
            const isTop = i === layers.length - 1
            const wipes = isTop && layer.direction !== 'none'
            return (
              <motion.img
                key={layer.id}
                src={layer.src}
                alt=""
                className="genre-bg-photo"
                initial={wipes ? { clipPath: clipPath(layer.direction, 'start') } : false}
                animate={{ clipPath: clipPath(layer.direction, 'end') }}
                transition={{ duration: 0.5, ease: [0, 0, 0.58, 1] }}
                onAnimationComplete={() => {
                  // Once the top layer has fully covered the screen, drop the
                  // layers beneath it (their removal is invisible).
                  if (isTop && layers.length > 1) {
                    setLayers((cur) => cur.slice(-1))
                  }
                }}
              />
            )
          })}
          <div className="genre-bg-scrim" />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
```

- [ ] **Step 2: Build and lint**

Run: `npm run build && npm run lint`
Expected: both succeed with no errors.

- [ ] **Step 3: Manual browser verification**

On the running dev server (carousel reached):
- Arrow/click RIGHT (next tape): the new genre photo wipes in from the **right** edge with a diagonal seam sweeping left.
- Arrow/click LEFT (previous tape): the new photo wipes in from the **left** edge.
- Wrap-around: from the LAST tape pressing right to reach the FIRST tape wipes **right** (not left); from the first pressing left to the last wipes **left**.
- Drag quickly across several tapes: photos wipe per genre change without leaving stale layers stacked (background settles on the final genre's photo).
- Two genres sharing the same photo (per `genreBackgroundMap` there are none by default — skip unless a duplicate is later introduced): switching between them does not trigger a redundant wipe.
- Insert still fades the whole background out; eject fades it back in.

- [ ] **Step 4: Clean up the throwaway verification file**

Run: `rm -f scratchpad/verify-direction.ts`
Expected: no error. (It lives in the scratchpad and was never committed.)

- [ ] **Step 5: Commit**

```bash
git add src/components/GenreBackground.tsx
git commit -m "Add diagonal directional wipe between genre backgrounds

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Per-genre photo replaces blur — Task 2 (component + overlay removal + CSS). ✓
- Subtle dark scrim for legibility — Task 2 Step 4 (`.genre-bg-scrim`). ✓
- Background changes on tape switch — Task 2 (static swap) → Task 3 (animated). ✓
- Diagonal wipe — Task 3 (`clipPath` polygons). ✓
- Direction follows navigation, shortest-path ring incl. wrap — Task 1 (`getWipeDirection`) + Task 3 wiring. ✓
- Fade out on insert (same feel as blur disappearing) — Task 2 Step 2 (`AnimatePresence` exit, 0.4s, gated on `!isInserted && !isInserting`). ✓
- Genre→file mapping incl. `hiphop`/`electro` mismatches + generic fallback — Task 1. ✓
- Layering (above player, below carousel) — Task 2 Step 1 check + `z-index: 20`. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases" — every code step shows complete code; every run step states expected output. ✓

**Type consistency:** `backgroundForGenre` / `getWipeDirection` / `genreBackgroundMap` signatures defined in Task 1 are used unchanged in Tasks 2–3. `GenreBackground` prop `{ isInserting: boolean }` is consistent between its definition (Task 2/3) and its call site in `CassetteCarousel` (Task 2 Step 3). `WipeDir` and `clipPath` are internal to Task 3. ✓
