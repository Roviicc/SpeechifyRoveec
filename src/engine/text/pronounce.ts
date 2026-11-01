import type { PronunciationEntry, Replacement } from './types'

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Compile a dictionary into one case-insensitive whole-word regex (longest words first). */
export function compileDictionary(entries: PronunciationEntry[]): { re: RegExp; map: Map<string, string> } | null {
  const clean = entries.map((e) => ({ word: e.word.trim(), say: e.say.trim() })).filter((e) => e.word)
  if (!clean.length) return null
  const map = new Map(clean.map((e) => [e.word.toLowerCase(), e.say]))
  const alts = [...map.keys()].sort((a, b) => b.length - a.length).map(escapeRe)
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts.join('|')})(?![\\p{L}\\p{N}])`, 'giu')
  return { re, map }
}

export function findPronunciations(
  text: string,
  dict: ReturnType<typeof compileDictionary>,
): Replacement[] {
  if (!dict) return []
  const out: Replacement[] = []
  dict.re.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = dict.re.exec(text))) {
    const say = dict.map.get(m[0].toLowerCase())
    if (say !== undefined) out.push({ start: m.index, end: m.index + m[0].length, say, kind: 'pronunciation' })
  }
  return out
}
