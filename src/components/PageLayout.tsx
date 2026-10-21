import {DesignSection} from './DesignSection'
import type {ReactNode} from 'react'
import {Link,useLocation} from 'react-router-dom'
import {usePageDesign} from './PageDesign'
import {safePageLink} from '../lib/pageEditor'
import './PageLayout.css'
export function LayoutSection({id,label,children}:{id:string;label:string;children:ReactNode}){
 return <DesignSection as="div" data-design-block={id} data-layout-item="true" data-layout-label={label} className="page-layout-section">{children}</DesignSection>
}
export function CustomPageSections({group}:{group:string}){
 const {changes}=usePageDesign()
 return <>{Object.entries(changes).filter(([id,c])=>id.startsWith('custom.')&&['note','link'].includes(c.kind??'')&&c.parent===group).map(([id,c])=><LayoutSection key={id} id={id} label={c.title||'Custom section'}><article className="page-custom-card">{c.title&&<h2>{c.title}</h2>}<p>{c.text}</p>{c.kind==='link'&&safePageLink(c.href)&&<Link to={c.href}>{c.linkLabel||'Open page'} →</Link>}</article></LayoutSection>)}</>
}
export function PageCanvas({children}:{children:ReactNode}){
 const {pathname}=useLocation()
 if(pathname==='/'||pathname==='/settings/wording')return <>{children}</>
 return <div className="page-canvas" data-design-block="page.canvas" data-layout-group="page.canvas" data-layout-label="Page layout"><LayoutSection id="page.content" label="Main page content">{children}</LayoutSection><CustomPageSections group="page.canvas"/></div>
}
