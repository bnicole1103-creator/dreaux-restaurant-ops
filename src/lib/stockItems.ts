const emptyAnswers=new Set(['','no','none','nothing','na','nil','noitems','noneatall','notapplicable','no86','no86s','no86items','no86editems','no86ditems','nothing86','nothing86ed','nothing86d','zero','yes'])
export function isActualStockItem(value:string){return !emptyAnswers.has(value.trim().toLowerCase().replace(/[^a-z0-9]/g,''))}
export function closeoutStockItems(answer:string,text:string):string[]{
 if(answer!=='yes'&&answer!=='no')throw Error('Please choose Yes or No for any 86’d items.')
 if(answer==='no')return []
 const items:string[]=[],seen=new Set<string>()
 for(const line of text.split(/\r?\n/)){const name=line.trim().replace(/\s+/g,' ');if(!isActualStockItem(name))continue;if(name.length>160)throw Error('Each 86’d item must be 160 characters or fewer.');const key=name.toLowerCase();if(!seen.has(key)){items.push(name);seen.add(key)}}
 if(!items.length)throw Error('Enter at least one actual 86’d item, or choose No.')
 if(items.length>50)throw Error('Enter up to 50 items, one per line.')
 return items
}
