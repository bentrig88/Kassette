# Per-Genre Tape-Selection Backgrounds — Design

**Date:** 2026-06-30
**Status:** Approved, pending implementation plan

## Summary

Replace the blurred/white overlay shown behind the floating cassette carousel during
tape selection with a dedicated full-screen photo background for the currently-selected
genre. Switching tapes triggers a diagonal line-wipe transition between photos whose
direction follows the navigation direction. Tapping "Insert Tape" fades the genre
background out (same feel as the current blur disappearance), revealing the player.

## Current behavior (baseline)

During tape selection (`!isInserted`), `CassetteCarousel` renders two stacked overlays:

- `.carousel-blur-overlay` — `z-index: 20`, `backdrop-filter: blur(10px)` + `rgba(0,0,0,0.35)`.
- `.carousel-white-overlay` — `z-index: 15`, `rgba(255,255,255,0.4)`.

Both mount when `!isInserted && !isInserting` and fade (`opacity` 0→1→0, 0.4s) via
`AnimatePresence`. They exit the moment `isInserting` becomes `true` (lift start), which
fades the blur away as the cassette flies into the player.

The persistent `SceneBackground` (`z-index: 0`) renders `background-generic.jpg` plus
three decorative objects and sits behind everything, including the player. The two
overlays dim/blur this scene + player during selection.

## Target behavior

- During tape selection, a per-genre photo (`tape_back_<genre>.jpg`) fills the screen in
  the z-band the old overlays occupied (above the player, below the carousel at `z 30`).
- A subtle dark scrim sits on top of the photo so white cassettes and the "Insert Tape"
  button stay legible on any photo.
- Switching the selected tape plays a diagonal line-wipe between the outgoing and incoming
  photos; the wipe direction follows the navigation direction.
- Tapping "Insert Tape" fades the whole genre-background layer to `opacity 0` over ~0.4s,
  revealing the player (the persistent `SceneBackground` + decorative objects remain as the
  playback backdrop). Ejecting fades it back in.

## Components & changes

### New: `src/components/GenreBackground.tsx`

A fixed, full-screen layer (`position: fixed; inset: 0; pointer-events: none`) rendered by
`CassetteCarousel`. Responsibilities:

- Read `selectedCassetteIndex` (→ selected cassette → genre) from `musicStore` and the
  `cassettes` array; read `isInserted` / `isInserting` to drive the fade-out/in.
- Render the genre photo(s) and the scrim.
- Manage the diagonal wipe between the previous and current genre photo.

Mount/unmount + fade is controlled by `AnimatePresence` keyed on the selection state,
mirroring the old overlays: present when `!isInserted && !isInserting`, exit (fade to
`opacity 0`, ~0.4s) when `isInserting` becomes `true`.

### New: genre → background map

Co-located with the background assets (e.g. `src/assets/background/genreBackgrounds.ts`),
importing each `tape_back_*.jpg` via Vite module imports (no expiring CDN URLs), exporting:

```ts
export const genreBackgroundMap: Record<string, string> = {
  'Rock':       tapeBackRock,
  'Hip-Hop':    tapeBackHiphop,    // file: tape_back_hiphop.jpg
  'Electronic': tapeBackElectro,   // file: tape_back_electro.jpg
  'Reggae':     tapeBackReggae,
  'Classical':  tapeBackClassical,
  'Folk':       tapeBackFolk,
  'Jazz':       tapeBackJazz,
  'Pop':        tapeBackPop,
}
```

A genre absent from the map falls back to `background-generic.jpg`. This file is the single
source of truth for genre→photo assignment.

### Edit: `src/components/CassetteCarousel.tsx`

- Remove the `.carousel-blur-overlay` and `.carousel-white-overlay` `motion.div`s (and
  their `AnimatePresence` wrappers).
- Render `<GenreBackground />` in their place.

### Edit: `src/index.css`

- Remove `.carousel-blur-overlay` and `.carousel-white-overlay` rules.
- Add `.genre-bg-*` rules (root layer, photo `<img>` positioning via `object-fit: cover`,
  scrim gradient).

## Diagonal wipe

When the selected genre changes:

1. The incoming photo mounts on top of the current photo.
2. Its `clip-path` animates from a thin sliver at the entering edge to full coverage. The
   seam is a diagonal: the top and bottom x-positions of the moving edge are offset by a
   slant (~20% of width).
3. The outgoing photo sits directly underneath and is unmounted once the incoming photo
   fully covers it (so its removal is invisible).
4. Duration ~0.5s, ease-out.

Direction (which edge the seam enters from) follows the **shortest path around the ring** of
the genre index change, so wrapping from the last tape to the first still reads as "right":

- Given previous real index `a`, new real index `b`, and `N` genres:
  `rightDist = (b - a + N) % N`, `leftDist = (a - b + N) % N`.
  If `rightDist <= leftDist` → **right** wipe, else → **left** wipe.
- **Right** wipe: visible (new) region is to the right of the seam; seam starts off the
  right edge and sweeps left.
- **Left** wipe: visible region is to the left of the seam; seam starts off the left edge
  and sweeps right.

This logic lives inside `GenreBackground` (it tracks the previous selected index), so it
covers keyboard/arrow navigation and drag uniformly — the wipe fires whenever the genre
actually changes. Exact `clip-path` polygon percentages are tuned during implementation.

## Layering / z-index

- `SceneBackground` stays at `z-index: 0` (generic bg + objects), always present.
- `GenreBackground` occupies the band the old overlays used (above the player, below the
  carousel). The player's current z-index keeps it behind this layer during selection
  (verify the exact value during implementation; the old blur overlay at `z 20` already
  covered the player).
- Carousel wrapper stays at `z-index: 30`; the floating "Insert Tape" button stays above
  the genre background.

## Scope / non-goals

- No change to playback-mode visuals: the generic `SceneBackground` + decorative objects
  remain the backdrop once a tape is inserted.
- No blur on the genre photo — only the subtle dark scrim.
- No new assets to produce; the eight `tape_back_*.jpg` files already exist in
  `src/assets/background/`.
