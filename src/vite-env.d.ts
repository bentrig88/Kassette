/// <reference types="vite/client" />

declare module '*.aac' {
  const src: string
  export default src
}

interface ImportMetaEnv {
  readonly VITE_APPLE_MUSIC_DEVELOPER_TOKEN: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
