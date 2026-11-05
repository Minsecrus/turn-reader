import type { TocItem } from 'foliate-js/view.js'
import { h } from './dom'

export class TocPanel {
  #items = new Map<TocItem, HTMLElement>()
  #current: HTMLElement | null = null

  constructor(
    private list: HTMLElement,
    private onPick: (href: string) => void,
  ) {}

  render(toc: TocItem[]) {
    this.#items.clear()
    this.#current = null
    const frag = document.createDocumentFragment()
    const walk = (items: TocItem[] | null | undefined, depth: number) => {
      for (const item of items ?? []) {
        const el = h(
          'button',
          {
            class: 'toc-item',
            'data-depth': String(depth),
            '--depth': String(Math.min(depth, 4)),
            disabled: !item.href,
            onClick: () => item.href && this.onPick(item.href),
          },
          item.label?.trim() || '—',
        )
        this.#items.set(item, el)
        frag.append(el)
        walk(item.subitems, depth + 1)
      }
    }
    walk(toc, 0)
    if (!this.#items.size) frag.append(h('div', { class: 'toc-empty' }, '这本书没有目录'))
    this.list.replaceChildren(frag)
  }

  highlight(item: TocItem | null | undefined) {
    const el = (item && this.#items.get(item)) || null
    if (el === this.#current) return
    this.#current?.classList.remove('current')
    el?.classList.add('current')
    this.#current = el
  }

  reveal() {
    this.#current?.scrollIntoView({ block: 'center' })
  }
}
