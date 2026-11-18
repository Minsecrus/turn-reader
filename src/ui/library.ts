import { touch } from '../lib/platform'
import type { BookRecord } from '../lib/store'
import { h } from './dom'
import { icons } from './icons'

const SEARCH_MIN_BOOKS = 10

export interface LibraryActions {
  open(path: string): void
  remove(path: string): void
  rename(book: BookRecord, title: string): void
  pick(): void
  /** Touch: long-press, Desktop: right-click on a book. */
  menu?(book: BookRecord, e: MouseEvent, startRename: () => void): void
  query?: string
  onQuery?(query: string): void
}

export interface LibraryView {
  focusSearch(): boolean
  clearSearch(): boolean
}

const hue = (s: string) => {
  let x = 0
  for (const ch of s) x = (x * 31 + ch.codePointAt(0)!) >>> 0
  return x % 360
}

const placeholderBg = (title: string) =>
  `linear-gradient(160deg, hsl(${hue(title)} 26% 46%), hsl(${hue(title)} 30% 30%))`

const pct = (f: number) => (f > 0 ? `${Math.min(100, Math.floor(f * 100))}%` : '未读')

function card(b: BookRecord, on: LibraryActions) {
  const cover = b.cover
    ? h('div', { class: 'cover' }, h('img', { src: b.cover, alt: '', draggable: 'false', decoding: 'async' }))
    : h(
        'div',
        {
          class: 'cover placeholder',
          style: { background: placeholderBg(b.title) },
        },
        b.title,
      )
  const titleEl = h('div', { class: 'card-title' }, b.title)
  const open = () => on.open(b.path)

  let editing = false
  const startRename = () => {
    if (touch || editing) return
    editing = true
    cardEl.classList.add('editing')

    const input = h('textarea', {
      class: 'card-title-edit',
      rows: '1',
      'aria-label': '重命名书名',
    })
    input.value = b.title

    const syncHeight = () => {
      input.style.height = 'auto'
      input.style.height = `${input.scrollHeight + (input.offsetHeight - input.clientHeight)}px`
    }

    let done = false
    const finish = (commit: boolean, restoreFocus = false) => {
      if (done) return
      done = true
      editing = false
      cardEl.classList.remove('editing')
      const next = commit ? input.value.replace(/[\r\n]+/g, ' ').trim() : ''
      if (next && next !== b.title) {
        on.rename(b, next)
        cardEl.setAttribute('aria-label', next)
        titleEl.textContent = next
        if (!b.cover) {
          cover.textContent = next
          cover.style.background = placeholderBg(next)
        }
      }
      input.replaceWith(titleEl)
      if (restoreFocus) cardEl.focus()
    }

    input.addEventListener('input', () => {
      if (/[\r\n]/.test(input.value)) input.value = input.value.replace(/[\r\n]+/g, ' ')
      syncHeight()
    })
    input.addEventListener('keydown', e => {
      if (e.isComposing) return
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        finish(true, true)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        finish(false, true)
      }
    })
    input.addEventListener('click', e => e.stopPropagation())
    input.addEventListener('dblclick', e => e.stopPropagation())
    input.addEventListener('contextmenu', e => e.stopPropagation())
    input.addEventListener('blur', () => finish(true, false))

    titleEl.replaceWith(input)
    syncHeight()
    input.focus()
    input.select()
  }

  const cardEl = h(
    'div',
    {
      class: 'card',
      role: 'button',
      tabindex: '0',
      title: b.path,
      'aria-label': b.title,
      onClick: () => {
        if (!editing) open()
      },
      onContextmenu: (e: MouseEvent) => {
        if (!on.menu) return
        e.preventDefault()
        on.menu(b, e, startRename)
      },
      onKeydown: (e: KeyboardEvent) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          open()
        } else if (e.key === 'F2') {
          e.preventDefault()
          startRename()
        } else if (e.key === 'Delete') on.remove(b.path)
      },
    },
    cover,
    titleEl,
    h(
      'div',
      { class: 'card-meta' },
      h('span', { class: 'card-author' }, b.author || '佚名'),
      h('span', { class: 'card-pct' }, pct(b.fraction)),
    ),
    h(
      'div',
      { class: 'card-actions' },
      h('button', {
        class: 'card-action card-rename',
        title: '重命名  F2',
        'aria-label': '重命名',
        html: icons.edit,
        onClick: (e: MouseEvent) => {
          e.stopPropagation()
          startRename()
        },
      }),
      h('button', {
        class: 'card-action card-remove',
        title: '从书架移除（不会删除文件）',
        'aria-label': '从书架移除',
        html: icons.close,
        onClick: (e: MouseEvent) => {
          e.stopPropagation()
          on.remove(b.path)
        },
      }),
    ),
  )
  return cardEl
}

export function renderLibrary(root: HTMLElement, books: BookRecord[], on: LibraryActions): LibraryView {
  const inner = h('div', { class: 'lib-inner' })
  if (!books.length) {
    on.onQuery?.('')
    inner.append(
      h(
        'div',
        { class: 'empty' },
        h('div', { html: icons.book }),
        ...(touch
          ? [h('div', { class: 'empty-title' }, '点击右上角加号，添加第一本书')]
          : [
              h('div', { class: 'empty-title' }, '把 EPUB 拖到这里'),
              h('div', {}, '或者按 ', h('kbd', {}, 'Ctrl'), ' + ', h('kbd', {}, 'O'), ' 打开文件'),
              h('button', { class: 'primary', onClick: () => on.pick() }, '打开文件'),
            ]),
      ),
    )
    root.replaceChildren(inner)
    return { focusSearch: () => false, clearSearch: () => false }
  }

  const searchable = books.length >= SEARCH_MIN_BOOKS
  const initialQuery = searchable ? (on.query ?? '') : ''
  if (!searchable && on.query) on.onQuery?.('')

  const countEl = h('span', { class: 'lib-count' })
  const head = h('div', { class: 'lib-head' }, h('div', { class: 'lib-title-group' }, h('h1', {}, '书架'), countEl))
  const body = h('div', { class: 'lib-body' })

  const renderList = (rawQuery: string) => {
    const q = rawQuery.trim().toLowerCase()
    const list = q ? books.filter(b => b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q)) : books
    countEl.textContent = q ? `${list.length} / ${books.length}` : String(books.length)
    if (list.length) {
      body.replaceChildren(h('div', { class: 'grid' }, ...list.map(b => card(b, on))))
    } else {
      body.replaceChildren(
        h(
          'div',
          { class: 'search-empty' },
          h('div', { html: icons.book }),
          h('div', {}, '没有找到相关书籍'),
        ),
      )
    }
  }

  let focusSearch = () => false
  let clearSearch = () => false

  if (searchable) {
    const input = h('input', {
      class: 'lib-search-input',
      type: 'text',
      enterkeyhint: 'search',
      placeholder: '搜索书名或作者',
      'aria-label': '搜索书架',
    })
    input.value = initialQuery

    const clearBtn = h('button', {
      type: 'button',
      class: 'lib-search-clear',
      'aria-label': '清除搜索',
      html: icons.close,
      hidden: !initialQuery,
      onPointerdown: (e: PointerEvent) => e.preventDefault(),
      onClick: () => {
        input.value = ''
        on.onQuery?.('')
        clearBtn.hidden = true
        renderList('')
        input.focus()
      },
    })

    const toggleBtn = h('button', {
      type: 'button',
      class: 'icon-btn lib-search-toggle',
      'data-tip': touch ? undefined : '搜索  Ctrl+F',
      'aria-label': '搜索书架',
      html: icons.search,
      onClick: () => openSearch(),
    })

    const searchWrap = h(
      'div',
      { class: initialQuery ? 'lib-search open' : 'lib-search' },
      toggleBtn,
      h(
        'div',
        { class: 'lib-search-box' },
        h('span', { class: 'lib-search-icon', html: icons.search }),
        input,
        clearBtn,
      ),
    )

    const openSearch = () => {
      searchWrap.classList.add('open')
      input.focus()
      input.select()
    }

    focusSearch = () => {
      openSearch()
      return true
    }

    clearSearch = () => {
      const active = searchWrap.classList.contains('open') || !!input.value
      if (!active) return false
      input.value = ''
      on.onQuery?.('')
      clearBtn.hidden = true
      searchWrap.classList.remove('open')
      input.blur()
      renderList('')
      return true
    }

    input.addEventListener('input', () => {
      on.onQuery?.(input.value)
      clearBtn.hidden = !input.value
      renderList(input.value)
    })
    input.addEventListener('keydown', e => {
      if (e.isComposing) return
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        clearSearch()
        root.focus()
      }
    })
    input.addEventListener('blur', () => {
      if (!input.value.trim()) {
        input.value = ''
        on.onQuery?.('')
        clearBtn.hidden = true
        searchWrap.classList.remove('open')
        renderList('')
      }
    })

    head.append(searchWrap)
  }

  renderList(initialQuery)
  inner.append(head, body)
  root.replaceChildren(inner)
  return { focusSearch, clearSearch }
}
