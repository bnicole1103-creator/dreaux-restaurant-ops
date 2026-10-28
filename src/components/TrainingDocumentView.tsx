import {cleanGuideStyle,guideCSS} from '../lib/trainingGuideStyle'
import {TrainingGuideMedia} from './TrainingGuideMedia'
import './TrainingGuideStyle.css'
import {PageWord} from './PageDesign'
import {useEffect,useRef,useState} from 'react'
import {assetBytes,assetType,pdfLibrary,pdfOptions,type TrainingDocument} from '../lib/trainingContent'
function PdfPages({data}:{data:string}){
 const host=useRef<HTMLDivElement>(null),[error,setError]=useState(''),[progress,setProgress]=useState('Loading document…')
 useEffect(()=>{let cancelled=false,task:any,render:any;setError('');setProgress('Loading document…');host.current?.replaceChildren();void(async()=>{try{const pdf=await pdfLibrary();if(cancelled)return;task=pdf.getDocument(pdfOptions(assetBytes(data)));const doc=await task.promise;if(doc.numPages>30)throw Error('This document exceeds the 30-page viewer limit.');for(let n=1;n<=doc.numPages;n++){if(cancelled)return;const page=await doc.getPage(n),base=page.getViewport({scale:1}),scale=Math.min(1.7,1200/base.width),viewport=page.getViewport({scale});const canvas=document.createElement('canvas');canvas.width=viewport.width;canvas.height=viewport.height;canvas.setAttribute('role','img');canvas.setAttribute('aria-label','Document page '+n);host.current?.append(canvas);render=page.render({canvasContext:canvas.getContext('2d')!,viewport});await render.promise;if(!cancelled)setProgress('Page '+n+' of '+doc.numPages)}if(!cancelled)setProgress(doc.numPages+' pages')}catch(e){if(!cancelled)setError(String((e as Error).message))}})();return()=>{cancelled=true;render?.cancel();void task?.destroy()}},[data])
 return <><p role="status">{progress}</p>{error&&<p role="alert">{error}</p>}<div className="training-pdf-pages" ref={host}/></>
}
export function TrainingDocumentView({document:doc}:{document:TrainingDocument}){
 const type=assetType(doc.asset_data??'')
 function download(){const blob=type?new Blob([assetBytes(doc.asset_data!)],{type}):new Blob([doc.body],{type:'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=doc.filename||doc.title+'.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000)}
 const style=cleanGuideStyle(doc.presentation)
 return <article className={'training-document training-guide-styled guide-layout-'+style.layout} style={guideCSS(style)}><h3><span className="guide-icon">{style.icon}</span>{doc.title}</h3>{doc.category&&<p className="guide-metadata">{doc.category}{doc.tags?.length?' · '+doc.tags.join(' · '):''}</p>}<TrainingGuideMedia path={doc.video_path} url={doc.video_url}/><div className="guide-body">{doc.body.split(/\n\s*\n/).map((p,i)=><p key={i} className="guide-reading-text">{p}</p>)}</div>{type&&<details><summary>Original uploaded document</summary>{type==='application/pdf'?<PdfPages data={doc.asset_data!}/>:type.startsWith('image/')?<img className="training-document-image" src={doc.asset_data} alt={doc.title}/>:null}</details>}<button type="button" onClick={download}>Download original / text</button></article>
}
