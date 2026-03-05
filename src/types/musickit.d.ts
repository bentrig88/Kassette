declare namespace MusicKit {
  function configure(config: Configuration): Promise<MusicKitInstance>
  function getInstance(): MusicKitInstance

  interface Configuration {
    developerToken: string
    app: {
      name: string
      build: string
      icon?: string
    }
  }

  interface MusicKitInstance {
    isAuthorized: boolean
    volume: number
    currentPlaybackTime: number
    currentPlaybackDuration: number
    playbackState: number
    nowPlayingItem: MediaItem | null
    queue: Queue

    authorize(): Promise<string>
    unauthorize(): Promise<void>
    play(): Promise<void>
    pause(): void
    stop(): void
    seekToTime(time: number): Promise<void>
    setQueue(options: QueueOptions): Promise<Queue>
    changeToMediaAtIndex(index: number): Promise<void>
    skipToNextItem(): Promise<void>
    skipToPreviousItem(): Promise<void>

    addEventListener(event: string, callback: (...args: unknown[]) => void): void
    removeEventListener(event: string, callback: (...args: unknown[]) => void): void

    api: API
  }

  interface API {
    music(path: string, params?: Record<string, unknown>): Promise<APIResponse>
  }

  interface APIResponse {
    data: {
      data: MediaItem[]
      next?: string
    }
  }

  interface MediaItem {
    id: string
    type: string
    attributes: {
      name: string
      artistName: string
      albumName: string
      genreNames: string[]
      durationInMillis: number
      isrc?: string
      artwork?: {
        url: string
        width: number
        height: number
      }
    }
  }

  interface Queue {
    items: MediaItem[]
    position: number
    length: number
  }

  interface QueueOptions {
    items?: Array<{
      id: string
      type: string
      attributes?: {
        name?: string
        artistName?: string
        albumName?: string
        durationInMillis?: number
        genreNames?: string[]
        artwork?: { url: string; width: number; height: number }
      }
    }>
    startWith?: number
    startPosition?: number
  }

  const PlaybackStates: {
    none: 0
    loading: 1
    playing: 2
    paused: 3
    stopped: 4
    ended: 5
    seeking: 6
    waiting: 8
    stalled: 9
    completed: 10
  }
}

interface Window {
  MusicKit: typeof MusicKit
}
