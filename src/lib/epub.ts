import { EPUB } from 'foliate-js/epub.js'
import type { Book } from 'foliate-js/view.js'
import { relativizeCSS, relativizeHTML } from './css-scale'
import { ipc } from './ipc'

// WebView2 serves custom schemes at http://<scheme>.localhost
const ORIGIN = 'http://turn.localhost'
const HTML_TYPES = new Set(['application/xhtml+xml', 'text/html'])

export interface LoadedBook {
  book: Book
  close(): void
}

const decode = (buf: ArrayBuffer) => {
  const b = new Uint8Array(buf, 0, Math.min(2, buf.byteLength))
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf)
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(buf)
  return new TextDecoder().decode(buf)
}

/**
 * Open an EPUB through the Rust side. Only the zip directory is read up front;
 * every entry is fetched lazily from the `turn` protocol when foliate-js asks.
 */
export async function loadEpub(path: string): Promise<LoadedBook> {
  const { id, entries } = await ipc.openBook(path)
  const sizes = new Map<string, number>()
  const lower = new Map<string, string>()
  for (const e of entries) {
    sizes.set(e.name, e.size)
    lower.set(e.name.toLowerCase(), e.name)
  }
  // Some EPUBs reference files with the wrong letter case.
  const resolve = (name: string) => (sizes.has(name) ? name : lower.get(name.toLowerCase()))

  const fetchEntry = async (name: string) => {
    const real = resolve(name)
    if (!real) return null
    const url = `${ORIGIN}/${id}/${real.split('/').map(encodeURIComponent).join('/')}`
    const res = await fetch(url)
    return res.ok ? res : null
  }

  const loader = {
    loadText: async (name: string) => {
      const res = await fetchEntry(name)
      return res ? decode(await res.arrayBuffer()) : null
    },
    loadBlob: async (name: string) => {
      const res = await fetchEntry(name)
      return res ? res.blob() : null
    },
    getSize: (name: string) => sizes.get(resolve(name) ?? '') ?? 0,
  }

  try {
    const book = await new EPUB(loader).init()
    // Never run scripts from books. The CSP blocks them too; this keeps them
    // from even being loaded.
    book.transformTarget?.addEventListener('load', e => {
      const detail = (e as CustomEvent<{ isScript: boolean; allow: boolean }>).detail
      if (detail.isScript) detail.allow = false
    })
    // Make absolute font sizes follow Turn's font size (not for fixed layout,
    // where px positioning is the design).
    if (book.rendition?.layout !== 'pre-paginated')
      book.transformTarget?.addEventListener('data', e => {
        const detail = (e as CustomEvent<{ type: string; data: unknown }>).detail
        const f = detail.type === 'text/css' ? relativizeCSS : HTML_TYPES.has(detail.type) ? relativizeHTML : null
        if (f) detail.data = Promise.resolve(detail.data).then(d => (typeof d === 'string' ? f(d) : d))
      })
    return {
      book,
      close: () => {
        book.destroy?.()
        ipc.closeBook(id).catch(() => {})
      },
    }
  } catch (e) {
    ipc.closeBook(id).catch(() => {})
    throw e
  }
}

const langString = (x: unknown): string => {
  if (!x) return ''
  if (typeof x === 'string') return x
  if (typeof x === 'object') {
    const values = Object.values(x as Record<string, unknown>)
    return typeof values[0] === 'string' ? values[0] : ''
  }
  return ''
}

const contributor = (x: unknown): string => {
  if (!x) return ''
  if (Array.isArray(x)) return x.map(contributor).filter(Boolean).join('、')
  if (typeof x === 'string') return x
  if (typeof x === 'object' && 'name' in (x as object)) return langString((x as { name: unknown }).name)
  return ''
}

export function bookInfo(book: Book, path: string) {
  const meta = book.metadata ?? {}
  const fallback = path.split(/[\\/]/).pop()?.replace(/\.epub$/i, '') ?? '未命名'
  return {
    title: langString(meta.title).trim() || fallback,
    author: contributor(meta.author).trim(),
  }
}

/** A small WebP data URL of the cover for the bookshelf. */
export async function coverThumb(book: Book, width = 240): Promise<string | undefined> {
  const blob = await book.getCover().catch(() => null)
  if (!blob) return
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    if (!img.naturalWidth) return
    const w = Math.min(width, img.naturalWidth)
    const h = Math.round((img.naturalHeight / img.naturalWidth) * w)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, w, h)
    return canvas.toDataURL('image/webp', 0.82)
  } catch {
    return
  } finally {
    URL.revokeObjectURL(url)
  }
}
