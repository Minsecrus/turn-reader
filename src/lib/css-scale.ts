/**
 * Makes a book's font sizes follow Turn's font size setting.
 *
 * Many EPUBs set absolute sizes (`p { font-size: 16px }`, `body { font-size: 12pt }`,
 * `font-size: medium`), which ignore the root font size Turn sets. Here they're
 * rewritten to `rem` relative to the browser default (16px = 12pt = medium = 1rem),
 * so the book's own hierarchy is kept but scales with the user's size.
 * Absolute line heights are converted too, or lines would overlap at larger sizes.
 */

const KEYWORDS: Record<string, number> = {
  'xx-small': 0.5625,
  'x-small': 0.625,
  small: 0.8125,
  medium: 1,
  large: 1.125,
  'x-large': 1.5,
  'xx-large': 2,
  'xxx-large': 3,
}

const rem = (n: number) => `${+n.toFixed(4)}rem`

const ABSOLUTE = /(-?\d*\.?\d+)(px|pt)(?![\w-])/gi
const KEYWORD = /(?<![\w-])(xxx-large|xx-large|x-large|large|medium|small|x-small|xx-small)(?![\w-])/gi
const DECLARATION = /(^|[{;\s])(font-size|line-height|font)(\s*:\s*)([^;{}]+)/gi

export function relativizeCSS(css: string): string {
  return css.replace(DECLARATION, (_, pre: string, prop: string, colon: string, value: string) => {
    let v = value.replace(ABSOLUTE, (_m, n: string, unit: string) =>
      rem(parseFloat(n) / (unit.toLowerCase() === 'pt' ? 12 : 16)),
    )
    if (prop.toLowerCase() !== 'line-height') v = v.replace(KEYWORD, k => rem(KEYWORDS[k.toLowerCase()]))
    return pre + prop + colon + v
  })
}

/** Rewrites `<style>` blocks and `style=""` attributes of a (X)HTML document. */
export function relativizeHTML(html: string): string {
  return html
    .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (_, open: string, css: string, close: string) =>
      open + relativizeCSS(css) + close,
    )
    .replace(/(\sstyle\s*=\s*)(["'])([\s\S]*?)\2/gi, (_, attr: string, q: string, css: string) =>
      attr + q + relativizeCSS(css) + q,
    )
}
