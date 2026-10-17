import type {CSSProperties} from 'react'
import {decalSvg,decalBank,type DecalSettings} from './decals'
export const backgroundPatterns=['none','scatter','grid','diagonal','pinstripe','dots','checker','scallop'] as const
export function backgroundSettings(v:DecalSettings):Required<Pick<DecalSettings,'backgroundPattern'|'backgroundDecal'|'backgroundOpacity'|'backgroundScale'|'backgroundRotation'|'backgroundColor'>> {
 const bounded=(n:number|undefined,fallback:number,min:number,max:number)=>Math.max(min,Math.min(max,Number.isFinite(n)?n!:fallback))
 return {backgroundPattern:backgroundPatterns.includes(v.backgroundPattern!)?v.backgroundPattern!:'none',backgroundDecal:v.backgroundDecal??'theme',backgroundOpacity:bounded(v.backgroundOpacity,.12,0,1),backgroundScale:bounded(v.backgroundScale,220,80,360),backgroundRotation:bounded(v.backgroundRotation,0,-45,45),backgroundColor:/^#[a-f\d]{6}$/i.test(v.backgroundColor??'')?v.backgroundColor!:'#795232'}
}
const escapeSvg=(s:string)=>s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
export function backgroundSvg(value:DecalSettings,fallback?:string):string|null {
 const d=backgroundSettings(value),color=d.backgroundColor
 if(d.backgroundPattern==='none'||d.backgroundOpacity===0)return null
 const art=decalSvg(d.backgroundDecal,color,fallback,1)
 const stamp=(x:number,y:number,size:number,angle:number)=>art?'<image x="'+x+'" y="'+y+'" width="'+size+'" height="'+size+'" transform="rotate('+(angle+d.backgroundRotation)+' '+(x+size/2)+' '+(y+size/2)+')" href="data:image/svg+xml,'+escapeSvg(encodeURIComponent(art))+'"/>':''
 let marks=''
 if(d.backgroundPattern==='scatter')marks=stamp(22,20,64,-14)+stamp(149,123,60,18)+stamp(28,164,34,8)+stamp(166,32,27,-10)
 if(d.backgroundPattern==='grid')marks=stamp(27,27,66,0)+stamp(147,147,66,0)
 if(d.backgroundPattern==='diagonal')marks=stamp(10,10,52,-22)+stamp(92,92,52,-22)+stamp(174,174,52,-22)
 if(d.backgroundPattern==='pinstripe')marks='<path d="M15 0V240M21 0V240M95 0V240M101 0V240M175 0V240M181 0V240" stroke="'+color+'" stroke-width="1"/>'
 if(d.backgroundPattern==='dots')marks=[30,110,190].flatMap(x=>[30,110,190].map(y=>'<circle cx="'+x+'" cy="'+y+'" r="3" fill="'+color+'"/>')).join('')
 if(d.backgroundPattern==='checker')marks='<path d="M0 0H60V60H0ZM120 0H180V60H120ZM60 60H120V120H60ZM180 60H240V120H180ZM0 120H60V180H0ZM120 120H180V180H120ZM60 180H120V240H60ZM180 180H240V240H180Z" fill="'+color+'"/>'
 if(d.backgroundPattern==='scallop')marks=Array.from({length:5},(_,j)=>Array.from({length:5},(_,i)=>'<path d="M'+(i*60-30)+' '+(j*60-30)+'q30 60 60 0" fill="none" stroke="'+color+'" stroke-width="1.5"/>').join('')).join('')
 if(!marks)return null
 const turn=['pinstripe','dots','checker','scallop'].includes(d.backgroundPattern)?d.backgroundRotation:0
 return '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240"><g opacity="'+d.backgroundOpacity+'" transform="rotate('+turn+' 120 120)">'+marks+'</g></svg>'
}
export function backgroundImage(value:DecalSettings,fallback?:string):string {
 const svg=backgroundSvg(value,fallback);return svg?'url("data:image/svg+xml,'+encodeURIComponent(svg)+'")':'none'
}
export type BackgroundPreset={name:string;collection:string;details:DecalSettings}
const recipe=(name:string,collection:string,backgroundDecal:string,backgroundColor:string,backgroundPattern:NonNullable<DecalSettings['backgroundPattern']>='scatter',backgroundOpacity=.16,backgroundScale=220):BackgroundPreset=>({name,collection,details:{backgroundDecal,backgroundColor,backgroundPattern,backgroundOpacity,backgroundScale,backgroundRotation:0}})
export const backgroundPresets:BackgroundPreset[]=[
 recipe('Martini Hour','Cocktail Lounge','martini','#697353'),recipe('Champagne Suite','Cocktail Lounge','coupe','#9b8052'),recipe('Whiskey & Walnut','Cocktail Lounge','whiskey','#826348','grid'),recipe('Shaken, Not Stirred','Cocktail Lounge','shaker','#667888','diagonal'),
 recipe('Magnolia House','Botanical','magnolia','#727d62','scatter',.18,300),recipe('Orchid Atelier','Botanical','orchid','#926579','diagonal',.16,300),recipe('Rosewater','Botanical','rose','#ad7786'),recipe('Palm Conservatory','Botanical','palm','#486e63','grid',.16,300),
 recipe('Silk & Pearls','Atelier','ribbon','#9f7894'),recipe('Lipstick Lounge','Atelier','lipstick','#9b4359','diagonal'),recipe('After-Dark Heels','Atelier','heels','#8c738b','scatter',.16,260),recipe('Boutique Weekend','Atelier','handbag','#977254','grid'),
 recipe('Record Room','Music & Nightlife','vinyl','#706785'),recipe('Mirrorball Social','Music & Nightlife','disco-ball','#918199','diagonal'),recipe('Listening Bar','Music & Nightlife','headphones','#637386','grid'),recipe('Black Tie','Heritage','bowtie','#686970','grid',.16,260),
 recipe('Sunday Football','Sports & Clubhouse','football','#82734d','diagonal'),recipe('Courtside Club','Sports & Clubhouse','basketball-line','#ae724f'),recipe('Tennis Whites','Sports & Clubhouse','tennis','#6d8056','grid'),recipe('Golf Club','Sports & Clubhouse','golf','#6d8056','diagonal'),
 recipe('Oyster Social','New Orleans','oyster','#7d8686','scatter',.18,260),recipe('Boil & Brass','New Orleans','crawfish','#a25d4b','diagonal'),recipe('Fleur de Nuit','New Orleans','fleurs','#978259','grid'),recipe('Carnival Afterglow','New Orleans','beads','#836d91'),
 recipe('Harvest Table','Seasons & Holidays','maple','#ae754e'),recipe('Holiday Soirée','Seasons & Holidays','ornament','#8b585f','grid'),recipe('Winter Starlight','Seasons & Holidays','snow','#7a929d','diagonal'),recipe('Love Letter','Seasons & Holidays','heart','#a46c7c'),
 recipe('Cabana Stripe','Textures','palm','#6a8b7a','pinstripe',.14),recipe('Café Check','Textures','none','#a68b70','checker',.07),recipe('Pearl Dot','Textures','none','#927f86','dots',.19,160),recipe('Riviera Scallop','Textures','shell','#708b94','scallop',.13,180)
]

export function safeBackground(value:unknown):DecalSettings|undefined {
 if(!value||typeof value!=='object'||Array.isArray(value))return undefined
 const input=value as DecalSettings,d=backgroundSettings(input)
 if(!['theme','none',...decalBank.map(i=>i.id)].includes(d.backgroundDecal))d.backgroundDecal='none'
 return d
}
export function wallpaperStyle(value:unknown,fallback?:string):CSSProperties {
 const d=safeBackground(value);return d?{backgroundImage:backgroundImage(d,fallback),backgroundSize:d.backgroundScale+'px',backgroundRepeat:'repeat'}:{}
}
