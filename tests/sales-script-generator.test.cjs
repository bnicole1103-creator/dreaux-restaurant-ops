const fs=require('fs'),{execFileSync}=require('child_process')
const source=fs.readFileSync('src/lib/menuPlanScripts.ts','utf8')
for(const phrase of ['sensoryRules','turns.set(turnKey,turn+1)','scriptsFor(style,parts,tone,turn)','What makes it stand out','The profile is']){
 if(!source.includes(phrase))throw new Error('missing generator behavior: '+phrase)
}
execFileSync('./node_modules/.bin/esbuild',['src/lib/menuPlanScripts.ts','--bundle','--platform=node','--format=cjs','--outfile=/tmp/justinis-menu-scripts.cjs'],{stdio:'ignore'})
delete require.cache[require.resolve('/tmp/justinis-menu-scripts.cjs')]
const {menuPlanScripts}=require('/tmp/justinis-menu-scripts.cjs')
const item={id:'drink-1',name:'Citrus 75',category:'Cocktails',service:'all',description:'gin, fresh lemon, honey syrup, sparkling wine',prices:[{label:'Glass',cents:1600,minimum:1,unit:'drink'}]}
const choice={key:'drink-1:0',name:'Citrus 75',category:'Cocktails',price:item.prices[0]}
for(const tone of ['warm','brief']){
 const outputs=Array.from({length:8},()=>menuPlanScripts([choice],[item],'best',tone)[0].text)
 if(new Set(outputs).size!==outputs.length)throw new Error(tone+' generation repeated within eight tries')
 for(const output of outputs){
  if(!output.includes('Citrus 75'))throw new Error('item name missing')
  if(!/bright and citrusy|fresh lemon/i.test(output))throw new Error('grounded descriptive detail missing')
  if(!/[?]$/.test(output))throw new Error('conversation does not end with a question')
 }
}
const home=fs.readFileSync('src/components/HomeSalesQuick.tsx','utf8')
if(!home.includes('rows={6}'))throw new Error('home script editor is too short')
if(!home.includes('Try another script changes the approach, description and closing question.'))throw new Error('variation guidance is missing')
console.log('8 unique descriptive scripts verified for both styles')
