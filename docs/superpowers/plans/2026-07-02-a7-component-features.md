# A7 Component-Based Audio Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store raw audio-signal components per track (cache v8) and compose the Energy/Mood sliders from library percentiles, so Energy means drive/intensity and Mood gains a groove cue — with zero UI change.

**Architecture:** The analysis worker extracts seven raw signals per clip; `featureCache` stores them; `buildNormalizer` percentile-ranks each component and blends percentiles with exported weights into the unchanged `{pace, energy, mood}` contract. No consumer beyond the normalizer changes.

**Tech Stack:** essentia.js 0.1.3 (pinned), existing worker-pool pipeline, IndexedDB.

**Spec:** `docs/superpowers/specs/2026-07-02-a7-component-features-design.md`.

## Global Constraints

- `verbatimModuleSyntax` on — `import type` for type-only imports.
- Every Essentia WASM object `.delete()`d in try/finally.
- Worker protocol `{reqId, id, samples, sampleRate, method}` → `{reqId, features}` unchanged.
- `NormalizedFeatures = { pace, energy, mood }` contract unchanged.
- Do NOT touch: hooks, stores, `sortTracksByFilters`, `analysisClient`, UI components.
- No test runner: gates are `npm run build` + `npm run lint` + the browser spikes in Task 3.

## Spike findings (verified 2026-07-02 — trust these)

Node spike against installed essentia.js 0.1.3:
- `OnsetRate(vec)` → `{ onsets: WASM_VECTOR, onsetRate: number }` — **delete `onsets`**.
- `DynamicComplexity(vec)` → `{ dynamicComplexity: number, loudness: number }` — scalars only (we ignore its `loudness`; the standalone `Loudness` algorithm stays our energy source).
- `Danceability(vec)` → `{ danceability: number, dfa: WASM_VECTOR }` — **delete `dfa`**.
- Cost of the FULL new chain on a 10s clip: **650 ms multifeature / 205 ms degara** — added algorithms are nearly free next to rhythm extraction; well under the spec's 2 s/track budget. On a 120 BPM click: bpm=120.0 both methods, onsetRate≈1.9/s, dynamicComplexity≈22.1, danceability≈7.98.

---

### Task 1: Cache v8 schema + ambient algorithm types

**Files:**
- Modify: `src/services/featureCache.ts:6-30` (interface, VERSION, makeTombstone)
- Modify: `src/types/essentia.d.ts` (three new algorithm signatures)

**Interfaces:**
- Produces: the v8 `TrackFeatures` shape below (Task 2's `analyzePCM` returns it; Task 2's normalizer consumes it) and typed `OnsetRate`/`DynamicComplexity`/`Danceability` methods on the `Essentia` class.
- NOTE: after this task the build FAILS (audioAnalysis/featureNormalize still use the old shape) — Tasks 1+2 are committed together in Task 2 Step 5. Do them back-to-back.

- [ ] **Step 1: Replace the `TrackFeatures` interface + version + tombstone in `featureCache.ts`**

Replace the current interface/`VERSION`/`makeTombstone` block with:

```ts
export interface TrackFeatures {
  id: string
  bpm: number               // RhythmExtractor2013, clamped 50–200
  bpmConfidence?: number    // 0–1 (multifeature only; omitted for degara)
  loudness: number          // Loudness (Steven's-law energy^0.67)
  onsetRate: number         // OnsetRate — onsets per second (activity)
  dynamicComplexity: number // DynamicComplexity — loudness fluctuation
  centroidHz: number        // SpectralCentroidTime — brightness
  modeScore: number         // 0–1: major → 0.5+0.5·strength, minor → 0.5−0.5·strength
  danceability: number      // Danceability — groove/pulse strength
  analyzedAt: number
  // Tombstone: the track can NEVER be analyzed (no catalog entry / no preview
  // clip). Cached so it is excluded from analysis retries, normalizer
  // distributions, sort scoring, and "N/M analyzed" denominators. The numeric
  // fields are zeroed sentinels — always check this flag before reading them.
  unanalyzable?: true
}

/** Cache entry marking a track as permanently unanalyzable (no preview). */
export function makeTombstone(id: string): TrackFeatures {
  return {
    id, bpm: 0, loudness: 0, onsetRate: 0, dynamicComplexity: 0,
    centroidHz: 0, modeScore: 0, danceability: 0,
    analyzedAt: Date.now(), unanalyzable: true,
  }
}
```

And bump: `const VERSION = 8 // bumped: component-based features (loudness/onsetRate/dynamicComplexity/centroidHz/modeScore/danceability) — re-analyze`

(`energyRaw`/`moodRaw` are gone. The old `makeTombstone` sat below the interface — keep its position.)

- [ ] **Step 2: Add algorithm signatures to `src/types/essentia.d.ts`**

Inside the `Essentia` class declaration, after `SpectralCentroidTime`, add (shapes verified by spike):

```ts
    OnsetRate(signal: EssentiaVector): { onsets: EssentiaVector; onsetRate: number }
    DynamicComplexity(signal: EssentiaVector): { dynamicComplexity: number; loudness: number }
    Danceability(signal: EssentiaVector): { danceability: number; dfa: EssentiaVector }
```

- [ ] **Step 3: Proceed straight to Task 2** (the build is intentionally red until Task 2 Step 3).

---

### Task 2: Component extraction + percentile-blend normalizer

**Files:**
- Modify: `src/services/audioAnalysis.ts:47-83` (the analyzePCM body)
- Modify: `src/services/featureNormalize.ts` (full rewrite of buildNormalizer + weights)

**Interfaces:**
- Consumes: v8 `TrackFeatures` + the three new algorithm typings from Task 1.
- Produces: `analyzePCM(id, data, sampleRate, method): Promise<TrackFeatures>` (signature unchanged, richer return) and `buildNormalizer(featuresMap): FeatureNormalizer` with the UNCHANGED `normalize(f): { pace, energy, mood }` contract; exports `ENERGY_WEIGHTS` and `MOOD_WEIGHTS`.

- [ ] **Step 1: Rewrite the extraction section of `analyzePCM` in `audioAnalysis.ts`**

Replace the body between `const signal = essentia.arrayToVector(data)` / `try {` and the `finally` block with:

```ts
    // ── BPM + confidence ────────────────────────────────────────
    const rhythm = essentia.RhythmExtractor2013(signal, 208, method, 40)
    rhythm.ticks.delete()
    rhythm.estimates.delete()
    rhythm.bpmIntervals.delete()
    const bpm = Math.round(Math.min(200, Math.max(50, rhythm.bpm)))
    // degara always reports 0 — omit the field rather than store a false
    // "no confidence" (the sort treats absent as fully confident).
    const bpmConfidence = method === 'multifeature' ? clamp01(rhythm.confidence / CONFIDENCE_MAX) : undefined

    // ── Raw components (percentile-ranked + blended in featureNormalize) ──
    const loudness = essentia.Loudness(signal).loudness

    const onsets = essentia.OnsetRate(signal)
    onsets.onsets.delete()
    const onsetRate = onsets.onsetRate

    const dynamicComplexity = essentia.DynamicComplexity(signal).dynamicComplexity

    const { scale, strength } = essentia.KeyExtractor(signal)
    const modeScore = clamp01(scale === 'major' ? 0.5 + 0.5 * strength : 0.5 - 0.5 * strength)

    const centroidHz = essentia.SpectralCentroidTime(signal, sampleRate).centroid

    const dance = essentia.Danceability(signal)
    dance.dfa.delete()
    const danceability = dance.danceability

    return {
      id, bpm, bpmConfidence, loudness, onsetRate, dynamicComplexity,
      centroidHz, modeScore, danceability, analyzedAt: Date.now(),
    }
```

Update the file-header comment: bpm/bpmConfidence lines stay; replace the `energyRaw`/`moodRaw` lines with:

```
 * Raw components (loudness, onsetRate, dynamicComplexity, centroidHz,
 * modeScore, danceability) are stored per track; the Energy/Mood slider
 * values are composed from library percentiles in featureNormalize.ts, so
 * blend weights can be re-tuned without re-analysis.
```

Delete the now-unused `BRIGHTNESS_CEILING_HZ` constant (brightness normalization moved to percentile space).

- [ ] **Step 2: Rewrite `src/services/featureNormalize.ts`**

Full new contents:

```ts
/**
 * Library-relative feature normalization + slider composition.
 *
 * The cache stores RAW per-track components (see featureCache.TrackFeatures).
 * Each component is normalized to its PERCENTILE RANK within the user's own
 * analyzed library (0 = lowest, 100 = highest), then the three slider values
 * are composed as weighted blends of percentiles:
 *
 *   pace   = P(bpm)
 *   energy = 0.45·P(loudness) + 0.30·P(onsetRate) + 0.25·P(dynamicComplexity)
 *   mood   = 0.45·P(centroidHz) + 0.30·P(modeScore) + 0.25·P(danceability)
 *
 * Blending percentiles (not raw values) keeps units comparable, and because
 * the blend happens here — not in the analysis worker — the weights can be
 * re-tuned without re-analyzing the library.
 */
import type { TrackFeatures } from './featureCache'

export interface NormalizedFeatures {
  pace: number   // 0–100 percentile of BPM across the library
  energy: number // 0–100 drive/intensity blend (loudness + activity + dynamics)
  mood: number   // 0–100 sad→happy blend (brightness + mode + groove)
}

export interface FeatureNormalizer {
  /** Number of analyzed tracks the distribution was built from. */
  count: number
  normalize: (f: TrackFeatures) => NormalizedFeatures
}

export const ENERGY_WEIGHTS = { loudness: 0.45, onsetRate: 0.3, dynamicComplexity: 0.25 } as const
export const MOOD_WEIGHTS = { centroidHz: 0.45, modeScore: 0.3, danceability: 0.25 } as const

const COMPONENTS = ['bpm', 'loudness', 'onsetRate', 'dynamicComplexity', 'centroidHz', 'modeScore', 'danceability'] as const
type Component = (typeof COMPONENTS)[number]

/** Percentile rank of `v` in an ascending-sorted array: (count ≤ v) / n × 100. */
function percentile(sorted: number[], v: number): number {
  const n = sorted.length
  if (n <= 1) return 50 // not enough data to rank — treat as neutral
  let lo = 0
  let hi = n
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] <= v) lo = mid + 1
    else hi = mid
  }
  return Math.round((lo / n) * 100)
}

/**
 * Build a normalizer from the current set of analyzed features. Cheap to
 * rebuild (one sort per component); memoize on `featuresMap` at the call site.
 */
export function buildNormalizer(featuresMap: Map<string, TrackFeatures>): FeatureNormalizer {
  const sorted: Record<Component, number[]> = {
    bpm: [], loudness: [], onsetRate: [], dynamicComplexity: [],
    centroidHz: [], modeScore: [], danceability: [],
  }
  for (const f of featuresMap.values()) {
    if (f.unanalyzable) continue // tombstones carry zeroed sentinels, not data
    for (const c of COMPONENTS) sorted[c].push(f[c])
  }
  for (const c of COMPONENTS) sorted[c].sort((a, b) => a - b)

  const P = (c: Component, f: TrackFeatures) => percentile(sorted[c], f[c])

  return {
    count: sorted.bpm.length,
    normalize: (f: TrackFeatures): NormalizedFeatures => ({
      pace: P('bpm', f),
      energy: Math.round(
        ENERGY_WEIGHTS.loudness * P('loudness', f) +
        ENERGY_WEIGHTS.onsetRate * P('onsetRate', f) +
        ENERGY_WEIGHTS.dynamicComplexity * P('dynamicComplexity', f),
      ),
      mood: Math.round(
        MOOD_WEIGHTS.centroidHz * P('centroidHz', f) +
        MOOD_WEIGHTS.modeScore * P('modeScore', f) +
        MOOD_WEIGHTS.danceability * P('danceability', f),
      ),
    }),
  }
}
```

- [ ] **Step 3: Field-reader sweep + build + lint**

Run: `grep -rn "energyRaw\|moodRaw" src/ CLAUDE.md`
Expected in `src/`: NO hits (if any surface, migrate them to `normalizer.normalize()` before proceeding; `CLAUDE.md` hits are handled in Task 4).
Run: `npm run build && npm run lint`
Expected: both exit 0.

- [ ] **Step 4: Sanity-check the plumbing compiles against consumers**

Run: `grep -rn "\.energy\b\|\.mood\b\|\.pace\b" src/components/TrackDisplay.tsx src/services/appleMusic.ts | head`
Expected: hits only through `NormalizedFeatures` values (`currentNorm.energy`, `n.pace`, etc.) — no direct raw-field reads. (This is a read-only verification step.)

- [ ] **Step 5: Commit Tasks 1+2 together**

```bash
git add src/services/featureCache.ts src/types/essentia.d.ts src/services/audioAnalysis.ts src/services/featureNormalize.ts
git commit -m "feat: component-based audio features (cache v8) + percentile-blend normalizer"
```

---

### Task 3: Browser spikes (dev worker + production worker)

**Files:** none in-repo (scratch scripts only — reuse the session's `browser-spike.mjs` / `preview-worker-spike.mjs` pattern: headless Chrome via CDP, no deps, Node ≥22 for global WebSocket).

**Interfaces:**
- Consumes: the shipped worker from Task 2.

- [ ] **Step 1: Dev-worker spike**

With `npm run dev` running, drive headless Chrome (CDP) to `http://localhost:5173/` and evaluate:

```js
const m = await import('/src/services/analysisClient.ts')
const buf = new OfflineAudioContext(1, 44100 * 10, 44100).createBuffer(1, 44100 * 10, 44100)
const ch = buf.getChannelData(0)
for (let t = 0; t < 20; t++) {
  const s = Math.floor(t * 0.5 * 44100)
  for (let i = 0; i < 400; i++) ch[s + i] = Math.sin(2 * Math.PI * 1000 * i / 44100) * Math.exp(-i / 80)
}
JSON.stringify(await m.analyzeAudioBuffer('spike', buf))
```

Expected: `bpm: 120`, and `loudness`, `onsetRate`, `dynamicComplexity`, `centroidHz` (≈1000), `modeScore` (0–1), `danceability` all finite numbers; no console errors.

- [ ] **Step 2: Production-worker spike**

`npm run build && npm run preview`, then instantiate the built worker chunk directly (find it via `ls dist/assets/analysis.worker-*.js`) inside the preview page and post `{ reqId: 1, id: 'prod-spike', samples, sampleRate: 44100, method: 'degara' }` with the same synthetic signal. Expected: the response `features` object contains all 8 numeric fields, `bpm: 120`, and `bpmConfidence` ABSENT (degara). Stop the preview server after.

- [ ] **Step 3: No commit** (verification only).

---

### Task 4: CLAUDE.md + manual verification handoff

**Files:**
- Modify: `CLAUDE.md` (Phase 2 sections)

- [ ] **Step 1: Update CLAUDE.md**

1. Project-structure lines: `featureCache.ts` → `v8`; `audioAnalysis.ts` → mention the seven extracted components; `featureNormalize.ts` → "percentile-ranks each raw component, composes pace/energy/mood via exported ENERGY_WEIGHTS/MOOD_WEIGHTS".
2. "Audio Feature Extraction" list: replace the `energyRaw`/`moodRaw` bullets with the component list + the two blend formulas (copy from the spec §5); cache version → **v8**.
3. "Library-Relative Normalization" section: note blending happens in percentile space and weight changes need no re-analysis.
4. Grep `energyRaw\|moodRaw\|v7` in CLAUDE.md and fix all remaining references.

- [ ] **Step 2: Build + lint + commit**

```bash
npm run build && npm run lint
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for component-based features (cache v8)"
```

- [ ] **Step 3: Manual verification (user-assisted, live Apple Music auth)**

1. Hard-reload the dev app; the v8 cache wipes and re-analysis starts (background degara chain ≈0.6 s/track — a full library run should be noticeably faster than the v7 multifeature era despite the extra algorithms).
2. **The headline check:** drag Energy HIGH — loud AND busy tracks surface; a quiet-mastered but dense/driving track should now rank high (it read "low energy" before).
3. Mood HIGH favors bright/major/groovy; Mood LOW surfaces dark/minor/static material.
4. Slider snap, LCD `BPM/NRG/MOD`, subgenre filtering, and the stopped-state NOW refresh all behave as before.
5. No WASM/heap errors over a long background run (proves the two new `.delete()`s — `onsets`, `dfa` — are complete).
