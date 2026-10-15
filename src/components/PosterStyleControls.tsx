import {useState} from 'react'
import {calendarThemes,layoutTemplates,chooseCalendarTheme,themeFor,type CalendarThemeId} from '../lib/calendarThemes'
import {CalendarThemePreview} from './CalendarThemePreview'
import './CalendarThemes.css'
import {PageWord} from './PageDesign'
import {appFonts,type FontName} from '../lib/appearance'
import {calendarPalettes,type CalendarLook} from '../lib/calendarLook'
import {ColorWheel} from './ColorWheel'
import './PosterCalendar.css'
import './CalendarLayoutExtras.css'
import './CalendarDistinctTemplates.css'
export function PosterStyleControls({look,onChange,month}:{look:CalendarLook;onChange:(look:CalendarLook)=>void;month?:string}){
 const [category,setCategory]=useState<string>(themeFor(look.template)?.category??'Flowers')
 const monthTitle=month?new Intl.DateTimeFormat('en-US',{month:'long',timeZone:'UTC'}).format(new Date(month+'-01T12:00:00Z')):'October'
 const choices=category==='Layouts'?layoutTemplates:calendarThemes.filter(t=>t.category===category)

 return <div className="poster-style-controls"><p className="calendar-theme-help">Choose a theme, then customize its colors, heading font and outline. Preview changes below before saving.</p><nav className="calendar-theme-categories" aria-label="Calendar theme categories">{['Flowers','Sports','Girly','Seasons','Holidays','Layouts'].map(c=><button type="button" key={c} aria-pressed={category===c} onClick={()=>setCategory(c)}>{c}</button>)}</nav><div className="calendar-theme-gallery">{choices.map(t=><button type="button" key={t.id} aria-label={'Use '+t.label+' theme'} aria-pressed={(look.template??'poster')===t.id} className="calendar-theme-choice" onClick={()=>onChange(themeFor(t.id)?chooseCalendarTheme(look,t.id as CalendarThemeId):{...look,template:t.id as CalendarLook['template']})}><CalendarThemePreview title={monthTitle} look={themeFor(t.id)?chooseCalendarTheme(look,t.id as CalendarThemeId):{...look,template:t.id as CalendarLook['template']}}/><span>{t.label}</span>{look.template===t.id&&<small>Selected ✓</small>}</button>)}</div><div className="calendar-style-fields"><label><PageWord id="sectioncopy.6b6ae851685d237d7e6d">{"Outline"}</PageWord><select value={look.outline??'double'} onChange={e=>onChange({...look,outline:e.target.value as CalendarLook['outline']})}><option value="thin">Fine line</option><option value="double">Double frame</option><option value="dashed">Dashed</option><option value="none">No outline</option></select></label><label><PageWord id="sectioncopy.0a30d8a0fffbda42fd3a">{"Heading font"}</PageWord><select value={look.font} onChange={e=>onChange({...look,font:e.target.value as FontName})}>{Object.entries(appFonts).map(([key,f])=><option key={key} value={key}>{f.label}</option>)}</select></label></div><div className="calendar-palette">{Object.entries(calendarPalettes).map(([name,color])=><button type="button" key={name} aria-pressed={look.color===color} onClick={()=>onChange({...look,color})}><span style={{background:color}}/>{name}</button>)}</div><div className="poster-colors"><ColorWheel label="Accent color wheel" value={look.color} onChange={color=>onChange({...look,color})}/><ColorWheel label="Paper color wheel" value={look.paper??'#fff8ef'} onChange={paper=>onChange({...look,paper})}/></div><div className="calendar-theme-live"><p>Selected: {themeFor(look.template)?.label??layoutTemplates.find(t=>t.id===(look.template??'poster'))?.label}</p><CalendarThemePreview look={look} title={monthTitle}/></div></div>
}
