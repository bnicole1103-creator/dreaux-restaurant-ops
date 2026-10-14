import {calendarLook,type CalendarLook} from './calendarLook'
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
export function postStyle(p?: {accent?:PostColor;design?:CalendarLook}): CSSProperties {
  const color = postColors[p?.accent ?? 'tan'] ?? postColors.tan
  if(p?.design){const look=calendarLook(p.design);return {...look,border:look['--calendar-outline' as keyof CSSProperties] as string,borderRadius:p.design.template==='editorial'?'0':p.design.template==='playful'?'30px':'16px',boxShadow:p.design.template==='playful'?'6px 6px 0 '+p.design.color+'30':'0 6px 24px #49302409',background:p.design.paper??'#fff8ef'}}
  return {borderTop: '5px solid '+color.ink, background:color.tint}
}
