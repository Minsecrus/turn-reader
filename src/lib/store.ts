import { ipc } from './ipc'
import type { OverscrollTuning } from './overscroll'
import { DEFAULT_TUNING } from './overscroll'

export type ThemeKey = 'auto' | 'light' | 'paper' | 'dark'
export type FontKey = 'book' | 'serif' | 'sans' | 'kai'
export type WidthKey = 'narrow' | 'medium' | 'wide'
export type Flow = 'paginated' | 'scrolled'

export interface Settings {
  theme: ThemeKey
  font: FontKey
  fontSize: number
  lineHeight: number
  width: WidthKey
  flow: Flow
}

export interface BookRecord {
  path: string
  title: string
  author: string
  cover?: string
  cfi?: string
  fraction: number
  lastRead: number
}

interface Persisted {
  version: 1
  settings: Settings
  tuning: OverscrollTuning
  books: BookRecord[]
  lastOpen: string | null
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'auto',
  font: 'book',
  fontSize: 19,
  lineHeight: 1.8,
  width: 'medium',
  flow: 'paginated',
}

export const FONT_SIZE_MIN = 14
export const FONT_SIZE_MAX = 30
const MAX_BOOKS = 60

/**
 * Windows paths are case-insensitive and accept both separators. (On Android
 * every path is Turn's own lowercase `<hash>.epub`, so this is harmless there.)
 */
export const pathKey = (p: string) => p.replaceAll('/', '\\').toLowerCase()

/** Off the bookshelf: an imported copy (Android) is deleted, other files are left alone. */
const forget = (path: string) => void ipc.forgetBook(path).catch(e => console.error('Failed to forget book', e))

class Store {
  settings: Settings = { ...DEFAULT_SETTINGS }
  tuning: OverscrollTuning = { ...DEFAULT_TUNING }
  books: BookRecord[] = []
  lastOpen: string | null = null

  #timer: number | undefined
  #saving: Promise<void> = Promise.resolve()

  async load() {
    try {
      const raw = await ipc.loadState()
      if (!raw) return
      const data = JSON.parse(raw) as Partial<Persisted>
      this.settings = { ...DEFAULT_SETTINGS, ...data.settings }
      this.tuning = { ...DEFAULT_TUNING, ...data.tuning }
      this.books = Array.isArray(data.books) ? data.books : []
      this.lastOpen = data.lastOpen ?? null
    } catch (e) {
      console.error('Failed to load state', e)
    }
  }

  book(path: string) {
    const key = pathKey(path)
    return this.books.find(b => pathKey(b.path) === key)
  }

  /** Insert or update a record and move it to the front (most recent). */
  upsert(path: string, patch: Partial<BookRecord>) {
    const existing = this.book(path)
    const rec: BookRecord = {
      path,
      title: '',
      author: '',
      fraction: 0,
      ...existing,
      ...patch,
      lastRead: Date.now(),
    }
    const books = [rec, ...this.books.filter(b => b !== existing)]
    this.books = books.slice(0, MAX_BOOKS)
    for (const b of books.slice(MAX_BOOKS)) forget(b.path)
    this.save()
    return rec
  }

  /** Update a record in place without reordering. */
  patch(path: string, patch: Partial<BookRecord>) {
    const rec = this.book(path)
    if (!rec) return
    Object.assign(rec, patch)
    this.save()
  }

  remove(path: string) {
    const key = pathKey(path)
    this.books = this.books.filter(b => pathKey(b.path) !== key)
    forget(path)
    if (this.lastOpen && pathKey(this.lastOpen) === key) this.lastOpen = null
    this.save()
  }

  save() {
    clearTimeout(this.#timer)
    this.#timer = window.setTimeout(() => void this.flush(), 400)
  }

  flush() {
    clearTimeout(this.#timer)
    const data: Persisted = {
      version: 1,
      settings: this.settings,
      tuning: this.tuning,
      books: this.books,
      lastOpen: this.lastOpen,
    }
    const json = JSON.stringify(data)
    // Serialize writes so an older snapshot can never land after a newer one.
    this.#saving = this.#saving
      .then(() => ipc.saveState(json))
      .catch(e => console.error('Failed to save state', e))
    return this.#saving
  }
}

export const store = new Store()
