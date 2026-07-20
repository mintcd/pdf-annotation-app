import type { Row } from './engine'

export type HighlightColorRow = Row<'highlight_colors'>

export type HighlightColor = {
  color: string
  semantics: string
}

export const FALLBACK_HIGHLIGHT_COLOR = '#87ceeb'

export const INITIAL_HIGHLIGHT_COLORS: readonly HighlightColor[] = [
  { color: '#87ceeb', semantics: 'Reference' },
  { color: '#90ee90', semantics: 'Confirmed' },
  { color: '#ff6b6b', semantics: 'Concern' },
  { color: '#d3d3d3', semantics: 'Follow-up' },
]

export const SETTINGS_COLOR_GRID = [
  '#fff475',
  '#fbbc04',
  '#f28b82',
  '#ff6b6b',
  '#fdcfe8',
  '#e6c9ff',
  '#cbf0f8',
  '#87ceeb',
  '#aecbfa',
  '#a7ffeb',
  '#90ee90',
  '#ccff90',
  '#d7aefb',
  '#fdd663',
  '#d3d3d3',
  '#b0bec5',
] as const

export function normalizeHexColor(value: string): string | null {
  const raw = value.trim()
  if (!raw) return null

  const withoutHash = raw.startsWith('#') ? raw.slice(1) : raw
  if (/^[0-9a-fA-F]{3}$/.test(withoutHash)) {
    return `#${withoutHash
      .split('')
      .map((character) => `${character}${character}`)
      .join('')}`.toLowerCase()
  }

  if (/^[0-9a-fA-F]{6}$/.test(withoutHash)) {
    return `#${withoutHash}`.toLowerCase()
  }

  return null
}

export function normalizeHighlightColorRow(row: Record<string, unknown>): HighlightColor {
  const color = normalizeHexColor(String(row.color ?? '')) ?? FALLBACK_HIGHLIGHT_COLOR
  const semantics = typeof row.semantics === 'string' ? row.semantics.trim() : ''
  return {
    color,
    semantics: semantics || color,
  }
}

export function highlightColorSemantics(
  colors: readonly HighlightColor[],
  color: string,
): string {
  return colors.find((item) => item.color === color)?.semantics.trim() || color
}
