import { useEffect, useRef } from 'react'

/**
 * Full-screen procedural VHS-glitch overlay. A transparent WebGL canvas that
 * draws scanlines, a rolling scan bar, grain, glitch tear-bands, chromatic
 * streaks, flicker and a vignette ON TOP of the DOM. `pointer-events: none`
 * (set in CSS) keeps everything underneath clickable — it composites over the
 * real page rather than sampling/warping it.
 */
const VERT = `
attribute vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }
`

const FRAG = `
precision highp float;
uniform float u_time;
uniform vec2  u_res;
uniform float u_intensity;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

// composite b OVER a (straight alpha)
vec4 over(vec4 a, vec4 b) {
  float oa = b.a + a.a * (1.0 - b.a);
  vec3  oc = (b.rgb * b.a + a.rgb * a.a * (1.0 - b.a)) / max(oa, 1e-4);
  return vec4(oc, oa);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float t = u_time;
  float I = u_intensity;

  vec4 col = vec4(0.0);

  // scanlines
  float lines = sin(uv.y * u_res.y * 1.6);
  col = over(col, vec4(0.0, 0.0, 0.0, smoothstep(0.0, 1.0, -lines) * 0.35 * I));

  // rolling scan bar (drifts down)
  float barPos = fract(-t * 0.12);
  float bar = smoothstep(0.06, 0.0, abs(uv.y - barPos));
  col = over(col, vec4(1.0, 1.0, 1.0, bar * 0.12 * I));

  // grain
  float g = hash(floor(gl_FragCoord.xy) + floor(t * 60.0));
  col = over(col, vec4(vec3(g), g * 0.18 * I));

  // glitch tear-bands (flicker on/off, colored streaks + black drops)
  float band = floor(uv.y * 24.0);
  float bt = hash(vec2(band, floor(t * 8.0)));
  if (bt > 0.84) {
    float amt = (bt - 0.84) / 0.16;
    vec3 tint = (hash(vec2(band, 3.0)) > 0.5) ? vec3(0.0, 1.0, 1.0) : vec3(1.0, 0.0, 0.6);
    float streak = hash(vec2(uv.x * 40.0, band + floor(t * 8.0)));
    col = over(col, vec4(tint, amt * streak * 0.55 * I));
    col = over(col, vec4(0.0, 0.0, 0.0, amt * (1.0 - streak) * 0.35 * I));
  }

  // occasional chromatic row streaks
  float rowN = hash(vec2(floor(uv.y * u_res.y * 0.5), floor(t * 4.0)));
  if (rowN > 0.985) col = over(col, vec4(0.0, 1.0, 1.0, 0.28 * I));

  // global flicker
  float flick = (hash(vec2(floor(t * 20.0), 7.0)) - 0.5) * 0.08 * I;
  col = over(col, flick < 0.0 ? vec4(0.0, 0.0, 0.0, -flick) : vec4(1.0, 1.0, 1.0, flick));

  // vignette
  float vig = smoothstep(0.85, 0.35, length(uv - 0.5));
  col = over(col, vec4(0.0, 0.0, 0.0, (1.0 - vig) * 0.4 * I));

  gl_FragColor = col;
}
`

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type)
  if (!sh) return null
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error('[VHS] shader compile error:', gl.getShaderInfoLog(sh))
    gl.deleteShader(sh)
    return null
  }
  return sh
}

export function VhsOverlay({ intensity = 1 }: { intensity?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvasEl = canvasRef.current
    if (!canvasEl) return
    const glCtx = canvasEl.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: false })
    if (!glCtx) return
    // Non-null aliases declared AFTER the guards so nested closures keep the type.
    const cv = canvasEl
    const gl = glCtx

    const vs = compile(gl, gl.VERTEX_SHADER, VERT)
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG)
    if (!vs || !fs) return
    const prog = gl.createProgram()!
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('[VHS] program link error:', gl.getProgramInfoLog(prog))
      return
    }
    gl.useProgram(prog)

    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const pLoc = gl.getAttribLocation(prog, 'p')
    gl.enableVertexAttribArray(pLoc)
    gl.vertexAttribPointer(pLoc, 2, gl.FLOAT, false, 0, 0)

    const uTime = gl.getUniformLocation(prog, 'u_time')
    const uRes = gl.getUniformLocation(prog, 'u_res')
    const uInt = gl.getUniformLocation(prog, 'u_intensity')

    function resize() {
      // VHS reads better slightly low-res; render at CSS pixels (cheaper too).
      cv.width = Math.floor(window.innerWidth)
      cv.height = Math.floor(window.innerHeight)
      gl.viewport(0, 0, cv.width, cv.height)
    }
    resize()
    window.addEventListener('resize', resize)

    const start = performance.now()
    let raf = 0
    function frame(now: number) {
      gl.uniform1f(uTime, (now - start) / 1000)
      gl.uniform2f(uRes, cv.width, cv.height)
      gl.uniform1f(uInt, intensity)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }, [intensity])

  return <canvas ref={canvasRef} className="vhs-overlay" aria-hidden="true" />
}
