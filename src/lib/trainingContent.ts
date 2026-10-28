import type {GuideStyle} from './trainingGuideStyle'
import {supabase} from './supabase'
export type TrainingKind='food'|'cocktails'|'service'
export type TrainingDocument={id:string;version:number;shelf:'menu'|'service';title:string;body:string;filename:string;asset_data?:string;created_at?:string;category?:string;tags?:string[];presentation?:GuideStyle;video_path?:string;video_url?:string}
export const uploadAccept='.pdf,.png,.jpg,.jpeg,.webp,.txt,.md'
export const sourceLimit=12000
export function assetType(data:string){return /^data:(application\/pdf|image\/(?:png|jpeg|webp));base64,[A-Za-z0-9+/]+={0,2}$/.exec(data)?.[1]??''}
export function assetBytes(data:string){const raw=atob(data.split(',')[1]);return Uint8Array.from(raw,c=>c.charCodeAt(0))}
export function pdfOptions(data:Uint8Array){return {data,isEvalSupported:false,useSystemFonts:false,standardFontDataUrl:import.meta.env.BASE_URL+'training-pdf/standard_fonts/'}}
export async function pdfLibrary(){const pdf=await import('pdfjs-dist');pdf.GlobalWorkerOptions.workerSrc=new URL('pdfjs-dist/build/pdf.worker.min.mjs',import.meta.url).href;return pdf}
export async function readTrainingFile(file:File,location:string,section:'food'|'cocktails'|'service'='service'):Promise<{body:string;asset_data:string;filename:string}>{
 if(file.size>5*1024*1024)throw Error('Choose a file up to 5 MB.')
 const ext=file.name.split('.').pop()?.toLowerCase()
 if(ext==='txt'||ext==='md'){const body=await file.text();if(body.includes('\0'))throw Error('Choose a plain UTF-8 text file.');if(body.length>sourceLimit)throw Error('This file exceeds 12,000 characters. Split it into smaller documents.');return {body,asset_data:'',filename:file.name}}
 const mime=ext==='pdf'?'application/pdf':ext==='png'?'image/png':ext==='jpg'||ext==='jpeg'?'image/jpeg':ext==='webp'?'image/webp':''
 if(!mime)throw Error('Choose PDF, JPG, PNG, WebP, TXT or Markdown. Export Word documents as PDF first.')
 const bytes=new Uint8Array(await file.arrayBuffer())
 const valid=mime==='application/pdf'?new TextDecoder().decode(bytes.slice(0,5))==='%PDF-':mime==='image/png'?bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71:mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216:new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP'
 if(!valid)throw Error('The file does not match its file type. Export it again and retry.')
 const asset_data=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve('data:'+mime+';base64,'+String(r.result).split(',')[1]);r.onerror=()=>reject(Error('Unable to read the file.'));r.readAsDataURL(file)})
 if(mime==='application/pdf'){
  const pdf=await pdfLibrary(),task=pdf.getDocument(pdfOptions(bytes))
  try{const doc=await task.promise;if(doc.numPages>30)throw Error('Choose a PDF with up to 30 pages.');let body='';for(let n=1;n<=doc.numPages;n++){const page=await doc.getPage(n),text=await page.getTextContent();body+=text.items.map(i=>'str' in i?i.str+('hasEOL' in i&&i.hasEOL?'\n':' '):'').join('')+'\n\n';if(body.length>sourceLimit)throw Error('This PDF exceeds 12,000 characters. Split it into smaller documents.')}if(body.trim().length>=30)return {body:body.trim(),asset_data,filename:file.name}}finally{await task.destroy()}
 }
 const r=await supabase.functions.invoke('training-content-extract',{body:{location_id:location,section,asset_data}})
 if(r.error){let detail='';try{detail=(await (r.error as any).context?.json())?.error??''}catch{}throw Error(detail||r.error.message)}
 if(typeof r.data?.text!=='string'||r.data.text.trim().length<1||r.data.text.length>sourceLimit)throw Error('No readable text was found. Paste the document text instead.')
 return {body:r.data.text,asset_data,filename:file.name}
}
export function combineTrainingSources(sources:{title:string;body:string}[],paste:string){return [...sources.map(s=>'SOURCE: '+s.title+'\n'+s.body),paste.trim()].filter(Boolean).join('\n\n---\n\n')}
