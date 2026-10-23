import {useEffect,useRef,useState} from 'react'
import {supabase} from './supabase'
export const recoveryPrefix='justinis-workspace-v1:'
export function readRecovery<T>(key:string):T|null{try{const raw=localStorage.getItem(key);if(!raw)return null;const saved=JSON.parse(raw);return saved.version===1?saved.value as T:null}catch{return null}}
export function writeRecovery(key:string,value:unknown){try{localStorage.setItem(key,JSON.stringify({version:1,updated:new Date().toISOString(),value}));return true}catch{return false}}
// User and location scope prevents another signed-in employee restoring this draft.
export function useWorkspaceRecovery<T>(scope:string,value:T,restore:(saved:T)=>void,enabled=true){
 const [user,setUser]=useState(''),[ready,setReady]=useState(''),[failed,setFailed]=useState(false)
 const current=useRef(value),restoreRef=useRef(restore),hydrated=useRef(''),skip=useRef(false)
 current.current=value;restoreRef.current=restore
 const key=user&&scope?recoveryPrefix+user+':'+scope:''
 useEffect(()=>{let active=true;void supabase.auth.getSession().then(r=>{if(active)setUser(r.data.session?.user.id??'')});return()=>{active=false}},[])
 useEffect(()=>{if(!key)return;hydrated.current='';skip.current=true;const saved=readRecovery<T>(key);if(saved)restoreRef.current(saved);hydrated.current=key;setReady(key)},[key])
 useEffect(()=>{if(!key||hydrated.current!==key||ready!==key)return;if(skip.current){skip.current=false;return}if(enabled)setFailed(!writeRecovery(key,value))},[key,ready,value,enabled])
 useEffect(()=>{if(!key)return;const flush=()=>{if(hydrated.current===key&&enabled)writeRecovery(key,current.current)};window.addEventListener('pagehide',flush);return()=>{flush();window.removeEventListener('pagehide',flush)}},[key,enabled])
 return {ready:!!key&&ready===key,failed,save:(next:T)=>key?writeRecovery(key,next):false,clear:()=>{if(key)try{localStorage.removeItem(key)}catch{}},key}
}
export function useWorkspaceScroll(key:string,ready:boolean){
 useEffect(()=>{
  if(!key||!ready)return
  const storageKey=key+':scroll';let target=0;try{target=Number(sessionStorage.getItem(storageKey)||0)}catch{}
  let restoring=target>0,frame=0,observer:ResizeObserver|undefined
  const restore=()=>{if(restoring){window.scrollTo({top:target,behavior:'instant'});if(window.scrollY>=target-2)restoring=false}}
  const save=()=>{if(!restoring)try{sessionStorage.setItem(storageKey,String(window.scrollY))}catch{}}
  const stop=()=>{restoring=false;observer?.disconnect();save()}
  if(restoring){frame=requestAnimationFrame(()=>requestAnimationFrame(restore));observer=new ResizeObserver(restore);observer.observe(document.body)}
  const timer=setTimeout(()=>{restoring=false;observer?.disconnect()},3000)
  window.addEventListener('scroll',save,{passive:true});window.addEventListener('wheel',stop,{passive:true});window.addEventListener('touchstart',stop,{passive:true});window.addEventListener('keydown',stop);window.addEventListener('pagehide',save)
  return()=>{save();cancelAnimationFrame(frame);clearTimeout(timer);observer?.disconnect();window.removeEventListener('scroll',save);window.removeEventListener('wheel',stop);window.removeEventListener('touchstart',stop);window.removeEventListener('keydown',stop);window.removeEventListener('pagehide',save)}
 },[key,ready])
}
