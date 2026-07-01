import { useEffect, useMemo, useState } from 'react'
import * as PlayerAssets from '../assets/player/playerAssets'
import * as CassetteAssets from '../assets/tapes/cassetteAssets'
import { genreBackgroundMap } from '../assets/background/genreBackgrounds'
import cassette0 from '../assets/tapes/cassette0-body-flat.webp'
import bgGeneric from '../assets/background/background-generic.webp'
import obj1 from '../assets/background/object-generic-1.webp'
import obj2 from '../assets/background/object-generic-2.webp'
import obj3 from '../assets/background/object-generic-3.webp'
import authBg from '../assets/auth/auth-background.webp'
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

  const urls = useMemo(() => Array.from(new Set([
    ...collectUrls(PlayerAssets as Record<string, unknown>),
    ...collectUrls(CassetteAssets as Record<string, unknown>),
    ...Object.values(genreBackgroundMap),
    cassette0, bgGeneric, obj1, obj2, obj3, authBg, logoUrl,
  ].filter((u): u is string => typeof u === 'string' && u.length > 0))), [])

  const total = urls.length

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
  }, [urls])

  const progress = done ? 1 : (total > 0 ? loaded / total : 0)
  return { progress, done }
}
