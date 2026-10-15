import {decalBand,decalPositions,decalSvg,decalValues,type DecalSettings} from './decals'
import {themeFor,motifSvg,compositionFor,type CalendarThemeId} from './calendarThemes'
import type {CSSProperties} from 'react'
import {appFonts,type FontName} from './appearance'
export type CalendarLook=DecalSettings&{color:string;font:FontName;template?:CalendarThemeId|'poster'|'editorial'|'playful'|'minimal'|'ledger'|'scrapbook'|'spotlight'|'deco'|'polaroid'|'blocks'|'planner';outline?:'thin'|'double'|'dashed'|'none';paper?:string}
export const defaultCalendarLook:CalendarLook={color:'#cc4b84',font:'script',template:'poster',outline:'double',paper:'#fff8ef'}
export const calendarPalettes={Pumpkin:'#d56b24',Pink:'#cc4b84',Lilac:'#8d69c1',Sage:'#4d8367',Ocean:'#347e9c',Espresso:'#795232'}
export function calendarLook(value?:CalendarLook):CSSProperties{
 const color=/^#[0-9a-fA-F]{6}$/.test(value?.color??'')?value!.color:defaultCalendarLook.color
 const paper=/^#[0-9a-fA-F]{6}$/.test(value?.paper??'')?value!.paper!:defaultCalendarLook.paper!
 const light=[1,3,5].map(i=>parseInt(paper.slice(i,i+2),16)/255);const ink=.2126*light[0]+.7152*light[1]+.0722*light[2]>.45?'#35251f':'#fff8ef'
 const outline=value?.outline??'double'
 const theme=themeFor(value?.template)
 const composition=compositionFor(value?.template)
 const accentLight=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255)
 const heroInk=composition==='ribbon'?(accentLight.reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0)>.5?'#25251f':'#ffffff'):ink
 const artColor=composition==='ribbon'?heroInk:color
 const d=decalValues(value??{}),svg=decalSvg(d.decal,artColor,value?.template,d.decalOpacity)
 const art=svg?'url("data:image/svg+xml,'+encodeURIComponent(svg)+'")':'none'

 return {'--calendar-decal-band':decalBand(value??{},artColor,value?.template),'--calendar-decal-positions':decalPositions(value??{}),'--calendar-decal-size':d.decalSize+'px','--calendar-decal-height':decalBand(value??{},artColor,value?.template)==='none'?'0px':(d.decalSize+16)+'px','--calendar-hero-ink':heroInk,'--calendar-art':art,'--calendar-color':color,'--calendar-tint':color+'16','--calendar-paper':paper,'--calendar-ink':ink,'--calendar-font':appFonts[value?.font??defaultCalendarLook.font]?.css??appFonts.script.css,'--calendar-outline':outline==='none'?'0':outline==='double'?'4px double '+color:outline==='dashed'?'2px dashed '+color:'1px solid '+color} as CSSProperties
}
