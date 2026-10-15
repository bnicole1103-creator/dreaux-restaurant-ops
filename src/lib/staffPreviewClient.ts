import {createClient,type SupabaseClient,type Session,type User} from '@supabase/supabase-js'
export const staffPreviewId=typeof window==='undefined'?null:new URLSearchParams(window.location.search).get('staff-preview')
export const staffPreviewActive=staffPreviewId!==null
export function createStaffPreviewClient(normal:SupabaseClient,url:string,key:string):SupabaseClient{
 // Isolate preview-only preferences from the manager's real browser storage.
 const memory=()=>{const values=new Map<string,string>();return {get length(){return values.size},key:(i:number)=>Array.from(values.keys())[i]??null,getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,String(v))},removeItem:(k:string)=>{values.delete(k)},clear:()=>values.clear()}}
 Object.defineProperty(window,'localStorage',{value:memory(),configurable:true})
 Object.defineProperty(window,'sessionStorage',{value:memory(),configurable:true})
 const nativeFetch=window.fetch.bind(window)
 window.fetch=async(input,init)=>{const req=new Request(input,init);if(!['GET','HEAD'].includes(req.method))return new Response(JSON.stringify({message:'Staff preview blocks direct write requests.'}),{status:403,headers:{'Content-Type':'application/json'}});return nativeFetch(req)}
 if(typeof navigator!=='undefined'&&'serviceWorker' in navigator)Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{getRegistration:async()=>undefined,getRegistrations:async()=>[],register:async()=>{throw Error('Service worker changes are disabled in Staff View.')},ready:Promise.resolve(undefined)}})
 let identityPromise:Promise<{user:User;location_id:string;organization_id:string;target_id:string;expires_at:string}>|null=null
 const report=(message:string)=>{window.dispatchEvent(new CustomEvent('staff-preview-error',{detail:message}))}
 async function call(body:Record<string,unknown>){
  const session=await normal.auth.getSession();if(!session.data.session)throw Error('Sign in as a Management before starting Staff View.')
  const response=await nativeFetch(url+'/functions/v1/staff-preview',{method:'POST',headers:{Authorization:'Bearer '+session.data.session.access_token,apikey:key,'Content-Type':'application/json'},body:JSON.stringify({...body,session:staffPreviewId}),cache:'no-store'})
  return response
 }
 const identity=()=>identityPromise??=(async()=>{if(!/^[0-9a-f-]{36}$/i.test(staffPreviewId??''))throw Error('Invalid preview session.');const r=await call({kind:'identity'}),data=await r.json();if(!r.ok)throw Error(data.message??'Staff preview could not start.');return data})()
 const blocked=()=>new Response(JSON.stringify({message:'Read-only staff preview: this action is disabled.',code:'STAFF_PREVIEW_READONLY'}),{status:403,headers:{'Content-Type':'application/json'}})
 const preview=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(input,init)=>{
  try{
   const request=new Request(input,init),u=new URL(request.url),segments=u.pathname.split('/').filter(Boolean)
   if(u.origin!==new URL(url).origin)return blocked()
   if(segments[0]==='storage'){
    if(request.method==='GET'&&segments[1]==='v1'&&segments[2]==='object'&&segments[3]==='public')return nativeFetch(request)
    return blocked()
   }
   await identity()
   let body:Record<string,unknown>
   if(segments[0]==='rest'&&segments[1]==='v1'&&segments[2]==='rpc'){
    if(!['GET','POST'].includes(request.method))return blocked()
    body={kind:'rpc',name:segments[3],args:request.method==='POST'?await request.json():Object.fromEntries(u.searchParams)}
   }else if(segments[0]==='rest'&&segments[1]==='v1'&&['GET','HEAD'].includes(request.method)){
    const range=request.headers.get('range');if(range){const m=range.match(/^(\d+)-(\d+)$/);if(!m)return blocked();u.searchParams.set('offset',m[1]);u.searchParams.set('limit',String(Number(m[2])-Number(m[1])+1))}
    body={kind:'table',method:request.method,name:segments[2],query:u.searchParams.toString(),single:request.headers.get('accept')?.includes('vnd.pgrst.object')??false}
   }else if(segments[0]==='functions'&&segments[2]==='home-schedule')body={kind:'schedule',args:await request.json()}
   else return blocked()
   const response=await call(body)
   if(!response.ok){const detail=await response.clone().json().catch(()=>({message:'Staff preview read failed.'}));report(detail.message??'Staff preview read failed.')}
   return response
  }catch(e){const message=(e as Error).message;report(message);return new Response(JSON.stringify({message,code:'STAFF_PREVIEW_FAILED'}),{status:503,headers:{'Content-Type':'application/json'}})}
 }}})
 const getSession=async()=>{try{const i=await identity();return {data:{session:{access_token:'staff-preview-readonly',refresh_token:'',token_type:'bearer',expires_in:900,expires_at:Math.floor(new Date(i.expires_at).getTime()/1000),user:i.user} as Session},error:null}}catch(e){report((e as Error).message);return {data:{session:null},error:e}}}
 Object.assign(preview.auth,{getSession,getUser:async()=>{try{return {data:{user:(await identity()).user},error:null}}catch(e){return {data:{user:null},error:e}}},onAuthStateChange:()=>({data:{subscription:{unsubscribe:()=>{},id:'staff-preview'}}}),signOut:async()=>({error:new Error('Exit Staff View using the manager toolbar.')}),refreshSession:getSession})
 return preview
}
