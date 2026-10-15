import {useEffect,useState} from 'react'
import {useLocation} from 'react-router-dom'
import {supabase} from '../lib/supabase'
import {loadTenantData} from '../lib/tenant'
import {emptyTheme,themeCss,type ThemeConfig} from '../lib/appTheme'
import {accessPage} from '../lib/accessCatalog'
import './AppTheme.css'
export function AppThemeRuntime(){
 const {pathname,search}=useLocation(),[config,setConfig]=useState<ThemeConfig>(emptyTheme)
 useEffect(()=>{let live=true,seq=0;async function refresh(){const ticket=++seq;try{const tenant=await loadTenantData(),loc=tenant.locations[0]?.id;if(!loc){if(live)setConfig(emptyTheme);return}const r=await supabase.rpc('app_theme_load',{p_location_id:loc});if(live&&ticket===seq)setConfig(r.error?emptyTheme:r.data.config)}catch{if(live&&ticket===seq)setConfig(emptyTheme)}}
 void refresh();const timer=setInterval(()=>void refresh(),60000);window.addEventListener('app-theme-changed',refresh);window.addEventListener('focus',refresh);const {data:{subscription}}=supabase.auth.onAuthStateChange(()=>{seq++;setConfig(emptyTheme);void refresh()})
 return()=>{live=false;seq++;clearInterval(timer);window.removeEventListener('app-theme-changed',refresh);window.removeEventListener('focus',refresh);subscription.unsubscribe()}
 },[])
 useEffect(()=>{const main=document.getElementById('app-main'),page=accessPage(pathname),view=new URLSearchParams(search).get('view');if(!main)return
 const part=page==='closeout'?(pathname.includes('/manager')?'manager':'staff'):page==='team'?'roster':page==='points'?'mine':page==='settings'?(view==='styling'?'styling':pathname.includes('permissions')?'permissions':undefined):page==='tasks'?(view==='assign'?'assign':view==='presets'?'presets':view==='progress'?'team':'mine'):page==='training'?(pathname.includes('/cocktails')?'cocktails':pathname.includes('/food')?'food':undefined):page==='quizzes'?(pathname.includes('/build')?'builder':'published'):page==='summary'?(pathname.includes('/cash')?'cash':'closeouts'):undefined
 if(part)main.dataset.themeSection=page+'.'+part;else delete main.dataset.themeSection
 return()=>{delete main.dataset.themeSection}
 },[pathname,search])
 const css=themeCss(config,accessPage(pathname))
 return css?<style data-app-theme="active">{css}</style>:null
}
