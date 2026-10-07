import { ScreenText } from "../components/ScreenText"
import { Link } from 'react-router-dom'
import { Palette, ShieldCheck, ListChecks } from 'lucide-react'
import './SettingsNavigation.css'
export function SettingsPage(){
 const items=[{to:'/guest-feedback',title:'Guest Feedback',description:'Print the guest feedback QR code and review comments and concerns.',Icon:ListChecks},{to:'/settings/wording',title:'Screen Wording',description:'Edit headings, instructions and labels throughout the app.',Icon:ListChecks},{to:'/settings/sales-targets',title:'Sales Targets',description:'Enter six weeks of net sales and allocate targets from 7shifts.',Icon:ListChecks},{to:'/appearance',title:'Appearance',description:'Change the app colors and fonts.',Icon:Palette},{to:'/closeout/permissions',title:'Permissions',description:'Manage team access and permissions.',Icon:ShieldCheck},{to:'/settings/point-rules',title:'Point Rules',description:'Review and edit point categories, reasons and values.',Icon:ListChecks}]
 return <section className="page settings-home"><p className="eyebrow"><ScreenText id="SettingsPage.a4baa08020e55315">General manager</ScreenText></p><h1><ScreenText id="SettingsPage.5a052c1146480afc">Settings</ScreenText></h1><div className="settings-cards">{items.map(({to,title,description,Icon})=><Link key={to} to={to}><Icon size={24}/><strong>{title}</strong><span>{description}</span></Link>)}</div></section>
}
