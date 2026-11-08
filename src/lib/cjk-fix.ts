/**
 * Remediates two common artifacts in OCR'd or poorly converted Chinese EPUBs:
 *
 * 1. Intra-paragraph line breaks (`</p><p>`, `</li><li>`, `</li></ol><p>`, `<br>`)
 *    where a prose sentence was split mid-way across PDF lines/pages or before
 *    Chinese numerals (`一`, `二`, `三`, `第`).
 * 2. Half-width English punctuation (`,`, `;`, `:`, `?`, `!`, `.`, `()`, `""`)
 *    and mis-paired OCR quotation marks (`”...”`) inside Chinese prose, while
 *    leaving English citations, numbers, URLs, code, and math expressions intact.
 */

const SKIP_TAGS = new Set([
  'CODE',
  'PRE',
  'KBD',
  'SAMP',
  'TT',
  'VAR',
  'SCRIPT',
  'STYLE',
  'MATH',
  'SVG',
  'CANVAS',
  'TEXTAREA',
  'ANNOTATION',
  'SEMANTICS',
])

const SKIP_SELECTOR =
  'code, pre, kbd, samp, tt, var, script, style, math, svg, canvas, textarea, .math, .katex, .MathJax, [data-mathml]'

const BLOCK_CHILD_SELECTOR = 'img, svg, video, audio, canvas, table, hr, pre, blockquote, ul, ol, div, p'

const CJK_RE = /[\u4e00-\u9fff]/
const CJK_GLOBAL_RE = /[\u4e00-\u9fff]/g
const CJK_OR_PUNCT_BEFORE_RE = /[\u4e00-\u9fff，。；：！？、“”‘’《》【】（）「」『』]/
const CJK_OR_PUNCT_AFTER_RE = /[\u4e00-\u9fff，。；：！？、“”‘’《》【】（）「」『』]/
const CJK_CLOSE_OR_HAN_RE = /[\u4e00-\u9fff”’）》】」』]/
const CJK_OPEN_OR_HAN_RE = /[\u4e00-\u9fff“‘（《【「『]/

// Mathematical / technical symbols and LaTeX / subscript patterns
const MATH_RE = /[=+×÷∑∫√∈∀∃≤≥≠≈→⇔∂∇±∞∝⊥∥]|\\[a-zA-Z]{2,}|_[0-9a-zA-Z]|\^[0-9a-zA-Z]/

const SENTENCE_PUNCT_RE = /[，,。！？!?；;：:—]/
const TERMINAL_PUNCT_RE = /[。！？!?.”"’'』」）》\)\]：:;；…]$/

function cjkCount(s: string): number {
  return s.match(CJK_GLOBAL_RE)?.length ?? 0
}

function dquoteCount(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '“' || c === '”' || c === '"') n++
  }
  return n
}

function hasUnclosedPairs(s: string): boolean {
  let paren = 0
  let book = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '(' || c === '（') paren++
    else if (c === ')' || c === '）') paren--
    else if (c === '《') book++
    else if (c === '》') book--
  }
  return paren > 0 || book > 0 || dquoteCount(s) % 2 === 1
}

function isTerminal(t1: string): boolean {
  // A trailing quote in a block with an odd number of quotes and no sentence-end
  // punctuation before it is an unclosed opening quote (e.g. `寻找”` || `三位一体的痕迹”`).
  if ((t1.endsWith('“') || t1.endsWith('”') || t1.endsWith('"')) && dquoteCount(t1) % 2 === 1) {
    if (!/[。！？!?.…][“”"]$/.test(t1)) return false
  }
  return TERMINAL_PUNCT_RE.test(t1)
}

function isChineseProseContext(s: string): boolean {
  if (MATH_RE.test(s)) return false
  const cjk = cjkCount(s)
  if (cjk < 2) return false
  const nonWs = s.replace(/\s+/g, '').length
  return cjk / Math.max(1, nonWs) >= 0.25 || cjk >= 10
}

function shouldMergeText(t1: string, t2: string, raw1: string, raw2: string, sameClass = true): boolean {
  if (!t1 || !t2) return false
  if (!sameClass && t1.length < 25) return false
  if (!isChineseProseContext(t1)) return false
  if (!isChineseProseContext(t2) && !hasUnclosedPairs(t1)) return false

  // Preserve short pseudo-list items that start with explicit leading spaces
  if ((/^[\s\u3000\xa0]/.test(raw1) || /^[\s\u3000\xa0]/.test(raw2)) && (t1.length < 25 || t2.length < 25)) {
    return false
  }
  if (isTerminal(t1)) return false

  // Exclude TOC entries ending with whitespace + page number
  if (/[\xa0\s\u3000]{2,}\d+$/.test(t1) || /[\xa0\s\u3000]{2,}\d+$/.test(t2)) return false
  // Exclude chapter list lines
  if (/^第[一二三四五六七八九十百\d]+[章节篇部]\s/.test(t1) && /^第[一二三四五六七八九十百\d]+[章节篇部]\s/.test(t2)) {
    return false
  }
  // Exclude lines ending with an email or domain name
  if (/\.[a-zA-Z]{2,}$/.test(t1)) return false

  // Case A: t1 ends with a comma / enumeration comma
  if (t1.endsWith(',') || t1.endsWith('，') || t1.endsWith('、')) {
    if (hasUnclosedPairs(t1)) return true
    // Only merge long prose clauses, never short poem / hymn lines
    return t1.length >= 25 && t2.length >= 20 && /[。！？!?；;]/.test(t2)
  }

  // Case B: t1 ends without terminal punctuation
  if (hasUnclosedPairs(t1) && t1.length >= 15) return true

  if (t1.length >= 20 && (SENTENCE_PUNCT_RE.test(t1) || SENTENCE_PUNCT_RE.test(t2))) {
    if (!(/[。！？!?]/.test(t1) || /[。！？!?]/.test(t2) || /[：:;；第]$/.test(t2))) return false
    // Don't merge a prose intro line into a short verse line
    if (t2.length < 20 && (t2.endsWith(',') || t2.endsWith('，'))) return false
    return true
  }

  // Split right before Chinese numeral / "第" (e.g. "本书" + "第一部分旨在概述...")
  if (/^第?[一二三四五六七八九十百千万]/.test(t2) && t2.length >= 30 && /[。！？!?]/.test(t2)) {
    return true
  }

  return false
}

function onlyWhitespaceBetween(a: Node, b: Node): boolean {
  let n = a.nextSibling
  while (n && n !== b) {
    if (n.nodeType === Node.ELEMENT_NODE) return false
    if (n.nodeType === Node.TEXT_NODE && n.nodeValue?.trim()) return false
    n = n.nextSibling
  }
  return n === b
}

function canMergeElement(el: Element): boolean {
  if (el.matches(SKIP_SELECTOR)) return false
  if (el.querySelector(BLOCK_CHILD_SELECTOR)) return false
  const align = el.getAttribute('align')
  if (align === 'center' || align === 'right') return false
  return true
}

function firstTextNode(root: Node): Text | null {
  const walker = root.ownerDocument!.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  return walker.nextNode() as Text | null
}

function lastTextNode(root: Node): Text | null {
  const walker = root.ownerDocument!.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let last: Text | null = null
  let cur: Node | null
  while ((cur = walker.nextNode())) last = cur as Text
  return last
}

function mergeInto(target: Element, source: Element) {
  const lastNode = lastTextNode(target)
  const firstNode = firstTextNode(source)
  if (lastNode?.nodeValue && firstNode?.nodeValue) {
    const trimmedRight = lastNode.nodeValue.replace(/[ \t\r\n]+$/, '')
    const trimmedLeft = firstNode.nodeValue.replace(/^[ \t\r\n]+/, '')
    const lastChar = trimmedRight.at(-1) ?? ''
    const firstChar = trimmedLeft[0] ?? ''
    // Keep a space only when joining Latin words or an English comma before a word/number
    const needSpace =
      (/[A-Za-z]/.test(lastChar) && /[A-Za-z]/.test(firstChar)) ||
      (lastChar === ',' && /[A-Za-z0-9]/.test(firstChar) && /[A-Za-z]/.test(trimmedRight.at(-2) ?? ''))
    lastNode.nodeValue = trimmedRight + (needSpace ? ' ' : '')
    firstNode.nodeValue = trimmedLeft
  }

  // Preserve anchor ID so TOC / internal links still resolve to the exact spot
  if (source.id) {
    const anchor = target.ownerDocument.createElement('span')
    anchor.id = source.id
    target.append(anchor)
  }

  while (source.firstChild) target.append(source.firstChild)
  source.remove()
  target.normalize()
}

function mergeBrokenParagraphs(doc: Document) {
  const body = doc.body
  if (!body) return

  // 1. Merge adjacent <p>+<p>, <li>+<li>, and <ol>/<ul> last <li>+<p>
  for (const node of Array.from(body.querySelectorAll('p, li, ol, ul'))) {
    if (!node.isConnected) continue
    const tag = node.tagName.toUpperCase()
    if (tag === 'P' || tag === 'LI') {
      while (canMergeElement(node)) {
        const next = node.nextElementSibling
        if (!next || next.tagName.toUpperCase() !== tag) break
        if (!onlyWhitespaceBetween(node, next) || !canMergeElement(next)) break
        const raw1 = node.textContent ?? ''
        const raw2 = next.textContent ?? ''
        const sameClass = node.className === next.className
        if (!shouldMergeText(raw1.trim(), raw2.trim(), raw1, raw2, sameClass)) break
        mergeInto(node, next)
      }
    } else if (tag === 'OL' || tag === 'UL') {
      const lastLi = node.lastElementChild
      if (lastLi && lastLi.tagName.toUpperCase() === 'LI' && canMergeElement(lastLi)) {
        while (true) {
          const next = node.nextElementSibling
          if (!next || next.tagName.toUpperCase() !== 'P') break
          if (!onlyWhitespaceBetween(node, next) || !canMergeElement(next)) break
          const raw1 = lastLi.textContent ?? ''
          const raw2 = next.textContent ?? ''
          if (!shouldMergeText(raw1.trim(), raw2.trim(), raw1, raw2, true)) break
          mergeInto(lastLi, next)
        }
      }
    }
  }

  // 2. Clean up mid-sentence <br> tags inside <p>
  for (const p of body.querySelectorAll('p')) {
    if (!p.querySelector('br') || !canMergeElement(p)) continue
    for (const br of Array.from(p.querySelectorAll('br'))) {
      const prev = br.previousSibling
      const next = br.nextSibling
      if (!prev || !next) continue
      const raw1 = prev.textContent ?? ''
      const raw2 = next.textContent ?? ''
      if (shouldMergeText(raw1.trim(), raw2.trim(), raw1, raw2, true)) {
        br.remove()
      }
    }
    p.normalize()
  }
}

function collectTextNodes(root: Element): Text[] {
  const nodes: Text[] = []
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      let cur = node.parentElement
      while (cur && cur !== root) {
        if (SKIP_TAGS.has(cur.tagName.toUpperCase()) || cur.matches?.(SKIP_SELECTOR)) {
          return NodeFilter.FILTER_REJECT
        }
        cur = cur.parentElement
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })
  let n: Node | null
  while ((n = walker.nextNode())) nodes.push(n as Text)
  return nodes
}

/**
 * Index-preserving transformation over a character array of length `s.length`.
 * Each pass updates `chars[i]` in place; space deletions set `chars[i] = ''`
 * at the very end so multi-node slices stay aligned with original offsets.
 */
function transformChineseChars(s: string): string[] | null {
  if (!isChineseProseContext(s)) return null
  const chars = s.split('')
  let changed = false

  const setChar = (i: number, c: string) => {
    if (chars[i] !== c) {
      chars[i] = c
      changed = true
    }
  }

  // 1. Parentheses `(...)` -> `（...）`
  const parenRe = /([ \t]*)\(([^()\n]{1,200})\)([ \t]*)/g
  for (const m of s.matchAll(parenRe)) {
    const start = m.index!
    const preSp = m[1]
    const inner = m[2]
    const postSp = m[3]
    const openIdx = start + preSp.length
    const closeIdx = openIdx + 1 + inner.length
    const end = closeIdx + 1 + postSp.length

    const charBefore = start > 0 ? s[start - 1] : ''
    const charAfter = end < s.length ? s[end] : ''
    const hasCjkInside = CJK_RE.test(inner)
    const cjkBefore = CJK_OR_PUNCT_BEFORE_RE.test(charBefore)
    const cjkAfter = CJK_OR_PUNCT_AFTER_RE.test(charAfter)

    if (!hasCjkInside && !cjkBefore && !cjkAfter) continue
    if (!hasCjkInside) {
      // Skip function-like calls `f(x)` or short markers `(1)`, `(a)`
      if (!preSp && /[A-Za-z0-9_]/.test(charBefore)) continue
      if (/^[0-9a-zA-Z]{1,2}$/.test(inner.trim())) continue
    }
    setChar(openIdx, '（')
    setChar(closeIdx, '）')
  }

  // 2. Double quotes: “ ” "
  const dqIndices: number[] = []
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]
    if (c === '“' || c === '”' || c === '"') dqIndices.push(i)
  }
  if (dqIndices.length > 0) {
    if (dqIndices.length % 2 === 0) {
      dqIndices.forEach((pos, idx) => setChar(pos, idx % 2 === 0 ? '“' : '”'))
    } else {
      const cur = chars.join('')
      for (const m of cur.matchAll(/[”"]([^“”"。！？；\n]{1,35})[”"]/g)) {
        const i1 = m.index!
        const i2 = i1 + m[0].length - 1
        setChar(i1, '“')
        setChar(i2, '”')
      }
    }
  }

  // 3. Single quotes: ‘ ’ ' (excluding apostrophes inside English words like Lord's, kath'holou)
  const sqIndices: number[] = []
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]
    if (c === '‘' || c === '’' || c === "'") {
      const prev = i > 0 ? chars[i - 1] : ''
      const next = i + 1 < chars.length ? chars[i + 1] : ''
      if (/[A-Za-z0-9]/.test(prev) && /[A-Za-z0-9]/.test(next)) continue
      sqIndices.push(i)
    }
  }
  if (sqIndices.length > 0 && sqIndices.length % 2 === 0) {
    sqIndices.forEach((pos, idx) => setChar(pos, idx % 2 === 0 ? '‘' : '’'))
  }

  // Current string after paren & quote normalization (same length as `s`)
  const cur = chars.join('')

  // Helper to find nearest non-space character before/after index
  const prevNonSpace = (idx: number): string => {
    for (let i = idx - 1; i >= 0; i--) {
      if (cur[i] !== ' ' && cur[i] !== '\t') return cur[i]
    }
    return ''
  }
  const nextNonSpace = (idx: number): string => {
    for (let i = idx + 1; i < cur.length; i++) {
      if (cur[i] !== ' ' && cur[i] !== '\t') return cur[i]
    }
    return ''
  }

  // 4. Comma `,` -> `，`
  for (let i = 0; i < cur.length; i++) {
    if (cur[i] !== ',') continue
    const left = prevNonSpace(i)
    const right = nextNonSpace(i)
    if (CJK_CLOSE_OR_HAN_RE.test(left) || CJK_OPEN_OR_HAN_RE.test(right)) {
      setChar(i, '，')
    } else if (/^[ \t]*\d+(?:[—–-]\s*约?\s*\d+)?\s*年/.test(cur.slice(i + 1))) {
      // e.g. `（Isaac Newton, 1643—1727年）`
      setChar(i, '，')
    }
  }

  // 5. Semicolon `;` -> `；`
  for (let i = 0; i < cur.length; i++) {
    if (cur[i] !== ';') continue
    const left = prevNonSpace(i)
    const right = nextNonSpace(i)
    if (CJK_CLOSE_OR_HAN_RE.test(left) || CJK_OPEN_OR_HAN_RE.test(right)) {
      setChar(i, '；')
    }
  }

  // 6. Colon `:` -> `：`
  for (let i = 0; i < cur.length; i++) {
    if (cur[i] !== ':') continue
    const left = prevNonSpace(i)
    const right = nextNonSpace(i)
    if (CJK_CLOSE_OR_HAN_RE.test(left)) {
      setChar(i, '：')
    } else if (!/[A-Za-z0-9]/.test(left) && CJK_OPEN_OR_HAN_RE.test(right)) {
      setChar(i, '：')
    }
  }

  // 7. `?` -> `？` and `!` -> `！`
  for (let i = 0; i < cur.length; i++) {
    const c = cur[i]
    if (c !== '?' && c !== '!') continue
    const left = prevNonSpace(i)
    if (CJK_CLOSE_OR_HAN_RE.test(left)) {
      setChar(i, c === '?' ? '？' : '！')
    }
  }

  // 8. Period `.` -> `。` and `...` -> `……`
  for (const m of cur.matchAll(/\.{3,}/g)) {
    const start = m.index!
    const len = m[0].length
    const left = start > 0 ? cur[start - 1] : ''
    const right = start + len < cur.length ? cur[start + len] : ''
    if (CJK_CLOSE_OR_HAN_RE.test(left) || CJK_OPEN_OR_HAN_RE.test(right)) {
      setChar(start, '…')
      setChar(start + 1, '…')
      for (let k = start + 2; k < start + len; k++) setChar(k, '')
    }
  }
  for (let i = 0; i < cur.length; i++) {
    if (chars[i] !== '.') continue
    const left = cur[i - 1] ?? ''
    const right = cur[i + 1] ?? ''
    if (!CJK_RE.test(left)) continue
    if (/[A-Za-z0-9.]/.test(right)) continue
    // Don't convert leading list marker like `一.` at start of paragraph
    if (i <= 2 && /^[一二三四五六七八九十]$/.test( cur.slice(0, i).trim())) continue
    if (!right || /\s/.test(right) || CJK_OPEN_OR_HAN_RE.test(right) || right === '”' || right === '’') {
      setChar(i, '。')
    }
  }

  // 9. Remove redundant ASCII spaces adjacent to fullwidth Chinese punctuation
  const FULLWIDTH_PUNCT_RE = /[，。；：！？、“”‘’（）《》【】「」『』]/
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] !== ' ' && chars[i] !== '\t') continue
    // Find nearest remaining non-space char to the left and right
    let l = ''
    for (let j = i - 1; j >= 0; j--) {
      if (chars[j] !== '' && chars[j] !== ' ' && chars[j] !== '\t') {
        l = chars[j]
        break
      }
    }
    let r = ''
    for (let j = i + 1; j < chars.length; j++) {
      if (chars[j] !== '' && chars[j] !== ' ' && chars[j] !== '\t') {
        r = chars[j]
        break
      }
    }
    // Space right inside `（ ` or ` ）`
    if (l === '（' || r === '）') {
      setChar(i, '')
      continue
    }
    // Space between fullwidth punct and CJK/fullwidth punct
    if (
      (FULLWIDTH_PUNCT_RE.test(l) && (CJK_RE.test(r) || FULLWIDTH_PUNCT_RE.test(r))) ||
      (FULLWIDTH_PUNCT_RE.test(r) && (CJK_RE.test(l) || FULLWIDTH_PUNCT_RE.test(l)))
    ) {
      setChar(i, '')
      continue
    }
    // Space after `，`/`：` before digits/Latin (e.g. `例如, 17 世纪` -> `例如，17 世纪`, `里程碑: 历史` -> `里程碑：历史`)
    if (/[，；：！？。、]/.test(l)) {
      setChar(i, '')
    }
  }

  return changed ? chars : null
}

function fixBlockPunctuation(block: Element) {
  if (block.matches(SKIP_SELECTOR)) return
  const nodes = collectTextNodes(block)
  if (!nodes.length) return

  let full = ''
  const ranges: [number, number][] = []
  for (const n of nodes) {
    const val = n.nodeValue ?? ''
    const start = full.length
    full += val
    ranges.push([start, full.length])
  }

  const chars = transformChineseChars(full)
  if (chars) {
    for (let i = 0; i < nodes.length; i++) {
      const [a, b] = ranges[i]
      const next = chars.slice(a, b).join('')
      if (nodes[i].nodeValue !== next) nodes[i].nodeValue = next
    }
  }

  // Fix bogus `lang="en"` from Word/Calibre exports on Chinese blocks so Chromium
  // applies proper CJK punctuation trimming and glyph shaping.
  if (isChineseProseContext(full)) {
    if (block.getAttribute('lang')?.toLowerCase().startsWith('en')) {
      block.removeAttribute('lang')
    }
    for (const span of block.querySelectorAll('[lang^="en" i]')) {
      if (CJK_RE.test(span.textContent ?? '')) span.removeAttribute('lang')
    }
  }
}

const BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, dd, dt'

export function repairCJKDocument(doc: Document) {
  if (!doc.body) return
  mergeBrokenParagraphs(doc)
  for (const block of doc.body.querySelectorAll(BLOCK_SELECTOR)) {
    // Skip outer blocks that wrap inner blocks to avoid processing twice
    if (block.querySelector(BLOCK_SELECTOR)) continue
    fixBlockPunctuation(block)
  }
}
