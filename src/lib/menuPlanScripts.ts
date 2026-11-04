import type {PricedChoice,SalesMenuItem} from './menuCatalog'

export type ScriptMoment='best'|'intro'|'addon'|'dessert'
export type ScriptTone='warm'|'brief'

type ScriptKind='food'|'drink'|'dessert'
type ScriptParts={name:string;description:string;qualities:string;kind:ScriptKind}

const turns=new Map<string,number>()
const sensoryRules:[RegExp,string][]=[
 [/lemon|lime|orange|grapefruit|citrus|yuzu/i,'bright and citrusy'],
 [/cream|creamy|mascarpone|custard|butter|cheesecake/i,'rich and creamy'],
 [/crisp|crispy|fried|toasted|crunch/i,'crisp'],
 [/jalape|habanero|cayenne|chili|chilli|spicy|hot sauce|pepper/i,'a little heat'],
 [/honey|caramel|vanilla|chocolate|syrup|sweet/i,'a touch of sweetness'],
 [/mint|basil|rosemary|thyme|herb/i,'fresh and herbal'],
 [/smok|jerk|blacken|char|barbecue|bbq/i,'smoky and savory'],
 [/champagne|prosecco|sparkling|soda|tonic|bubbles/i,'light and bubbly'],
 [/shrimp|crab|oyster|fish|salmon|seafood/i,'seafood-forward'],
 [/cognac|bourbon|whiskey|whisky|rum|tequila|mezcal|vodka|gin/i,'spirit-forward'],
]

function sentence(value:string){
 const clean=value.trim().replace(/\s+/g,' ').replace(/\s*([,;])\s*/g,'$1 ')
 return clean?clean+(/[.!?]$/.test(clean)?'':'.'):''
}
function spokenDescription(value:string){
 const clean=value.trim().replace(/\s+/g,' ').replace(/[.;]+$/,'')
 if(!clean)return ''
 const parts=clean.split(/\s*[;|•]\s*|\s*,\s*/).filter(Boolean)
 if(parts.length<2)return clean
 if(parts.length===2)return `${parts[0]} and ${parts[1]}`
 return `${parts.slice(0,-1).join(', ')}, and ${parts[parts.length-1]}`
}
function qualities(value:string){
 const found=sensoryRules.filter(([pattern])=>pattern.test(value)).map(([,label])=>label)
 const unique=[...new Set(found)].slice(0,2)
 return unique.length===2?`${unique[0]} with ${unique[1]}`:unique[0]??''
}
function itemKind(category:string,name:string):ScriptKind{
 const text=`${category} ${name}`
 if(/dessert|cake|pie|pudding|brownie|ice cream|sorbet/i.test(text)&&!/cocktail|martini|drink/i.test(text))return 'dessert'
 if(/cocktail|drink|beer|wine|champagne|martini|shot|spirit|bourbon|whiskey|vodka|rum|tequila|gin/i.test(text))return 'drink'
 return 'food'
}
function detailLines(parts:ScriptParts,tone:ScriptTone,turn:number){
 const {description,qualities,kind}=parts
 if(!description)return tone==='brief'?[]:[kind==='drink'?'It is a good choice when you want to try one of our featured drinks.':kind==='dessert'?'It is an easy way to finish the meal with something special.':'It is a good choice when you want to try one of our featured dishes.']
 const spoken=spokenDescription(description)
 const lead=qualities
  ?[ `The profile is ${qualities}. It features ${spoken}.`, `You get a ${qualities} combination built around ${spoken}.`, `What makes it stand out is the ${qualities} profile: ${spoken}.`, `It brings ${spoken} together in a ${qualities} combination.` ][turn%4]
  :[ `What makes it stand out is ${spoken}.`, `It brings together ${spoken}.`, `The menu description highlights ${spoken}.`, `The heart of it is ${spoken}.` ][turn%4]
 if(tone==='brief')return [sentence(lead)]
 const follow=kind==='drink'
  ?['It works well as a first round or as the drink you settle into for the meal.','It gives the guest a clear flavor direction without making the order feel complicated.','It is a useful recommendation when someone wants a drink with a distinct point of view.']
  :kind==='dessert'
  ?['It gives the table something memorable to share or a satisfying finish for one.','It is a natural last course when the table wants one more good thing.','It makes the finish of the meal feel intentional instead of rushed.']
  :['It gives the guest a clear reason to choose it instead of simply reading back the menu.','It is easy to recommend when a guest wants something with a clear flavor direction.','It gives the table a specific, confident choice without overselling it.']
 return [sentence(lead),follow[turn%follow.length]]
}
function scriptsFor(style:ScriptMoment,parts:ScriptParts,tone:ScriptTone,turn:number){
 const {name,kind}=parts,cycle=Math.floor(turn/4),details=detailLines(parts,tone,turn+cycle)
 const close=kind==='drink'
  ?['Would you like to start with one?','Does that sound like your kind of drink?','Want me to bring one for the first round?','Would that fit what you are in the mood to sip?']
  :kind==='dessert'
  ?['Should I bring one for the table?','Would you like to save room for it?','Want to finish with one?','Does that sound like the right ending?']
  :['Would that fit what you are in the mood for?','Should I put one in for you?','Does that sound like your kind of dish?','Want to give that one a try?']
 const closing=close[(turn+cycle*2)%close.length]
 const intro=[
  [`If you want a recommendation, I would point you toward the ${name}.`,...details,closing],
  [`One item worth a closer look is the ${name}.`,details[0],details[1],closing],
  [`The ${name} has a lot more personality than a name on the menu can show.`,...details,closing],
  [`Let me give you a real picture of the ${name}.`,...details,closing],
 ]
 const addon=[
  [`The ${name} would be a strong addition to what you have ordered.`,...details,closing],
  [`If you want to round out the order, consider the ${name}.`,details[0],details[1],closing],
  [`There is room to make this order even better with the ${name}.`,...details,closing],
  [`A good next move for the table would be the ${name}.`,...details,closing],
 ]
 const dessert=[
  [`Before I let you go, the ${name} is worth hearing about.`,...details,closing],
  [`If the table wants a proper finish, I would choose the ${name}.`,details[0],details[1],closing],
  [`You do not have to decide on dessert from the name alone—the ${name} is the one I would describe.`,...details,closing],
  [`For one last course, take a look at the ${name}.`,...details,closing],
 ]
 const selected=style==='addon'?addon:style==='dessert'?dessert:intro
 return selected[turn%selected.length].filter(Boolean).join(' ')
}

export function menuPlanScripts(choices:PricedChoice[],items:SalesMenuItem[],moment:ScriptMoment,tone:ScriptTone){
 const seen=new Set<string>()
 return choices.filter(c=>!seen.has(c.key)&&!!seen.add(c.key)).map(c=>{
  const source=items.find(i=>i.prices.some((_,index)=>i.id+':'+index===c.key))
  const kind=itemKind(c.category,c.name)
  const style=moment==='best'?(kind==='dessert'?'dessert':'intro'):moment
  const name=c.name+(c.price.label&&c.price.label!=='Menu price'?` (${c.price.label})`:'')
  const description=(source?.description??'').trim()
  const turnKey=`${c.key}:${style}:${tone}`,turn=turns.get(turnKey)??0
  turns.set(turnKey,turn+1)
  const parts={name,description,qualities:qualities(description),kind}
  return {key:c.key,name:c.name,label:c.price.label||c.category,text:scriptsFor(style,parts,tone,turn)}
 })
}
