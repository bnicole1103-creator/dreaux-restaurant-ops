import type {CSSProperties} from 'react'
export const guideFonts={system:'system-ui, sans-serif',classic:'Georgia, serif',clean:'Arial, sans-serif',mono:'monospace'}
export const guideThemes={cream:{background:'#fff5e8',color:'#432b20',accent:'#9c603b'},midnight:{background:'#161b27',color:'#f3f4f8',accent:'#b7c6ff'},sage:{background:'#eef5ed',color:'#213b2b',accent:'#387b55'},white:{background:'#ffffff',color:'#202020',accent:'#3b63ad'}}
export type GuideStyle={theme:keyof typeof guideThemes;font:keyof typeof guideFonts;layout:'reading'|'cards'|'checklist';background:string;color:string;accent:string;size:number;icon:string}
export const defaultGuideStyle:GuideStyle={theme:'cream',font:'system',layout:'reading',...guideThemes.cream,size:18,icon:'📖'}
export function cleanGuideStyle(raw:unknown):GuideStyle{
 const r=(raw&&typeof raw==='object'?raw:{}) as Partial<GuideStyle>
 const color=(v:unknown,fallback:string)=>typeof v==='string'&&/^#[a-f\d]{6}$/i.test(v)?v:fallback
 return {theme:r.theme&&Object.prototype.hasOwnProperty.call(guideThemes,r.theme)?r.theme:'cream',font:r.font&&Object.prototype.hasOwnProperty.call(guideFonts,r.font)?r.font:'system',layout:['reading','cards','checklist'].includes(r.layout??'')?r.layout!:'reading',background:color(r.background,defaultGuideStyle.background),color:color(r.color,defaultGuideStyle.color),accent:color(r.accent,defaultGuideStyle.accent),size:Math.round(Math.min(28,Math.max(14,Number(r.size)||18))),icon:typeof r.icon==='string'?r.icon.slice(0,12):'📖'}
}
export function guideCSS(raw:unknown):CSSProperties{const p=cleanGuideStyle(raw);return {background:p.background,color:p.color,fontFamily:guideFonts[p.font],fontSize:p.size,'--guide-accent':p.accent} as CSSProperties}
export const guideIcons=['📖','🎬','🍽️','🍷','☕','🛎️','🤝','⭐','✅','⚠️','💵','🧹','🧠','📋','🗣️','🔑']
export const guideVideoBucket='training-guide-videos'
