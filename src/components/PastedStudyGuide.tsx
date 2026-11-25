import { useWorkspaceRecovery } from '../lib/workspaceRecovery'
import {useEffect,useRef,useState} from 'react'
import type {TrainingKind} from '../lib/trainingContent'
import {supabase} from '../lib/supabase'
import {sourceStudyGuide,textGuideFields,validTextGuideSections,type TextGuideSection} from '../lib/textStudyGuide'
export function PastedStudyGuide({location,kind,onSaved,sourceText,onBusy}:{location:string;kind:TrainingKind;onSaved:(guide:any)=>void;sourceText?:string;onBusy?:(v:boolean)=>void}){
 const [pastedSource,setSource]=useState(''),[title,setTitle]=useState(''),[sections,setSections]=useState<TextGuideSection[]|null>(null),[warnings,setWarnings]=useState<string[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const [generatedSource,setGeneratedSource]=useState('')
 const source=sourceText??pastedSource
 const stale=!!sections&&generatedSource!==source
 const recovery=useWorkspaceRecovery(location?'training-guide:'+location+':'+kind:'',{pastedSource,title,sections,warnings,generatedSource},saved=>{
  if(typeof saved.pastedSource==='string')setSource(saved.pastedSource)
  if(typeof saved.title==='string')setTitle(saved.title)
  if(Array.isArray(saved.sections)&&typeof saved.generatedSource==='string'){
   setSections(saved.sections);setGeneratedSource(saved.generatedSource)
   setWarnings(Array.isArray(saved.warnings)?saved.warnings:[])
  }
 })

 const activity=useRef(onBusy);activity.current=onBusy
 useEffect(()=>{activity.current?.(busy);return()=>{activity.current?.(false)}},[busy])
 const lock=useRef(false),live=useRef(true)
 useEffect(()=>{live.current=true;return()=>{live.current=false}},[])
 function showPreview(draft:{title:string;sections:TextGuideSection[];warnings:string[]},message:string){
  if(!live.current)return
  setSections(draft.sections)
  setGeneratedSource(source)
  setWarnings(draft.warnings)
  if(!title.trim())setTitle(draft.title)
  setNotice(message)
 }
 function showSourcePreview(){
  showPreview(sourceStudyGuide(source,title),'Source-based preview ready. Review it before saving.')
 }
 async function generate(useSource=false){
  if(lock.current)return
  if(source.trim().length<30||source.length>12000){setError('Paste 30–12,000 characters of training content.');return}
  if(sections&&!window.confirm('Replace this study guide preview?'))return
  setError('');setNotice('')
  if(useSource){showSourcePreview();return}
  lock.current=true;setBusy(true)
  try{
   const result=await supabase.functions.invoke('training-guide-generate',{body:{location_id:location,title,source}})
   if(result.error){
    let detail=''
    try{detail=(await (result.error as any).context?.json())?.error??''}catch{}
    if(/No valid, source-backed sections|generated sections were invalid|generated guide format was invalid|No usable study guide/i.test(detail)){
     showSourcePreview();return
    }
    throw Error(detail||result.error.message)
   }
   if(!validTextGuideSections(result.data?.sections)){showSourcePreview();return}
   showPreview({
    title:typeof result.data.title==='string'&&result.data.title.trim()?result.data.title:'Training study guide',
    sections:result.data.sections,warnings:Array.isArray(result.data.warnings)?result.data.warnings:[],
   },'Guide generated. Review and edit the sections, then save to the bank.')
  }catch(e){if(live.current)setError(String((e as Error).message??e))}
  finally{lock.current=false;if(live.current)setBusy(false)}
 }
 async function save(){if(lock.current||!sections||stale)return;if(!validTextGuideSections(sections)||!title.trim()||title.length>160){setError('Enter a title and valid study sections before saving.');return}lock.current=true;setBusy(true);setError('')
 try{const r=await supabase.rpc('training_guide_create_text',{p_location_id:location,p_kind:kind,p_title:title.trim(),p_source:source,p_sections:sections});if(r.error)throw r.error;if(live.current){onSaved(r.data);setSections(null);setGeneratedSource('');setWarnings([]);setSource('');setTitle('');setNotice('Study guide saved to the bank.')}}catch(e){if(live.current)setError(String((e as Error).message??e))}finally{lock.current=false;if(live.current)setBusy(false)}}
 function patch(index:number,field:keyof TextGuideSection,value:string){setSections(old=>old?.map((s,i)=>i===index?{...s,[field]:value}:s)??null)}
 return <section className="pasted-study-guide" aria-label="Generate study guide from pasted paragraphs">{sourceText===undefined&&<p>Paste training notes, menu descriptions, service standards, or paragraphs. No recipe selection is required.</p>}{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}{recovery.failed&&<p role="alert">The guide draft could not save on this device.</p>}{stale&&<p role="status">The source changed. Restore it or generate a new preview before saving this guide.</p>}<fieldset disabled={busy||!location||!recovery.ready}><label>Study guide title<input aria-label="Pasted study guide title" maxLength={160} value={title} onChange={e=>setTitle(e.target.value)} placeholder="Guest service, menu knowledge, opening procedures…"/></label>{sourceText===undefined&&<><label>Paragraphs to turn into a study guide<textarea aria-label="Study guide source paragraphs" rows={10} value={source} onChange={e=>{setSource(e.target.value);setNotice('')}} placeholder="Paste your training paragraphs here…"/></label><p>{source.length.toLocaleString()}/12,000 characters. Changes to the source require a new preview before saving.</p></>}{source.length>12000&&<p role="alert">Split this text into smaller guides of up to 12,000 characters.</p>}<button type="button" disabled={source.trim().length<30||source.length>12000} onClick={()=>void generate()}>{busy?'Working…':sections?'Generate a new preview':'Generate study guide preview'}</button>{error&&<button type="button" disabled={source.trim().length<30||source.length>12000} onClick={()=>void generate(true)}>Create preview from source text</button>}{sections&&<><h3>Review your study guide</h3><p>Check every section against your source before saving. Generated text stays a draft until you save it.</p>{warnings.map((w,i)=><p role="status" key={i}>{w}</p>)}{sections.map((s,i)=><details key={i} open={sections.length===1||i===0}><summary>{i+1}. {s.name}</summary><label>Section heading<input aria-label={'Section '+(i+1)+' heading'} maxLength={160} value={s.name} onChange={e=>patch(i,'name',e.target.value)}/></label>{textGuideFields.map(([field,label])=><label key={field}>{label}<textarea rows={field==='build'?5:4} maxLength={12000} value={s[field]} onChange={e=>patch(i,field,e.target.value)}/></label>)}<button type="button" disabled={sections.length<=1} onClick={()=>setSections(old=>old?.filter((_,n)=>n!==i)??null)}>Remove this section</button></details>)}<button type="button" className="primary-button" disabled={!title.trim()||stale} onClick={()=>void save()}>Save study guide to bank</button></>}</fieldset></section>
}
