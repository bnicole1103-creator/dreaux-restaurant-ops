import type { Question } from '../pages/QuizzesPage'
export type UploadedQuiz={title:string;instructions:string;quizDate:string;questions:Question[]}
const str=(v:unknown)=>typeof v==='string'?v:''
function correctIndex(value:unknown,options:string[],zeroBased=false):number{
 if(zeroBased&&typeof value==='number'&&Number.isInteger(value))return value
 const s=String(value??'').trim().replace(/^(?:correct\s*)?answer\s*:\s*/i,'')
 if(/^[A-F][.)]?$/i.test(s))return s[0].toUpperCase().charCodeAt(0)-65
 const index=options.findIndex(o=>o.toLowerCase()===s.toLowerCase());if(index>=0)return index
 throw new Error('Each correct answer must be a choice letter (A–F), its full text, or a zero-based JSON correct index.')
}
function validate(input:unknown,title='',instructions='',quizDate=''):UploadedQuiz{
 if(!Array.isArray(input)||input.length<1||input.length>50)throw new Error('Upload 1 to 50 questions.')
 const questions=input.map((q,index)=>{
  if(!q||typeof q!=='object')throw new Error(`Question ${index+1} is invalid.`)
  const prompt=str(q.prompt??q.question).trim(),category=str(q.category??'Pre-Shift').trim(),explanation=str(q.explanation??'').trim()
  if(!prompt||prompt.length>2000)throw new Error(`Question ${index+1} needs text, up to 2,000 characters.`)
  if(category.length>100||explanation.length>2000)throw new Error(`Question ${index+1}: shorten the category or explanation.`)
  if(!Array.isArray(q.options)||q.options.length<2||q.options.length>6||q.options.some((o:unknown)=>typeof o!=='string'||!o.trim()||o.length>1000))throw new Error(`Question ${index+1} needs 2–6 filled-in choices.`)
  const options=q.options.map((o:string)=>o.trim()) as string[]
  if(new Set(options.map(o=>o.toLowerCase())).size!==options.length)throw new Error(`Question ${index+1} has duplicate choices.`)
  const correct=correctIndex(q.correct??q.correct_answer,options,q.correct!==undefined)
  if(correct<0||correct>=options.length)throw new Error(`Question ${index+1}: the correct answer is outside its choices.`)
  return {prompt,category:category||'Pre-Shift',options,correct,explanation}
 })
 if(title.length>200||instructions.length>4000)throw new Error('Shorten the quiz title or instructions.')
 if(quizDate&&!/^\d{4}-\d{2}-\d{2}$/.test(quizDate))throw new Error('Use YYYY-MM-DD for the quiz date.')
 return {title,instructions,quizDate,questions}
}
function csvRows(text:string):string[][]{
 const rows:string[][]=[];let row:string[]=[],cell='',quoted=false
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++}else if(quoted)quoted=false;else if(!cell.trim())quoted=true;else throw new Error('Invalid CSV quote. Use the CSV template.')}else if(c===','&&!quoted){row.push(cell.trim());cell=''}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell.trim());if(row.some(Boolean))rows.push(row);row=[];cell=''}else cell+=c}
 if(quoted)throw new Error('The CSV has an unclosed quotation mark.')
 row.push(cell.trim());if(row.some(Boolean))rows.push(row);return rows
}
export function parseQuizUpload(text:string,format:'json'|'csv'|'text'):UploadedQuiz{
 text=text.replace(/^\uFEFF/,'').trim();if(!text)throw new Error('The quiz is empty.')
 if(format==='json'){const parsed=JSON.parse(text);return validate(Array.isArray(parsed)?parsed:parsed.questions,str(parsed.title),str(parsed.instructions),str(parsed.quiz_date))}
 if(format==='csv'){
  const [headers,...rows]=csvRows(text);if(!headers||!rows.length)throw new Error('The CSV needs a header and question rows.')
  const names=headers.map(s=>s.toLowerCase().replace(/[\s-]+/g,'_'));if(new Set(names).size!==names.length)throw new Error('The CSV has duplicate headers.')
  if(!names.includes('question')&&!names.includes('prompt'))throw new Error('The CSV needs a question column.')
  const items=rows.map((row,i)=>{if(row.length!==names.length)throw new Error(`CSV row ${i+2} has ${row.length} cells; expected ${names.length}. Put commas inside quoted text.`);const q=Object.fromEntries(names.map((name,i)=>[name,row[i]??'']));const options=['a','b','c','d','e','f'].map(c=>q['option_'+c]??'');while(options.length&&!options[options.length-1])options.pop();return {...q,prompt:q.question??q.prompt,options,correct_answer:q.correct_answer??q.answer}})
  return validate(items)
 }
 const items:Record<string,unknown>[]=[];let prompt:string[]=[],options:string[]=[],category='Pre-Shift',title='',instructions='',quizDate=''
 for(const line of text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean)){
  let match=line.match(/^(?:quiz\s+)?title:\s*(.+)$/i);if(match&&!options.length){title=match[1];continue}
  match=line.match(/^instructions:\s*(.+)$/i);if(match&&!options.length){instructions=match[1];continue}
  match=line.match(/^(?:quiz\s+)?date:\s*(.+)$/i);if(match&&!options.length){quizDate=match[1];continue}
  match=line.match(/^category:\s*(.+)$/i);if(match&&!options.length){category=match[1];continue}
  match=line.match(/^explanation:\s*(.*)$/i);if(match&&items.length&&!prompt.length){items[items.length-1].explanation=match[1];continue}
  match=line.match(/^(?:correct\s+)?answer:\s*(.+)$/i);if(match){if(!prompt.length||options.length<2)throw new Error('Put the question and its choices before its Answer line.');items.push({prompt:prompt.join(' '),options,correct_answer:match[1],category,explanation:''});prompt=[];options=[];category='Pre-Shift';continue}
  match=line.match(/^([A-F])[.)]\s*(.+)$/i);if(match){if(match[1].toUpperCase().charCodeAt(0)-65!==options.length)throw new Error('List answer choices in order, starting with A.');options.push(match[2]);continue}
  if(options.length)throw new Error('A question is missing its Answer: line, or a choice label is missing.')
  prompt.push(line.replace(/^\d+[.)]\s*/,''))
 }
 if(prompt.length||options.length)throw new Error('The last question needs an Answer: line.')
 return validate(items,title,instructions,quizDate)
}
export const quizCsvTemplate='question,category,option_a,option_b,option_c,option_d,correct_answer,explanation\n"What should every table greeting include?",Guest service,"A specific recommendation","Only the server’s name","The check","Nothing",A,"Guide guests into the experience."\n'
export const quizTextTemplate='Title: Daily Pre-Shift Quiz\n\n1. What should every table greeting include?\nA. A specific recommendation\nB. Only the server’s name\nC. The check\nD. Nothing\nAnswer: A\nExplanation: Guide guests into the experience.\n'
