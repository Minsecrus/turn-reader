import { FONT_SIZE_MAX, FONT_SIZE_MIN, type Settings } from '../lib/store'
import { fontChoices, PALETTES } from '../lib/typography'
import { h } from './dom'
import { icons } from './icons'

type Patch = Partial<Settings>

interface Option<T> {
  value: T
  label: string
  swatch?: string
  font?: string
}

/**
 * A shortcut: alternatives, each a combo of keys. A key starting with `~` is a
 * mouse action shown as text (e.g. `~滚轮`). A plain string is a mouse-only
 * action, shown as text.
 */
type Keys = string[][] | string

const SHORTCUTS: { group: string; items: [string, Keys][] }[] = [
  {
    group: '翻页',
    items: [
      ['下一页', [['→'], ['↓'], ['空格'], ['PgDn']]],
      ['上一页', [['←'], ['↑'], ['Shift', '空格'], ['PgUp']]],
    ],
  },
  {
    group: '面板',
    items: [
      ['目录', [['T']]],
      ['排版', [['S']]],
      ['切换翻页 / 滚动', [['M']]],
      ['快捷键', [['?']]],
      ['关闭面板', [['Esc']]],
    ],
  },
  {
    group: '字号',
    items: [
      ['增大', [['Ctrl', '+']]],
      ['减小', [['Ctrl', '−']]],
      ['恢复默认', [['Ctrl', '0']]],
      ['调整', [['Ctrl', '~滚轮']]],
    ],
  },
  {
    group: '窗口',
    items: [
      ['打开文件', [['Ctrl', 'O']]],
      ['返回书架', [['Ctrl', 'W']]],
      ['全屏', [['F11']]],
    ],
  },
  {
    group: '鼠标',
    items: [
      ['翻页', '点击页面左右两侧'],
      ['显示 / 隐藏工具栏', '点击页面中间'],
      ['跨章（滚动模式）', '章末继续滚动'],
    ],
  },
]

function keysView(keys: Keys) {
  if (typeof keys === 'string') return h('span', { class: 'sc-text' }, keys)
  const out = h('span', { class: 'sc-keys' })
  keys.forEach((combo, i) => {
    if (i) out.append(h('span', { class: 'sc-or' }, '/'))
    combo.forEach((k, j) => {
      if (j) out.append(h('span', { class: 'sc-plus' }, '+'))
      out.append(k.startsWith('~') ? h('span', { class: 'sc-text' }, k.slice(1)) : h('kbd', {}, k))
    })
  })
  return out
}

type Page = 'main' | 'keys' | 'about'

const REPO_URL = 'https://github.com/Minsecrus/turn-reader'

export interface SettingsPanelOptions {
  onChange(patch: Patch): void
  openUrl(url: string): void
  version: Promise<string>
  /** Show the keyboard shortcuts page (not on touch devices). */
  shortcuts: boolean
}

export class SettingsPanel {
  #sync: ((s: Settings) => void)[] = []
  #pages: HTMLElement
  #page: Record<Page, HTMLElement>
  #current: Page = 'main'
  private onChange: (patch: Patch) => void

  constructor(root: HTMLElement, opts: SettingsPanelOptions) {
    this.onChange = opts.onChange
    const fonts = fontChoices()
    const fontOptions: Option<Settings['font']>[] = [
      { value: 'book', label: '原书' },
      { value: 'serif', label: fonts.serif.label, font: fonts.serif.css },
      { value: 'sans', label: fonts.sans.label, font: fonts.sans.css },
    ]
    if (fonts.kai) fontOptions.push({ value: 'kai', label: fonts.kai.label, font: fonts.kai.css })
    const link = (page: Page, icon: string, label: string, hint?: string) =>
      h(
        'button',
        { class: 'menu-link', onClick: () => this.show(page) },
        h('span', { class: 'menu-link-icon', html: icon }),
        h('span', { class: 'menu-link-label' }, label),
        hint ? h('kbd', {}, hint) : null,
        h('span', { class: 'menu-link-chevron', html: icons.chevronRight }),
      )
    const subHead = () =>
      h(
        'div',
        { class: 'sub-head' },
        h('button', { class: 'back-btn', 'aria-label': '返回', html: icons.chevronLeft, onClick: () => this.show('main') }),
      )

    const main = h(
      'div',
      { class: 'page active' },
      this.#seg('主题', 'theme', [
        { value: 'auto', label: '自动', swatch: `linear-gradient(135deg, ${PALETTES.light.bg} 50%, ${PALETTES.dark.bg} 50%)` },
        { value: 'light', label: '浅色', swatch: PALETTES.light.bg },
        { value: 'paper', label: '纸张', swatch: PALETTES.paper.bg },
        { value: 'dark', label: '深色', swatch: PALETTES.dark.bg },
      ]),
      this.#seg('字体', 'font', fontOptions),
      this.#stepper(),
      this.#seg('行距', 'lineHeight', [
        { value: 1.5, label: '紧凑' },
        { value: 1.8, label: '适中' },
        { value: 2.1, label: '宽松' },
      ]),
      this.#seg('版心', 'width', [
        { value: 'narrow', label: '窄' },
        { value: 'medium', label: '中' },
        { value: 'wide', label: '宽' },
      ]),
      this.#seg('模式', 'flow', [
        { value: 'paginated', label: '翻页' },
        { value: 'scrolled', label: '滚动' },
      ]),
      h('div', { class: 'menu-sep' }),
      opts.shortcuts ? link('keys', icons.keyboard, '键盘快捷键', '?') : null,
      link('about', icons.info, '关于'),
    )

    const keys = h(
      'div',
      { class: 'page sub', 'aria-hidden': 'true', 'aria-label': '键盘快捷键' },
      subHead(),
      ...SHORTCUTS.map(({ group, items }) =>
        h(
          'section',
          { class: 'sc-group' },
          h('div', { class: 'sc-group-title' }, group),
          ...items.map(([label, keys]) =>
            h('div', { class: 'sc-row' }, h('span', { class: 'sc-label' }, label), keysView(keys)),
          ),
        ),
      ),
    )

    const version = h('span', { class: 'about-version' })
    void opts.version.then(v => (version.textContent = `版本 ${v}`)).catch(() => {})
    const about = h(
      'div',
      { class: 'page sub about-page', 'aria-hidden': 'true', 'aria-label': '关于' },
      subHead(),
      h(
        'div',
        { class: 'about' },
        h('img', { class: 'about-icon', src: '/icon.svg', alt: '', draggable: 'false' }),
        h('div', { class: 'about-name' }, 'Turn ', h('span', {}, '翻篇')),
        version,
        h('p', { class: 'about-intro' }, '注重用户体验的极简 EPUB 阅读器'),
        h(
          'button',
          { class: 'about-link', onClick: () => opts.openUrl(REPO_URL) },
          h('span', { class: 'about-link-icon', html: icons.github }),
          'github.com/Minsecrus/turn-reader',
        ),
        h(
          'p',
          { class: 'about-credits' },
          'MIT 许可证 · 基于 ',
          h('button', { class: 'inline-link', onClick: () => opts.openUrl('https://github.com/johnfactotum/foliate-js') }, 'foliate-js'),
          ' 与 ',
          h('button', { class: 'inline-link', onClick: () => opts.openUrl('https://tauri.app') }, 'Tauri'),
        ),
      ),
    )

    this.#page = { main, keys, about }
    this.#pages = h('div', { class: 'pages' }, main, keys, about)
    root.append(this.#pages)
  }

  get onSubpage() {
    return this.#current !== 'main'
  }

  get current() {
    return this.#current
  }

  update(s: Settings) {
    for (const f of this.#sync) f(s)
  }

  showKeys(animate = true) {
    this.show('keys', animate)
  }

  showMain(animate = true) {
    this.show('main', animate)
  }

  /** Slides between pages, animating the height. */
  show(page: Page, animate = true) {
    if (page === this.#current) return
    const pages = this.#pages
    const from = this.#page[this.#current]
    const to = this.#page[page]
    this.#current = page
    if (animate) pages.style.height = `${pages.offsetHeight}px`
    from.classList.remove('active')
    from.setAttribute('aria-hidden', 'true')
    to.classList.add('active')
    to.removeAttribute('aria-hidden')
    pages.classList.toggle('on-sub', page !== 'main')
    if (!animate) {
      pages.style.height = ''
      return
    }
    pages.style.height = `${to.offsetHeight}px`
    const done = () => {
      pages.style.height = ''
      pages.removeEventListener('transitionend', done)
    }
    pages.addEventListener('transitionend', done)
    setTimeout(done, 400)
  }

  #seg<K extends keyof Settings>(label: string, key: K, options: Option<Settings[K]>[]) {
    const buttons = options.map(o =>
      h(
        'button',
        {
          onClick: () => this.onChange({ [key]: o.value } as Patch),
          style: o.font ? { fontFamily: o.font } : undefined,
        },
        o.swatch ? h('span', { class: 'swatch', style: { background: o.swatch } }) : null,
        o.label,
      ),
    )
    this.#sync.push(s => buttons.forEach((b, i) => b.classList.toggle('on', s[key] === options[i].value)))
    return h('div', { class: 'row' }, h('div', { class: 'row-label' }, label), h('div', { class: 'seg' }, ...buttons))
  }

  #stepper() {
    const out = h('output')
    let size = 0
    const dec = h('button', {
      html: icons.minus,
      'aria-label': '减小字号',
      onClick: () => this.onChange({ fontSize: Math.max(FONT_SIZE_MIN, size - 1) }),
    })
    const inc = h('button', {
      html: icons.plus,
      'aria-label': '增大字号',
      onClick: () => this.onChange({ fontSize: Math.min(FONT_SIZE_MAX, size + 1) }),
    })
    this.#sync.push(s => {
      size = s.fontSize
      out.textContent = String(size)
      dec.disabled = size <= FONT_SIZE_MIN
      inc.disabled = size >= FONT_SIZE_MAX
    })
    return h(
      'div',
      { class: 'row' },
      h('div', { class: 'row-label' }, '字号'),
      h('div', { class: 'stepper' }, dec, out, inc),
    )
  }
}
