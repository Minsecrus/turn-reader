import { getVersion } from '@tauri-apps/api/app'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { openUrl } from '@tauri-apps/plugin-opener'
import type { RelocateDetail } from 'foliate-js/view.js'
import { coverThumb, bookInfo } from './lib/epub'
import { ipc } from './lib/ipc'
import { Reader } from './lib/reader'
import { DEFAULT_SETTINGS, FONT_SIZE_MAX, FONT_SIZE_MIN, store, type Settings } from './lib/store'
import { onSystemThemeChange, PALETTES, resolveTheme } from './lib/typography'
import { toast } from './ui/dom'
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

let reader: Reader
let settingsPanel: SettingsPanel
let opening = false

// ── Title bar ───────────────────────────────────────────────────────────────

$('btn-library').innerHTML = icons.library
$('btn-open').innerHTML = icons.open
$('btn-toc').innerHTML = icons.toc
$('btn-settings').innerHTML = icons.type
$('win-min').innerHTML = icons.winMin
$('win-max').innerHTML = icons.winMax
$('win-close').innerHTML = icons.winClose

$('win-min').addEventListener('click', () => win.minimize())
$('win-max').addEventListener('click', () => win.toggleMaximize())
$('win-close').addEventListener('click', () => win.close())
$('btn-library').addEventListener('click', () => goLibrary())
$('btn-open').addEventListener('click', () => pickFile())
$('btn-toc').addEventListener('click', () => toggleToc())
$('btn-settings').addEventListener('click', () => toggleSettings())

const syncMaximized = async () => {
  $('win-max').innerHTML = (await win.isMaximized()) ? icons.winRestore : icons.winMax
}
void win.onResized(() => void syncMaximized())

// ── Chrome auto-hide (reading mode) ─────────────────────────────────────────

const chrome = {
  timer: 0,
  hovering: false,
  get pinned() {
    return this.hovering || app.classList.contains('toc-open') || app.classList.contains('settings-open')
  },
  show() {
    clearTimeout(this.timer)
    app.classList.add('chrome')
  },
  hideLater(ms = 800) {
    clearTimeout(this.timer)
    this.timer = window.setTimeout(() => {
      if (!this.pinned) app.classList.remove('chrome')
    }, ms)
  },
  toggle() {
    if (app.classList.contains('chrome')) {
      clearTimeout(this.timer)
      if (!this.pinned) app.classList.remove('chrome')
    } else {
      this.show()
      this.hideLater(3000)
    }
  },
}
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

// ── Panels ──────────────────────────────────────────────────────────────────

const tocPanel = new TocPanel($('toc-list'), href => {
  closePanels()
  void reader.goTo(href)
})

function closePanels() {
  app.classList.remove('toc-open', 'settings-open')
  $('btn-settings').classList.remove('active')
  if (app.dataset.mode === 'reader') chrome.hideLater(300)
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
  if (app.classList.contains('settings-open') && !t.closest('#settings, #btn-settings')) closePanels()
})

// ── Theme & settings ────────────────────────────────────────────────────────

function applyTheme() {
  const theme = resolveTheme(store.settings.theme)
  document.documentElement.dataset.theme = theme
  win.setBackgroundColor(PALETTES[theme].bg).catch(() => {})
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

// ── Library ─────────────────────────────────────────────────────────────────

function showLibrary() {
  renderLibrary($('library'), store.books, {
    open: path => void openBook(path),
    remove: path => {
      store.remove(path)
      showLibrary()
    },
    pick: () => void pickFile(),
  })
}

async function pickFile() {
  const file = await openDialog({
    multiple: false,
    directory: false,
    filters: [{ name: 'EPUB 电子书', extensions: ['epub'] }],
  }).catch(() => null)
  if (typeof file === 'string') void openBook(file)
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
  void win.setTitle('Turn')
  showLibrary()
  $('library').focus()
}

// ── Reading ─────────────────────────────────────────────────────────────────

async function openBook(path: string): Promise<boolean> {
  if (opening) return false
  opening = true
  try {
    const rec = store.book(path)
    try {
      await reader.open(path, store.settings, rec?.cfi)
    } catch (e) {
      console.error(e)
      toast(`无法打开「${fileName(path)}」：${errorText(e)}`, 4000)
      return false
    }
    const book = reader.view!.book
    const info = bookInfo(book, path)
    store.upsert(path, info)
    store.lastOpen = path
    store.save()

    closePanels()
    app.dataset.mode = 'reader'
    $('tb-title').textContent = info.title
    void win.setTitle(`${info.title} — Turn`)
    tocPanel.render(reader.toc)
    tocPanel.highlight(reader.location?.tocItem)
    chrome.show()
    chrome.hideLater(1600)

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
    if (key === 'F11') return void win.isFullscreen().then(fs => win.setFullscreen(!fs)), true
    if (key === 'Escape') {
      // Esc steps back one level: shortcuts page → settings → closed → leave full screen.
      if (app.classList.contains('settings-open') && settingsPanel.onSubpage) settingsPanel.showMain()
      else if (app.classList.contains('toc-open') || app.classList.contains('settings-open')) closePanels()
      else void win.isFullscreen().then(fs => (fs ? win.setFullscreen(false) : undefined))
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

// ── Files from outside: drag & drop, second launch ──────────────────────────

void getCurrentWebview().onDragDropEvent(({ payload }) => {
  if (payload.type === 'enter') {
    if (payload.paths.some(isEpub)) app.classList.add('dropping')
  } else if (payload.type === 'leave') {
    app.classList.remove('dropping')
  } else if (payload.type === 'drop') {
    app.classList.remove('dropping')
    const file = payload.paths.find(isEpub)
    if (file) void openBook(file)
    else if (payload.paths.length) toast('只支持 EPUB 文件')
  }
})

void listen<string>('open-file', e => void openBook(e.payload))

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
        if (app.classList.contains('settings-open') || app.classList.contains('toc-open')) closePanels()
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
  })
  settingsPanel.update(store.settings)
  mountTuning($('tuning'), reader.tuning, () => {
    store.tuning = reader.tuning
    store.save()
  })

  // Reopen what was being read (or the file Turn was launched with), straight
  // to the last position. The window stays hidden until there's something to
  // show, but never longer than ~1.2s.
  const target = (await ipc.launchFile().catch(() => null)) ?? store.lastOpen
  const opened = target ? openBook(target) : Promise.resolve(false)
  await Promise.race([opened, sleep(1200)])
  if (app.dataset.mode === 'library') showLibrary()
  opened.then(ok => {
    if (!ok && app.dataset.mode === 'library') showLibrary()
  })

  void syncMaximized()
  requestAnimationFrame(() =>
    requestAnimationFrame(async () => {
      await win.show()
      await win.setFocus()
    }),
  )
}

void boot()
