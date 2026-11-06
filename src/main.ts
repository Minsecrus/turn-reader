import { getVersion, onBackButtonPress } from '@tauri-apps/api/app'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { openUrl } from '@tauri-apps/plugin-opener'
import type { RelocateDetail } from 'foliate-js/view.js'
import { coverThumb, bookInfo } from './lib/epub'
import { ipc } from './lib/ipc'
import { android, desktop, moveToBack, onInsetsChange, setSystemBars, touch } from './lib/platform'
import { Reader } from './lib/reader'
import { DEFAULT_SETTINGS, FONT_SIZE_MAX, FONT_SIZE_MIN, store, type BookRecord, type Settings } from './lib/store'
import { onSystemThemeChange, PALETTES, resolveTheme } from './lib/typography'
import { actionSheet, closeSheet, hideToast, sheetOpen, toast } from './ui/dom'
import { icons } from './ui/icons'
import { renderLibrary } from './ui/library'
import { SettingsPanel } from './ui/settings'
import { TocPanel } from './ui/toc'
import { mountTuning } from './ui/tuning'

const win = getCurrentWindow()
const $ = (id: string) => document.getElementById(id)!
const app = $('app')
const isEpub = (p: string) => /\.epub$/i.test(p)
const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p
const errorText = (e: unknown) => (typeof e === 'string' ? e : e instanceof Error ? e.message : String(e))
/** A URI the system handed over (Android), as opposed to a path. */
const isUri = (s: string) => /^(content|file):/i.test(s)

let reader: Reader
let settingsPanel: SettingsPanel
let opening = false

// ── Title bar ───────────────────────────────────────────────────────────────

$('btn-library').innerHTML = icons.library
$('btn-toc').innerHTML = icons.toc
$('btn-settings').innerHTML = icons.type
$('btn-library').addEventListener('click', () => goLibrary())
$('btn-open').addEventListener('click', () => pickFile())
$('btn-toc').addEventListener('click', () => toggleToc())
$('btn-settings').addEventListener('click', () => toggleSettings())

if (desktop) {
  $('btn-open').innerHTML = icons.open
  $('win-min').innerHTML = icons.winMin
  $('win-max').innerHTML = icons.winMax
  $('win-close').innerHTML = icons.winClose
  $('win-min').addEventListener('click', () => win.minimize())
  $('win-max').addEventListener('click', () => win.toggleMaximize())
  $('win-close').addEventListener('click', () => win.close())
  void win.onResized(() => void syncMaximized())
} else {
  // Android: the system draws the window; adding a book replaces "open file".
  $('btn-open').innerHTML = icons.add
  $('btn-open').setAttribute('aria-label', '添加书籍')
  document.querySelector('.win-controls')?.remove()
}

async function syncMaximized() {
  $('win-max').innerHTML = (await win.isMaximized()) ? icons.winRestore : icons.winMax
}

const setTitle = (title: string) => {
  if (desktop) void win.setTitle(title)
}

// ── Chrome auto-hide (reading mode) ─────────────────────────────────────────

const panelsOpen = () => app.classList.contains('toc-open') || app.classList.contains('settings-open')

const chrome = {
  timer: 0,
  hovering: false,
  get pinned() {
    return this.hovering || panelsOpen()
  },
  show() {
    clearTimeout(this.timer)
    app.classList.add('chrome')
  },
  hide() {
    clearTimeout(this.timer)
    if (!this.pinned) app.classList.remove('chrome')
  },
  hideLater(ms = 800) {
    clearTimeout(this.timer)
    this.timer = window.setTimeout(() => this.hide(), ms)
  },
  toggle() {
    if (app.classList.contains('chrome')) return this.hide()
    this.show()
    // A mouse user moves away and the bars fade; on touch they stay until the
    // next tap or page turn.
    if (!touch) this.hideLater(3000)
  },
}

// Hover reveals the chrome. Not on touch: a tap also fires mouseenter, and
// with no mouseleave to follow, the chrome would stay pinned.
if (desktop) {
  for (const el of document.querySelectorAll<HTMLElement>('.hot-zone')) el.addEventListener('mouseenter', () => chrome.show())
  for (const el of [$('titlebar'), $('footer')]) {
    el.addEventListener('mouseenter', () => {
      chrome.hovering = true
      chrome.show()
    })
    el.addEventListener('mouseleave', () => {
      chrome.hovering = false
      chrome.hideLater()
    })
  }
  document.addEventListener('mouseleave', () => {
    chrome.hovering = false
    if (app.dataset.mode === 'reader') chrome.hideLater(400)
  })
}

// ── System bars (Android) ───────────────────────────────────────────────────

/** Reading full screen: the status and navigation bars come and go with the chrome. */
function syncSystemBars() {
  const immersive = app.dataset.mode === 'reader' && !app.classList.contains('chrome') && !panelsOpen()
  setSystemBars(immersive, resolveTheme(store.settings.theme) !== 'dark')
}

if (android) new MutationObserver(syncSystemBars).observe(app, { attributes: true, attributeFilter: ['class', 'data-mode'] })

// ── Panels ──────────────────────────────────────────────────────────────────

const tocPanel = new TocPanel($('toc-list'), href => {
  closePanels()
  // A jump from the TOC is no page turn: the bars stay.
  keepChromeUntil = performance.now() + 800
  void reader.goTo(href)
})

/**
 * Panels open from the bars, so closing one goes back to the bars, still
 * showing. With a mouse they then fade as after a click.
 */
function closePanels() {
  const wasOpen = panelsOpen()
  app.classList.remove('toc-open', 'settings-open')
  $('btn-settings').classList.remove('active')
  if (wasOpen && app.dataset.mode === 'reader') {
    chrome.show()
    if (!touch) chrome.hideLater(3000)
  }
}

function toggleToc() {
  if (app.dataset.mode !== 'reader') return
  const open = !app.classList.contains('toc-open')
  closePanels()
  if (open) {
    app.classList.add('toc-open')
    chrome.show()
    tocPanel.highlight(reader.location?.tocItem)
    tocPanel.reveal()
  }
}

/** Opens/closes the settings popover; `keys` opens it on the shortcuts page. */
function toggleSettings(keys = false) {
  if (app.dataset.mode !== 'reader') return
  const isOpen = app.classList.contains('settings-open')
  const open = !isOpen || (keys && settingsPanel.current !== 'keys')
  if (isOpen && open) return settingsPanel.showKeys()
  closePanels()
  if (open) {
    if (keys) settingsPanel.showKeys(false)
    else settingsPanel.showMain(false)
    app.classList.add('settings-open')
    $('btn-settings').classList.add('active')
    chrome.show()
  }
}

$('scrim').addEventListener('click', closePanels)
document.addEventListener('pointerdown', e => {
  const t = e.target as Element
  // The scrim closes on click instead: closing here would hide it before the
  // tap lands, and the tap would fall through to the page and turn it.
  if (app.classList.contains('settings-open') && !t.closest('#settings, #btn-settings, #scrim')) closePanels()
})

// ── Theme & settings ────────────────────────────────────────────────────────

function applyTheme() {
  const theme = resolveTheme(store.settings.theme)
  document.documentElement.dataset.theme = theme
  if (desktop) win.setBackgroundColor(PALETTES[theme].bg).catch(() => {})
  else syncSystemBars()
}

function updateSettings(patch: Partial<Settings>) {
  Object.assign(store.settings, patch)
  store.save()
  applyTheme()
  reader.applySettings(store.settings)
  settingsPanel.update(store.settings)
}

function fontStep(dir: 1 | -1) {
  const fontSize = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, store.settings.fontSize + dir))
  if (fontSize === store.settings.fontSize) return
  updateSettings({ fontSize })
  toast(`字号 ${fontSize}`, 1000)
}

function toggleFlow() {
  const flow = store.settings.flow === 'paginated' ? 'scrolled' : 'paginated'
  updateSettings({ flow })
  toast(flow === 'scrolled' ? '滚动模式' : '翻页模式', 1200)
}

onSystemThemeChange(() => {
  if (store.settings.theme !== 'auto') return
  applyTheme()
  reader.applySettings(store.settings)
})

// The book's top/bottom margin clears the system bars (Android).
onInsetsChange(() => reader?.applySettings(store.settings))

// ── Library ─────────────────────────────────────────────────────────────────

function removeBook(path: string) {
  store.remove(path)
  showLibrary()
}

function showLibrary() {
  renderLibrary($('library'), store.books, {
    open: path => void openBook(path),
    remove: removeBook,
    pick: () => void pickFile(),
    menu: touch
      ? (b: BookRecord) =>
          actionSheet(b.title, [
            { label: '从书架移除', danger: true, run: () => removeBook(b.path) },
          ])
      : undefined,
  })
}

async function pickFile() {
  const file = await openDialog({
    multiple: false,
    directory: false,
    // Android filters the system picker by MIME type rather than extension.
    filters: [{ name: 'EPUB 电子书', extensions: [android ? 'application/epub+zip' : 'epub'] }],
  }).catch(() => null)
  if (typeof file === 'string') void openFile(file)
}

function goLibrary() {
  if (app.dataset.mode === 'library') return
  closePanels()
  reader.close()
  store.lastOpen = null
  store.save()
  app.dataset.mode = 'library'
  app.classList.remove('chrome')
  $('tb-title').textContent = ''
  setTitle('Turn')
  showLibrary()
  $('library').focus()
}

// ── Reading ─────────────────────────────────────────────────────────────────

/**
 * Opens a file from outside Turn: a path (desktop), or a URI that is imported
 * into Turn's storage first (Android).
 */
async function openFile(source: string): Promise<boolean> {
  if (!isUri(source)) return openBook(source)
  const slow = setTimeout(() => toast('正在导入…', 60_000), 400)
  try {
    const path = await ipc.importBook(source)
    hideToast()
    return await openBook(path)
  } catch (e) {
    console.error(e)
    toast(`无法打开：${errorText(e)}`, 4000)
    return false
  } finally {
    clearTimeout(slow)
  }
}

/** Until then, relocations are not page turns (just opened, jumped from the TOC). */
let keepChromeUntil = 0
/** Last reported position. foliate also reports after a tap (it re-snaps the page), which is no turn. */
let lastCfi = ''

async function openBook(path: string): Promise<boolean> {
  if (opening) return false
  opening = true
  try {
    const rec = store.book(path)
    try {
      await reader.open(path, store.settings, rec?.cfi)
    } catch (e) {
      console.error(e)
      toast(`无法打开「${rec?.title ?? fileName(path)}」：${errorText(e)}`, 4000)
      return false
    }
    const book = reader.view!.book
    const info = bookInfo(book, path)
    store.upsert(path, info)
    store.lastOpen = path
    store.save()

    closePanels()
    closeSheet()
    app.dataset.mode = 'reader'
    $('tb-title').textContent = info.title
    setTitle(`${info.title} — Turn`)
    tocPanel.render(reader.toc)
    tocPanel.highlight(reader.location?.tocItem)
    keepChromeUntil = performance.now() + 1000
    // Desktop flashes the bars to show where they are; Android opens straight
    // into full screen.
    if (desktop) {
      chrome.show()
      chrome.hideLater(1600)
    } else chrome.hide()

    if (!rec?.cover)
      void coverThumb(book).then(cover => {
        if (cover) store.patch(path, { cover })
      })
    return true
  } finally {
    opening = false
  }
}

function onRelocate(d: RelocateDetail) {
  $('ft-chapter').textContent = d.tocItem?.label?.trim() ?? ''
  $('ft-progress').textContent = `${((d.fraction ?? 0) * 100).toFixed(1)}%`
  tocPanel.highlight(d.tocItem)
  if (reader.path) store.patch(reader.path, { cfi: d.cfi, fraction: d.fraction ?? 0, lastRead: Date.now() })
  // Touch: turning the page puts the bars away, as in any reading app.
  const moved = d.cfi !== lastCfi
  lastCfi = d.cfi
  if (touch && moved && performance.now() > keepChromeUntil) chrome.hide()
}

// ── Keyboard ────────────────────────────────────────────────────────────────

function onKey(e: KeyboardEvent) {
  if (e.defaultPrevented || e.isComposing) return
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
  const ctrl = e.ctrlKey || e.metaKey
  const reading = app.dataset.mode === 'reader'

  const handled = (() => {
    if (ctrl && key === 'o') return void pickFile(), true
    if (ctrl && e.shiftKey && key === 'd') return app.classList.toggle('tuning-open'), true
    if (key === 'F11' && desktop) return void win.isFullscreen().then(fs => win.setFullscreen(!fs)), true
    if (key === 'Escape') {
      // Esc steps back one level: shortcuts page → settings → closed → leave full screen.
      if (app.classList.contains('settings-open') && settingsPanel.onSubpage) settingsPanel.showMain()
      else if (panelsOpen()) closePanels()
      else if (desktop) void win.isFullscreen().then(fs => (fs ? win.setFullscreen(false) : undefined))
      return true
    }
    if (!reading) return false
    if (ctrl && key === 'w') return goLibrary(), true
    if (ctrl && (key === '=' || key === '+')) return fontStep(1), true
    if (ctrl && key === '-') return fontStep(-1), true
    if (ctrl && key === '0') return updateSettings({ fontSize: DEFAULT_SETTINGS.fontSize }), true
    if (!ctrl && !e.altKey) {
      if (key === 't') return toggleToc(), true
      if (key === 's') return toggleSettings(), true
      if (key === 'm') return toggleFlow(), true
      if (key === '?') return toggleSettings(true), true
    }
    if (app.classList.contains('toc-open')) return false
    return reader.navKey(e)
  })()
  if (handled) e.preventDefault()
}

document.addEventListener('keydown', onKey)

// ── Back button (Android) ───────────────────────────────────────────────────

// Steps back one level: action sheet → settings page → panel → bookshelf → home screen.
if (android)
  void onBackButtonPress(() => {
    if (sheetOpen()) closeSheet()
    else if (app.classList.contains('settings-open') && settingsPanel.onSubpage) settingsPanel.showMain()
    else if (panelsOpen()) closePanels()
    else if (app.dataset.mode === 'reader') goLibrary()
    else {
      void store.flush()
      moveToBack()
    }
  })

// ── Files from outside: drag & drop, second launch, "Open with" ─────────────

if (desktop)
  void getCurrentWebview().onDragDropEvent(({ payload }) => {
    if (payload.type === 'enter') {
      if (payload.paths.some(isEpub)) app.classList.add('dropping')
    } else if (payload.type === 'leave') {
      app.classList.remove('dropping')
    } else if (payload.type === 'drop') {
      app.classList.remove('dropping')
      const file = payload.paths.find(isEpub)
      if (file) void openFile(file)
      else if (payload.paths.length) toast('只支持 EPUB 文件')
    }
  })

/** The file Turn was launched with or handed while running, if any. */
async function openPendingFile(): Promise<boolean> {
  const file = await ipc.takePendingFile().catch(() => null)
  return file ? openFile(file) : false
}

void listen('open-file', () => void openPendingFile())

// Android may kill a backgrounded app without warning, so save on the way out.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) void store.flush()
})
if (desktop)
  void win.onCloseRequested(async () => {
    await store.flush()
  })

// ── Boot ────────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function boot() {
  await store.load()
  applyTheme()

  reader = new Reader(
    { host: $('view-host'), meter: $('meter'), meterLabel: $('meter-label'), meterFill: $('meter-fill') },
    {
      relocate: onRelocate,
      key: onKey,
      toggleChrome: () => {
        if (panelsOpen()) closePanels()
        else chrome.toggle()
      },
      fontStep,
      externalLink: href => {
        if (/^(https?|mailto):/i.test(href)) void openUrl(href)
      },
    },
  )
  settingsPanel = new SettingsPanel($('settings'), {
    onChange: updateSettings,
    openUrl: url => void openUrl(url),
    version: getVersion(),
    shortcuts: !touch,
  })
  settingsPanel.update(store.settings)
  mountTuning($('tuning'), reader.tuning, () => {
    store.tuning = reader.tuning
    store.save()
  })

  // Reopen the file Turn was launched with, or else what was being read,
  // straight to the last position. The window stays hidden until there's
  // something to show, but never longer than ~1.2s.
  const opened = openPendingFile().then(ok => ok || (store.lastOpen ? openBook(store.lastOpen) : false))
  await Promise.race([opened, sleep(1200)])
  if (app.dataset.mode === 'library') showLibrary()
  opened.then(ok => {
    if (!ok && app.dataset.mode === 'library') showLibrary()
  })

  if (desktop) {
    void syncMaximized()
    requestAnimationFrame(() =>
      requestAnimationFrame(async () => {
        await win.show()
        await win.setFocus()
      }),
    )
  }
}

void boot()
