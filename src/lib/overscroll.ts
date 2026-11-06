/**
 * Chapter overscroll for scrolled mode.
 *
 * At the end (or start) of a chapter, continuing to scroll charges a meter;
 * when it fills, the next (or previous) chapter opens. Rules:
 *
 *  - Momentum that carried the user to the boundary can charge at most
 *    `arrivalCap`. Crossing needs a fresh, intentional push.
 *  - Stopping for `idleMs` drains the meter over `decayMs`, so separate small
 *    nudges never add up.
 *  - Reversing direction cancels immediately and lets native scrolling continue.
 *
 * Touch works like pull-to-refresh instead: dragging past the boundary fills
 * the meter, and letting go when it's full opens the chapter (`pull`/`release`).
 */

import type { WheelSample } from './wheel'

export interface OverscrollTuning {
  /** Pixels of wheel delta to fill the meter. */
  threshold: number
  /** Max fill from the gesture that arrived at the boundary (0–1). */
  arrivalCap: number
  /** Idle time before draining starts (ms). */
  idleMs: number
  /** Drain duration (ms). */
  decayMs: number
  /** Max rubber-band offset of the page (px). */
  maxShift: number
  /** Touch: drag distance past the boundary that fills the meter (px). */
  pullDistance: number
}

export const DEFAULT_TUNING: OverscrollTuning = {
  threshold: 380,
  arrivalCap: 0.3,
  idleMs: 260,
  decayMs: 320,
  maxShift: 44,
  pullDistance: 150,
}

export type Dir = 1 | -1

export interface OverscrollHost {
  atStart(): boolean
  atEnd(): boolean
  hasAdjacent(dir: Dir): boolean
  /** Draw the meter. `dir` 0 means hidden. */
  render(dir: Dir | 0, progress: number): void
  /** Meter filled: go to the adjacent chapter. */
  fire(dir: Dir): Promise<void>
}

export class ChapterOverscroll {
  #dir: Dir | 0 = 0
  #progress = 0
  /** Last gesture that moved the page (i.e. was not at the boundary). */
  #movingGesture = -1
  #lastGesture = -1
  #idle: number | undefined
  #raf = 0
  #firing = false

  constructor(
    private host: OverscrollHost,
    public tuning: OverscrollTuning,
  ) {}

  get active() {
    return this.#dir !== 0
  }

  feed(s: WheelSample) {
    this.#lastGesture = s.gesture
    if (this.#firing || !s.dy || Math.abs(s.dx) > Math.abs(s.dy)) return
    const want: Dir = s.dy > 0 ? 1 : -1

    if (this.#dir && want !== this.#dir) this.reset()

    const atBoundary = want === 1 ? this.host.atEnd() : this.host.atStart()
    if (!atBoundary) {
      this.#movingGesture = s.gesture
      return
    }
    if (!this.host.hasAdjacent(want)) return

    cancelAnimationFrame(this.#raf)
    this.#dir = want
    const cap = s.gesture === this.#movingGesture ? this.tuning.arrivalCap : 1
    const next = this.#progress + Math.abs(s.dy) / this.tuning.threshold
    this.#progress = Math.max(this.#progress, Math.min(cap, next))
    this.host.render(want, this.#progress)

    clearTimeout(this.#idle)
    if (this.#progress >= 1) void this.#fire(want)
    else this.#idle = window.setTimeout(() => this.#drain(this.tuning.decayMs), this.tuning.idleMs)
  }

  /** Touch: the finger is `distance` px past the boundary in direction `dir` (0 or less: back inside). */
  pull(dir: Dir, distance: number) {
    if (this.#firing) return
    clearTimeout(this.#idle)
    cancelAnimationFrame(this.#raf)
    if (distance <= 0 || !this.host.hasAdjacent(dir)) return this.reset()
    this.#dir = dir
    this.#progress = Math.min(1, distance / this.tuning.pullDistance)
    this.host.render(dir, this.#progress)
  }

  /** Touch: the finger lifted. Full: go; otherwise spring back. */
  release() {
    if (this.#firing || !this.#dir) return
    if (this.#progress >= 1) void this.#fire(this.#dir)
    else this.#drain(180)
  }

  /** Hide immediately (chapter changed, mode switched…). */
  reset() {
    clearTimeout(this.#idle)
    cancelAnimationFrame(this.#raf)
    this.#dir = 0
    this.#progress = 0
    this.host.render(0, 0)
  }

  async #fire(dir: Dir) {
    this.#firing = true
    clearTimeout(this.#idle)
    try {
      await this.host.fire(dir)
    } finally {
      this.#dir = 0
      this.#progress = 0
      this.host.render(0, 0)
      // Momentum from the push that just crossed must not start charging again
      // (e.g. when the new chapter is shorter than the window).
      this.#movingGesture = this.#lastGesture
      this.#firing = false
    }
  }

  #drain(duration: number) {
    clearTimeout(this.#idle)
    cancelAnimationFrame(this.#raf)
    const dir = this.#dir
    const from = this.#progress
    if (!dir || from <= 0) return this.reset()
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      this.#progress = from * (1 - t) ** 3
      this.host.render(dir, this.#progress)
      if (t < 1) this.#raf = requestAnimationFrame(step)
      else this.reset()
    }
    this.#raf = requestAnimationFrame(step)
  }
}
