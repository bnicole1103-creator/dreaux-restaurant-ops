import type {CalendarLook} from './calendarLook'
export const calendarThemes=[
 {id:'floral',label:'Garden Party',category:'Flowers',color:'#804454',paper:'#fcf9f6',font:'parisienne',motif:'flower'},
 {id:'botanical',label:'Botanical',category:'Flowers',color:'#385448',paper:'#f8f9f3',font:'editorial',motif:'leaf'},
 {id:'gameday',label:'Game Day',category:'Sports',color:'#294336',paper:'#f7f8f2',font:'condensed',motif:'football'},
 {id:'courtside',label:'Courtside',category:'Sports',color:'#914a32',paper:'#faf6ef',font:'condensed',motif:'basketball'},
 {id:'coquette',label:'Bows & Blush',category:'Girly',color:'#8e4c62',paper:'#fff9f6',font:'greatvibes',motif:'bow'},
 {id:'disco',label:'Disco Nights',category:'Girly',color:'#644b7a',paper:'#faf7fc',font:'modern',motif:'sparkle'},
 {id:'spring',label:'Spring Bloom',category:'Seasons',color:'#657044',paper:'#fcfbf4',font:'editorial',motif:'flower'},
 {id:'summer',label:'Poolside Summer',category:'Seasons',color:'#326b70',paper:'#f8fbf7',font:'editorial',motif:'sun'},
 {id:'autumn',label:'Autumn Harvest',category:'Seasons',color:'#8a4e31',paper:'#fbf6ed',font:'editorial',motif:'leaf'},
 {id:'winter',label:'Winter Frost',category:'Seasons',color:'#496376',paper:'#fbfcfd',font:'serif',motif:'snow'},
 {id:'halloween',label:'Spooky Season',category:'Holidays',color:'#d6a078',paper:'#292725',font:'condensed',motif:'pumpkin'},
 {id:'christmas',label:'Holiday Cheer',category:'Holidays',color:'#753c43',paper:'#fcf9f1',font:'greatvibes',motif:'holly'},
 {id:'valentine',label:'Love Notes',category:'Holidays',color:'#9a3f58',paper:'#fff8f5',font:'allura',motif:'heart'},
 {id:'mardigras',label:'Mardi Gras',category:'Holidays',color:'#634b78',paper:'#fbf8f3',font:'editorial',motif:'crown'} ,
 {id:'roseatelier',label:'Rose Atelier',category:'Flowers',color:'#8c4c58',paper:'#fff9f4',font:'allura',motif:'rose'},
 {id:'daisydays',label:'Daisy Days',category:'Flowers',color:'#777343',paper:'#fcfaf1',font:'editorial',motif:'flower'},
 {id:'wildflower',label:'Wildflower Press',category:'Flowers',color:'#716178',paper:'#faf7f2',font:'editorial',motif:'sprig'},
 {id:'blackgold',label:'Black & Gold',category:'Sports',color:'#c0a36c',paper:'#1e211f',font:'condensed',motif:'fleur'},
 {id:'matchpoint',label:'Match Point',category:'Sports',color:'#395b46',paper:'#fafaf0',font:'editorial',motif:'tennis'},
 {id:'clubhouse',label:'Clubhouse',category:'Sports',color:'#354c65',paper:'#f9f8f1',font:'serif',motif:'baseball'},
 {id:'cherryclub',label:'Cherry Club',category:'Girly',color:'#943d4d',paper:'#fff8f1',font:'editorial',motif:'cherry'},
 {id:'pearlribbon',label:'Pearl Ribbon',category:'Girly',color:'#796183',paper:'#fdf9fb',font:'greatvibes',motif:'bow'},
 {id:'champagnesocial',label:'Champagne Social',category:'Girly',color:'#806c47',paper:'#fffaf0',font:'parisienne',motif:'sparkle'},
 {id:'midnightmuse',label:'Midnight Muse',category:'Girly',color:'#c1accd',paper:'#24232c',font:'modern',motif:'moon'},
 {id:'citruscoast',label:'Citrus Coast',category:'Seasons',color:'#a6623c',paper:'#fffaf0',font:'modern',motif:'citrus'},
 {id:'goldenhour',label:'Golden Hour',category:'Seasons',color:'#956343',paper:'#fff6eb',font:'editorial',motif:'sun'},
 {id:'cozycabin',label:'Cozy Cabin',category:'Seasons',color:'#6d5746',paper:'#f9f4ea',font:'serif',motif:'pine'},
 {id:'aprilrain',label:'April Rain',category:'Seasons',color:'#55717e',paper:'#f8fbfb',font:'editorial',motif:'rain'},
 {id:'newyear',label:'Midnight Toast',category:'Holidays',color:'#c5ad76',paper:'#232427',font:'editorial',motif:'sparkle'},
 {id:'thanksgiving',label:'Gather Together',category:'Holidays',color:'#865736',paper:'#fff8eb',font:'editorial',motif:'sprig'},
 {id:'easter',label:'Pastel Sunday',category:'Holidays',color:'#7b6887',paper:'#fdf9f5',font:'editorial',motif:'egg'},
 {id:'fourth',label:'Stars & Stripes',category:'Holidays',color:'#405570',paper:'#fbf9f1',font:'condensed',motif:'star'}
] as const
export type CalendarThemeId=typeof calendarThemes[number]['id']
export const layoutTemplates=[{id:'poster',label:'Classic Poster'},{id:'editorial',label:'Editorial'},{id:'playful',label:'Playful'},{id:'minimal',label:'Minimal'},{id:'ledger',label:'Ledger'},{id:'scrapbook',label:'Scrapbook'},{id:'spotlight',label:'Spotlight'},{id:'deco',label:'Art Deco'},{id:'polaroid',label:'Polaroid Board'},{id:'blocks',label:'Bold Blocks'},{id:'planner',label:'Weekly Planner'}] as const
export function themeFor(id?:string){return calendarThemes.find(t=>t.id===id)}
export function chooseCalendarTheme(look:CalendarLook,id:CalendarThemeId):CalendarLook{
 const t=themeFor(id)!;return {...look,template:id,color:t.color,paper:t.paper,font:t.font,outline:'thin'}
}
export type ThemeComposition='airy'|'arch'|'ribbon'|'stripe'|'frame'|'night'|'split'
export function compositionFor(id?:string):ThemeComposition{
 if(['blackgold','midnightmuse','newyear'].includes(id??''))return 'night'
 if(['botanical','pearlribbon','halloween'].includes(id??''))return 'arch'
 if(['gameday','courtside','cherryclub','fourth'].includes(id??''))return 'ribbon'
 if(['coquette','matchpoint','summer','citruscoast'].includes(id??''))return 'stripe'
 if(['wildflower','winter','christmas','clubhouse','easter'].includes(id??''))return 'frame'
 if(['disco','goldenhour','autumn','cozycabin'].includes(id??''))return 'split'
 return 'airy'
}
// Code-native decorative artwork; text and day cells remain accessible HTML.
export function motifSvg(motif:string,color:string):string{
 const petals=Array.from({length:8},(_,i)=>'<ellipse cx="50" cy="25" rx="9" ry="17" transform="rotate('+i*45+' 50 50)"/>').join('')
 const shapes:Record<string,string>={
 rose:'<path d="M50 79C4 67 8 12 48 19C78 1 100 57 66 73Z" opacity=".2"/><path d="M49 62C18 65 20 23 45 31C64 10 86 50 62 58C71 76 34 84 30 57M45 31C30 48 59 62 62 43C57 31 41 42 49 51" fill="none" stroke="currentColor" stroke-width="3"/><path d="M50 74V95M49 86Q23 92 19 74Q40 71 49 86" fill="none" stroke="currentColor" stroke-width="3"/>',
 sprig:'<path d="M22 92Q65 55 68 9" fill="none" stroke="currentColor" stroke-width="3"/><path d="M34 80Q10 67 19 51Q39 53 39 73M47 61Q73 72 85 52Q65 43 52 53M57 43Q30 40 39 20Q56 22 61 35M64 27Q89 31 87 10Q73 7 64 27Z"/>',
 fleur:'<path d="M50 5Q28 29 44 52Q27 25 12 43Q2 61 28 65L40 58L34 79H20V86H42L50 96L58 86H80V79H66L60 58L72 65Q98 61 88 43Q73 25 56 52Q72 29 50 5Z"/>',
 tennis:'<circle cx="50" cy="50" r="34" opacity=".16"/><circle cx="50" cy="50" r="34" fill="none" stroke="currentColor" stroke-width="3"/><path d="M28 24Q68 42 35 81M73 23Q36 55 76 76" fill="none" stroke="currentColor" stroke-width="3"/>',
 baseball:'<circle cx="50" cy="50" r="35" fill="none" stroke="currentColor" stroke-width="3"/><path d="M24 26Q67 50 24 76M76 26Q33 50 76 76" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="4 4"/>',
 cherry:'<path d="M34 59Q52 33 49 10Q57 39 72 57M49 13Q65 1 81 15Q65 32 49 13" fill="none" stroke="currentColor" stroke-width="4"/><circle cx="28" cy="69" r="20"/><circle cx="73" cy="71" r="19"/><path d="M16 65Q18 57 25 56M62 66Q63 61 69 59" stroke="#fff" stroke-width="3" fill="none"/>',
 moon:'<path d="M67 10C18 2 2 71 52 88Q80 93 91 67C39 85 25 35 67 10Z"/><path d="M78 13L81 25L93 28L81 31L78 43L75 31L63 28L75 25Z"/>',
 citrus:'<circle cx="50" cy="50" r="35" fill="none" stroke="currentColor" stroke-width="4"/><path d="M50 18V82M18 50H82M27 27L73 73M27 73L73 27" stroke="currentColor" stroke-width="3" fill="none"/>',
 pine:'<path d="M50 7L22 42H35L12 69H41V92H59V69H88L65 42H78Z"/>',
 rain:'<path d="M24 49C0 43 16 15 35 25C45 2 82 15 77 34C100 35 96 58 77 57H25" opacity=".4"/><path d="M31 66L25 82M52 67L46 88M73 66L67 82" stroke="currentColor" stroke-width="4" fill="none"/>',
 egg:'<path d="M50 7C25 8 9 52 20 75C30 97 74 98 83 73C92 50 72 7 50 7Z" fill="none" stroke="currentColor" stroke-width="3"/><path d="M20 53L31 44L43 54L55 44L68 54L80 44M25 73Q50 60 78 73" fill="none" stroke="currentColor" stroke-width="3"/>',
 star:'<path d="M50 6L62 35L94 38L69 58L77 91L50 73L23 91L31 58L6 38L38 35Z"/>',
 flower:petals+'<circle cx="50" cy="50" r="11" fill="#e5b957"/>',
 leaf:'<path d="M22 82Q18 20 78 16Q83 70 22 82Z"/><path d="M24 80L67 30M40 61L33 39M51 50L72 49" fill="none" stroke="#fffaf0" stroke-width="3"/>',
 football:'<ellipse cx="50" cy="50" rx="37" ry="22" transform="rotate(-30 50 50)"/><path d="M30 61L70 39M40 46L48 60M49 41L57 55M58 36L66 50" fill="none" stroke="#fff" stroke-width="3"/>',
 basketball:'<circle cx="50" cy="50" r="35"/><path d="M15 50H85M50 15V85M25 25Q65 50 25 75M75 25Q35 50 75 75" fill="none" stroke="#fff6e8" stroke-width="2"/>',
 bow:'<path d="M48 44Q6 4 13 44Q13 65 45 54L27 87L47 79L51 57L63 86L80 92L59 52Q96 62 88 29Q83 9 56 44Z"/><circle cx="51" cy="49" r="9"/>',
 sparkle:'<path d="M50 5L60 39L95 50L60 61L50 95L40 61L5 50L40 39Z"/><circle cx="82" cy="16" r="6"/>',
 sun:'<circle cx="50" cy="50" r="23"/><path d="M50 4V18M50 82V96M4 50H18M82 50H96M17 17L27 27M73 73L83 83M17 83L27 73M73 27L83 17" fill="none" stroke="currentColor" stroke-width="5"/>',
 snow:'<path d="M50 8V92M14 29L86 71M14 71L86 29M40 18L50 28L60 18M40 82L50 72L60 82" fill="none" stroke="currentColor" stroke-width="4"/>',
 pumpkin:'<ellipse cx="50" cy="56" rx="36" ry="29"/><path d="M50 29Q43 8 61 12" fill="none" stroke="#4d7148" stroke-width="7"/><path d="M28 49L38 39L43 51ZM58 51L65 39L75 49ZM36 65L64 65L58 75L42 75Z" fill="#fff3d5"/>',
 holly:'<path d="M43 51L15 48L24 38L16 20L35 24L45 13L48 44M55 49L60 15L70 26L87 19L81 38L91 48L60 55" fill="#47734c"/><circle cx="48" cy="54" r="11"/><circle cx="63" cy="59" r="10"/><circle cx="51" cy="70" r="9"/>',
 heart:'<path d="M50 85L14 49C-10 15 34 1 50 30C68 1 109 17 86 49Z"/>',
 crown:'<path d="M18 72L9 25L34 45L50 14L66 45L91 25L82 72Z"/><path d="M20 83H80" stroke="#d1a42d" stroke-width="9"/>'
 }
 return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" color="'+color+'" fill="'+color+'">'+(shapes[motif]??shapes.sparkle)+'</svg>'
}
