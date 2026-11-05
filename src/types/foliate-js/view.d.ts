// Hand-written types for the parts of foliate-js that Turn uses.
// foliate-js is vendored as a git submodule at src/foliate-js.

export interface TocItem {
  label: string
  href: string
  subitems?: TocItem[] | null
}

export interface Section {
  id: string
  linear?: string
  size: number
  cfi?: string
}

export interface Book {
  metadata?: Record<string, unknown>
  toc?: TocItem[]
  sections: Section[]
  dir?: string
  rendition?: { layout?: string }
  transformTarget?: EventTarget
  getCover(): Promise<Blob | null>
  destroy?(): void
}

export interface Resolved {
  index: number
  anchor?: unknown
}

export interface RelocateDetail {
  fraction: number
  section: { current: number; total: number }
  tocItem?: TocItem | null
  cfi: string
  range?: Range
  reason?: string
}

export interface Renderer extends HTMLElement {
  readonly start: number
  readonly end: number
  readonly size: number
  readonly viewSize: number
  next(distance?: number): Promise<void>
  prev(distance?: number): Promise<void>
  goTo(target: { index: number; anchor?: number | ((doc: Document) => unknown) }): Promise<void>
  setStyles?(styles: string | [string, string]): void
  getContents(): { index: number; doc: Document }[]
}

export class View extends HTMLElement {
  book: Book
  renderer: Renderer
  isFixedLayout: boolean
  lastLocation: RelocateDetail | null
  open(book: Book): Promise<void>
  close(): void
  init(opts: { lastLocation?: string | null; showTextStart?: boolean }): Promise<void>
  goTo(target: string | number): Promise<Resolved | undefined>
  goToFraction(fraction: number): Promise<void>
  next(): Promise<void>
  prev(): Promise<void>
  goLeft(): Promise<void>
  goRight(): Promise<void>
  resolveNavigation(target: string | number): Resolved | undefined
}
