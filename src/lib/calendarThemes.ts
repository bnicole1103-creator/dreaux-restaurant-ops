import type {CalendarLook} from './calendarLook'
export const calendarThemes=[
 {id:'floral',label:'Garden Party',category:'Flowers',color:'#a84971',paper:'#fffaf5',font:'parisienne',motif:'flower'},
 {id:'botanical',label:'Botanical',category:'Flowers',color:'#41705a',paper:'#f4f5e9',font:'editorial',motif:'leaf'},
 {id:'gameday',label:'Game Day',category:'Sports',color:'#325c40',paper:'#f7f6ed',font:'condensed',motif:'football'},
 {id:'courtside',label:'Courtside',category:'Sports',color:'#b95329',paper:'#fff4e7',font:'condensed',motif:'basketball'},
 {id:'coquette',label:'Bows & Blush',category:'Girly',color:'#bd527c',paper:'#fff2f6',font:'greatvibes',motif:'bow'},
 {id:'disco',label:'Disco Nights',category:'Girly',color:'#8853b8',paper:'#faf0ff',font:'modern',motif:'sparkle'},
 {id:'spring',label:'Spring Bloom',category:'Seasons',color:'#77833f',paper:'#fffced',font:'dancing',motif:'flower'},
 {id:'summer',label:'Poolside Summer',category:'Seasons',color:'#147f8e',paper:'#edfbf8',font:'rounded',motif:'sun'},
 {id:'autumn',label:'Autumn Harvest',category:'Seasons',color:'#af5629',paper:'#fff4e7',font:'editorial',motif:'leaf'},
 {id:'winter',label:'Winter Frost',category:'Seasons',color:'#427a9e',paper:'#f2f9ff',font:'serif',motif:'snow'},
 {id:'halloween',label:'Spooky Season',category:'Holidays',color:'#995222',paper:'#fff4df',font:'condensed',motif:'pumpkin'},
 {id:'christmas',label:'Holiday Cheer',category:'Holidays',color:'#9c3545',paper:'#fffaf1',font:'greatvibes',motif:'holly'},
 {id:'valentine',label:'Love Notes',category:'Holidays',color:'#c24064',paper:'#fff1f3',font:'allura',motif:'heart'},
 {id:'mardigras',label:'Mardi Gras',category:'Holidays',color:'#744198',paper:'#fff9df',font:'dancing',motif:'crown'}
] as const
export type CalendarThemeId=typeof calendarThemes[number]['id']
export const layoutTemplates=[{id:'poster',label:'Classic Poster'},{id:'editorial',label:'Editorial'},{id:'playful',label:'Playful'},{id:'minimal',label:'Minimal'},{id:'ledger',label:'Ledger'},{id:'scrapbook',label:'Scrapbook'},{id:'spotlight',label:'Spotlight'},{id:'deco',label:'Art Deco'},{id:'polaroid',label:'Polaroid Board'},{id:'blocks',label:'Bold Blocks'},{id:'planner',label:'Weekly Planner'}] as const
export function themeFor(id?:string){return calendarThemes.find(t=>t.id===id)}
export function chooseCalendarTheme(look:CalendarLook,id:CalendarThemeId):CalendarLook{
 const t=themeFor(id)!;return {...look,template:id,color:t.color,paper:t.paper,font:t.font,outline:'thin'}
}
// Code-native decorative artwork; text and day cells remain accessible HTML.
export function motifSvg(motif:string,color:string):string{
 const petals=Array.from({length:8},(_,i)=>'<ellipse cx="50" cy="25" rx="9" ry="17" transform="rotate('+i*45+' 50 50)"/>').join('')
 const shapes:Record<string,string>={
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
