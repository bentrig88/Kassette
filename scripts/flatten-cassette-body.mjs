/**
 * Composites the ct-swapable cassette body layers into a single PNG.
 * Run: node scripts/flatten-cassette-body.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { execSync } from 'child_process'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const ASSETS = join(__dir, '../src/assets/tapes')
const OUT_SVG = '/tmp/cassette-body-composite.svg'
const OUT_PNG = join(__dir, '../src/assets/tapes/cassette-body-flat.png')

// Figma canvas bounding box of the cassette body
const BX = 47, BY = 52, BW = 550, BH = 342
// Output scale (2× for retina)
const SCALE = 2
const W = BW * SCALE
const H = BH * SCALE

// [filename, canvas_left, canvas_top, canvas_w, canvas_h]
// Order: bottom → top (same as BODY_LAYERS in CassetteTapeBody.tsx)
const LAYERS = [
  ['cassette-ears.svg',                  43,      286,      558,     82],
  ['cassette-subtract-base-shadow.svg',  47,       60,      550,    342],
  ['cassette-subtract-base.svg',         47,       52,      550,    342],
  ['cassette-pattern.svg',               47,       52,      550,    342],
  ['cassette-other-pattern.svg',         75,       75,      494,    240],
  ['cassette-subtract-pattern.svg',      167.95,  360.27,  308.098, 29.392],
  ['cassette-bottom-border.svg',         127,     321,      390,     73],
  ['cassette-screw-center.svg',          312,     334,       20,     20],
  ['cassette-screw.svg',                  56,      61,       22,     22], // TL
  ['cassette-screw.svg',                 566,      61,       22,     22], // TR
  ['cassette-screw.svg',                  56,     363,       22,     22], // BL
  ['cassette-screw.svg',                 566,     363,       22,     22], // BR
  ['cassette-side-a-bottom-right.svg',   517,     321,       53,     38],
  ['cassette-logo-top-right.svg',        504,      56,       53,     12],
  ['cassette-tdk-logo.svg',              165,     255,      327,     66],
]

// Encode each unique SVG file as a base64 data URI
const cache = new Map()
function dataUri(filename) {
  if (!cache.has(filename)) {
    const buf = readFileSync(join(ASSETS, filename))
    cache.set(filename, `data:image/svg+xml;base64,${buf.toString('base64')}`)
  }
  return cache.get(filename)
}

// Build composite SVG
const images = LAYERS.map(([file, cl, ct, cw, ch]) => {
  const x = (cl - BX) * SCALE
  const y = (ct - BY) * SCALE
  const w = cw * SCALE
  const h = ch * SCALE
  return `  <image href="${dataUri(file)}" x="${x.toFixed(4)}" y="${y.toFixed(4)}" width="${w.toFixed(4)}" height="${h.toFixed(4)}" />`
}).join('\n')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
${images}
</svg>`

writeFileSync(OUT_SVG, svg)
console.log(`Composite SVG written to ${OUT_SVG}`)

// Convert to PNG via sips
execSync(`sips -s format png "${OUT_SVG}" --out "${OUT_PNG}"`, { stdio: 'inherit' })
console.log(`PNG written to ${OUT_PNG}`)
console.log(`Size: ${W}×${H}px (@${SCALE}x)`)
