import {decalSvg,decalValues} from '../lib/decals'
import {themeFor,motifSvg,compositionFor} from '../lib/calendarThemes'
import {calendarLook,type CalendarLook} from '../lib/calendarLook'
import {appFonts} from '../lib/appearance'
export function CalendarThemePreview({look,title='October',month='2026-10'}:{look:CalendarLook;title?:string;month?:string}){
 const t=themeFor(look.template),style=calendarLook(look) as Record<string,string>,ink=style['--calendar-ink'],accent=look.color,paper=look.paper??'#fff8ef',heroInk=style['--calendar-hero-ink'],composition=compositionFor(look.template)
 const d=decalValues(look),svg=decalSvg(d.decal,composition==='ribbon'?heroInk:accent,look.template,d.decalOpacity),art=svg&&d.decalPlacement!=='off'?'data:image/svg+xml,'+encodeURIComponent(svg):null

 const planner=look.template==='planner',monthDate=new Date(month+'-01T12:00:00Z'),valid=Number.isFinite(monthDate.getTime()),offset=valid?(monthDate.getUTCDay()+6)%7:3,days=valid?new Date(Date.UTC(monthDate.getUTCFullYear(),monthDate.getUTCMonth()+1,0)).getUTCDate():31
 const frame=look.outline==='double'?3:look.outline==='none'?0:1,dashed=look.outline==='dashed'?'4 4':undefined
 return <svg className="calendar-theme-preview" viewBox="0 0 360 330" aria-hidden="true" focusable="false">
 <rect width="360" height="330" rx="16" fill={paper}/>
 {composition==='ribbon'&&<rect x="8" y="8" width="344" height="96" rx="10" fill={accent}/>}
 {composition==='stripe'&&Array.from({length:12},(_,i)=><rect key={i} x={i*32} y="0" width="16" height="100" fill={accent} opacity=".07"/>)}
 {composition==='split'&&<path d="M0 0H360V84Q180 124 0 84Z" fill={accent} opacity=".13"/>}
 {composition==='arch'&&<path d="M12 101V70Q12 12 90 12H270Q348 12 348 70V101" fill="none" stroke={accent} strokeWidth="1"/>}
 {composition==='frame'&&<rect x="8" y="8" width="344" height="314" rx="3" fill="none" stroke={accent} strokeWidth={frame||1}/>}
 {look.outline!=='none'&&<rect x="14" y="14" width="332" height="302" rx="10" fill="none" stroke={composition==='ribbon'?ink:accent} strokeOpacity=".25" strokeWidth={frame} strokeDasharray={dashed}/>}
 {art&&(d.decalPlacement==='garland'?[35,105,175,245,315]:d.decalPlacement==='center'?[180]:[40,320]).map((x,i)=><image key={i} href={art} x={x-Math.min(48,d.decalSize*.4)/2} y={d.decalPlacement==='corners'?37:82} width={Math.min(48,d.decalSize*.4)} height={Math.min(48,d.decalSize*.4)}/>)}
 <text x="180" y="30" textAnchor="middle" fontFamily="system-ui" fontSize="6.5" letterSpacing="2" fill={heroInk} opacity=".7">JUS TINI’S · NEW ORLEANS</text>
 <text x="180" y="76" textAnchor="middle" fill={heroInk} style={{fontFamily:appFonts[look.font].css,fontSize:title.length>8?38:44,fontWeight:400}}>{title}</text>
 <path d="M30 104H330" stroke={accent} strokeOpacity=".25"/>
 {planner?Array.from({length:7},(_,i)=><g key={i}><rect x="28" y={119+i*25} width="3" height="19" fill={accent}/><path d={'M40 '+(138+i*25)+'H330'} stroke={accent} strokeOpacity=".2"/><text x="43" y={132+i*25} fontFamily="system-ui" fontSize="10" fill={ink}>{['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][i]}</text></g>):<>
 {['M','T','W','T','F','S','S'].map((d,i)=><text key={i} x={48+i*44} y="120" textAnchor="middle" fontSize="8" fontFamily="system-ui" fill={ink} opacity=".6">{d}</text>)}
 {Array.from({length:42},(_,i)=>{const date=i-offset+1,inMonth=date>0&&date<=days;return <g key={i}><rect x={28+i%7*44} y={130+Math.floor(i/7)*27} width="40" height="24" rx={composition==='arch'||composition==='airy'?5:2} fill={accent} fillOpacity={inMonth?.055:.015} stroke={accent} strokeOpacity=".12"/>{inMonth&&<text x={48+i%7*44} y={146+Math.floor(i/7)*27} textAnchor="middle" fontSize="9" fontFamily="system-ui" fill={ink}>{date}</text>}</g>})}
 </>}
 <text x="180" y="310" textAnchor="middle" fontSize="6.5" fontFamily="system-ui" letterSpacing="1.5" fill={ink} opacity=".55">{t?.label.toUpperCase()??'MAKE ROOM FOR GOOD THINGS'}</text>
 </svg>
}
