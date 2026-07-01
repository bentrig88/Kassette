// Figma cassette tape assets — node 51:4831, file 8Q9h4JkKgL8ota7JdW7qrX
// Stored locally — re-export from Figma MCP if the design changes.

import _imgLeftReelTape from './cassette-reel-left.svg'
import _imgRightReelTape from './cassette-reel-right.svg'
import _imgBodyFlat from './cassette-body-flat.webp'
import _imgBody2Flat from './cassette2-body-flat.webp'
import _imgBody3Flat from './cassette3-body-flat.webp'
import _imgBody4Flat from './cassette4-body-flat.webp'
import _imgBody5Flat from './cassette5-body-flat.webp'
import _imgBody6Flat from './cassette6-body-flat.webp'
import _imgBody7Flat from './cassette7-body-flat.webp'
import _imgBody8Flat from './cassette8-body-flat.webp'

export const imgLeftReelTape = _imgLeftReelTape
export const imgRightReelTape = _imgRightReelTape

// Edit this map to assign a style to each genre.
// ← this is the only place you need to touch when reassigning styles.
export const genreBodyMap: Record<string, string> = {
  'Rock':       _imgBodyFlat,
  'Hip-Hop':    _imgBody2Flat,
  'Electronic': _imgBody3Flat,
  'Reggae':     _imgBody4Flat,
  'Classical':  _imgBody6Flat,
  'Folk':       _imgBody5Flat,
  'Jazz':       _imgBody7Flat,
  'Pop':        _imgBody8Flat,
}
