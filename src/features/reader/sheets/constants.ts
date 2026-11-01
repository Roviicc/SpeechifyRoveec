import type { HighlightColor } from '@/data/db'

export const SPEED_PRESETS = [1, 1.5, 2, 2.5]

export const HIGHLIGHT_COLORS: Array<{ color: HighlightColor; css: string }> = [
  { color: 'yellow', css: 'rgb(250 204 21)' },
  { color: 'green', css: 'rgb(74 222 128)' },
  { color: 'blue', css: 'rgb(96 165 250)' },
  { color: 'pink', css: 'rgb(244 114 182)' },
]
