function moneyCents(text:string){
 if(text.trim()==='')return null
 const value=Number(text),cents=Math.round(value*100)
 return Number.isFinite(value)&&value>=0&&Number.isSafeInteger(cents)?cents:null
}
export function salesProgressPlan(target:number|null,spend:string,current:string){
 if(target===null||!Number.isFinite(target)||target<0)return null
 const goal=Math.round(target*100);if(!Number.isSafeInteger(goal))return null
 const currentCents=moneyCents(current),spendCents=moneyCents(spend)
 const remaining=currentCents===null?null:Math.max(0,goal-currentCents)
 return {
  target:goal/100,current:currentCents===null?null:currentCents/100,
  remaining:remaining===null?null:remaining/100,
  over:currentCents===null?null:Math.max(0,currentCents-goal)/100,
  percent:currentCents===null?null:goal===0?100:Math.min(100,currentCents/goal*100),
  spend:spendCents!==null&&spendCents>0?spendCents/100:null,
  guests:remaining===null?null:remaining===0?0:spendCents!==null&&spendCents>0?Math.ceil(remaining/spendCents):null,
  fiveDollarAdds:remaining===null?null:Math.ceil(remaining/500),
  tenDollarAdds:remaining===null?null:Math.ceil(remaining/1000),
  stage:remaining===null?'start':remaining===0?'reached':remaining<=10000?'close':'build',
 }
}
