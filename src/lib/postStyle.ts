import type { CSSProperties } from 'react'
export const postColors = {
  brown: { label: 'Espresso brown', ink: '#493024', tint: '#eee1d5' },
  tan: { label: 'Warm tan', ink: '#795232', tint: '#f5eadc' },
  rose: { label: 'Rose', ink: '#9b3559', tint: '#fbe8ed' },
  plum: { label: 'Plum', ink: '#703b80', tint: '#f2e8f6' },
  green: { label: 'Forest green', ink: '#28603c', tint: '#e9f4ec' },
  orange: { label: 'Burnt orange', ink: '#9d421f', tint: '#fff0e5' },
} as const
export type PostColor = keyof typeof postColors
export function postStyle(p?: {accent?:PostColor}): CSSProperties {
  const color = postColors[p?.accent ?? 'tan'] ?? postColors.tan
  return {borderTop: '5px solid '+color.ink, background:color.tint}
}
