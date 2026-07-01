import { useEffect, useRef, useState } from 'react'
import Lottie from 'lottie-react'
import logoLoading from '../assets/auth/logo_loading.json'
import logoReveal from '../assets/auth/logo_reveal.json'
import redBack from '../assets/auth/auth-red-back.svg'
import loadingTapeBack from '../assets/auth/loading_tape_back.webp'
import authBg from '../assets/auth/auth-background.webp'
import authTape from '../assets/auth/auth-tape.webp'
import authTapeShadow from '../assets/auth/auth-tape-shadow.webp'
import authLogo from '../assets/auth/auth-logo.svg'

// Auth-screen assets to preload while the loading loop plays.
const PRELOAD = [authBg, authTape, authTapeShadow, redBack, authLogo]

/**
 * Pre-auth loader. Fully-red diagonal cover with a looping Lottie while the auth
 * assets download; once ready, the loop finishes and swaps to the reveal Lottie;
 * when that finishes the Lottie fades out and the red cover slides left to reveal
 * the auth screen underneath. Calls onDone after the reveal transition.
 */
type Phase = 'loading' | 'reveal' | 'exit'

export function AuthIntro({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [slide, setSlide] = useState(false)
  const [started, setStarted] = useState(false)
  const assetsReadyRef = useRef(false)
  const fade = phase === 'exit'

  // Fade the loading Lottie + tape shell in on first paint.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setStarted(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  // Preload the auth assets; flip the flag when all are done (or after a
  // safety timeout so we never hang the loader).
  useEffect(() => {
    let remaining = PRELOAD.length
    let settled = false
    const done = () => { if (!settled) { settled = true; assetsReadyRef.current = true } }
    const tick = () => { remaining -= 1; if (remaining <= 0) done() }
    for (const src of PRELOAD) {
      const img = new Image()
      img.onload = tick
      img.onerror = tick
      img.src = src
    }
    const safety = setTimeout(done, 6000)
    return () => clearTimeout(safety)
  }, [])

  // When a loading loop completes AND assets are ready, move to the reveal.
  function handleLoadingLoop() {
    if (assetsReadyRef.current) setPhase('reveal')
  }

  function handleRevealComplete() {
    setPhase('exit')
  }

  // Exit choreography: the Lottie fades (via `fade` = phase==='exit'), then the
  // red cover slides away, then done.
  useEffect(() => {
    if (phase !== 'exit') return
    const t1 = setTimeout(() => setSlide(true), 450)
    const t2 = setTimeout(onDone, 1500)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [phase, onDone])

  const cls =
    'auth-intro' + (fade ? ' auth-intro--fade' : '') + (slide ? ' auth-intro--slide' : '')

  return (
    <div className={cls} aria-hidden="true">
      <img src={redBack} alt="" className="auth-intro-red" />
      <img
        src={loadingTapeBack}
        alt=""
        className={
          'auth-intro-tape' +
          (!started || phase !== 'loading' ? ' auth-intro-tape--hidden' : '')
        }
      />
      <div className={'auth-intro-logo' + (started ? ' auth-intro-logo--in' : '')}>
        {phase === 'loading' ? (
          <Lottie animationData={logoLoading} loop autoplay onLoopComplete={handleLoadingLoop} />
        ) : (
          <Lottie animationData={logoReveal} loop={false} autoplay onComplete={handleRevealComplete} />
        )}
      </div>
    </div>
  )
}
