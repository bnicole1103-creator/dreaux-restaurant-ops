const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
function load(path){const code=ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const exports={};vm.runInNewContext(code,{exports,crypto:require('node:crypto').webcrypto,console});return exports}
const scripts=load('src/lib/menuPlanScripts.ts');
const price={label:'Menu price',cents:1800,unit:'order',minimum:1};
const item={id:'x',name:'Signature Fizz',category:'Drink',description:'Blackberry and lemon with cognac.',prices:[price]},choice={key:'x:0',name:item.name,category:item.category,price};
const variants=Array.from({length:6},()=>scripts.menuPlanScripts([choice],[item],'best','warm')[0].text);
assert.equal(new Set(variants).size,6);assert(variants.every(v=>v.includes(item.description)));assert(variants.every(v=>!v.includes('best seller')));
assert(scripts.menuPlanScripts([choice],[item],'addon','brief')[0].text.includes('add'));
assert.equal(scripts.menuPlanScripts([choice,choice],[item],'best','warm').length,1);
const quiz=load('supabase/functions/preshift-quiz-generate/generate.ts');
assert(quiz.similarPrompt('How much cognac is in the blackberry fizz?','How much cognac is in the blackberry fizz?'));
assert(quiz.similarPrompt('Which garnish finishes the blackberry cognac fizz cocktail?','What garnish finishes the blackberry cognac fizz cocktail?'));
assert(!quiz.similarPrompt('Which garnish finishes the blackberry cognac fizz cocktail?','What printed check is presented before payment?'));
assert.equal(quiz.freshQuestions([{prompt:'Which garnish finishes the blackberry cognac fizz cocktail?'},{prompt:'What printed check is presented before payment?'}],['What garnish finishes the blackberry cognac fizz cocktail?']).length,1);
const body=quiz.requestBody('test','Today','Some exact source material.','2026-11-02',16,['Old question']);
assert.equal(JSON.parse(body.input[0].content).recent_questions[0],'Old question');
function response(data){return {status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(data)}]}]}}
const q={prompt:'Which garnish finishes the recipe?',category:'Recipe',options:['Lemon','Lime','Mint','Orange'],correct:0,correct_answer:'Lemon',explanation:'The source specifies lemon.',source_quote:'Finish with lemon.'};
const parsed=quiz.parseQuiz(response({title:'Today',questions:[q],warnings:[]}),q.source_quote,10);
assert.equal(parsed.questions.length,1);
assert.throws(()=>quiz.verifyQuiz(response({checks:[{index:0,supported:false,correct_answer:''}]}),parsed),/could not confirm/);
const verified=quiz.verifyQuiz(response({checks:[{index:0,supported:true,correct_answer:'Lemon'}]}),parsed);
assert.equal(verified.questions[0].options[verified.questions[0].correct],'Lemon');
console.log('11 script, novelty, source and answer checks passed');
