/** Tiny DOM helper. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue
    if (k === 'class') el.className = String(v)
    else if (k === 'html') el.innerHTML = String(v)
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v)
    else if (k.startsWith('on') && typeof v === 'function')
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener)
    else if (k.startsWith('--')) el.style.setProperty(k, String(v))
    else el.setAttribute(k, v === true ? '' : String(v))
  }
  for (const c of children) if (c != null && c !== false) el.append(c)
  return el
}

let toastTimer: number | undefined
export function toast(message: string, ms = 2600) {
  const el = document.getElementById('toast')!
  el.textContent = message
  el.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => el.classList.remove('show'), ms)
}

export function hideToast() {
  clearTimeout(toastTimer)
  document.getElementById('toast')!.classList.remove('show')
}

// ── Action sheet (touch) ────────────────────────────────────────────────────

export interface SheetAction {
  label: string
  danger?: boolean
  run(): void
}

let closeCurrent: (() => void) | null = null

export const sheetOpen = () => closeCurrent != null

export const closeSheet = () => closeCurrent?.()

/** A list of actions sliding up from the bottom. An action, the scrim or Back closes it. */
export function actionSheet(title: string, actions: SheetAction[]) {
  closeSheet()
  const layer = h('div', { class: 'sheet-layer' })
  const close = () => {
    if (closeCurrent !== close) return
    closeCurrent = null
    layer.classList.remove('open')
    setTimeout(() => layer.remove(), 300)
  }
  layer.append(
    h('div', { class: 'sheet-scrim', onClick: close }),
    h(
      'div',
      { class: 'sheet', role: 'dialog', 'aria-label': title },
      h('div', { class: 'sheet-title' }, title),
      ...actions.map(a =>
        h(
          'button',
          {
            class: a.danger ? 'sheet-btn danger' : 'sheet-btn',
            onClick: () => {
              close()
              a.run()
            },
          },
          a.label,
        ),
      ),
      h('button', { class: 'sheet-btn cancel', onClick: close }, '取消'),
    ),
  )
  document.getElementById('app')!.append(layer)
  void layer.offsetHeight // start the transition from the closed state
  layer.classList.add('open')
  closeCurrent = close
}
