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

let closeCurrentSheet: (() => void) | null = null
let closeCurrentMenu: (() => void) | null = null
let closeCurrentDialog: (() => void) | null = null

export const sheetOpen = () => closeCurrentSheet != null
export const closeSheet = () => closeCurrentSheet?.()

export const menuOpen = () => closeCurrentMenu != null
export const closeMenu = () => closeCurrentMenu?.()

export const dialogOpen = () => closeCurrentDialog != null
export const closeDialog = () => closeCurrentDialog?.()

function closeOverlays() {
  closeSheet()
  closeMenu()
  closeDialog()
}

/** A list of actions sliding up from the bottom. An action, the scrim or Back closes it. */
export function actionSheet(title: string, actions: SheetAction[]) {
  closeOverlays()
  const layer = h('div', { class: 'sheet-layer' })
  const close = () => {
    if (closeCurrentSheet !== close) return
    closeCurrentSheet = null
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
  closeCurrentSheet = close
}

// ── Context menu (desktop) ──────────────────────────────────────────────────

export interface MenuAction {
  label: string
  icon?: string
  danger?: boolean
  run(): void
}

export function contextMenu(x: number, y: number, actions: MenuAction[]) {
  closeOverlays()
  const menu = h(
    'div',
    { class: 'ctx-menu', role: 'menu', tabindex: '-1' },
    ...actions.map(a =>
      h(
        'button',
        {
          class: a.danger ? 'ctx-item danger' : 'ctx-item',
          role: 'menuitem',
          onClick: () => {
            close()
            a.run()
          },
        },
        a.icon ? h('span', { class: 'ctx-icon', html: a.icon }) : null,
        h('span', {}, a.label),
      ),
    ),
  )

  const onPointerDown = (e: PointerEvent) => {
    if (!menu.contains(e.target as Node)) close()
  }
  const onClose = () => close()
  const close = () => {
    if (closeCurrentMenu !== close) return
    closeCurrentMenu = null
    window.removeEventListener('pointerdown', onPointerDown, true)
    window.removeEventListener('scroll', onClose, true)
    window.removeEventListener('blur', onClose)
    window.removeEventListener('resize', onClose)
    menu.remove()
  }

  menu.style.visibility = 'hidden'
  document.getElementById('app')!.append(menu)
  const rect = menu.getBoundingClientRect()
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`
  menu.style.visibility = ''
  menu.classList.add('open')
  menu.focus()

  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('scroll', onClose, true)
  window.addEventListener('blur', onClose)
  window.addEventListener('resize', onClose)
  closeCurrentMenu = close
}

// ── Prompt dialog ───────────────────────────────────────────────────────────

export interface PromptOptions {
  title: string
  value: string
  placeholder?: string
  confirmLabel?: string
  onConfirm(value: string): void
}

export function promptDialog(opts: PromptOptions) {
  closeOverlays()
  const prevFocus = document.activeElement as HTMLElement | null

  const confirmBtn = h(
    'button',
    { type: 'submit', class: 'modal-btn confirm', disabled: !opts.value.trim() },
    opts.confirmLabel ?? '确定',
  )
  const input = h('input', {
    class: 'modal-input',
    type: 'text',
    value: opts.value,
    placeholder: opts.placeholder ?? '',
    'aria-label': opts.title,
    onInput: () => {
      confirmBtn.disabled = !input.value.trim()
    },
    onKeydown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' && e.isComposing) e.preventDefault()
    },
  })

  const close = () => {
    if (closeCurrentDialog !== close) return
    closeCurrentDialog = null
    layer.classList.remove('open')
    setTimeout(() => layer.remove(), 200)
    if (prevFocus?.isConnected) prevFocus.focus()
  }

  const form = h(
    'form',
    {
      class: 'modal',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': opts.title,
      onSubmit: (e: SubmitEvent) => {
        e.preventDefault()
        const value = input.value.trim()
        if (!value) return
        close()
        opts.onConfirm(value)
      },
    },
    h('h2', { class: 'modal-title' }, opts.title),
    input,
    h(
      'div',
      { class: 'modal-actions' },
      h('button', { type: 'button', class: 'modal-btn cancel', onClick: close }, '取消'),
      confirmBtn,
    ),
  )

  const layer = h('div', { class: 'modal-layer' }, h('div', { class: 'modal-scrim', onClick: close }), form)
  document.getElementById('app')!.append(layer)
  void layer.offsetHeight
  layer.classList.add('open')
  closeCurrentDialog = close
  input.focus()
  input.select()
}
