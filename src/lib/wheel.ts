/**
 * Wheel input classification.
 *
 * On Windows, a precision touchpad keeps emitting wheel events during inertia,
 * and Chromium does not mark them. A mouse emits one large event per notch.
 * This tracker groups events into gestures so callers can tell "the user is
 * pushing again" apart from "momentum is still coming in".
 */

export interface WheelSample {
  dx: number
  dy: number
  /** Increments for every new gesture. */
  gesture: number
  /** First event of a gesture. */
  fresh: boolean
  /** Looks like a discrete mouse-wheel notch rather than a touchpad stream. */
  notch: boolean
}

export class WheelTracker {
  /** Silence longer than this ends a gesture. */
  gapMs = 140

  #lastT = -Infinity
  #lastMag = 0
  #falling = 0
  #gesture = 0

  feed(e: WheelEvent): WheelSample {
    const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? window.innerHeight : 1
    const dx = e.deltaX * unit
    const dy = e.deltaY * unit
    // Events come from several documents (each iframe has its own timeStamp
    // origin), so time is taken here, in the main document.
    const now = performance.now()
    const mag = Math.hypot(dx, dy)
    const gap = now - this.#lastT

    let fresh = gap > this.gapMs
    // A new swipe started while the previous one's inertia was still decaying.
    if (!fresh && this.#falling >= 3 && mag > this.#lastMag * 1.6 + 4) fresh = true

    if (fresh) {
      this.#gesture++
      this.#falling = 0
    } else if (mag < this.#lastMag) this.#falling++
    else if (mag > this.#lastMag) this.#falling = 0

    const notch =
      e.deltaMode === 1 ||
      (mag >= 50 && dx === 0 && (fresh || (Math.abs(mag - this.#lastMag) < 0.01 && gap > 20)))

    this.#lastT = now
    this.#lastMag = mag
    return { dx, dy, gesture: this.#gesture, fresh, notch }
  }
}

/**
 * Wheel → page turns for paginated mode.
 * Mouse: one page per notch. Touchpad: one page per swipe, however long its
 * inertia lasts.
 */
export class PagedWheel {
  threshold = 50
  #accum = 0
  #consumed = -1
  #lastTurn = 0

  constructor(private turn: (dir: 1 | -1) => void) {}

  feed(s: WheelSample) {
    const d = Math.abs(s.dx) > Math.abs(s.dy) ? s.dx : s.dy
    if (!d) return
    const dir = d > 0 ? 1 : -1

    if (s.notch) {
      const now = performance.now()
      if (now - this.#lastTurn > 50) {
        this.#lastTurn = now
        this.#consumed = s.gesture
        this.turn(dir)
      }
      return
    }

    if (s.fresh || Math.sign(this.#accum) !== dir) this.#accum = 0
    if (this.#consumed === s.gesture) return
    this.#accum += d
    if (Math.abs(this.#accum) >= this.threshold) {
      this.#accum = 0
      this.#consumed = s.gesture
      this.#lastTurn = performance.now()
      this.turn(dir)
    }
  }
}
