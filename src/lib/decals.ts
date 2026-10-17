import {stickerBank} from './stickerBank'
import {themeFor,motifSvg} from './calendarThemes'
export type DecalSettings={decal?:string;decalSize?:number;decalOpacity?:number;decalPlacement?:'corners'|'garland'|'center'|'off';backgroundPattern?:'none'|'scatter'|'grid'|'diagonal'|'pinstripe'|'dots'|'checker'|'scallop';backgroundDecal?:string;backgroundOpacity?:number;backgroundScale?:number;backgroundRotation?:number;backgroundColor?:string}
const line=(path:string)=>'<g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">'+path+'</g>'
const vectorDecals=[
 {id:'coupe',label:'Champagne coupe',category:'Cocktail Lounge',shape:line('<path d="M16 20H84Q79 52 50 52Q21 52 16 20ZM50 52V84M30 87H70M22 30H78"/>')},
 {id:'shaker',label:'Cocktail shaker',category:'Cocktail Lounge',shape:line('<path d="M29 29H71L65 89H35ZM33 29L37 17H63L67 29M42 17V8H58V17M40 41L38 73M48 5H52"/>')},
 {id:'whiskey',label:'Rocks & citrus',category:'Cocktail Lounge',shape:line('<path d="M18 36H80L74 86H24ZM22 58H77M33 45L45 40L51 53L39 58ZM55 61L68 57L72 70L59 74M62 34A22 22 0 1 1 82 35M65 29L80 14M71 32H91"/>')},
 {id:'disco-ball',label:'Mirror ball',category:'Music & Nightlife',shape:line('<circle cx="50" cy="52" r="34"/><ellipse cx="50" cy="52" rx="16" ry="34"/><path d="M50 18V4M16 52H84M23 32H77M23 72H77M5 10V22M0 16H11M89 80V94M82 87H96"/>')},
 {id:'headphones',label:'After-hours headphones',category:'Music & Nightlife',shape:line('<path d="M18 56V43A32 32 0 0 1 82 43V56M20 48H29V83H20Q12 81 12 71V61Q12 51 20 48ZM80 48H71V83H80Q88 81 88 71V61Q88 51 80 48M79 83Q73 95 54 91"/>')},
 {id:'vinyl',label:'Vinyl lounge',category:'Music & Nightlife',shape:line('<circle cx="50" cy="50" r="40"/><circle cx="50" cy="50" r="13"/><circle cx="50" cy="50" r="3"/><path d="M18 49A32 32 0 0 1 48 18M26 49A24 24 0 0 1 48 26M82 51A32 32 0 0 1 52 82M74 51A24 24 0 0 1 52 74"/>')},
 {id:'lipstick',label:'Lipstick sketch',category:'Atelier',shape:line('<path d="M33 56H67V91H33ZM37 56V29L62 10V56M37 29L62 10M34 67H66M78 42V91H93V42Z"/>')},
 {id:'heels',label:'Evening heels',category:'Atelier',shape:line('<path d="M12 55L27 26L44 56Q54 72 84 67L92 79H48Q30 79 25 64L22 91H16L17 61Z"/>')},
 {id:'handbag',label:'Mini handbag',category:'Atelier',shape:line('<path d="M21 37H79L88 86H12ZM36 37V23A14 14 0 0 1 64 23V37M17 57Q50 80 83 57M44 64H56V74H44Z"/>')},
 {id:'bowtie',label:'Black tie',category:'Heritage',shape:line('<path d="M45 41L9 20V79L45 59M55 41L91 20V79L55 59M43 39H57V61H43Z"/>')},
 {id:'golf',label:'Golf club morning',category:'Sports',shape:line('<path d="M50 14V70M50 14L79 24L50 35M22 80Q49 66 80 80Q53 94 22 80M13 15L34 67M26 68Q15 61 12 70L23 79L36 76"/>')},
 {id:'basketball-line',label:'Courtside linework',category:'Sports',shape:line('<circle cx="50" cy="50" r="36"/><path d="M14 50H86M50 14V86M24 24Q70 50 24 76M76 24Q30 50 76 76"/>')},
 {id:'dumbbell',label:'Training club',category:'Sports',shape:line('<path d="M35 43H65V57H35M24 22H35V78H24ZM12 33H24V67H12ZM65 22H76V78H65ZM76 33H88V67H76Z"/>')},
 {id:'oyster',label:'Oyster bar',category:'New Orleans',shape:line('<path d="M50 8Q22 4 16 30Q-1 53 18 78Q37 104 68 87Q99 80 87 51Q85 20 50 8ZM47 24Q29 20 30 42Q11 64 35 77Q66 91 75 65Q80 36 47 24Z"/><ellipse cx="52" cy="53" rx="15" ry="19"/>')},
 {id:'crawfish',label:'Boil season',category:'New Orleans',shape:line('<path d="M42 40Q50 28 58 40L62 63L56 81L50 91L44 81L38 63ZM41 48H59M39 58H61M41 69H59M44 79H56M41 40L24 25L14 30L9 12L21 20L24 8M59 40L76 25L86 30L91 12L79 20L76 8M40 52L18 48M39 63L15 66M42 73L24 86M60 52L82 48M61 63L85 66M58 73L76 86M46 33L37 12M54 33L63 12"/>')},
 {id:'monstera',label:'Monstera leaf',category:'Coastal',shape:line('<path d="M50 86Q-4 61 18 20Q40-3 50 24Q60-3 82 20Q104 61 50 86ZM50 27V97M49 51L25 35M51 61L77 43M49 72L24 57"/>')},
 {id:'shell',label:'Coastal shell',category:'Coastal',shape:line('<path d="M15 23Q50-5 85 23L75 71L60 88H40L25 71ZM50 10V87M28 16L44 87M72 16L56 87M15 23L40 87M85 23L60 87M32 73H68"/>')},
 {id:'maple',label:'Autumn maple',category:'Seasonal',shape:line('<path d="M50 5L60 31L75 21L70 46L92 41L82 61L91 67L57 77L52 96L47 77L13 67L22 61L12 41L34 46L29 21L43 31ZM50 34V80M50 59L30 51M50 68L72 57"/>')},
 {id:'ornament',label:'Holiday ornament',category:'Seasonal',shape:line('<circle cx="50" cy="58" r="31"/><path d="M41 27V16H59V27M50 16V7M21 49Q50 71 79 49M22 70Q50 47 78 70M39 17H61"/>')},
 {id:'sparkle-line',label:'Fine starbursts',category:'Celestial',shape:line('<path d="M50 10L57 43L90 50L57 57L50 90L43 57L10 50L43 43ZM83 3V23M73 13H93M14 72V94M3 83H25"/>')},
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
