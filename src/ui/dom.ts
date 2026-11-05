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
