// Minimal CDP driver for the running Turn dev app (WebView2 with
// WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222).
//
//   node scripts/cdp.mjs eval "<js expression>"
//   node scripts/cdp.mjs shot out.png
//   node scripts/cdp.mjs key <Key> [count] [shift]
//   node scripts/cdp.mjs wheel <x> <y> <deltaY> [count] [intervalMs]
//   node scripts/cdp.mjs click <x> <y>
import { writeFileSync } from 'node:fs'

const port = process.env.CDP_PORT ?? 9222
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = targets.find(t => t.type === 'page')
if (!page) throw new Error('no page target: ' + JSON.stringify(targets))

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)))
let id = 0
const pending = new Map()
ws.onmessage = ev => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result)
  }
}
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++id
    pending.set(i, { res, rej })
    ws.send(JSON.stringify({ id: i, method, params }))
  })
const sleep = ms => new Promise(r => setTimeout(r, ms))

const KEYS = {
  ArrowRight: 39, ArrowLeft: 37, ArrowUp: 38, ArrowDown: 40, PageDown: 34, PageUp: 33,
  ' ': 32, Escape: 27, t: 84, s: 83, m: 77, F11: 122,
}

const [cmd, ...args] = process.argv.slice(2)
switch (cmd) {
  case 'eval': {
    const r = await send('Runtime.evaluate', { expression: args[0], awaitPromise: true, returnByValue: true })
    console.log(r.exceptionDetails ? 'EXCEPTION ' + JSON.stringify(r.exceptionDetails) : JSON.stringify(r.result.value, null, 1))
    break
  }
  case 'shot': {
    const r = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(args[0], Buffer.from(r.data, 'base64'))
    console.log('saved', args[0])
    break
  }
  case 'key': {
    const key = args[0]
    const n = Number(args[1] ?? 1)
    const modifiers = args[2] === 'shift' ? 8 : 0
    for (let i = 0; i < n; i++) {
      const code = KEYS[key]
      const text = key.length === 1 ? key : undefined
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, windowsVirtualKeyCode: code, text, modifiers })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, windowsVirtualKeyCode: code, modifiers })
      await sleep(Number(process.env.KEY_GAP ?? 450))
    }
    console.log('keys sent')
    break
  }
  case 'wheel': {
    const [x, y, dy] = args.slice(0, 3).map(Number)
    const n = Number(args[3] ?? 1)
    const gap = Number(args[4] ?? 16)
    for (let i = 0; i < n; i++) {
      await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy })
      await sleep(gap)
    }
    console.log('wheel sent')
    break
  }
  case 'click': {
    const [x, y] = args.map(Number)
    for (const type of ['mousePressed', 'mouseReleased'])
      await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
    console.log('clicked')
    break
  }
  default:
    console.log('unknown command')
}
ws.close()
process.exit(0)
