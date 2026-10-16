export type ProfileData={closeouts:{date:string;sales:number|null;target:number|null}[];quizzes?:{date:string;score:number;total:number;percent:number}[];tasks?:{date:string;title:string;completed:number;total:number;active:boolean}[];points?:{date:string;points:number;description:string}[];ratings?:{date:string;rating:number}[];disposals?:unknown[];sections?:unknown[];scheduled_sections?:unknown[];activity?:{wallet?:{receipts:number;known_total:number;missing_totals:number;captured:number;recorded:number};reading?:{posts_opened:number;visible_ms?:number;basis:string};crew?:{messages:number}};manager_view:boolean}
const finite=(v:unknown):number|null=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null
export function analyzeProfile(p:ProfileData){
 const sales=p.closeouts.reduce((n,r)=>n+(finite(r.sales)??0),0)
 const paired=p.closeouts.filter(r=>(finite(r.target)??0)>0&&finite(r.sales)!==null)
 const pairedSales=paired.reduce((n,r)=>n+Number(r.sales),0),target=paired.reduce((n,r)=>n+Number(r.target),0)
 const quiz=(p.quizzes??[]).filter(q=>(finite(q.total)??0)>0&&finite(q.score)!==null)
 const questions=quiz.reduce((n,q)=>n+Number(q.total),0),correct=quiz.reduce((n,q)=>n+Number(q.score),0)
 const tasks=(p.tasks??[]).filter(t=>t.active&&t.total>0),taskTotal=tasks.reduce((n,t)=>n+Number(t.total),0),taskDone=tasks.reduce((n,t)=>n+Math.max(0,Math.min(Number(t.completed),Number(t.total))),0)
 const points=(p.points??[]).reduce((n,r)=>n+(finite(r.points)??0),0)
 const earned=(p.points??[]).reduce((n,r)=>n+Math.max(0,finite(r.points)??0),0),deducted=(p.points??[]).reduce((n,r)=>n+Math.min(0,finite(r.points)??0),0)
 const byDate=new Map<string,{date:string;sales:number;salesKnown:number;target:number|null;points:number;quizCorrect:number;quizTotal:number}>()
 function day(date:string){let r=byDate.get(date);if(!r){r={date,sales:0,salesKnown:0,target:null,points:0,quizCorrect:0,quizTotal:0};byDate.set(date,r)}return r}
 for(const r of p.closeouts){const d=day(r.date);d.sales+=finite(r.sales)??0;if(finite(r.sales)!==null)d.salesKnown++;if((finite(r.target)??0)>0)d.target=(d.target??0)+Number(r.target)}
 for(const r of p.points??[])day(r.date).points+=finite(r.points)??0
 for(const q of quiz){day(q.date).quizCorrect+=Number(q.score);day(q.date).quizTotal+=Number(q.total)}
 const series=[...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date))
 const ratings=(p.ratings??[]).filter(r=>(finite(r.rating)??0)>=1&&(finite(r.rating)??0)<=10);
 return {sales,salesRecords:p.closeouts.filter(r=>finite(r.sales)!==null).length,ratingCount:ratings.length,ratingAverage:ratings.length?ratings.reduce((n,r)=>n+Number(r.rating),0)/ratings.length:null,pairedSales,target,achievement:target>0?pairedSales/target*100:null,closeouts:p.closeouts.length,paired:paired.length,quizAttempts:quiz.length,quizPercent:questions?correct/questions*100:null,taskTotal,taskDone,taskPercent:taskTotal?taskDone/taskTotal*100:null,points,earned,deducted,series}
}
