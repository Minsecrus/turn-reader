/**
 * Platform differences, kept in one place.
 *
 * Desktop (Windows) is driven by mouse, wheel and keyboard in a frameless
 * window. Android is driven by touch in an edge-to-edge activity: the page
 * draws under the system bars, gets their size from `MainActivity`'s bridge,
 * and hides them while reading.
 */

interface AndroidBridge {
  insets(): string
  setSystemBars(hidden: boolean, lightBackground: boolean): void
  moveToBack(): void
}

declare global {
  interface Window {
    TurnAndroid?: AndroidBridge
    __turnInsets?: (value: string) => void
  }
}

const bridge = window.TurnAndroid

export const android = /\bAndroid\b/.test(navigator.userAgent)
export const desktop = !android

/** Primary input is a finger (no hover, no keyboard). */
export const touch = android

document.documentElement.dataset.platform = android ? 'android' : 'desktop'

// ── Safe area ───────────────────────────────────────────────────────────────

export const insets = { top: 0, right: 0, bottom: 0, left: 0 }
const insetListeners: (() => void)[] = []

/** Called when the safe-area insets change (rotation, first measurement). */
export const onInsetsChange = (f: () => void) => insetListeners.push(f)

function applyInsets(value: string) {
  const [top, right, bottom, left] = value.split(',').map(n => Math.max(0, Number(n) || 0))
  if (top === insets.top && right === insets.right && bottom === insets.bottom && left === insets.left) return
  Object.assign(insets, { top, right, bottom, left })
  const s = document.documentElement.style
  s.setProperty('--inset-top', `${top}px`)
  s.setProperty('--inset-right', `${right}px`)
  s.setProperty('--inset-bottom', `${bottom}px`)
  s.setProperty('--inset-left', `${left}px`)
  for (const f of insetListeners) f()
}

if (bridge) {
  // Listen first, then read, so no update can fall in between.
  window.__turnInsets = applyInsets
  applyInsets(bridge.insets())
}

// ── System bars ─────────────────────────────────────────────────────────────

let bars = ''

/** Hides the status/navigation bars (reading) or shows them, with icons readable on the background. */
export function setSystemBars(hidden: boolean, lightBackground: boolean) {
  const key = `${hidden}${lightBackground}`
  if (!bridge || key === bars) return
  bars = key
  bridge.setSystemBars(hidden, lightBackground)
}

/** Leaves the app running in the background (back from the top level). */
export const moveToBack = () => bridge?.moveToBack()
