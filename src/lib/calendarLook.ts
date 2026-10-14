import type {CSSProperties} from 'react'
import {appFonts,type FontName} from './appearance'
export type CalendarLook={color:string;font:FontName}
export const defaultCalendarLook:CalendarLook={color:'#c47743',font:'modern'}
export const calendarPalettes={Pumpkin:'#d56b24',Pink:'#cc4b84',Lilac:'#8d69c1',Sage:'#4d8367',Ocean:'#347e9c',Espresso:'#795232'}
export function calendarLook(value?:CalendarLook):CSSProperties{
 const color=/^#[0-9a-fA-F]{6}$/.test(value?.color??'')?value!.color:defaultCalendarLook.color
 return {'--calendar-color':color,'--calendar-tint':color+'16','--calendar-font':appFonts[value?.font??defaultCalendarLook.font]?.css??appFonts.modern.css} as CSSProperties
}
