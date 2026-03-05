import { useEffect, useRef, useState } from 'react'

const BAR_COUNT = 12

/**
 * Simulates a VU meter when playing.
 * DRM-protected content prevents Web Audio API tapping,
 * so we use animated pseudo-random values seeded by time.
 */
export function useVUMeter(isPlaying: boolean) {
  const [bars, setBars] = useState<number[]>(new Array(BAR_COUNT).fill(0))
  const rafRef = useRef<number | null>(null)
  const lastTimeRef = useRef(0)

  useEffect(() => {
    if (!isPlaying) {
      // Animate bars falling to zero
      let falling = true
      function fall() {
        setBars((prev) => {
          const next = prev.map((v) => Math.max(0, v - 0.08))
          falling = next.some((v) => v > 0)
          return next
        })
        if (falling) {
          rafRef.current = requestAnimationFrame(fall)
        }
      }
      rafRef.current = requestAnimationFrame(fall)
      return () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
      }
    }

    // Animate VU bars with pseudo-random values
    function animate(time: number) {
      if (time - lastTimeRef.current > 80) {
        lastTimeRef.current = time
        setBars(generateBars(time))
      }
      rafRef.current = requestAnimationFrame(animate)
    }

    rafRef.current = requestAnimationFrame(animate)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [isPlaying])

  return bars
}

function generateBars(seed: number): number[] {
  const bars: number[] = []
  // Simple LCG-based pseudo random for smooth-ish animation
  let s = Math.floor(seed / 100)
  for (let i = 0; i < BAR_COUNT; i++) {
    s = (s * 1664525 + 1013904223) & 0xffffffff
    const base = Math.abs(s) / 0xffffffff
    // Shape: more energy in mid frequencies (bars 3-8)
    const shape = 1 - Math.abs((i - BAR_COUNT / 2) / (BAR_COUNT / 2)) * 0.4
    bars.push(Math.min(1, base * shape * 1.3))
  }
  return bars
}
