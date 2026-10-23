import {AccessSection} from '../components/AppAccess'
import {ScreenEditorCalendarStyle} from '../components/ScreenEditorCalendarStyle'
import {useEffect,useState,type ReactNode} from 'react'
import {Link,useSearchParams} from 'react-router-dom'
import {ThemeStudioPage} from './ThemeStudioPage'
import {AppearancePage} from './AppearancePage'
import {StickerBankPage} from './StickerBankPage'
import './ScreenEditorStudio.css'
const tools=[['screen','Screen & wording'],['themes','Themes'],['fonts','Fonts & colors'],['backgrounds','Backgrounds'],['stickers','Stickers']] as const
type Tool=typeof tools[number][0]
const isTool=(v:string|null):v is Tool=>tools.some(([id])=>id===v)
export function ScreenEditorStudio({children}:{children:ReactNode}){
 const [params,setParams]=useSearchParams(),requested=params.get('tool'),active:Tool=isTool(requested)?requested:'screen'
 const [visited,setVisited]=useState<Set<Tool>>(()=>new Set([active]))
 useEffect(()=>{setVisited(old=>old.has(active)?old:new Set([...old,active]))},[active])
 const themeActive=active==='themes'||active==='fonts'||active==='backgrounds'
 const themeVisited=themeActive||['themes','fonts','backgrounds'].some(t=>visited.has(t as Tool))
 function choose(tool:Tool){const next=new URLSearchParams(params);next.set('tool',tool);setParams(next,{replace:true})}
 return <section className="screen-editor-studio"><header className="studio-heading"><div><p className="eyebrow">Your app, your style</p><h1>Screen Editor</h1><p>Wording, layout, stickers, themes, fonts and backgrounds in one workspace.</p></div><Link to="/settings">Settings</Link></header>
 <nav className="studio-tools" aria-label="Screen editor tools">{tools.map(([id,label])=><button id={'studio-tool-'+id} key={id} type="button" aria-pressed={active===id} aria-controls={'studio-panel-'+(id==='screen'||id==='stickers'?id:'theme')} onClick={()=>choose(id)}>{label}</button>)}</nav>
 <section id="studio-panel-screen" className="studio-panel" hidden={active!=='screen'} aria-label="Screen layout and wording">{(visited.has('screen')||active==='screen')&&children}</section>
 <section id="studio-panel-theme" className="studio-panel" hidden={!themeActive} aria-label="Themes, fonts, colors and backgrounds">{themeVisited&&<><ThemeStudioPage embedded focus={themeActive?active:undefined}/>{(visited.has('backgrounds')||active==='backgrounds')&&<AccessSection page="calendar" section="styling"><ScreenEditorCalendarStyle/></AccessSection>}{(visited.has('fonts')||active==='fonts')&&<details className="studio-classic"><summary>Classic app appearance settings</summary><AppearancePage embedded/></details>}</>}</section>
 <section id="studio-panel-stickers" className="studio-panel" hidden={active!=='stickers'} aria-label="Stickers and placement">{(visited.has('stickers')||active==='stickers')&&<StickerBankPage embedded/>}</section>
 </section>
}
