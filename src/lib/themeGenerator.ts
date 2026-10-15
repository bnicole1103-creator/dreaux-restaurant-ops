import {type DecalSettings,decalValues} from './decals'
import {calendarThemes,type CalendarThemeId} from './calendarThemes'
import {themePreset,readableInk,type ThemeTokens} from './appTheme'
import type {FontName} from './appearance'
import type {CalendarLook} from './calendarLook'
export const generatorCollections=[...new Set(calendarThemes.map(t=>t.category))]
export type GeneratorOptions=DecalSettings&{collection:string;description:string;mood:'soft'|'rich'|'night';accent?:string;paper?:string;titleFont?:FontName;bodyFont:FontName;decoration:boolean;outline:NonNullable<CalendarLook['outline']>;radius:number}
export type GeneratedTheme={id:string;name:string;tokens:ThemeTokens;calendar:CalendarLook;matchedCollection:string}
const words:Record<string,string[]>={
 'Botanical & Floral':['floral','flower','garden','botanical','rose','bloom'],
 'Social & Style':['social','style','pink','blush','bow','coquette','cherry'],
 'Nightlife & Lounge':['nightlife','lounge','disco','midnight','cocktail'],
 'Editorial & Luxe':['luxe','luxury','editorial','champagne','pearl'],
 'Vintage & Heritage':['vintage','heritage','cabin','antique','retro'],
 'Modern Minimal':['minimal','modern','clean','monochrome'],
 'Coastal & Tropical':['coastal','tropical','beach','ocean','citrus','summer'],
 'Seasons & Weather':['season','autumn','fall','spring','winter','rain','terracotta'],
 'Holidays':['holiday','halloween','christmas','valentine','easter','thanksgiving'],
 'Sports & Clubhouse':['sports','football','basketball','tennis','baseball','clubhouse'],
 'New Orleans':['new orleans','mardi gras','black and gold','saints']
}
export function matchCollection(description:string,fallback:string):string{
 const text=description.toLowerCase();let best=fallback,score=0
 for(const [collection,terms] of Object.entries(words)){const n=terms.reduce((v,w)=>v+(text.includes(w)?w.split(' ').length:0),0);if(n>score){score=n;best=collection}}
 return best
}
export function mixColor(a:string,b:string,amount:number):string{
 return '#'+[1,3,5].map(i=>Math.round(parseInt(a.slice(i,i+2),16)*(1-amount)+parseInt(b.slice(i,i+2),16)*amount).toString(16).padStart(2,'0')).join('')
}
export function contrastRatio(a:string,b:string):number{
 const lum=(hex:string)=>[1,3,5].reduce((sum,i,j)=>{const c=parseInt(hex.slice(i,i+2),16)/255;return sum+(c<=.04045?c/12.92:((c+.055)/1.055)**2.4)*[.2126,.7152,.0722][j]},0)
 const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)
}
export function safeInk(background:string):string{
 const chosen=contrastRatio('#302c29',background)>contrastRatio('#fffaf4',background)?'#302c29':'#fffaf4'
 return contrastRatio(chosen,background)>=4.5?chosen:contrastRatio('#000000',background)>contrastRatio('#ffffff',background)?'#000000':'#ffffff'
}
function secondaryInk(ink:string,paper:string,card:string):string{
 for(let amount=.22;amount>=0;amount-=.02){const candidate=mixColor(ink,paper,amount);if(Math.min(contrastRatio(candidate,paper),contrastRatio(candidate,card))>=4.5)return candidate}
 return ink
}
export function generateThemes(o:GeneratorOptions,round=0):GeneratedTheme[]{
 const decoration=decalValues(o)
 const collection=matchCollection(o.description,o.collection),pool=calendarThemes.filter(t=>t.category===collection),seeds=pool.length?pool:calendarThemes
 const text=o.description.toLowerCase(),night=o.mood==='night'||/\b(dark|noir|after dark)\b/.test(text)
 const inferredFont=/\b(script|cursive)\b/.test(text)?'allura':/\b(serif|editorial)\b/.test(text)?'editorial':undefined
 return Array.from({length:3},(_,i)=>{
  const seed=seeds[(round+i)%seeds.length],base=themePreset(seed.id),weight=[.08,.2,.34][i]+(round%5)*.025
  const accent=o.accent??mixColor(base.accent,o.mood==='rich'?'#33292b':'#8d7763',weight)
  const paper=o.paper??(night?mixColor('#25242b',base.accent,.035+i*.025):mixColor(base.background,'#fffaf3',.22+i*.17+(round%4)*.025))
  const ink=safeInk(paper),dark=ink==='#fffaf4'||ink==='#ffffff',candidateCard=dark?mixColor(paper,'#ffffff',.055):mixColor(paper,'#ffffff',.7),card=contrastRatio(ink,candidateCard)>=4.5?candidateCard:paper
  const tokens:ThemeTokens={...base,background:paper,card,text:ink,muted:secondaryInk(ink,paper,card),accent,accentText:safeInk(accent),border:mixColor(paper,ink,.17),titleFont:o.titleFont??inferredFont??base.titleFont,font:o.bodyFont,headingFont:'system',labelFont:'system',buttonFont:'system',radius:o.radius,borderWidth:o.outline==='none'?0:1,shadow:i===1?'none':'soft',surface:'solid',art:o.decoration?seed.id:'none',decal:decoration.decal,decalPlacement:o.decoration?decoration.decalPlacement:'off',decalSize:decoration.decalSize,decalOpacity:decoration.decalOpacity}
  const layout:CalendarLook['template']=o.decoration?seed.id as CalendarThemeId:(['editorial','minimal','poster'] as const)[i]
  const calendar:CalendarLook={color:accent,paper,font:tokens.titleFont,template:layout,outline:o.outline,decal:decoration.decal,decalPlacement:o.decoration?decoration.decalPlacement:'off',decalSize:decoration.decalSize,decalOpacity:decoration.decalOpacity}
  return {id:seed.id+'-'+round+'-'+i,name:seed.label+' · '+['Quiet','Editorial','Signature'][i],tokens,calendar,matchedCollection:collection}
 })
}
export const defaultGeneratorOptions:GeneratorOptions={collection:'Botanical & Floral',description:'',mood:'soft',bodyFont:'system',decoration:false,outline:'thin',radius:12}
