import 'foliate-js/view.js'
import type { RelocateDetail, TocItem, View } from 'foliate-js/view.js'
import { loadEpub, type LoadedBook } from './epub'
import { ChapterOverscroll, type Dir } from './overscroll'
import { store, type Settings } from './store'
import { bookCSS, maxInlineSize, reducedMotion, resolveTheme } from './typography'
import { PagedWheel, WheelTracker } from './wheel'

export interface ReaderEvents {
  relocate(detail: RelocateDetail): void
  /** A keydown from inside the book. The app decides what it means. */
  key(e: KeyboardEvent): void
  toggleChrome(): void
  fontStep(dir: Dir): void
  externalLink(href: string): void
}

export interface ReaderElements {
  host: HTMLElement
  meter: HTMLElement
  meterLabel: HTMLElement
  meterFill: HTMLElement
}

const easeOut = (t: number) => 1 - (1 - t) ** 3

const setAttr = (el: Element, name: string, value: string) => {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value)
}

export class Reader {
  view: View | null = null
  path: string | null = null

  #loaded: LoadedBook | null = null
  #settings: Settings = store.settings
  #wheel = new WheelTracker()
  #paged = new PagedWheel(dir => this.turn(dir))
  #overscroll: ChapterOverscroll
  #busy = false
  #queue: (() => Promise<unknown>)[] = []
  #transitioning = false
  #titles = new Map<number, string>()
  #index = -1
  #shift = 0
  #meterDir: Dir | 0 = 0
  #zoomAccum = 0
  #clickTimer: number | undefined

  constructor(
    private el: ReaderElements,
    private on: ReaderEvents,
  ) {
    this.#overscroll = new ChapterOverscroll(
      {
        atStart: () => this.#atStart(),
        atEnd: () => this.#atEnd(),
        hasAdjacent: dir => this.#adjacent(dir) != null,
        render: (dir, p) => this.#renderMeter(dir, p),
        fire: dir => this.#chapterTransition(dir),
      },
      store.tuning,
    )
    // Wheel and clicks over the page margins (outside the book's iframe).
    el.host.addEventListener('wheel', e => this.#onWheel(e), { passive: false })
    el.host.addEventListener('click', e => {
      if (e.target === el.host || e.target === this.view) this.#onClick(e, null)
    })
  }

  get tuning() {
    return this.#overscroll.tuning
  }

  get scrolled() {
    return !!this.view && !this.view.isFixedLayout && this.#settings.flow === 'scrolled'
  }

  get toc(): TocItem[] {
    return this.view?.book.toc ?? []
  }

  get location() {
    return this.view?.lastLocation ?? null
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Opens a book. Throws if it can't be opened; the current book stays open in that case. */
  async open(path: string, settings: Settings, lastCfi?: string) {
    const loaded = await loadEpub(path)
    this.close()
    this.#loaded = loaded
    this.path = path

    const view = document.createElement('foliate-view') as View
    view.setAttribute('autohide-cursor', '')
    view.addEventListener('load', e => this.#onDocLoad((e as CustomEvent<{ doc: Document }>).detail.doc))
    view.addEventListener('relocate', e => this.#onRelocate((e as CustomEvent<RelocateDetail>).detail))
    view.addEventListener('external-link', e => {
      e.preventDefault()
      const { a, href_ } = (e as CustomEvent<{ a: HTMLAnchorElement; href_: string }>).detail
      this.on.externalLink(a.href || href_)
    })
    this.el.host.replaceChildren(view)
    this.view = view

    try {
      await view.open(loaded.book)
      this.applySettings(settings)
      this.#buildTitles()
      await view.init({ lastLocation: lastCfi ?? null, showTextStart: true })
    } catch (e) {
      this.close()
      throw e
    }
  }

  close() {
    this.#overscroll.reset()
    this.view?.close()
    this.view?.remove()
    this.view = null
    this.#loaded?.close()
    this.#loaded = null
    this.path = null
    this.#titles.clear()
    this.#index = -1
    this.#queue = []
  }

  applySettings(s: Settings) {
    this.#settings = s
    const v = this.view
    if (!v) return
    const r = v.renderer
    if (!v.isFixedLayout) {
      setAttr(r, 'max-inline-size', `${maxInlineSize(s)}px`)
      setAttr(r, 'max-column-count', '2')
      setAttr(r, 'margin', '52px')
      setAttr(r, 'gap', '6%')
      if (reducedMotion()) r.removeAttribute('animated')
      else setAttr(r, 'animated', '')
      if (r.getAttribute('flow') !== s.flow) {
        this.#overscroll.reset()
        r.setAttribute('flow', s.flow)
      }
    }
    r.setStyles?.(bookCSS(s, resolveTheme(s.theme)))
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  goTo(target: string) {
    return this.#run(() => this.view!.goTo(target))
  }

  /** Previous/next page (paginated) or screen (scrolled). */
  turn(dir: Dir) {
    const v = this.view
    if (!v) return
    if (this.scrolled) return this.#scrollBy(dir, this.#pageDistance())
    this.#run(() => (dir > 0 ? v.next() : v.prev()))
  }

  /** Keyboard navigation. Returns whether the key was used. */
  navKey(e: KeyboardEvent): boolean {
    const v = this.view
    if (!v || e.ctrlKey || e.altKey || e.metaKey) return false
    const scrolled = this.scrolled
    const line = this.#settings.fontSize * this.#settings.lineHeight * 3
    switch (e.key) {
      case 'ArrowLeft':
        if (scrolled) this.turn(-1)
        else this.#run(() => v.goLeft())
        break
      case 'ArrowRight':
        if (scrolled) this.turn(1)
        else this.#run(() => v.goRight())
        break
      case 'ArrowUp':
        if (scrolled) this.#scrollBy(-1, line)
        else this.turn(-1)
        break
      case 'ArrowDown':
        if (scrolled) this.#scrollBy(1, line)
        else this.turn(1)
        break
      case 'PageUp':
        this.turn(-1)
        break
      case 'PageDown':
        this.turn(1)
        break
      case ' ':
        this.turn(e.shiftKey ? -1 : 1)
        break
      default:
        return false
    }
    e.preventDefault()
    return true
  }

  /**
   * Serializes navigation. foliate-js drops input while a page animation runs;
   * instead requests wait their turn (up to a few), so fast key presses and
   * wheel notches are never lost but can't pile up either.
   */
  async #run(action: () => Promise<unknown>) {
    if (this.#busy || this.#transitioning) {
      if (this.#queue.length < 3) this.#queue.push(action)
      return
    }
    this.#busy = true
    try {
      await action()
    } catch (e) {
      console.error(e)
    } finally {
      this.#busy = false
    }
    const next = this.#queue.shift()
    if (next) void this.#run(next)
  }

  #pageDistance() {
    const r = this.view!.renderer
    const overlap = this.#settings.fontSize * this.#settings.lineHeight * 2
    return Math.max(100, r.size - overlap)
  }

  #scrollBy(dir: Dir, distance: number) {
    const r = this.view!.renderer
    if (dir > 0 ? this.#atEnd() : this.#atStart()) {
      // Keys are deliberate, so no charging: go straight to the next chapter,
      // with the same transition as the wheel.
      if (this.#adjacent(dir) != null) void this.#chapterTransition(dir)
      return
    }
    this.#run(() => (dir > 0 ? r.next(distance) : r.prev(distance)))
  }

  #currentIndex() {
    return this.view?.renderer.getContents()[0]?.index ?? this.#index
  }

  #adjacent(dir: Dir): number | null {
    const sections = this.view?.book.sections
    if (!sections) return null
    for (let i = this.#currentIndex() + dir; i >= 0 && i < sections.length; i += dir)
      if (sections[i].linear !== 'no') return i
    return null
  }

  #atStart() {
    return this.view!.renderer.start <= 1
  }

  #atEnd() {
    const r = this.view!.renderer
    return r.viewSize - r.end <= 2
  }

  async #chapterTransition(dir: Dir) {
    const v = this.view
    const target = this.#adjacent(dir)
    if (!v || target == null || this.#transitioning) return
    this.#transitioning = true
    const motion = !reducedMotion()
    try {
      let out: Animation | undefined
      if (motion) {
        out = v.animate(
          [
            { transform: `translate3d(0, ${this.#shift}px, 0)`, opacity: 1 },
            { transform: `translate3d(0, ${-dir * 32}px, 0)`, opacity: 0 },
          ],
          { duration: 150, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' },
        )
        await out.finished
      }
      this.el.meter.classList.remove('show', 'full')
      v.style.transform = ''
      this.#shift = 0
      // Next chapter opens at its start; previous chapter at its end.
      await v.renderer.goTo({ index: target, anchor: dir > 0 ? 0 : () => 1 })
      if (motion) {
        const into = v.animate(
          [
            { transform: `translate3d(0, ${dir * 32}px, 0)`, opacity: 0 },
            { transform: 'none', opacity: 1 },
          ],
          { duration: 220, easing: 'cubic-bezier(0, 0, .2, 1)' },
        )
        out?.cancel()
        await into.finished
      }
    } finally {
      this.#transitioning = false
    }
  }

  // ── Overscroll meter ──────────────────────────────────────────────────────

  #title(index: number | null, dir: Dir) {
    return (index != null && this.#titles.get(index)) || (dir > 0 ? '下一部分' : '上一部分')
  }

  #renderMeter(dir: Dir | 0, p: number) {
    const { meter, meterFill, meterLabel } = this.el
    const v = this.view
    if (!dir || p <= 0) {
      meter.classList.remove('show', 'full')
      this.#meterDir = 0
      if (v && !this.#transitioning) {
        v.style.transform = ''
        this.#shift = 0
      }
      return
    }
    if (this.#meterDir !== dir) {
      this.#meterDir = dir
      meter.dataset.dir = dir > 0 ? 'next' : 'prev'
      meterLabel.textContent = (dir > 0 ? '继续滚动 · ' : '继续上滚 · ') + this.#title(this.#adjacent(dir), dir)
    }
    meter.classList.add('show')
    meter.classList.toggle('full', p >= 1)
    meter.style.setProperty('--p', p.toFixed(3))
    meterFill.style.transform = `scaleX(${p})`
    if (v && !reducedMotion()) {
      this.#shift = -dir * this.#overscroll.tuning.maxShift * easeOut(p)
      v.style.transform = `translate3d(0, ${this.#shift}px, 0)`
    }
  }

  #buildTitles() {
    const v = this.view!
    const walk = (items: TocItem[] | null | undefined) => {
      for (const item of items ?? []) {
        const index = item.href ? v.resolveNavigation(item.href)?.index : undefined
        const label = item.label?.trim()
        if (index != null && label && !this.#titles.has(index)) this.#titles.set(index, label)
        walk(item.subitems)
      }
    }
    walk(v.book.toc)
  }

  // ── Events ────────────────────────────────────────────────────────────────

  #onDocLoad(doc: Document) {
    doc.addEventListener('keydown', e => this.on.key(e))
    doc.addEventListener('wheel', e => this.#onWheel(e), { passive: false })
    doc.addEventListener('click', e => this.#onClick(e, doc))
    doc.addEventListener('dblclick', () => clearTimeout(this.#clickTimer))
  }

  #onRelocate(detail: RelocateDetail) {
    const index = this.#currentIndex()
    if (index !== this.#index) {
      this.#index = index
      if (!this.#transitioning) this.#overscroll.reset()
    }
    this.on.relocate(detail)
  }

  #onWheel(e: WheelEvent) {
    if (!this.view) return
    if (e.ctrlKey) {
      // Ctrl+wheel and touchpad pinch change the font size.
      e.preventDefault()
      this.#zoomAccum += e.deltaY
      if (Math.abs(this.#zoomAccum) >= 60) {
        this.on.fontStep(this.#zoomAccum < 0 ? 1 : -1)
        this.#zoomAccum = 0
      }
      return
    }
    const s = this.#wheel.feed(e)
    if (this.#transitioning) {
      e.preventDefault()
      return
    }
    if (this.scrolled) {
      this.#overscroll.feed(s)
      if (this.#overscroll.active) e.preventDefault()
      return
    }
    e.preventDefault()
    this.#paged.feed(s)
  }

  #onClick(e: MouseEvent, doc: Document | null) {
    if (e.defaultPrevented || e.button !== 0 || e.detail > 1) return
    const target = e.target as Element | null
    if (target?.closest?.('a, button, input, textarea, select, label, audio, video, summary')) return
    const sel = (doc ?? document).getSelection()
    if (sel && !sel.isCollapsed) return

    const frame = doc?.defaultView?.frameElement
    const x = (frame?.getBoundingClientRect().left ?? 0) + e.clientX
    const w = window.innerWidth
    const v = this.view
    if (v && !this.scrolled) {
      if (x < w * 0.2) return void this.#run(() => v.goLeft())
      if (x > w * 0.8) return void this.#run(() => v.goRight())
    }
    // Middle click toggles the chrome, delayed so a double-click (word selection) cancels it.
    clearTimeout(this.#clickTimer)
    this.#clickTimer = window.setTimeout(() => this.on.toggleChrome(), 230)
  }
}
