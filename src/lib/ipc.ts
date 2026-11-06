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
  /** Android: copies a `content://`/`file://` book into Turn's storage, returns its path. */
  importBook: (uri: string) => invoke<string>('import_book', { uri }),
  /** A book left the bookshelf: deletes Turn's imported copy, if it is one. */
  forgetBook: (path: string) => invoke<void>('forget_book', { path }),
  loadState: () => invoke<string | null>('load_state'),
  saveState: (json: string) => invoke<void>('save_state', { json }),
  /** The file Turn was launched with or handed while running, once. */
  takePendingFile: () => invoke<string | null>('take_pending_file'),
}
