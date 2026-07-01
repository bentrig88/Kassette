/**
 * VHS-glitch overlay — pure CSS/SVG (no WebGL, so no context limits or shader
 * compile step; works in dev + prod). Layered artifacts (grain, scanlines,
 * rolling scan bar, glitch tears, vignette, flicker) composited over the DOM on
 * a `pointer-events: none` element, so everything underneath stays clickable.
 *
 * `animate` (default true) drives the moving layers. When false the overlay is
 * static (grain/glitch/flicker paused; scanlines + vignette stay) — used off the
 * auth state to cut the continuous grain repaint on the player + loading screens.
 */
export function VhsOverlay({ animate = true }: { animate?: boolean }) {
  return (
    <div className={'vhs-overlay' + (animate ? '' : ' vhs-overlay--static')} aria-hidden="true">
      <div className="vhs-grain" />
      <div className="vhs-glitch" />
      <div className="vhs-scanlines" />
      <div className="vhs-vignette" />
    </div>
  )
}
