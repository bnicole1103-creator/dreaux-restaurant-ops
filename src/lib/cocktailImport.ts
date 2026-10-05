export type RecipeData={name:string;category:string;build:string;method:string;finish:string;notes:string}
export const emptyRecipe=(category="JusTini's Signatures"):RecipeData=>({name:'',category,build:'',method:'',finish:'',notes:''})
export const recipeKey=(name:string)=>name.trim().replace(/\s+/g,' ').toLowerCase()
export function parseCocktails(text:string,category:string):RecipeData[]{
 if(text.length>500000)throw Error('Paste a smaller batch.');
 const blocks=text.replace(/\r\n?/g,'\n').split(/\n\s*-{3,}\s*\n|\n(?=\s*(?:name|cocktail|cocktail name)\s*:)/i).map(s=>s.trim()).filter(Boolean)
 if(!blocks.length||blocks.length>50)throw Error('Paste 1 to 50 recipes. Start each with Name: or separate recipes with --- on its own line.');
 const rows=blocks.map((block,index)=>{const row=emptyRecipe(category);let field:keyof RecipeData='build';for(const raw of block.split('\n')){const line=raw.trim();const m=line.match(/^(name|cocktail(?: name)?|category|ingredients|build|recipe|method|instructions|preparation|glass(?:ware)?|garnish|finish|notes)\s*:\s*(.*)$/i);if(m){const label=m[1].toLowerCase();field=/name|cocktail/.test(label)?'name':label==='category'?'category':/ingredients|build|recipe/.test(label)?'build':/method|instructions|preparation/.test(label)?'method':/glass|garnish|finish/.test(label)?'finish':'notes';if(field==='name'||field==='category'){row[field]=m[2].trim();field='build';}else row[field]+=(row[field]?'\n':'')+(field==='finish'&&label!=='finish'?m[1]+': ':'')+m[2]}else if(!row.name&&line){row.name=line}else{row[field]+=(row[field]?'\n':'')+raw}}
 if(!row.name.trim())throw Error('Recipe '+(index+1)+' needs a name.');return row})
 const seen=new Set<string>();for(const row of rows){const key=recipeKey(row.name);if(seen.has(key))throw Error('Duplicate in pasted batch: '+row.name);seen.add(key)}return rows
}
