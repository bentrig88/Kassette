/**
 * VHS-glitch overlay — pure CSS/SVG (no WebGL, so no context limits or shader
 * compile step; works in dev + prod). Layered artifacts (grain, scanlines,
 * rolling scan bar, glitch tears, vignette, flicker) composited over the DOM on
 * a `pointer-events: none` element, so everything underneath stays clickable.
 */
export function VhsOverlay() {
  return (
    <div className="vhs-overlay" aria-hidden="true">
      <div className="vhs-grain" />
      <div className="vhs-glitch" />
      <div className="vhs-scanlines" />
      <div className="vhs-vignette" />
    </div>
  )
}
