export type TaskGroup={title:string;tasks:{text:string;index:number}[]}
const names:Record<string,string>={'courtyard':'Courtyard Setup','setup main dining':'Store / Dining Room Setup','set up bar':'Bar Setup','fruit tray':'Fruit Tray Setup','garnish setup':'Garnish Setup','non-alcoholic beverages':'Non-alcoholic beverages','non alcoholic beverages':'Non-alcoholic beverages','soft drinks':'Non-alcoholic beverages','water':'Non-alcoholic beverages','dry goods':'Dry goods & disposables','dry good':'Dry goods & disposables','disposables':'Dry goods & disposables','juices/ mixers/ purées':'Juice, Mixer & Purée Restocking','beers':'Beer Restocking','import':'Imported Beer Restocking','local':'Local Beer & Seltzer Restocking','wine/ champagne':'White Wine & Rosé Restocking','red wine':'Red Wine Restocking','champagne':'Champagne & Prosecco Restocking','other items to be stocked on':'Service Supplies Restocking',"other to do's":'Reservations & Service Prep'}
const inferred = /^(?:stock|restock|refill|replenish|count|rotate)\b/i
function inferredGroup(text:string,fallback:string) {
 if(!inferred.test(text)) return fallback
 if(/\b(soft drinks?|soda|bottled water|sparkling water|non[- ]alcoholic)\b/i.test(text)) return 'Non-alcoholic beverages'
 if(/\b(dry goods|napkins?|straws?|to-go containers?|takeout bags?|disposables)\b/i.test(text)) return 'Dry goods & disposables'
 return fallback
}
export function taskGroups(items:string[],fallback='Tasks'):TaskGroup[]{
 const categories=new Map<string,{text:string;index:number}[]>()
 items.forEach((item,index)=>{const colon=item.indexOf(':');const prefix=colon>=1&&colon<=60?item.slice(0,colon).trim():'';const title=prefix?(names[prefix.toLowerCase()]??prefix):inferredGroup(item,fallback);const tasks=categories.get(title)??[];tasks.push({text:prefix?item.slice(colon+1).trim()||item:item,index});categories.set(title,tasks)})
 return [...categories].flatMap(([title,tasks])=>Array.from({length:Math.ceil(tasks.length/8)},(_,part)=>({title:tasks.length>8?`${title} · Part ${part+1} of ${Math.ceil(tasks.length/8)}`:title,tasks:tasks.slice(part*8,part*8+8)})))
}
