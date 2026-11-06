import { android } from './platform'
import type { FontKey, Settings, ThemeKey, WidthKey } from './store'

export type ResolvedTheme = 'light' | 'paper' | 'dark'

export interface Palette {
  bg: string
  fg: string
  link: string
  selection: string
  scheme: 'light' | 'dark'
}

export const PALETTES: Record<ResolvedTheme, Palette> = {
  light: { bg: '#FDFDFC', fg: '#232220', link: '#2E5AAC', selection: 'rgba(46, 90, 172, .2)', scheme: 'light' },
  paper: { bg: '#F2EAD8', fg: '#3A3125', link: '#8A5A2B', selection: 'rgba(138, 90, 43, .2)', scheme: 'light' },
  dark: { bg: '#0F0F10', fg: '#D3CFC7', link: '#8FB1EE', selection: 'rgba(143, 177, 238, .28)', scheme: 'dark' },
}

const darkQuery = matchMedia('(prefers-color-scheme: dark)')

export const resolveTheme = (t: ThemeKey): ResolvedTheme =>
  t === 'auto' ? (darkQuery.matches ? 'dark' : 'light') : t

export const onSystemThemeChange = (f: () => void) => darkQuery.addEventListener('change', f)

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/** Target characters per line. The text width follows the font size, so a larger size doesn't narrow the line. */
export const CHARS_PER_LINE: Record<WidthKey, number> = { narrow: 28, medium: 36, wide: 46 }

/**
 * Value for the paginator's `max-inline-size`. In paginated mode foliate-js
 * takes the column gap out of that size (≈ 6–13% depending on 1 or 2 columns),
 * so it gets a bit more room to land near the target character count.
 */
export const maxInlineSize = (s: Settings) =>
  Math.round(s.fontSize * CHARS_PER_LINE[s.width] * (s.flow === 'paginated' ? 1.1 : 1))

// ── Fonts ───────────────────────────────────────────────────────────────────

const probe = document.createElement('canvas').getContext('2d')!
const SAMPLE = '永和九年岁在癸丑暮春之初 Turn 0123'

/** Whether a local font is installed, by comparing rendered widths against fallbacks. */
const installed = (family: string) =>
  ['monospace', 'serif', 'sans-serif'].some(base => {
    probe.font = `32px ${base}`
    const w0 = probe.measureText(SAMPLE).width
    probe.font = `32px "${family}", ${base}`
    return probe.measureText(SAMPLE).width !== w0
  })

const firstInstalled = (families: string[], fallback: string) =>
  families.find(installed) ?? fallback

const stack = (...families: string[]) => families.map(f => (/^[a-z-]+$/.test(f) ? f : `"${f}"`)).join(', ')

export interface FontChoice {
  label: string
  css: string
}

/** Kai is only offered where a Kai font exists (always on Windows, rarely on Android). */
let fonts: { serif: FontChoice; sans: FontChoice; kai: FontChoice | null } | null = null

export function fontChoices() {
  if (fonts) return fonts
  if (android) {
    // Android's generic families map Chinese to Noto Serif / Sans CJK.
    const kai = ['LXGW WenKai', 'LXGW WenKai Screen', '霞鹜文楷'].find(installed)
    fonts = {
      serif: { label: '宋体', css: 'serif' },
      sans: { label: '黑体', css: 'sans-serif' },
      kai: kai ? { label: '楷体', css: stack(kai, 'serif') } : null,
    }
    return fonts
  }
  const serif = firstInstalled(
    ['Source Han Serif SC', 'Source Han Serif CN', 'Noto Serif SC', 'Noto Serif CJK SC', '思源宋体'],
    'SimSun',
  )
  const kai = firstInstalled(['LXGW WenKai', 'LXGW WenKai Screen', '霞鹜文楷', 'KaiTi', 'STKaiti'], 'KaiTi')
  fonts = {
    serif: { label: '宋体', css: stack(serif, 'SimSun', 'serif') },
    sans: { label: '黑体', css: stack('Microsoft YaHei UI', 'Microsoft YaHei', 'sans-serif') },
    kai: { label: '楷体', css: stack(kai, 'KaiTi', 'serif') },
  }
  return fonts
}

const fontCSS = (key: Exclude<FontKey, 'book'>) => (fontChoices()[key] ?? fontChoices().serif).css

/** Used when the book doesn't specify a font: a good serif if one is installed, else YaHei. */
function fallbackFamily() {
  const f = fontChoices()
  return f.serif.css.startsWith('"SimSun"') ? f.sans.css : f.serif.css
}

// ── Book CSS ────────────────────────────────────────────────────────────────

/**
 * Returns [before, after]: `before` is prepended to the book's own styles (the
 * book may override it), `after` is appended (overrides the book).
 */
export function bookCSS(s: Settings, theme: ResolvedTheme): [string, string] {
  const p = PALETTES[theme]
  const font = s.font === 'book' ? null : fontCSS(s.font)
  // In tinted and dark themes, books that hardcode colors become unreadable,
  // so those colors are neutralized. In the light theme the book's colors stay.
  const neutralize = theme !== 'light'

  const before = `
    @namespace epub "http://www.idpf.org/2007/ops";
    html { font-family: ${fallbackFamily()}; }
  `

  const after = `
    @namespace epub "http://www.idpf.org/2007/ops";
    html {
      color-scheme: ${p.scheme};
      color: ${p.fg} !important;
      background: transparent !important;
      font-size: ${s.fontSize}px !important;
      line-height: ${s.lineHeight};
      -webkit-text-size-adjust: none;
      text-rendering: optimizeLegibility;
      font-kerning: normal;
      /* CJK punctuation compression and CJK/Latin spacing (Chromium) */
      text-spacing-trim: normal;
      text-autospace: normal;
      line-break: strict;
      overflow-wrap: break-word;
    }
    body { background: transparent !important; }
    ${font ? `body, body :not(code, pre, kbd, samp, tt, code *, pre *) { font-family: ${font} !important; }` : ''}
    p, li, blockquote, dd, dt {
      line-height: ${s.lineHeight} !important;
      text-align: justify;
      widows: 2;
      orphans: 2;
    }
    [align="left"] { text-align: left; }
    [align="right"] { text-align: right; }
    [align="center"] { text-align: center; }
    pre { white-space: pre-wrap !important; }
    a:any-link { color: ${p.link} !important; text-decoration-thickness: from-font; }
    ::selection { background: ${p.selection}; }
    ${
      neutralize
        ? `body :not(a, a *, svg, svg *) {
             color: inherit !important;
             background-color: transparent !important;
             border-color: currentColor;
           }`
        : ''
    }
    ${theme === 'dark' ? 'img, svg image { filter: brightness(.88); }' : ''}
    aside[epub|type~="endnote"],
    aside[epub|type~="footnote"],
    aside[epub|type~="note"],
    aside[epub|type~="rearnote"] { display: none; }
  `
  return [before, after]
}
