// Figma cassette tape assets — node 51:4831, file 8Q9h4JkKgL8ota7JdW7qrX
// Stored locally — re-export from Figma MCP if the design changes.

import _imgLeftReelTape from './cassette-reel-left.svg'
import _imgRightReelTape from './cassette-reel-right.svg'
import _imgBodyFlat from './cassette-body-flat.png'
import _imgBody2Flat from './cassette2-body-flat.png'
import _imgBody3Flat from './cassette3-body-flat.png'
import _imgBody4Flat from './cassette4-body-flat.png'
import _imgBody5Flat from './cassette5-body-flat.png'
import _imgBody6Flat from './cassette6-body-flat.png'

export const imgLeftReelTape = _imgLeftReelTape
export const imgRightReelTape = _imgRightReelTape

// Edit this map to assign a style to each genre.
// ← this is the only place you need to touch when reassigning styles.
export const genreBodyMap: Record<string, string> = {
  'Rock':       _imgBodyFlat,
  'Hip-Hop':    _imgBody2Flat,
  'Electronic': _imgBody3Flat,
  'Reggae':     _imgBody4Flat,
  'Classical':  _imgBody5Flat,
  'Folk':       _imgBody6Flat,
  'Jazz':       _imgBody3Flat,  // reuse Electronic — reassign when ready
  'Pop':        _imgBody5Flat,  // reuse Classical  — reassign when ready
}
