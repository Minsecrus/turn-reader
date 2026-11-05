import type { BookRecord } from '../lib/store'
import { h } from './dom'
import { icons } from './icons'

export interface LibraryActions {
  open(path: string): void
  remove(path: string): void
  pick(): void
}

const hue = (s: string) => {
  let x = 0
  for (const ch of s) x = (x * 31 + ch.codePointAt(0)!) >>> 0
  return x % 360
}

const pct = (f: number) => (f > 0 ? `${Math.min(100, Math.floor(f * 100))}%` : '未读')

function card(b: BookRecord, on: LibraryActions) {
  const cover = b.cover
    ? h('div', { class: 'cover' }, h('img', { src: b.cover, alt: '', draggable: 'false', decoding: 'async' }))
    : h(
        'div',
        {
          class: 'cover placeholder',
          style: { background: `linear-gradient(160deg, hsl(${hue(b.title)} 26% 46%), hsl(${hue(b.title)} 30% 30%))` },
        },
        b.title,
      )
  const open = () => on.open(b.path)
  return h(
    'div',
    {
      class: 'card',
      role: 'button',
      tabindex: '0',
      title: b.path,
      'aria-label': b.title,
      onClick: open,
      onKeydown: (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          open()
        } else if (e.key === 'Delete') on.remove(b.path)
      },
    },
    cover,
    h('div', { class: 'card-title' }, b.title),
    h(
      'div',
      { class: 'card-meta' },
      h('span', { class: 'card-author' }, b.author || '佚名'),
      h('span', { class: 'card-pct' }, pct(b.fraction)),
    ),
    h('button', {
      class: 'card-remove',
      title: '从书架移除（不会删除文件）',
      'aria-label': '从书架移除',
      html: icons.close,
      onClick: (e: MouseEvent) => {
        e.stopPropagation()
        on.remove(b.path)
      },
    }),
  )
}

export function renderLibrary(root: HTMLElement, books: BookRecord[], on: LibraryActions) {
  const inner = h('div', { class: 'lib-inner' })
  if (!books.length) {
    inner.append(
      h(
        'div',
        { class: 'empty' },
        h('div', { html: icons.book }),
        h('div', { class: 'empty-title' }, '把 EPUB 拖到这里'),
        h('div', {}, '或者按 ', h('kbd', {}, 'Ctrl'), ' + ', h('kbd', {}, 'O'), ' 打开文件'),
        h('button', { class: 'primary', onClick: () => on.pick() }, '打开文件'),
      ),
    )
  } else {
    inner.append(
      h('div', { class: 'lib-head' }, h('h1', {}, '书架'), h('span', { class: 'lib-count' }, `${books.length} 本`)),
      h('div', { class: 'grid' }, ...books.map(b => card(b, on))),
    )
  }
  root.replaceChildren(inner)
}
