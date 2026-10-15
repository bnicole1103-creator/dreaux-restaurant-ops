import {stickerBank} from './stickerBank'
import {themeFor,motifSvg} from './calendarThemes'
export type DecalSettings={decal?:string;decalSize?:number;decalOpacity?:number;decalPlacement?:'corners'|'garland'|'center'|'off'}
const line=(path:string)=>'<g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">'+path+'</g>'
const vectorDecals=[
 {id:'magnolia',label:'Magnolia bloom',category:'Botanical',shape:line('<path d="M50 64C7 70 14 29 45 48C18 6 65 4 56 44C81 9 107 48 65 57C103 72 65 101 54 70C36 102 7 76 42 64Z"/><path d="M50 61L54 92M53 80Q77 64 85 80Q71 91 53 80"/>')},
 {id:'orchid',label:'Orchid stems',category:'Botanical',shape:line('<path d="M25 96Q70 48 44 8M46 27Q14 10 24 35Q39 44 48 32Q72 5 79 30Q78 52 51 36M45 52Q7 39 19 65Q32 76 43 57Q70 32 77 58Q71 79 44 65"/>')},
 {id:'olive',label:'Olive branches',category:'Botanical',shape:line('<path d="M15 91Q67 61 72 7M29 81Q5 68 20 53Q41 63 29 81M43 67Q79 81 85 56Q60 49 43 67M59 45Q29 41 39 21Q65 24 59 45M68 28Q90 30 91 9Q73 6 68 28"/>')},
 {id:'vine',label:'Trailing vines',category:'Botanical',shape:line('<path d="M5 85Q98 78 25 12M24 80Q13 56 35 54M43 71Q75 87 82 62M50 52Q23 39 40 29M44 29Q74 39 73 15"/>')},
 {id:'butterflies',label:'Butterfly linework',category:'Botanical',shape:line('<path d="M50 75V32M50 42Q12 2 12 40Q12 63 46 57Q15 61 25 81Q41 92 50 64Q61 96 78 79Q88 60 55 57Q94 59 89 30Q85 4 51 43M49 34L39 22M51 34L61 22"/>')},
 {id:'ribbon',label:'Silk ribbon bow',category:'Atelier',shape:line('<path d="M46 47Q2 7 9 39Q13 64 46 51M54 47Q98 7 91 39Q87 64 54 51M46 46H55V54H46ZM47 54L23 92L40 84L47 92L51 57M55 54L77 92L61 84L54 92"/>')},
 {id:'lace',label:'Lace medallion',category:'Atelier',shape:line('<circle cx="50" cy="50" r="26"/><circle cx="50" cy="50" r="20"/>')+Array.from({length:12},(_,i)=>'<ellipse cx="50" cy="14" rx="6" ry="12" fill="none" stroke="currentColor" stroke-width="1" transform="rotate('+i*30+' 50 50)"/>').join('')},
 {id:'fan',label:'Art Deco fan',category:'Atelier',shape:line(Array.from({length:9},(_,i)=>'<path d="M50 91L'+(8+i*10)+' '+(25-Math.sin(i/8*Math.PI)*18)+'"/>').join('')+'<path d="M8 25Q50-10 92 25L50 91Z"/>')},
 {id:'diamonds',label:'Diamond chain',category:'Atelier',shape:line('<path d="M50 6L73 32L50 58L27 32ZM50 42L73 68L50 94L27 68Z"/><path d="M50 6V94M27 32H73M27 68H73"/>')},
 {id:'laurel',label:'Laurel crest',category:'Heritage',shape:line('<path d="M42 92Q5 76 17 20M58 92Q95 76 83 20"/>')+'<g fill="currentColor">'+[0,1,2,3].map(i=>'<ellipse cx="'+(17+i*3)+'" cy="'+(27+i*16)+'" rx="4" ry="9" transform="rotate(-35 '+(17+i*3)+' '+(27+i*16)+')"/><ellipse cx="'+(83-i*3)+'" cy="'+(27+i*16)+'" rx="4" ry="9" transform="rotate(35 '+(83-i*3)+' '+(27+i*16)+')"/>').join('')+'</g>'},
 {id:'fleurs',label:'New Orleans fleur',category:'New Orleans',motif:'fleur'},
 {id:'beads',label:'Carnival beads',category:'New Orleans',shape:line('<path d="M8 5Q50 145 92 5"/>')+Array.from({length:15},(_,i)=>{const x=8+i*6,y=5+62*Math.sin(i/14*Math.PI);return '<circle cx="'+x+'" cy="'+y+'" r="3" fill="currentColor"/>'}).join('')},
 {id:'martini',label:'Martini glass',category:'Hospitality',shape:line('<path d="M12 16H88L50 54ZM50 54V86M28 88H72M54 37L77 7"/><circle cx="64" cy="23" r="6"/>')},
 {id:'champagne',label:'Champagne toast',category:'Hospitality',shape:line('<path d="M15 10H39V36Q39 56 27 56Q15 56 15 36ZM27 56V87M15 89H39M61 10H85V36Q85 56 73 56Q61 56 61 36ZM73 56V87M61 89H85M15 28H39M61 28H85M48 4V16M43 8L38 3M53 8L58 3"/>')},
 {id:'candle',label:'Dinner by candlelight',category:'Hospitality',shape:line('<path d="M36 44H64V86H36ZM50 44V32M29 89H71M50 32Q30 22 50 5Q70 22 50 32ZM37 56Q49 63 52 51Q55 65 64 59"/>')},
 {id:'citrus',label:'Citrus slice',category:'Coastal',motif:'citrus'},
 {id:'palm',label:'Palm fronds',category:'Coastal',shape:line('<path d="M20 93Q45 50 76 11M37 68Q9 44 6 22Q38 35 44 58M51 48Q30 17 39 5Q59 24 57 40M60 36Q95 20 97 39Q80 55 51 48M40 64Q78 57 85 76Q64 89 30 77"/>')},
 {id:'sunburst',label:'Riviera sunburst',category:'Coastal',shape:line('<circle cx="50" cy="50" r="18"/>'+Array.from({length:16},(_,i)=>'<path d="M50 6V24" transform="rotate('+i*22.5+' 50 50)"/>').join(''))},
 {id:'moonstars',label:'Moon & starlight',category:'Celestial',motif:'moon'},
 {id:'constellation',label:'Constellations',category:'Celestial',shape:line('<path d="M10 70L33 30L61 51L85 13M61 51L91 85"/>')+[ [10,70],[33,30],[61,51],[85,13],[91,85] ].map(([x,y])=>'<circle cx="'+x+'" cy="'+y+'" r="3" fill="currentColor"/>').join('')},
 {id:'football',label:'Game day stitching',category:'Sports',motif:'football'},
 {id:'tennis',label:'Tennis club',category:'Sports',motif:'tennis'},
 {id:'pine',label:'Winter pine',category:'Seasonal',motif:'pine'},
 {id:'snow',label:'Snowflake filigree',category:'Seasonal',motif:'snow'},
 {id:'pumpkin',label:'Harvest pumpkin',category:'Seasonal',motif:'pumpkin'},
 {id:'holly',label:'Holiday holly',category:'Seasonal',motif:'holly'},
 {id:'heart',label:'Romantic hearts',category:'Seasonal',motif:'heart'},
 {id:'rose',label:'Pressed rose',category:'Botanical',motif:'rose'}
] as const
export const decalBank=[...vectorDecals,...stickerBank.map(([id,emoji,category,label])=>({id:'sticker-'+id,label,category:'Stickers · '+category,shape:'<text x="50" y="76" text-anchor="middle" font-size="76" font-family="Apple Color Emoji,Segoe UI Emoji,Noto Color Emoji,sans-serif">'+emoji+'</text>'}))]
export const decalGroups=[...new Set(decalBank.map(d=>d.category))]
export function decalSvg(id:string,color:string,fallback?:string,opacity=1):string|null{
 const safe=/^#[a-f\d]{6}$/i.test(color)?color:'#795232';if(id==='none')return null
 if(id==='theme'){const t=themeFor(fallback);return t?motifSvg(t.motif,safe).replace('<svg ','<svg opacity="'+Math.max(.05,Math.min(1,opacity))+'" '):null}
 const item=decalBank.find(d=>d.id===id);if(!item)return null
 const svg='motif' in item?motifSvg(item.motif,safe):'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" color="'+safe+'">'+item.shape+'</svg>'
 return svg.replace('<svg ','<svg opacity="'+Math.max(.05,Math.min(1,opacity))+'" ')
}
export function decalValues(v:DecalSettings){return {decal:v.decal??'theme',decalSize:Math.max(24,Math.min(160,v.decalSize??88)),decalOpacity:Math.max(.05,Math.min(1,v.decalOpacity??.65)),decalPlacement:v.decalPlacement??'corners'} as const}
export function decalBand(v:DecalSettings,color:string,fallback?:string):string{
 const d=decalValues(v),svg=decalSvg(d.decal,color,fallback,d.decalOpacity);if(!svg||d.decalPlacement==='off')return 'none'
 const image='url("data:image/svg+xml,'+encodeURIComponent(svg)+'")'
 return Array.from({length:d.decalPlacement==='center'?1:d.decalPlacement==='garland'?5:2},()=>image).join(',')
}
export function decalPositions(v:DecalSettings):string{const d=decalValues(v);return d.decalPlacement==='center'?'center':d.decalPlacement==='garland'?'0% center,25% center,50% center,75% center,100% center':'left center,right center'}
