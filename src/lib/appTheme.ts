import {decalBand,decalPositions,decalSvg,decalValues,type DecalSettings} from './decals'
import {appFonts,type FontName,appearanceVars,type Appearance} from './appearance'
import {calendarThemes,themeFor,motifSvg} from './calendarThemes'
import {accessCatalog,type AccessPage} from './accessCatalog'
export type ThemeTokens=Appearance&DecalSettings&{titleFont:FontName;headingFont:FontName;labelFont:FontName;buttonFont:FontName;radius:number;borderWidth:number;shadow:'none'|'soft'|'lifted';surface:'solid'|'tint'|'stripes'|'gradient';art:string}
export type ThemeConfig={base:ThemeTokens|null;pages:Partial<Record<AccessPage,Partial<ThemeTokens>>>;sections:Record<string,Partial<ThemeTokens>>;presets:{id:string;name:string;tokens:ThemeTokens}[]}
export const emptyTheme:ThemeConfig={base:null,pages:{},sections:{},presets:[]}
export const defaultTokens:ThemeTokens={background:'#f7f1e9',card:'#fff8ef',text:'#493024',muted:'#725e51',accent:'#d7b795',accentText:'#493024',border:'#d4c1b0',font:'system',titleFont:'editorial',headingFont:'system',labelFont:'system',buttonFont:'system',radius:20,borderWidth:1,shadow:'soft',surface:'solid',art:'none',decal:'theme',decalSize:88,decalOpacity:.65,decalPlacement:'corners'}
export const readableInk=(hex:string)=>[1,3,5].reduce((sum,i,j)=>sum+parseInt(hex.slice(i,i+2),16)/255*[.2126,.7152,.0722][j],0)>.5?'#29251f':'#fffaf4'
// Restrained palettes and purpose-specific typography; decoration is opt-in.
export function themePreset(id:string):ThemeTokens{
 const t=themeFor(id);if(!t)return {...defaultTokens}
 const palettes:Record<string,[string,string,string,string]>={
 floral:['#f3eeeb','#fcf9f6','#804454','#ded1d0'],botanical:['#eaece5','#f8f9f3','#385448','#cbd2c7'],
 gameday:['#e9ece5','#f7f8f2','#294336','#c9d0c5'],courtside:['#eee7e0','#faf6ef','#914a32','#d8cabe'],
 coquette:['#f2e9e8','#fff9f6','#8e4c62','#ddc9cd'],disco:['#eae6ee','#faf7fc','#644b7a','#d0c6d9'],
 spring:['#eeeee4','#fcfbf4','#657044','#d5d7c5'],summer:['#e6efed','#f8fbf7','#326b70','#c5d8d4'],
 autumn:['#eee5dc','#fbf6ed','#8a4e31','#d6c4b4'],winter:['#e9edf0','#fbfcfd','#496376','#cbd5dc'],
 halloween:['#292725','#35312e','#d6a078','#554a41'],christmas:['#eee9e0','#fcf9f1','#753c43','#d8ccbe'],
 valentine:['#eee4e4','#fff8f5','#9a3f58','#ddc6cb'],mardigras:['#eae5ed','#fbf8f3','#634b78','#d2c6d9'],
 roseatelier:['#eee5e1','#fff9f4','#8c4c58','#d7c6c1'],daisydays:['#eeebdf','#fcfaf1','#777343','#d7d1bd'],
 wildflower:['#ebe7e4','#faf7f2','#716178','#cfc6cd'],blackgold:['#1e211f','#292d29','#c0a36c','#47493e'],
 matchpoint:['#e8eadd','#fafaf0','#395b46','#c8cdb6'],clubhouse:['#e8e9e5','#f9f8f1','#354c65','#c8cdd0'],
 cherryclub:['#eee4df','#fff8f1','#943d4d','#dbc5bd'],pearlribbon:['#ece8ed','#fdf9fb','#796183','#d5cbd8'],
 champagnesocial:['#eee8dc','#fffaf0','#806c47','#d7cbb7'],midnightmuse:['#24232c','#302e39','#c1accd','#514b5b'],
 citruscoast:['#eee8da','#fffaf0','#a6623c','#dbccb6'],goldenhour:['#eee1d5','#fff6eb','#956343','#d8c1aa'],
 cozycabin:['#e8e1d7','#f9f4ea','#6d5746','#d1c0ad'],aprilrain:['#e6ecee','#f8fbfb','#55717e','#c7d4d8'],
 newyear:['#232427','#2e3034','#c5ad76','#4f4d45'],thanksgiving:['#eee5d8','#fff8eb','#865736','#d9c5a8'],
 easter:['#ebe6ec','#fdf9f5','#7b6887','#d4c9d7'],fourth:['#e8e8e3','#fbf9f1','#405570','#c8ced5']
 }
 const [background,card,accent,border]=palettes[id]??[t.paper,t.paper,t.color,t.color]
 const dark=readableInk(background)==='#fffaf4',sport=['gameday','courtside','blackgold','fourth'].includes(id)
 const script=['floral','coquette','roseatelier','pearlribbon','champagnesocial','valentine'].includes(id)
 return {...defaultTokens,background,card,text:dark?'#f4f0e8':'#302c29',muted:dark?'#bdb8b0':'#6d655f',accent,accentText:readableInk(accent),border,font:'system',titleFont:script?t.font:sport?'condensed':'editorial',headingFont:'system',labelFont:'system',buttonFont:'system',radius:sport?6:12,shadow:'soft',art:id,surface:'solid'}
}
export function resolveTheme(config:ThemeConfig,page:AccessPage,section?:string):ThemeTokens{
 return {...defaultTokens,...config.base,...config.pages[page],...(section?config.sections[page+'.'+section]:{})}
}
export function tokenVars(t:ThemeTokens):Record<string,string>{
 const art=themeFor(t.art),d=decalValues(t),svg=decalSvg(d.decal,t.accent,t.art,d.decalOpacity)
 return {...appearanceVars(t),'--warm-bg':t.background,'--warm-card':t.card,'--warm-ink':t.text,'--warm-muted':t.muted,'--warm-tan':t.accent,'--warm-border':t.border,'--theme-title-font':appFonts[t.titleFont].css,'--theme-heading-font':appFonts[t.headingFont].css,'--theme-label-font':appFonts[t.labelFont].css,'--theme-button-font':appFonts[t.buttonFont].css,'--theme-radius':t.radius+'px','--theme-width':t.borderWidth+'px','--theme-shadow':t.shadow==='none'?'none':t.shadow==='soft'?'0 1px 2px #201c1805,0 8px 24px #201c1806':'0 4px 8px #201c1806,0 18px 40px #201c1810','--theme-surface':t.surface==='gradient'?'linear-gradient(135deg,color-mix(in srgb,var(--app-accent) 9%,transparent),transparent 65%)':t.surface==='stripes'?'repeating-linear-gradient(90deg,color-mix(in srgb,var(--app-accent) 4%,transparent) 0 18px,transparent 18px 36px)':t.surface==='tint'?'linear-gradient(color-mix(in srgb,var(--app-accent) 4%,transparent),color-mix(in srgb,var(--app-accent) 4%,transparent))':'none', '--decal-band':decalBand(t,t.accent,t.art),'--decal-positions':decalPositions(t),'--decal-size':d.decalSize+'px','--decal-height':decalBand(t,t.accent,t.art)==='none'?'0px':(d.decalSize+16)+'px','--theme-art':svg?'url("data:image/svg+xml,'+encodeURIComponent(svg)+'")':'none'} as Record<string,string>
}
const propertyVars:Record<keyof ThemeTokens,string[]>={background:['--app-background','--warm-bg'],card:['--app-card','--warm-card'],text:['--app-text','--warm-ink'],muted:['--app-muted','--warm-muted'],accent:['--app-accent','--warm-tan','--theme-art','--decal-band'],accentText:['--app-accent-text'],border:['--app-border','--warm-border'],font:['--app-font'],titleFont:['--theme-title-font'],headingFont:['--theme-heading-font'],labelFont:['--theme-label-font'],buttonFont:['--theme-button-font'],radius:['--theme-radius'],borderWidth:['--theme-width'],shadow:['--theme-shadow'],surface:['--theme-surface'],art:['--theme-art','--decal-band','--decal-height'],decal:['--theme-art','--decal-band','--decal-height'],decalSize:['--decal-size','--decal-height'],decalOpacity:['--theme-art','--decal-band'],decalPlacement:['--decal-band','--decal-positions','--decal-height']}
function declarations(t:ThemeTokens,keys=(Object.keys(t) as (keyof ThemeTokens)[])){const all=tokenVars(t),vars=keys.flatMap(k=>propertyVars[k]);return Object.entries(all).filter(([k])=>vars.includes(k)).map(([k,v])=>k+':'+v+';').join('')}
export function themeCss(config:ThemeConfig,page:AccessPage):string{
 if(!config.base&&!config.pages[page]&&!Object.keys(config.sections).some(k=>k.startsWith(page+'.')))return ''
 let css=config.base?'.app-shell{'+declarations({...defaultTokens,...config.base})+'}':''
 if(config.pages[page])css+='.app-shell #app-main{'+declarations(resolveTheme(config,page),Object.keys(config.pages[page]!) as (keyof ThemeTokens)[])+'}'
 for(const section of accessCatalog[page].sections){
  if(config.sections[page+'.'+section]){
   const overrides=config.sections[page+'.'+section]!,selector='.app-shell [data-theme-section="'+page+'.'+section+'"]'
   css+=selector+'{'+declarations(resolveTheme(config,page,section),Object.keys(overrides) as (keyof ThemeTokens)[])+'}'
   if(['art','decal','decalPlacement','decalSize','decalOpacity'].some(k=>k in overrides))css+=selector+'>:is(section,article)::before{content:"";display:block;height:var(--decal-height,0px);background-image:var(--decal-band,none);background-position:var(--decal-positions,center);background-size:min(var(--decal-size,88px),20vw) auto;background-repeat:no-repeat;pointer-events:none}'
  }
 }
 return css
}
export const themeCollections=[...new Set(calendarThemes.map(t=>t.category))]
