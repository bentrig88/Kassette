import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { imgLeftReelTape, imgRightReelTape } from './assets/tapes/cassetteAssets'
import loadingTapeBody from './assets/tapes/cassette0-body-flat.webp'
import authLogo from './assets/auth/auth-logo.svg'
import authBg from './assets/auth/auth-background.webp'

// Warm the loading-screen-critical images at the earliest JS moment. The
// post-auth LoadingScreen mounts before its own asset preloader can help it
// (chicken-and-egg), so over a real network its tape pops in late. Fetching
// here — on every load, including the pre-auth visit — means the post-connect
// reload paints the loading tape straight from HTTP cache.
for (const url of [loadingTapeBody, imgLeftReelTape, imgRightReelTape, authLogo, authBg]) {
  new Image().src = url
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
