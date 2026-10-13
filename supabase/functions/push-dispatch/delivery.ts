type Job={id:string;token:string;subscription:{endpoint:string;keys:{p256dh:string;auth:string}};payload:unknown}
type Client={rpc:(name:string,args?:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>}
export function allowedEndpoint(endpoint:string){
 try{const u=new URL(endpoint);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['web.push.apple.com','fcm.googleapis.com','updates.push.services.mozilla.com'].includes(u.hostname)}catch{return false}
}
export async function deliverBatch(client:Client,send:(job:Job)=>Promise<number>){
 const claim=await client.rpc('push_claim');if(claim.error)throw Error('Unable to claim push queue');
 const jobs=claim.data as Job[];let sent=0,failed=0;
 for(let i=0;i<jobs.length;i+=5){await Promise.all(jobs.slice(i,i+5).map(async job=>{
  let status=400;try{if(allowedEndpoint(job.subscription.endpoint))status=await send(job)}catch{status=503}
  const finished=await client.rpc('push_finish',{p_id:job.id,p_token:job.token,p_status:status});
  if(finished.error)throw Error('Unable to finish push delivery');
  if(status>=200&&status<300)sent++;else failed++;
 }))}
 return {claimed:jobs.length,sent,failed};
}
