/* eslint-disable react-refresh/only-export-components */
import { imgLine14 } from '../assets/player/playerAssets'

export interface ScreenTrack {
  name: string
  artistName: string
}
export interface ScreenMeta {
  bpm: number
  nrg: number
  mood: number
}

export function formatTime(sec: number) {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

interface Props {
  now: ScreenTrack | null
  nowTime: number
  nowDuration: number
  nowProgress: number
  nowMeta: ScreenMeta | null
  next: ScreenTrack | null
  nextMeta: ScreenMeta | null
}

/**
 * Presentational now/next LCD — the exact markup shared by CassettePlayer and
 * the loading-screen tape. No store access; all data comes in via props.
 */
export function TrackScreen({ now, nowTime, nowDuration, nowProgress, nowMeta, next, nextMeta }: Props) {
  return (
    <div className="np-screen">
      <div className="np-screen-inner">
        {/* NEXT column */}
        <div className="np-screen-col np-screen-col--next">
          <div className="np-screen-header">
            <span className="np-screen-label">NEXT</span>
          </div>
          {next ? (
            <>
              <div className="np-screen-progress-track np-screen-progress-track--empty" />
              <div className="np-screen-title np-screen-title--dim">{next.name}</div>
              <div className="np-screen-artist np-screen-artist--dim">{next.artistName}</div>
            </>
          ) : (
            <div className="np-screen-artist np-screen-artist--dim">—</div>
          )}
          {nextMeta ? (
            <div className="np-screen-meta np-screen-meta--dim">
              <span>{nextMeta.bpm} BPM</span>
              <img src={imgLine14} alt="" className="np-meta-sep" />
              <span>NRG {nextMeta.nrg}</span>
              <img src={imgLine14} alt="" className="np-meta-sep" />
              <span>MOOD {nextMeta.mood}</span>
            </div>
          ) : (
            <div className="np-screen-meta np-screen-meta--placeholder" />
          )}
        </div>

        <div className="np-screen-divider" />

        {/* NOW column */}
        <div className="np-screen-col np-screen-col--now">
          <div className="np-screen-header">
            <span className="np-screen-label">NOW</span>
            {now && (
              <span className="np-screen-time">{formatTime(nowTime)} / {formatTime(nowDuration)}</span>
            )}
          </div>
          {now ? (
            <>
              <div className="np-screen-progress-track">
                <div className="np-screen-progress-fill" style={{ width: `${nowProgress * 100}%` }} />
              </div>
              <div className="np-screen-title">{now.name}</div>
              <div className="np-screen-artist">{now.artistName}</div>
            </>
          ) : (
            <div className="np-screen-idle">INSERT TAPE</div>
          )}
          {nowMeta ? (
            <div className="np-screen-meta">
              <span>{nowMeta.bpm} BPM</span>
              <img src={imgLine14} alt="" className="np-meta-sep" />
              <span>NRG {nowMeta.nrg}</span>
              <img src={imgLine14} alt="" className="np-meta-sep" />
              <span>MOOD {nowMeta.mood}</span>
            </div>
          ) : (
            <div className="np-screen-meta np-screen-meta--empty">NO DATA</div>
          )}
        </div>
      </div>
      {/* Glass reflection */}
      <div className="np-screen-glass" />
    </div>
  )
}
