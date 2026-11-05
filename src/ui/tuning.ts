import { DEFAULT_TUNING, type OverscrollTuning } from '../lib/overscroll'
import { h } from './dom'

const FIELDS: { key: keyof OverscrollTuning; label: string; min: number; max: number; step: number }[] = [
  { key: 'threshold', label: '满格力度 px', min: 120, max: 1200, step: 20 },
  { key: 'arrivalCap', label: '惯性上限', min: 0, max: 1, step: 0.05 },
  { key: 'idleMs', label: '停顿回落 ms', min: 80, max: 800, step: 20 },
  { key: 'decayMs', label: '回落时长 ms', min: 80, max: 1000, step: 20 },
  { key: 'maxShift', label: '橡皮筋 px', min: 0, max: 120, step: 2 },
]

/** Debug panel (Ctrl+Shift+D) for tuning the chapter overscroll feel. */
export function mountTuning(root: HTMLElement, tuning: OverscrollTuning, onChange: () => void) {
  const syncs: (() => void)[] = []
  const rows = FIELDS.map(f => {
    const input = h('input', { type: 'range', min: f.min, max: f.max, step: f.step })
    const out = h('output')
    const sync = () => {
      input.value = String(tuning[f.key])
      out.textContent = String(tuning[f.key])
    }
    input.addEventListener('input', () => {
      tuning[f.key] = Number(input.value)
      out.textContent = input.value
      onChange()
    })
    syncs.push(sync)
    sync()
    return h('label', {}, f.label, input, out)
  })
  const reset = h(
    'button',
    {
      class: 'reset',
      onClick: () => {
        Object.assign(tuning, DEFAULT_TUNING)
        syncs.forEach(s => s())
        onChange()
      },
    },
    '恢复默认',
  )
  root.replaceChildren(h('h3', {}, '章末越界 · 手感调试'), ...rows, reset)
}
