import type {PricedChoice,SalesMenuItem} from './menuCatalog'
export type ScriptMoment='best'|'intro'|'addon'|'dessert'
export type ScriptTone='warm'|'brief'
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
  const start=tone==='brief'?(style==='dessert'?`Would you like to finish with our ${name}?`:style==='addon'?`Would you like to add our ${name} to your order?`:`May I recommend our ${name}?`):(style==='dessert'?`For dessert, I’d recommend our ${name}.`:style==='addon'?`You could also try our ${name}.`:`If you’re still deciding, I’d recommend our ${name}.`)

  return {key:c.key,name:c.name,label:style==='dessert'?'Dessert offer':style==='addon'?'Add-on suggestion':drinks?'Drink recommendation':'Menu recommendation',text:start+detail+(tone==='warm'?' '+(style==='dessert'?'Would you like to try it?':style==='addon'?'Would you like to give it a try?':'Does that sound like something you’d enjoy?'):'')}
 })
}
