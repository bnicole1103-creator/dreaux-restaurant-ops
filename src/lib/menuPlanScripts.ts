import type {PricedChoice,SalesMenuItem} from './menuCatalog'
export type ScriptMoment='best'|'intro'|'addon'|'dessert'
export type ScriptTone='warm'|'brief'
const turns=new Map<string,number>()
export function menuPlanScripts(choices:PricedChoice[],items:SalesMenuItem[],moment:ScriptMoment,tone:ScriptTone){
 const seen=new Set<string>()
 return choices.filter(c=>!seen.has(c.key)&&!!seen.add(c.key)).map(c=>{
  const source=items.find(i=>i.prices.some((_,index)=>i.id+':'+index===c.key))
  const dessert=/dessert/i.test(c.category)&&!/cocktail|martini|float/i.test(c.name)
  const drinks=/cocktail|drink|beer|wine|champagne|martini|shot/i.test(c.category+' '+c.name)
  const style=moment==='best'?(dessert?'dessert':drinks?'intro':'intro'):moment
  const name=c.name+(c.price.label&&c.price.label!=='Menu price'?' ('+c.price.label+')':'')
  const description=(source?.description??'').trim().replace(/\s+/g,' ')
  const detail=tone==='warm'&&description?' '+description+(/[.!?]$/.test(description)?'':'.'):''
  const variants=style==='dessert'
   ?[`Before we wrap up, how about our ${name}?`,`Save a little room for ${name}.`,`For a finish to your meal, consider ${name}.`,`Can I tempt the table with ${name}?`,`Let’s talk dessert: ${name}.`,`One option before the check is ${name}.`]
   :style==='addon'
   ?[`Would you like to add ${name}?`,`While you’re looking, take a look at ${name}.`,`Another option for your order is ${name}.`,`How about ${name} as well?`,`If you’d like something else, there’s ${name}.`,`Let me put ${name} on your radar.`]
   :drinks
   ?[`What are you in the mood to sip? One option is ${name}.`,`For your drink, take a look at ${name}.`,`Let me introduce you to ${name}.`,`Have you considered ${name}?`,`I can tell you about our ${name}.`,`On the drinks menu, there’s ${name}.`]
   :[`What are you in the mood for? Take a look at ${name}.`,`One dish to consider is ${name}.`,`Let me tell you about ${name}.`,`Have you had a chance to look at ${name}?`,`Here’s an option for your meal: ${name}.`,`I’d like to put ${name} on your radar.`]
  const turnKey=c.key+':'+style+':'+tone,turn=turns.get(turnKey)??0
  turns.set(turnKey,turn+1)
  const start=variants[turn%variants.length]


  return {key:c.key,name:c.name,label:style==='dessert'?'Dessert offer':style==='addon'?'Add-on suggestion':drinks?'Drink recommendation':'Menu recommendation',text:start+detail+(tone==='warm'&&turn%2===1?' Would that fit what you’re looking for?':'')}
 })
}
