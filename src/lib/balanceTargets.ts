export type BalancedRow={key:string;group:string;hours:number;target:number}
/** Keep explicit targets fixed and distribute the remainder by selling hours. */
export function balanceTargets<T extends BalancedRow>(total:number,rows:T[],manual:Record<string,number>={}){
 const pinned=rows.filter(r=>manual[r.group+':'+r.key]!=null)
 if(!pinned.length)return {rows,issue:''}
 const cents=Math.round(total*100)
 if(!Number.isSafeInteger(cents)||cents<0)return {rows,issue:'The team target is invalid.'}
 if(pinned.some(r=>!Number.isFinite(manual[r.group+':'+r.key])||manual[r.group+':'+r.key]<0||Math.abs(manual[r.group+':'+r.key]*100-Math.round(manual[r.group+':'+r.key]*100))>.00001))return {rows,issue:'Manual targets must be valid nonnegative amounts with at most two decimals.'}
 const fixed=pinned.reduce((sum,r)=>sum+Math.round(manual[r.group+':'+r.key]*100),0),free=rows.filter(r=>manual[r.group+':'+r.key]==null),remaining=cents-fixed
 if(remaining<0)return {rows,issue:'Manual individual targets exceed the team goal. Lower or reset a manual target.'}
 if(!free.length&&remaining!==0)return {rows,issue:'All targets are manually set. They must add up to the team goal; reset a target to allow redistribution.'}
 const hours=free.reduce((sum,r)=>sum+r.hours,0)
 if(free.some(r=>!Number.isFinite(r.hours)||r.hours<=0))return {rows,issue:'Usable selling hours are required to redistribute the remaining goal.'}
 const allocated=free.map(r=>{const raw=remaining*r.hours/hours;return {id:r.group+':'+r.key,cents:Math.floor(raw),fraction:raw-Math.floor(raw)}})
 let left=remaining-allocated.reduce((sum,r)=>sum+r.cents,0)
 for(const r of [...allocated].sort((a,b)=>b.fraction-a.fraction||(a.id<b.id?-1:a.id>b.id?1:0))){if(left--<=0)break;r.cents++}
 const amounts=new Map(allocated.map(r=>[r.id,r.cents/100]))
 return {rows:rows.map(r=>({...r,target:manual[r.group+':'+r.key]??amounts.get(r.group+':'+r.key)!})),issue:''}
}
