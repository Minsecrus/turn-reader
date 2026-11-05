import { invoke } from '@tauri-apps/api/core'

export interface ZipEntry {
  name: string
  size: number
}

export interface Opened {
  id: number
  entries: ZipEntry[]
}

export const ipc = {
  openBook: (path: string) => invoke<Opened>('open_book', { path }),
  closeBook: (id: number) => invoke<void>('close_book', { id }),
  loadState: () => invoke<string | null>('load_state'),
  saveState: (json: string) => invoke<void>('save_state', { json }),
  launchFile: () => invoke<string | null>('launch_file'),
}
