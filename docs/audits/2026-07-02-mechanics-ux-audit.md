# Kassette — Mechanics, Filter Accuracy & UX Audit (2026-07-02)

Follow-up to `2026-07-01-perf-filtering-audit.md` (whose Tier 1–2 items are all shipped). Scope: **filter logic & accuracy** (primary focus), queue/playback correctness, UX edge cases, remaining runtime performance. Sources: direct code analysis of the filter core + three parallel audit passes; every finding marked **[verified]** was confirmed against the code by the lead session, others are **[reported]** by an audit pass and spot-checked plausible.

Baseline context: Essentia.js DSP (v7 cache), parallel library fetch, and the stopped-state slider rebuild all shipped 2026-07-02 and are NOT re-reported here.

---

## A. Filter logic & accuracy (the core product mechanic)

### A1. Slider magnitude is meaningless — the headline flaw **[verified]**
`sortTracksByFilters` (`appleMusic.ts:272-291`) converts each slider to a directional weight `(value−50)/50` and sorts by the weighted sum of library percentiles. Consequences:
- With a single slider moved, **the resulting order is identical at 55 and at 100** — only the sign matters. Slider *position* carries no information beyond direction; users reasonably expect "Pace at 70" to mean "tracks around the 70th percentile", i.e. target semantics.
- The **auto-snap** sets sliders to the current track's percentiles; interpreted as *weights* this is incoherent (a track at the 63rd pace percentile becomes "prefer fast, weight 0.26"). Under target semantics, snap + sort compose naturally: "queue tracks like this one; nudge a slider to steer away".

**Proposed redesign (needs product sign-off — behavior change):** target-proximity scoring with per-slider *touched* state:
- Score = Σ over touched sliders of `|slider_d − percentile_d|` (lower = earlier in queue). Untouched sliders contribute nothing (preserves "no preference until you move it").
- Auto-snap updates slider *positions* but clears the touched flags, so a snap never becomes an unintended filter.
- Composes cleanly with the shipped stopped-state NOW refresh ("dial a track"), and fixes the documented "snap conflicts with user filters" limitation for free.
**Impact: HIGH** (this is the product's core interaction). **Effort: M** (~score function + touched flags in store + snap change).

### A2. Subgenre-filtered queues come out in library order **[verified]**
In `applyAll` (`PlaylistController.tsx:92-99`), the pool with subgenres selected is the **unshuffled** `currentCassette.tracks`; with neutral sliders all weights are 0, the sort is stable, so the queue is album/alphabetical clumps — not a mixtape. Fix: Fisher-Yates the candidates once per rebuild (or a per-insert seeded shuffle for stability across drags).
**Impact: MED-HIGH** (any subgenre user hits it). **Effort: S.**

### A3. `bpmConfidence` is stored but never consulted **[verified]**
RhythmExtractor2013 confidence (0–1, persisted since cache v7) should de-weight the pace term for shaky detections: e.g. `paceContribution × (0.4 + 0.6·confidence)`. Rubato/ambient tracks stop polluting the extremes of a Pace-sorted queue.
**Impact: MED** (accuracy at the slider extremes). **Effort: S.**

### A4. Analysis throughput vs. accuracy — a decision, not a bug **[verified]**
`multifeature` costs ~2s of DSP per 30s clip; a 5–15k library takes hours of aggregate CPU to cover (and the sliders-unlock wait is directly downstream). `degara` is ~4-5× faster but returns no confidence. Options:
1. **Two-tier**: active cassette → `multifeature` (accuracy where BPM is displayed), background pass → `degara` (coverage). Confidence stays meaningful where it's shown.
2. All-`degara` after an accuracy spot-check.
**Impact: HIGH** (first-session experience, slider unlock latency across tapes). **Effort: S-M** (mostly the two-tier plumbing + a method param).

### A5. Unanalyzable tracks poison denominators and sorting **[reported, mechanism verified]**
Tracks with no `catalogId` (`appleMusic.ts:160`) or no preview URL can **never** be analyzed, yet they: (a) count in the "Analyzing your tape… N/M ready" denominator forever, (b) permanently sink to the queue tail regardless of filters, (c) in the worst case (cassette of mostly-uncataloged tracks) leave the sliders locked with no explanation. Fix: persist an "unanalyzable" tombstone after a failed attempt (cache entry with a flag), exclude tombstoned tracks from analysis denominators, and optionally badge them in the LCD.
**Impact: HIGH for affected libraries, invisible otherwise.** **Effort: M.**

### A6. Dead store state **[verified]**
`filtersActive` (`playerStore.ts:20,46-48,89-91`) is written on every slider change and read nowhere. Remove.
**Impact: hygiene. Effort: XS.**

### A7. Richer features (R&D)
Energy = whole-clip Loudness (mastering-loudness proxy); Mood = brightness + key mode. Essentia already ships `Danceability`, `DynamicComplexity`, onset rate — computable in the same worker pass. Would need cache v8 + full re-analysis + slider-mapping design.
**Impact: MED-HIGH but speculative. Effort: L.**

---

## B. Queue / playback correctness

### B1. The NEXT display lies after a re-sort while playing **[verified]**
MusicKit holds a 20-track window (`playQueueFrom`, `appleMusic.ts:302-312`); slider re-sorts while playing deliberately don't re-sync it (avoids interrupting playback). So auto-advance follows the **old** order while the LCD's NEXT line shows the **new** one — until a manual skip or window exhaustion.
Options: (a) **honest display** — while playing, show MusicKit's actual upcoming item (`music.queue`) on the NEXT line (**S**); (b) re-sync the window at each track boundary from the current sorted queue (**M**, needs care around the setQueue/play sequence). (a) is the safe quick win; (b) makes re-sorts actually apply mid-tape and can ship later.
**Impact: MED-HIGH (trust in the core filter feature).**

### B2. Now-playing index falls back to 0 on miss **[verified]**
`onNowPlayingChange` (`CassettePlayer.tsx:94-101`): `findIndex` misses (track filtered out of the rebuilt queue mid-play) reset `currentTrackIndex` to 0 — LCD shows the wrong track and next/prev compute from the wrong position. Fix: keep the previous index on miss (or append the playing track).
**Impact: MED. Effort: S.**

### B3. `pendingPlay` latches forever on a no-op play **[verified]**
`handlePlay` sets `pendingPlay(true)` then `playQueueFrom` silently returns if the window slice is empty (stale index into a shrunken queue) — the Play button stays pressed with nothing playing until Stop/Eject. Fix: return a boolean from `playQueueFrom`; clear `pendingPlay` on false.
**Impact: LOW-MED. Effort: S.**

### B4. Rewind mute + SFX loop leak **[verified]**
`startFB` mutes the audio element and starts a looping SFX; the unmute + SFX stop live in `stopFB`'s guarded path (`CassettePlayer.tsx:205-222`). If the pointer is released **off the button** (mouseup elsewhere) or the user ejects mid-hold, `stopFB` never runs its cleanup (`fbPressRef` null-check early-returns after eject) → audio stays muted and the rewind SFX loops indefinitely. Fix: global mouseup listener while held + unconditional unmute/SFX-stop in `handleEject`.
**Impact: MED (feels broken when hit). Effort: S.**

---

## C. UX polish & edge cases

| # | Finding | Impact | Effort |
|---|---|---|---|
| C1 | **No session persistence**: volume, slider values, inserted tape, queue position all reset on reload (only auth + feature cache survive) — persist at least volume + sliders (localStorage), optionally tape + position | MED | S (volume/sliders) – M (tape restore) |
| C2 | **"NO DATA"** shows on the LCD meta line for not-yet-analyzed tracks — read as broken during the ~2s/track analysis; show "ANALYZING…" when an analysis pass is active | MED | S |
| C3 | **Arrow keys dead after insert** (`useKeyboardNav` gated on `!isInserted`) — map ←/→ to prev/next track while inserted | LOW-MED | S |
| C4 | **Worker error nukes all pending analyses** (`analysisClient.ts:44-48` rejects the whole global `pending` map on any single worker's `onerror`) — scope rejection to that worker's in-flight requests | LOW (rare) | S |
| C5 | **Loading-screen LCD shows random meta as if real** (by design) — render "—" instead of fabricated numbers for unanalyzed tracks | LOW | XS |
| C6 | Subgenre dropdown lacks focus management (Tab escapes the open menu) | LOW | S |
| C7 | 100-track insert cap + "All"-pool inconsistency (subgenres search the full cassette, sliders only the 100) — either raise the cap or communicate it | LOW-MED | M |
| C8 | **Library refetch on every load** — cache the library in IndexedDB + background revalidate for near-instant startups (raised in-session; parallel fetch shipped, this is the next step) | MED-HIGH | M |

Rejected/corrected from the audit passes: the "hardcoded 20" message claim (code already uses `Math.min(upcoming.length, 20)`), "sliders draggable while disabled" (`pointer-events: none` covers it), the rawItemCache "critical" scenario and the stale-refs race (refs update synchronously each render; contrived), multi-tab support (out of scope).

---

## D. Remaining performance (all small)

| # | Finding | Impact | Effort |
|---|---|---|---|
| D1 | `GenreBackground` mousemove parallax listener keeps driving springs while the layer is invisible (post-insert) | LOW | S |
| D2 | `addFeatures` copies the whole `featuresMap` per analyzed track (10k+ Map copies + subscriber re-renders over a full first-load re-analysis) — batch background-pass store flushes (~1/s) | LOW-MED during first load | S-M |
| D3 | `LoadingScreen` rebuilds the normalizer on every analyzed track during load | LOW | S |
| D4 | SFX hooks + motor AudioContext never cleaned up on unmount (sign-out/in cycles accumulate) | LOW | S |
| D5 | Memory pressure from 6 parallel decodes at 44.1kHz (~60-120MB peak, speculative) — profile before acting | ? | monitor |

Bundle/delivery verified healthy: 2.5MB essentia worker chunk is lazy + worker-only; main chunk 330KB with vendor splits.

---

## Effort × Impact plan

### Batch 1 — Quick wins, no behavior decisions needed (all S, ~1 session)
1. **A2** shuffle the subgenre pool (mixtape feel back)
2. **A3** bpmConfidence de-weighting in the sort
3. **B2** now-playing index fallback (keep previous, don't jump to 0)
4. **B3** pendingPlay unlatch on no-op play
5. **B4** rewind mute/SFX leak (global mouseup + eject cleanup)
6. **B1a** honest NEXT display while playing
7. **C2** "ANALYZING…" instead of "NO DATA"
8. **A6** remove dead `filtersActive`
9. **D1** gate the parallax listener
10. **C4** per-worker error scoping

### Batch 2 — The product-defining changes (need your sign-off, each is its own branch)
1. **A1** target-based sliders with touched-state semantics — *the* filter-accuracy fix
2. **A4** two-tier analysis (multifeature active / degara background) — slider unlock + coverage speed
3. **A5** unanalyzable-track tombstones + honest denominators
4. **C8** library IndexedDB cache (instant reloads)
5. **C1** session persistence (volume + sliders at minimum)

### Batch 3 — Later / R&D
- **B1b** mid-tape window re-sync at track boundaries (makes re-sorts apply while playing)
- **A7** richer Essentia features (Danceability, DynamicComplexity) → cache v8
- **C3, C5, C6, C7, D2-D4** as filler between bigger items
