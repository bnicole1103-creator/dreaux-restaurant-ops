import { Link } from 'react-router-dom'
import { Palette, ShieldCheck, ListChecks } from 'lucide-react'
import './SettingsNavigation.css'
export function SettingsPage(){
 const items=[{to:'/settings/sales-targets',title:'Sales Targets',description:'Enter six weeks of net sales and allocate targets from 7shifts.',Icon:ListChecks},{to:'/appearance',title:'Appearance',description:'Change the app colors and fonts.',Icon:Palette},{to:'/closeout/permissions',title:'Permissions',description:'Manage team access and permissions.',Icon:ShieldCheck},{to:'/settings/point-rules',title:'Point Rules',description:'Review and edit point categories, reasons and values.',Icon:ListChecks}]
 return <section className="page settings-home"><p className="eyebrow">General manager</p><h1>Settings</h1><div className="settings-cards">{items.map(({to,title,description,Icon})=><Link key={to} to={to}><Icon size={24}/><strong>{title}</strong><span>{description}</span></Link>)}</div></section>
}
