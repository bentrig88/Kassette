# Spec: Migrate audio-feature DSP to Essentia.js

**Date:** 2026-07-02
**Status:** Approved in principle (user chose "full Essentia.js"), ready to implement.
**Audience:** A fresh implementing agent with NO prior session context. Read this top to bottom; it is self-contained. Then read the referenced files before writing code.

---

## 1. Goal

Replace Kassette's hand-rolled audio-feature DSP (`analyzePCM` in `src/services/audioAnalysis.ts`) with **Essentia.js** (a WebAssembly port of the Essentia MIR library) running in the existing analysis Web Worker. Use Essentia's battle-tested algorithms for tempo, key, and loudness to produce higher-quality `bpm` / `energyRaw` / `moodRaw` values than the current FFT/spectral-flux/chroma heuristics.

**Non-goal:** changing the app's UX, the normalizer, the sort logic, the sliders, or the caching architecture. Only the *feature-extraction internals* change. The rest of the pipeline consumes the same `TrackFeatures` shape and must keep working unchanged.

---

## 2. Current state (read these files first)

The analysis pipeline (all already in place — do NOT rebuild it):

- **`src/hooks/usePreviewAnalysis.ts`** / **`src/hooks/useBackgroundAnalysis.ts`** — two passes that fetch 30s Apple Music preview clips, `decodeAudioData` them on the main thread, and call `analyzeAudioBuffer`. A bounded concurrency pool (`src/lib/mapPool.ts`, `CONCURRENCY = 6`) drives them. A shared `AudioContext` + cross-pass in-flight dedup live in **`src/lib/analysisShared.ts`**. Results are cached in IndexedDB and pushed into the Zustand store (`addFeatures`).
- **`src/services/analysisClient.ts`** — main-thread worker owner. `analyzeAudioBuffer(id, buffer)`:
  1. `toMonoPCM(buffer)` resamples the decoded clip to **mono `TARGET_RATE = 11025` Hz** via `OfflineAudioContext` and returns a `Float32Array`.
  2. Transfers that PCM to a **pool** of workers (round-robin), correlating responses by `reqId` through a `pending` Map.
- **`src/workers/analysis.worker.ts`** — receives `{reqId, id, samples, sampleRate}`, calls `analyzePCM(id, samples, sampleRate)` (synchronous today), posts back `{reqId, features}` or `{reqId, error}`.
- **`src/services/audioAnalysis.ts`** — `export function analyzePCM(id, data: Float32Array, sampleRate): TrackFeatures`. Today it hand-rolls: radix-2 FFT, spectral-flux onset novelty + autocorrelation + a log-Gaussian tempo prior for `bpm`; RMS for `energyRaw`; spectral centroid (brightness) + chroma/Krumhansl-Schmuckler mode for `moodRaw = 0.6·brightness + 0.4·mode` (0–1). This whole file is what gets replaced.
- **`src/services/featureCache.ts`** — IndexedDB (`kassette-features`, store `tracks`, `keyPath: 'id'`). `TrackFeatures = { id: string; bpm: number; energyRaw: number; moodRaw: number; analyzedAt: number }`. `const VERSION = 6`. `onupgradeneeded` DROPS and recreates the store (so bumping VERSION forces a full re-analysis). Connection is cached in a module promise (reset on error); `getAllKeys()` bulk-check exists.
- **`src/services/featureNormalize.ts`** — `buildNormalizer(featuresMap)` converts each raw `bpm`/`energyRaw`/`moodRaw` to a **percentile rank within the analyzed library** → `{ pace, energy, mood }` (0–100). **This is scale-agnostic** — it percentile-ranks whatever raw numbers it's given, so changing how the raw values are computed requires NO change here as long as higher-raw still means higher-of-that-quality.
- **`src/services/appleMusic.ts`** — `sortTracksByFilters(...)` reads the normalizer; **unchanged by this work**.

**Data flow (unchanged):** preview clip → decode (main) → resample to PCM (main) → transfer to worker → `analyzePCM` (worker) → `TrackFeatures` → IndexedDB + store → normalizer → sliders/LCD.

---

## 3. Design

### 3.1 Dependency

Add `essentia.js` (npm). It bundles two pieces: the WASM backend and a JS class wrapper (`Essentia`) exposing the algorithms. Pin a specific version and record it.

**Vite/worker gotcha (important):** use the **base64-embedded ES build** of the WASM so Vite doesn't have to resolve a separate `.wasm` asset URL inside a module worker (that path resolution is the usual source of breakage). In most `essentia.js` versions this is the `essentia-wasm.es.js` (or `essentia-wasm.web.js`) entry that inlines the binary. Verify the exact export/entry names against the **installed version's `dist/` folder** before wiring imports — the package has shipped several different entry layouts across versions. Typical shape:

```ts
// in the worker module
import { Essentia, EssentiaWASM } from 'essentia.js'
// some versions instead: import Essentia from 'essentia.js/dist/essentia.js-core.es.js'
//                        import { EssentiaWASM } from 'essentia.js/dist/essentia-wasm.es.js'
```

Instantiation is async-ish and must happen **once per worker** and be reused:

```ts
let essentiaPromise: Promise<Essentia> | null = null
function getEssentia(): Promise<Essentia> {
  if (!essentiaPromise) {
    essentiaPromise = (async () => {
      // Depending on the build, EssentiaWASM is either the module object or a
      // factory returning a promise. Handle both:
      const wasm = typeof EssentiaWASM === 'function' ? await EssentiaWASM() : EssentiaWASM
      return new Essentia(wasm)
    })()
  }
  return essentiaPromise
}
```

### 3.2 Sample rate

Essentia's standard algorithms (RhythmExtractor2013, KeyExtractor, SpectralCentroidTime, Loudness) are tuned for and default to **44100 Hz**. The current pipeline resamples to 11025 Hz for the hand-rolled DSP — too low for Essentia's rhythm/key models.

**Decision:** raise `TARGET_RATE` in `analysisClient.ts` to **44100** for the Essentia path (accuracy over transfer cost). A 30s mono clip at 44100 = ~1.3M `Float32` = ~5.3 MB transferred per track; transfers are zero-copy and the worker pool is ≤~3, so this is acceptable. If profiling shows this is too heavy, 22050 is an acceptable fallback **only if** every algorithm call is passed `sampleRate: 22050` explicitly (confirm each accepts it) — but start at 44100.

### 3.3 Algorithms + feature mapping

In the worker, convert the incoming `Float32Array` to an Essentia vector once (`essentia.arrayToVector(samples)`), run the algorithms, then **free every vector/created object with `.delete()`** (Essentia WASM objects are not GC'd — leaking them exhausts the WASM heap over a full-library run). Wrap in try/finally so `.delete()` always runs.

Map to the existing `TrackFeatures` fields:

- **`bpm`** ← `RhythmExtractor2013(signal, maxTempo=208, method='multifeature', minTempo=40)` → use `.bpm`. Also capture `.confidence`. Clamp bpm to the current 50–200 range for parity. `method='multifeature'` is the most accurate (slower); `'degara'` is a faster fallback if worker throughput is a problem.
- **`energyRaw`** ← `Loudness(signal)` → `.loudness` (Essentia's `loudness = energy^0.67`, a better perceptual intensity than plain RMS). Fallback: `RMS(signal).rms`. Field name stays `energyRaw`; the normalizer percentile-ranks it regardless of absolute scale.
- **`moodRaw`** ← keep the current *shape* (a 0–1 blend of brightness + major/minor mode) so the "Mood" slider keeps its meaning, but source the parts from Essentia:
  - **mode:** `KeyExtractor(signal)` → `.scale` (`'major'` | `'minor'`) and `.strength` (0–1). `modeScore = scale === 'major' ? 0.5 + 0.5·strength : 0.5 − 0.5·strength` (major → brighter/happier, minor → darker), giving 0–1.
  - **brightness:** `SpectralCentroidTime(signal)` (or `Spectrum`→`Centroid` on frames) → centroid in Hz; normalize to 0–1 by dividing by a ceiling (e.g. `min(1, centroidHz / 4000)` — pick a ceiling that spreads a real library; the percentile normalizer will handle the rest, so exact ceiling isn't critical).
  - `moodRaw = 0.6·brightness + 0.4·modeScore` (0–1) — matches the current weighting so behavior is continuous.
- **`bpmConfidence` (NEW optional field):** add `bpmConfidence?: number` to `TrackFeatures` and store `RhythmExtractor2013.confidence`. It is **not** consumed yet (the normalizer/sort ignore unknown fields), but persisting it enables a future "de-weight shaky BPM" enhancement without another re-analysis. Optional but recommended while we're bumping the cache version anyway.

`analyzePCM` becomes **async** (Essentia init is async): `export async function analyzePCM(id, data, sampleRate): Promise<TrackFeatures>`. The worker's `onmessage` handler must `await` it (see §4).

### 3.4 Cache version bump

Bump `VERSION` in `featureCache.ts` from `6` to `7` (the `onupgradeneeded` drop/recreate then forces every track to re-analyze with Essentia). Also fix the stale `moodRaw` comment (it still says "zero-crossing rate"; it's brightness + mode).

---

## 4. Files to change

- **`package.json`** — add `essentia.js` (pin the version).
- **`src/services/audioAnalysis.ts`** — replace the entire hand-rolled implementation with the Essentia-based `async function analyzePCM`. Delete the now-dead FFT / tempo-prior / chroma / Krumhansl code. Add the `getEssentia()` singleton + vector `.delete()` cleanup.
- **`src/workers/analysis.worker.ts`** — make `onmessage` async and `await analyzePCM(...)`; keep the `{reqId, features}` / `{reqId, error}` protocol identical.
- **`src/services/analysisClient.ts`** — change `TARGET_RATE` 11025 → 44100 (and confirm `toMonoPCM` still transfers `.slice()`d PCM). Nothing else changes — `analyzeAudioBuffer` is already async and the pool/reqId plumbing is untouched.
- **`src/services/featureCache.ts`** — `VERSION` 6 → 7; add optional `bpmConfidence?: number` to `TrackFeatures`; fix the `moodRaw` comment.
- **`vite.config.ts`** — likely NO change if using the base64-embedded WASM build. If the chosen build needs the `.wasm` served as an asset, add whatever `assetsInclude` / worker config the version requires (verify empirically). Consider adding `essentia.js` to a `manualChunks` vendor group only if it ends up in the main chunk (it should be worker-only).
- **`CLAUDE.md`** — update the "Phase 2 — Audio Analysis" section to describe Essentia (RhythmExtractor2013 / KeyExtractor / Loudness), the 44100 resample, the v7 cache, and remove the "hand-rolled FFT / Essentia is future work" language.

**Do NOT touch:** `featureNormalize.ts`, `sortTracksByFilters` in `appleMusic.ts`, the hooks, `mapPool.ts`, `analysisShared.ts`, the stores, or any UI — the `TrackFeatures` contract is preserved.

---

## 5. Interfaces preserved (contract)

- `analyzeAudioBuffer(id: string, buffer: AudioBuffer): Promise<TrackFeatures>` — signature unchanged (still async).
- `TrackFeatures = { id, bpm, energyRaw, moodRaw, analyzedAt, bpmConfidence? }` — same required fields; only the optional `bpmConfidence` is added. Higher `energyRaw` still means more intense; higher `moodRaw` still means brighter/happier; `bpm` still in ~50–200.
- Worker message protocol `{reqId, id, samples, sampleRate}` → `{reqId, features}|{reqId, error}` — unchanged.

If those hold, the normalizer, sliders, LCD, and sort all keep working with zero changes.

---

## 6. Risks & open questions (resolve during implementation)

1. **essentia.js entry points / init pattern vary by version** — the single biggest integration risk. Inspect the installed `node_modules/essentia.js/dist/` and match imports to what's actually exported. Prefer the ES + base64-WASM build for Vite module-worker compatibility.
2. **WASM in a Vite module worker** — the worker is created via `new Worker(new URL('../workers/analysis.worker.ts', import.meta.url), { type: 'module' })`. Confirm the WASM instantiates inside that worker in both `npm run dev` and `npm run build && npm run preview` (dev and prod resolve assets differently).
3. **Bundle/memory** — the WASM is a few MB. It's worker-only and loaded lazily on first analysis, so it shouldn't hit initial page load — verify it does NOT get pulled into the main/entry chunk. Watch the WASM heap: `.delete()` every Essentia object.
4. **Throughput** — `RhythmExtractor2013` `multifeature` is accurate but CPU-heavy; a full library × pool could be slow. The worker pool already parallelizes; if too slow, consider `method='degara'`. Measure.
5. **Sample rate** — validate 44100 gives good BPM/key on real clips; only drop to 22050 if you pass `sampleRate` to every algorithm and re-validate.
6. **Async worker** — make sure the `onmessage` handler awaits and still posts `{reqId, error}` on rejection (callers skip failed tracks; don't let a rejection go unposted or the `pending` promise hangs).

---

## 7. Verification

No test runner exists in this project. Gates:
- `npm run build` (`tsc -b && vite build`) and `npm run lint` (`eslint .`) both exit 0.
- **Manual, with live Apple Music auth (required — can't be done headlessly):**
  1. Sign in; confirm the active-cassette LCD populates `BPM / NRG / MOOD` and the background pass fills the rest (watch the `[Kassette] Background analysis: N tracks` console log). First run re-analyzes everything (v7 cache) — expect it to take a while.
  2. Sanity-check detected BPM against a few tracks you know the tempo of (Essentia should be noticeably better than the old heuristic, especially on clear-beat genres).
  3. Drag the Pace/Energy/Mood sliders; confirm the upcoming queue re-sorts sensibly and the slider auto-snap on track change still reflects the track.
  4. Confirm no WASM/heap errors in the console over a long background run (proves `.delete()` cleanup is complete).

---

## 8. Suggested task breakdown (for the implementing agent)

1. Add `essentia.js`; write a tiny throwaway spike (a worker that instantiates Essentia and runs `RhythmExtractor2013` on a dummy signal) to lock down the exact import/init pattern for the installed version + confirm it builds and runs in dev AND `vite preview`. **Resolve risks #1/#2 before anything else.**
2. Rewrite `analyzePCM` (async, Essentia-based, with `.delete()` cleanup + the feature mapping in §3.3).
3. Make the worker handler async; bump `TARGET_RATE` to 44100.
4. Bump cache `VERSION` to 7; add `bpmConfidence?`; fix the comment.
5. Build + lint; then the manual verification in §7.
6. Update `CLAUDE.md`.

Use the superpowers writing-plans → subagent-driven-development flow if desired, but the spike in step 1 is the critical de-risking step — do it first and adjust the rest of the plan based on what the installed essentia.js version actually exposes.
