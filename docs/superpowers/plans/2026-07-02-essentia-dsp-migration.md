# Essentia.js DSP Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-rolled DSP in `src/services/audioAnalysis.ts` with Essentia.js (WASM) running in the existing analysis worker, producing higher-quality `bpm` / `energyRaw` / `moodRaw`.

**Architecture:** Only the feature-extraction internals change. The pipeline (hooks → `analysisClient` worker pool → `analyzePCM` in the worker → IndexedDB cache → normalizer → sliders) stays identical; `analyzePCM` becomes async and the resample target rate rises from 11025 Hz to 44100 Hz because Essentia's rhythm/key algorithms assume 44100.

**Tech Stack:** essentia.js 0.1.3 (Essentia core 2.1-beta6-dev), Vite 7 module workers, TypeScript strict + `verbatimModuleSyntax`.

**Spec:** `docs/superpowers/specs/2026-07-02-essentia-dsp-migration.md` (read it for background; this plan supersedes its open questions — the spike below resolved them).

## Global Constraints

- `TrackFeatures` contract preserved: `{ id, bpm, energyRaw, moodRaw, analyzedAt }` + NEW optional `bpmConfidence?: number`. Higher raw still means higher-of-that-quality; `bpm` stays in 50–200.
- Worker message protocol unchanged: `{reqId, id, samples, sampleRate}` → `{reqId, features}` | `{reqId, error}`.
- Do NOT touch: `featureNormalize.ts`, `sortTracksByFilters` in `appleMusic.ts`, the analysis hooks, `mapPool.ts`, `analysisShared.ts`, the stores, any UI component.
- `verbatimModuleSyntax` is on — use `import type` for type-only imports.
- Every Essentia WASM object must be `.delete()`d (they are not GC'd; leaking exhausts the WASM heap over a full-library run).
- No test runner exists in this project. Gates per task: `npm run build` (tsc -b + vite build) and `npm run lint` exit 0, plus the dev-console spike in Task 2.

## Spike findings (already verified 2026-07-02 — trust these, don't re-derive)

A Node spike against the installed `essentia.js@0.1.3` confirmed:

1. **Exports:** `dist/essentia.js-core.es.js` → `export default Essentia` (a class). `dist/essentia-wasm.es.js` → `export { Module as EssentiaWASM }` — a **module object, not a factory**, with the WASM **base64-embedded** (`wasmBinaryFile="data:application/octet-stream;base64,..."`) and **synchronous instantiation** (sync compile is allowed in workers). No separate `.wasm` asset for Vite to resolve.
2. **Init:** `new Essentia(EssentiaWASM)` works immediately. Keep the defensive `typeof EssentiaWASM === 'function'` factory handling anyway (costs nothing, guards version drift).
3. **Return shapes:** `RhythmExtractor2013(vec, 208, 'multifeature', 40)` → `{ bpm: number, confidence: number, ticks, estimates, bpmIntervals }` where `ticks`/`estimates`/`bpmIntervals` are **WASM vectors that must each be `.delete()`d**. `Loudness(vec)` → `{ loudness: number }`. `KeyExtractor(vec)` → `{ key: string, scale: 'major'|'minor', strength: number }`. `SpectralCentroidTime(vec, sampleRate)` → `{ centroid: number }` (Hz).
4. **Accuracy sanity:** 120 BPM synthetic click → detected 120.03; 1 kHz ping → centroid ≈ 1003 Hz.
5. **Confidence scale:** `multifeature` confidence is **0–5.32** (NOT 0–1 as the spec assumed). Normalize: `confidence / 5.32`, clamped to 0–1.
6. **Throughput:** multifeature on a 10s clip ≈ 633 ms in Node → ~2s per 30s preview per worker. Acceptable with the ≤4-worker pool; `'degara'` is the faster fallback only if real-world use feels too slow.
7. **`RhythmExtractor2013` has no sampleRate parameter — it assumes 44100.** This is why `TARGET_RATE` must become 44100. `KeyExtractor`'s sampleRate default is 44100 (leave defaults). `SpectralCentroidTime` takes an explicit `sampleRate` second arg — pass it.
8. The ES builds do NOT run under plain Node ESM (Emscripten env detection expects web/worker) — that's fine, the target is the browser module worker. Node verification used the UMD builds.
9. `package.json` has no `types` field and deep-dist imports are untyped → we need an ambient declaration file (Task 1).

---

### Task 1: Pin dependency + ambient types

**Files:**
- Modify: `package.json` (dependency line for `essentia.js`)
- Create: `src/types/essentia.d.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: typed modules `'essentia.js/dist/essentia.js-core.es.js'` (default export `Essentia` class) and `'essentia.js/dist/essentia-wasm.es.js'` (named export `EssentiaWASM: unknown`) used by Task 2.

- [ ] **Step 1: Pin the exact version**

`essentia.js` is already installed (`^0.1.3`). Pin it exactly (the dist layout varies across versions and the spike findings are version-specific). In `package.json` change:

```json
"essentia.js": "^0.1.3",
```
to
```json
"essentia.js": "0.1.3",
```

Then run: `npm install` (updates the lockfile pin). Expected: exits 0, no version change.

- [ ] **Step 2: Create the ambient type declarations**

Create `src/types/essentia.d.ts`:

```ts
/**
 * Ambient types for essentia.js 0.1.3 deep-dist imports (the package ships no
 * `types` entry). Only the algorithms Kassette uses are declared; shapes were
 * verified empirically against the installed version (see the Essentia
 * migration plan's spike findings).
 */
declare module 'essentia.js/dist/essentia.js-core.es.js' {
  /** Emscripten-bound C++ vector — must be freed with .delete(), not GC'd. */
  export interface EssentiaVector {
    delete(): void
  }

  export default class Essentia {
    constructor(wasm: unknown)
    version: string
    arrayToVector(arr: Float32Array): EssentiaVector
    RhythmExtractor2013(
      signal: EssentiaVector,
      maxTempo?: number,
      method?: 'multifeature' | 'degara',
      minTempo?: number,
    ): {
      bpm: number
      confidence: number
      ticks: EssentiaVector
      estimates: EssentiaVector
      bpmIntervals: EssentiaVector
    }
    Loudness(signal: EssentiaVector): { loudness: number }
    KeyExtractor(signal: EssentiaVector): { key: string; scale: 'major' | 'minor'; strength: number }
    SpectralCentroidTime(signal: EssentiaVector, sampleRate?: number): { centroid: number }
  }
}

declare module 'essentia.js/dist/essentia-wasm.es.js' {
  /** Emscripten Module object (base64-embedded WASM, sync-instantiated). */
  export const EssentiaWASM: unknown
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run build`
Expected: exits 0 (nothing imports the new modules yet; this catches d.ts syntax errors).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/types/essentia.d.ts
git commit -m "feat: pin essentia.js 0.1.3 + ambient types for its ES dist entries"
```

---

### Task 2: Essentia-based analyzePCM + async worker + 44100 Hz resample

**Files:**
- Modify: `src/services/audioAnalysis.ts` (full rewrite — delete all hand-rolled DSP)
- Modify: `src/workers/analysis.worker.ts` (make handler async)
- Modify: `src/services/analysisClient.ts:17` (`TARGET_RATE`) and its header comment

**Interfaces:**
- Consumes: the ambient module types from Task 1; `TrackFeatures` from `./featureCache` (Task 3 adds `bpmConfidence?` — until Task 3 lands, the extra field is why Task 2 and 3 should be built/linted together if done out of order; in order, Task 2 will NOT compile until Task 3's `bpmConfidence?` exists, so **apply the one-line `TrackFeatures` addition from Task 3 Step 1 as part of this task if executing strictly sequentially — or simply do Task 3 first**. Recommended execution order: Task 1 → Task 3 → Task 2 → Task 4 → Task 5.)
- Produces: `export async function analyzePCM(id: string, data: Float32Array, sampleRate: number): Promise<TrackFeatures>` — awaited by the worker; `analyzeAudioBuffer` signature unchanged.

- [ ] **Step 1: Rewrite `src/services/audioAnalysis.ts`**

Replace the ENTIRE file contents (the FFT / tempo-prior / chroma / Krumhansl code all dies) with:

```ts
/**
 * Pure audio feature extraction on raw mono PCM (Float32Array), running inside
 * the analysis Web Worker via Essentia.js (WASM port of the Essentia MIR
 * library). Returns RAW measurements; absolute 0–100 scaling happens
 * library-relative in featureNormalize.ts.
 *
 * bpm           — RhythmExtractor2013 'multifeature', clamped to 50–200
 * bpmConfidence — RhythmExtractor2013 confidence rescaled to 0–1 (raw 0–5.32)
 * energyRaw     — Loudness (Steven's-law energy^0.67, a perceptual intensity)
 * moodRaw       — 0–1 blend of brightness (SpectralCentroidTime, 4 kHz ceiling)
 *                 and musical mode (KeyExtractor major/minor × strength):
 *                 0.6·brightness + 0.4·mode — same weighting as the old DSP so
 *                 the Mood slider's meaning is continuous.
 *
 * Expects 44100 Hz input: RhythmExtractor2013 has no sampleRate param and
 * assumes 44100 (analysisClient's TARGET_RATE matches).
 */
import Essentia from 'essentia.js/dist/essentia.js-core.es.js'
import { EssentiaWASM } from 'essentia.js/dist/essentia-wasm.es.js'
import type { TrackFeatures } from './featureCache'

// RhythmExtractor2013 'multifeature' confidence is on a 0–5.32 scale.
const CONFIDENCE_MAX = 5.32
// Spectral-centroid Hz ceiling for the 0–1 brightness term. The exact value is
// uncritical — the percentile normalizer rescales library-relative anyway.
const BRIGHTNESS_CEILING_HZ = 4000

// One Essentia instance per worker, created lazily and reused. The WASM module
// is base64-embedded in the ES build and instantiates synchronously, but keep
// the factory-vs-object handling in case a future version changes shape.
let essentiaPromise: Promise<Essentia> | null = null
function getEssentia(): Promise<Essentia> {
  if (!essentiaPromise) {
    essentiaPromise = (async () => {
      const wasm =
        typeof EssentiaWASM === 'function'
          ? await (EssentiaWASM as () => Promise<unknown>)()
          : EssentiaWASM
      return new Essentia(wasm)
    })()
  }
  return essentiaPromise
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

/**
 * Analyzes raw mono 44.1 kHz PCM and returns raw BPM / energy / mood measurements.
 */
export async function analyzePCM(
  id: string,
  data: Float32Array,
  sampleRate: number,
): Promise<TrackFeatures> {
  const essentia = await getEssentia()
  const signal = essentia.arrayToVector(data)
  try {
    // ── BPM + confidence ────────────────────────────────────────
    const rhythm = essentia.RhythmExtractor2013(signal, 208, 'multifeature', 40)
    rhythm.ticks.delete()
    rhythm.estimates.delete()
    rhythm.bpmIntervals.delete()
    const bpm = Math.round(Math.min(200, Math.max(50, rhythm.bpm)))
    const bpmConfidence = clamp01(rhythm.confidence / CONFIDENCE_MAX)

    // ── Energy (perceptual loudness) ────────────────────────────
    const energyRaw = essentia.Loudness(signal).loudness

    // ── Mood (brightness × mode blend, 0–1) ─────────────────────
    const { scale, strength } = essentia.KeyExtractor(signal)
    const modeScore = clamp01(scale === 'major' ? 0.5 + 0.5 * strength : 0.5 - 0.5 * strength)
    const centroidHz = essentia.SpectralCentroidTime(signal, sampleRate).centroid
    const brightness = clamp01(centroidHz / BRIGHTNESS_CEILING_HZ)
    const moodRaw = 0.6 * brightness + 0.4 * modeScore

    return { id, bpm, bpmConfidence, energyRaw, moodRaw, analyzedAt: Date.now() }
  } finally {
    signal.delete()
  }
}
```

- [ ] **Step 2: Make the worker handler async**

In `src/workers/analysis.worker.ts`, replace the `self.onmessage` block (keep the imports, interface, and `post` helper exactly as they are):

```ts
self.onmessage = async (e: MessageEvent<AnalyzeRequest>) => {
  const { reqId, id, samples, sampleRate } = e.data
  try {
    const features = await analyzePCM(id, samples, sampleRate)
    post({ reqId, features })
  } catch (err) {
    post({ reqId, error: String(err) })
  }
}
```

(The `catch` now also covers awaited rejections — including a failed WASM init — so `{reqId, error}` is always posted and the client's `pending` promise never hangs.)

- [ ] **Step 3: Raise the resample rate to 44100**

In `src/services/analysisClient.ts`:

1. Change line 17: `const TARGET_RATE = 11025` → `const TARGET_RATE = 44100`
2. Replace the stale paragraph in the file-header comment (the sentence starting "Decoding stays on the main thread…" through "…is plenty for BPM / energy / brightness / key estimation."):

```
 * Decoding stays on the main thread (native + async), then we resample the clip
 * to mono 44.1 kHz via OfflineAudioContext and transfer the raw PCM to a
 * worker, which runs the heavy DSP (Essentia.js WASM). 44100 Hz is required:
 * Essentia's RhythmExtractor2013 has no sampleRate parameter and assumes it.
```

Nothing else in the file changes (`toMonoPCM` already `.slice()`s for a clean transfer; the pool/reqId plumbing is untouched).

- [ ] **Step 4: Build + lint**

Run: `npm run build && npm run lint`
Expected: both exit 0. (If `tsc` complains about `bpmConfidence` not existing on `TrackFeatures`, Task 3 Step 1 hasn't been applied yet — see the Interfaces note; recommended order is Task 3 before Task 2.)
The vite build will show a large worker chunk (~2.5 MB+, the embedded WASM) — that is expected; it must NOT appear in the main entry chunk (verified properly in Task 4).

- [ ] **Step 5: Dev-console spike — real worker, synthetic 120 BPM click**

Start the dev server (`npm run dev`) if not already running, open `http://localhost:5173/`, and in the browser console (works pre-auth; Vite dev serves source modules directly):

```js
const m = await import('/src/services/analysisClient.ts')
const buf = new OfflineAudioContext(1, 44100 * 10, 44100).createBuffer(1, 44100 * 10, 44100)
const ch = buf.getChannelData(0)
for (let t = 0; t < 20; t++) {
  const s = Math.floor(t * 0.5 * 44100)
  for (let i = 0; i < 400; i++) ch[s + i] = Math.sin(2 * Math.PI * 1000 * i / 44100) * Math.exp(-i / 80)
}
await m.analyzeAudioBuffer('spike', buf)
```

Expected: resolves (a few seconds — WASM init + multifeature) to `{ id: 'spike', bpm: 120, bpmConfidence: ~0.7, energyRaw: > 0, moodRaw: 0..1, analyzedAt: <timestamp> }` with no console errors. This proves the ES imports, WASM instantiation, and the async round-trip all work inside the real Vite module worker.

- [ ] **Step 6: Commit**

```bash
git add src/services/audioAnalysis.ts src/workers/analysis.worker.ts src/services/analysisClient.ts
git commit -m "feat: migrate audio-feature DSP to Essentia.js (RhythmExtractor2013/KeyExtractor/Loudness)"
```

---

### Task 3: Cache v7 + bpmConfidence field

*(Recommended to execute BEFORE Task 2 — Task 2's return object includes `bpmConfidence`.)*

**Files:**
- Modify: `src/services/featureCache.ts:6-16` (interface + VERSION)

**Interfaces:**
- Consumes: nothing.
- Produces: `TrackFeatures` with optional `bpmConfidence?: number`; `VERSION = 7` (the `onupgradeneeded` drop/recreate forces full re-analysis on first load).

- [ ] **Step 1: Update the interface and version**

In `src/services/featureCache.ts`, replace lines 6–16:

```ts
export interface TrackFeatures {
  id: string
  bpm: number            // detected BPM (RhythmExtractor2013), clamped to 50–200
  bpmConfidence?: number // 0–1 (multifeature confidence / 5.32); persisted but not yet consumed
  energyRaw: number      // Essentia Loudness (energy^0.67) — normalized library-relative on read
  moodRaw: number        // 0–1 brightness (spectral centroid) + major/minor mode blend — normalized library-relative on read
  analyzedAt: number
}

const DB_NAME = 'kassette-features'
const STORE = 'tracks'
const VERSION = 7 // bumped: DSP migrated to Essentia.js (RhythmExtractor2013/KeyExtractor/Loudness) — re-analyze
```

(This also fixes the stale `moodRaw` "zero-crossing rate" comment and the stale `bpm` "folded into 60–150" comment.)

- [ ] **Step 2: Build + lint**

Run: `npm run build && npm run lint`
Expected: both exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/services/featureCache.ts
git commit -m "feat: bump feature cache to v7 + optional bpmConfidence (Essentia re-analysis)"
```

---

### Task 4: Production build verification

**Files:** none created/modified (verification only; `vite.config.ts` only changes if a check below fails).

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces: evidence the WASM lives in the worker chunk only and the built app serves it.

- [ ] **Step 1: Build and inspect chunk placement**

```bash
npm run build
ls -la dist/assets/ | sort -k5 -n | tail -5
grep -l "data:application/octet-stream;base64" dist/assets/*.js
grep -L "data:application/octet-stream;base64" dist/assets/index-*.js >/dev/null && echo "main chunk clean"
```

Expected: exactly ONE chunk (the analysis worker chunk, ~2.5 MB+) contains the base64 WASM data URI; the `index-*.js` entry chunk does NOT (prints "main chunk clean"). No `manualChunks` change is needed — worker code is bundled into its own chunk automatically. If (and only if) the WASM data URI shows up in the entry chunk, stop and investigate what pulled `audioAnalysis.ts` into the main graph before touching `vite.config.ts`.

- [ ] **Step 2: Preview smoke test**

```bash
npm run preview
```

Open the preview URL (default `http://localhost:4173/`). Expected: app loads to the auth screen with no console errors (the worker is lazy — full analysis verification in prod mode happens with live auth in Task 5). Then stop the preview server.

- [ ] **Step 3: Commit (only if anything changed)**

Nothing should have changed; skip the commit if `git status` is clean.

---

### Task 5: CLAUDE.md update + manual live-auth verification

**Files:**
- Modify: `CLAUDE.md` (Phase 2 section + project-structure file descriptions)

**Interfaces:**
- Consumes: the shipped behavior from Tasks 1–4.
- Produces: docs matching reality; a user-assisted verification checklist.

- [ ] **Step 1: Update CLAUDE.md**

Update these spots (keep surrounding structure; wording may be adapted to fit):

1. **Project structure block** — `audioAnalysis.ts` line becomes:
   `audioAnalysis.ts    analyzePCM() — Essentia.js (WASM) feature extraction: RhythmExtractor2013 (BPM+confidence), KeyExtractor (mode), SpectralCentroidTime (brightness), Loudness (energy); runs in the worker`
   and `analysisClient.ts` line: change `(11kHz mono)` → `(44.1kHz mono)`; and `featureCache.ts` line: `v6` → `v7`.
2. **"Phase 2 — Audio Analysis & Smart Sliders" → "Audio Feature Extraction"**: rewrite point 2–3 to say the clip is resampled to mono **44.1 kHz** (Essentia's RhythmExtractor2013 assumes 44100) and `analyzePCM` (async, in the worker) uses **Essentia.js 0.1.3** — `energyRaw` ← `Loudness` (energy^0.67), `moodRaw` ← 0.6·brightness (`SpectralCentroidTime`/4 kHz ceiling) + 0.4·mode (`KeyExtractor` major/minor × strength), `bpm` ← `RhythmExtractor2013` multifeature clamped 50–200 with `bpmConfidence` (0–1, raw 0–5.32 rescaled) persisted-but-unused. Point 4: cache is **v7**.
3. **"Known Limitations / Future Work"**: remove the "Best overall future upgrade: Essentia.js…" bullet and the hand-rolled-DSP caveats it fixed; note instead that Essentia WASM objects require manual `.delete()` (done in `analyzePCM`) and that `bpmConfidence` is available for a future de-weighting enhancement.
4. Anywhere else `11025`/`11kHz`/hand-rolled FFT is mentioned in Phase 2 text (grep for `11`, `FFT`, `Krumhansl`, `spectral-flux`), align with the new implementation. Import boilerplate/entry-point note: essentia is imported from `essentia.js/dist/essentia.js-core.es.js` + `essentia-wasm.es.js` (base64-embedded WASM ES build) with ambient types in `src/types/essentia.d.ts`.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for Essentia.js DSP migration (44.1kHz, cache v7)"
```

- [ ] **Step 3: Manual verification with live Apple Music auth (user-assisted — cannot be done headlessly)**

With `npm run dev` running, the user signs in and confirms:

1. Active-cassette LCD populates `BPM / NRG / MOD`; background pass logs `[Kassette] Background analysis: N tracks`. First run re-analyzes everything (v7 cache) — expect ~2s/track/worker, noticeably slower than before; watch that it completes.
2. Detected BPM sanity-checks against a few known-tempo tracks (should beat the old heuristic, especially on clear-beat genres).
3. Pace/Energy/Mood sliders re-sort the upcoming queue sensibly; slider auto-snap on track change still reflects the track.
4. No WASM/heap errors in the console over a long background run (proves the `.delete()` cleanup is complete). If throughput feels unacceptable, the sanctioned fallback is switching `'multifeature'` → `'degara'` in `analyzePCM` (keep everything else identical).
