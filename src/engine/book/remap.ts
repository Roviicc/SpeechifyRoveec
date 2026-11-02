import type { BookDoc } from './types'

/** {section, block (global block index), offset} — same shape as the data layer's Locator. */
export interface DocLocator {
  section: number
  block: number
  offset: number
}

function sectionStarts(doc: BookDoc): number[] {
  const starts: number[] = []
  let n = 0
  for (const s of doc.sections) {
    starts.push(n)
    n += s.blocks.length
  }
  starts.push(n)
  return starts
}

/** Find `needle` in the blocks of `section` of `doc`; returns [blockInSection, index] of the first match. */
function findIn(doc: BookDoc, section: number, needle: string): [number, number] | null {
  const blocks = doc.sections[section]?.blocks ?? []
  for (let b = 0; b < blocks.length; b++) {
    const i = blocks[b].text.indexOf(needle)
    if (i >= 0) return [b, i]
  }
  return null
}

/**
 * Map a position in a re-parsed document. Block numbers can shift when the parser changes (PDF
 * column order, new skip blocks), but sections (pages) stay the same, so the old position is looked
 * up by the text around it inside the same section. `end` = the locator is an exclusive end (match
 * the text before it first). Falls back to the start of the same section.
 */
export function remapLocator(oldDoc: BookDoc, newDoc: BookDoc, loc: DocLocator, end = false): DocLocator {
  const newStarts = sectionStarts(newDoc)
  const lastSection = Math.max(0, newDoc.sections.length - 1)
  const section = Math.min(Math.max(0, loc.section), lastSection)
  const fallback = { section, block: Math.min(newStarts[section], Math.max(0, newStarts[newStarts.length - 1] - 1)), offset: 0 }
  const oldStarts = sectionStarts(oldDoc)
  const oldSection = oldDoc.sections[loc.section]
  // the locator must point into its own section of the old document, else we can't trust it
  if (!oldSection || section !== loc.section) return fallback
  const oldBlock = oldSection.blocks[loc.block - oldStarts[loc.section]]
  if (!oldBlock) return fallback
  const text = oldBlock.text
  const offset = Math.min(Math.max(0, loc.offset), text.length)
  const at = (b: number, i: number): DocLocator => ({ section, block: newStarts[section] + b, offset: i })
  const after = (len: number) => {
    const needle = text.slice(offset, offset + len)
    if (needle.trim().length < 4) return null
    const m = findIn(newDoc, section, needle)
    return m ? at(m[0], m[1]) : null
  }
  const before = (len: number) => {
    const needle = text.slice(Math.max(0, offset - len), offset)
    if (needle.trim().length < 4) return null
    const m = findIn(newDoc, section, needle)
    return m ? at(m[0], m[1] + needle.length) : null
  }
  for (const len of [40, 20, 10, 6]) {
    const r = end ? (before(len) ?? after(len)) : (after(len) ?? before(len))
    if (r) return r
  }
  // at least the paragraph: its first words
  const head = text.slice(0, 30)
  const m = head.trim().length >= 4 ? findIn(newDoc, section, head) : null
  return m ? at(m[0], m[1]) : fallback
}

/** Map a highlighted range; `text` (the highlighted text) is used to keep the exact extent when possible. */
export function remapRange(oldDoc: BookDoc, newDoc: BookDoc, start: DocLocator, end: DocLocator, text: string): { start: DocLocator; end: DocLocator } {
  const s = remapLocator(oldDoc, newDoc, start)
  const starts = sectionStarts(newDoc)
  const block = newDoc.sections[s.section]?.blocks[s.block - starts[s.section]]
  if (text && block && block.text.slice(s.offset, s.offset + text.length) === text) return { start: s, end: { ...s, offset: s.offset + text.length } }
  if (text.trim().length >= 4) {
    // the highlighted text itself, nearest to where the start mapped
    let best: DocLocator | null = null
    let bestCost = Infinity
    newDoc.sections[s.section]?.blocks.forEach((b, bi) => {
      for (let i = b.text.indexOf(text); i >= 0; i = b.text.indexOf(text, i + 1)) {
        const cost = Math.abs(starts[s.section] + bi - s.block) * 100000 + Math.abs(i - s.offset)
        if (cost < bestCost) {
          bestCost = cost
          best = { section: s.section, block: starts[s.section] + bi, offset: i }
        }
      }
    })
    const found = best as DocLocator | null
    if (found) return { start: found, end: { ...found, offset: found.offset + text.length } }
  }
  const e = remapLocator(oldDoc, newDoc, end, true)
  return { start: s, end: e.block > s.block || (e.block === s.block && e.offset >= s.offset) ? e : { ...s } }
}
