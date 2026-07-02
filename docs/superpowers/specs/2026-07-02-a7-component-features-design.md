# Spec: A7 — Component-based audio features (cache v8)

**Date:** 2026-07-02
**Status:** Approved in principle (design walked through with Benjamin), ready for an implementation plan.
**Audience:** A fresh implementing agent with no session context. Read this top to bottom, then the referenced files, before writing code.
**Origin:** Item A7 of `docs/audits/2026-07-02-mechanics-ux-audit.md`. Builds on the Essentia.js migration spec (`2026-07-02-essentia-dsp-migration.md`) — that pipeline is in place and this spec only changes what the worker extracts and how the normalizer composes it.

---

## 1. Goal

Make the existing three sliders truer without any UI change:

- **Energy** stops being a mastering-loudness proxy. New meaning (user-chosen): *drive/intensity blend* — loud AND rhythmically busy AND dynamically dense.
- **Mood** keeps its brightness + major/minor character but gains a *groove cue* (Danceability) — happy tracks tend to groove, sad ones rarely do.
- **Pace** is unchanged (BPM + confidence shrink).

**Non-goals:** no fourth slider (but `danceability` lands in every cache row, so a future one needs no re-analysis), no UI changes, no changes to sort/queue mechanics, no change to the two-tier multifeature/degara split.

## 2. Architecture decision (user-approved)

**Store raw components; blend in percentile space** (Approach A):

- The worker returns each raw signal separately; the cache stores them.
- `buildNormalizer` percentile-ranks each component within the user's analyzed library, then composes `{pace, energy, mood}` from *percentiles* with fixed weights.
- Why: blending percentiles is statistically sound (raw units never mix), and re-tuning weights — or adding a slider — is a code-only change with **zero re-analysis**.

The rejected alternative (worker bakes single `energyRaw`/`moodRaw` numbers) would reintroduce fixed-constant cross-unit scaling and make every weight tweak cost a full library re-analysis.

## 3. Data model — `featureCache.ts`

```ts
export interface TrackFeatures {
  id: string
  bpm: number               // RhythmExtractor2013, clamped 50–200
  bpmConfidence?: number    // 0–1 (multifeature only; omitted for degara)
  loudness: number          // Loudness (Steven's-law energy^0.67)
  onsetRate: number         // OnsetRate — onsets per second (activity)
  dynamicComplexity: number // DynamicComplexity — loudness fluctuation
  centroidHz: number        // SpectralCentroidTime — brightness
  modeScore: number         // 0–1: major → 0.5+0.5·strength, minor → 0.5−0.5·strength (KeyExtractor)
  danceability: number      // Danceability — groove/pulse strength
  analyzedAt: number
  unanalyzable?: true       // tombstone: numeric fields are zeroed sentinels
}
```

- `energyRaw` / `moodRaw` are **deleted** — grep for every reader and migrate (see §5; the set is small because consumers go through the normalizer).
- `VERSION = 7 → 8` (the `onupgradeneeded` drop/recreate forces the clean-wipe full re-analysis Benjamin approved; ~20–40 min background for a 10k library at degara speeds).
- `makeTombstone(id)` zeroes all numeric fields, keeps `unanalyzable: true`.

## 4. Worker — `audioAnalysis.ts` `analyzePCM`

Per clip (unchanged: 44.1 kHz mono PCM in, one Essentia instance per worker, everything in try/finally):

| Signal | Algorithm | Notes |
|---|---|---|
| `bpm`, `bpmConfidence` | `RhythmExtractor2013(signal, 208, method, 40)` | unchanged, incl. `.delete()` of ticks/estimates/bpmIntervals and the method param (multifeature/degara) |
| `loudness` | `Loudness(signal)` | unchanged |
| `onsetRate` | `OnsetRate(signal)` | returns `{ onsets, onsetRate }` — `onsets` is very likely a WASM vector: **`.delete()` it** (spike confirms) |
| `dynamicComplexity` | `DynamicComplexity(signal)` | returns `{ dynamicComplexity, loudness }` scalars (spike confirms) |
| `centroidHz` | `SpectralCentroidTime(signal, sampleRate)` | unchanged |
| `modeScore` | `KeyExtractor(signal)` | same 0–1 mapping as today |
| `danceability` | `Danceability(signal)` | check output shape for vectors (spike confirms) |

Worker message protocol `{reqId, id, samples, sampleRate, method}` → `{reqId, features}` is unchanged; only the features object grows. Ambient types in `src/types/essentia.d.ts` gain the three new algorithm signatures with shapes copied from the spike.

**Spike first (blocking):** a Node script against the UMD build (pattern: the Essentia-migration spike) that (a) prints the exact output keys of `OnsetRate` / `DynamicComplexity` / `Danceability` and which have `.delete`, and (b) times the full new chain on a 10s clip for both rhythm methods. Estimated added cost +0.3–0.8 s/track; if the measured degara-path total exceeds ~2 s/track, stop and discuss before proceeding.

## 5. Normalizer — `featureNormalize.ts`

- `buildNormalizer` builds seven sorted arrays (bpm, loudness, onsetRate, dynamicComplexity, centroidHz, modeScore, danceability), skipping tombstones as today.
- `normalize(f)` keeps the exact `NormalizedFeatures = { pace, energy, mood }` contract:
  - `pace` = P(bpm)
  - `energy` = `0.45·P(loudness) + 0.30·P(onsetRate) + 0.25·P(dynamicComplexity)`
  - `mood` = `0.45·P(centroidHz) + 0.30·P(modeScore) + 0.25·P(danceability)`
- Weights are exported constants (`ENERGY_WEIGHTS`, `MOOD_WEIGHTS`) so future tuning is one edit.
- Because every consumer reads `normalize()` and `f.bpm`/`f.bpmConfidence` (sort, snap, LCD via TrackDisplay, LoadingScreen) — **no consumer logic changes**. The full list of `TrackFeatures` field readers to verify at implementation time: `featureNormalize.ts`, `sortTracksByFilters` (`bpmConfidence`), `TrackDisplay` (`bpm`, `unanalyzable`), `LoadingScreen.metaFor` (`bpm`, `unanalyzable`), `CassettePlayer` snap (`unanalyzable`), `playerStore.addFeatures/bulkAddFeatures` (`unanalyzable`), the two analysis hooks (whole-object passthrough), `analysisClient` (whole-object passthrough).

## 6. Files to change

- `src/services/featureCache.ts` — interface, `VERSION = 8`, `makeTombstone`.
- `src/services/audioAnalysis.ts` — extract the new signals; `.delete()` any new vector outputs.
- `src/types/essentia.d.ts` — add `OnsetRate`, `DynamicComplexity`, `Danceability` signatures (shapes from the spike).
- `src/services/featureNormalize.ts` — component percentiles + weighted composition + exported weights.
- `CLAUDE.md` — Phase 2 feature-extraction + normalization sections, cache v8.
- **Do NOT touch:** hooks, stores, `sortTracksByFilters`, `analysisClient`, any UI component (unless the field-reader sweep in §5 surfaces a direct `energyRaw`/`moodRaw` read — migrate it to the normalizer).

## 7. Verification

No test runner. Gates:
1. Node spike passes (shapes + cost within budget) — before any production code.
2. `npm run build` + `npm run lint` exit 0.
3. Headless-Chrome dev-worker spike (pattern: `browser-spike.mjs` from the Essentia migration): synthetic clip through the real module worker returns all 8 numeric fields with sane values (bpm 120 on the click track; every component finite and non-negative).
4. Production-worker spike against `vite preview` (same assertion).
5. Manual with live auth after the v8 re-analysis: Energy HIGH surfaces loud+busy tracks (a quiet-mastered but dense track should now rank high — the headline fix); Mood HIGH favors bright/major/groovy; slider snap and LCD BPM behave identically; no WASM heap errors over a long background run (new `.delete()`s are complete).

## 8. Suggested task breakdown

1. Node spike (§4) — resolve output shapes + cost. Blocking.
2. `featureCache` v8 + `makeTombstone` + ambient types.
3. `analyzePCM` extraction + cleanup.
4. `featureNormalize` composition + weights; field-reader sweep (§5).
5. Build/lint + browser spikes (dev + preview).
6. CLAUDE.md; manual verification handoff.
