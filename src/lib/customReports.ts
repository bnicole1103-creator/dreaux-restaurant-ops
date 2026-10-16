export type Cell=string|number|boolean|null
export type DataRow=Record<string,Cell>
export type Rule={column:string;op:'contains'|'equals'|'gte'|'lte';value:string}
export type ReportSpec={columns:{key:string;label:string}[];filters:Rule[];group:string;sums:string[];sort:string;descending:boolean}
export const MAX_ROWS=5000,MAX_COLUMNS=50
const badKeys=new Set(['__proto__','prototype','constructor'])
export function validateRows(rows:unknown):DataRow[]{
 if(!Array.isArray(rows)||!rows.length||rows.length>MAX_ROWS)throw Error('Import between 1 and 5,000 rows.')
 const keys=new Set<string>();for(const row of rows){if(!row||typeof row!=='object'||Array.isArray(row))throw Error('Each row must be an object with column names.');for(const [key,value] of Object.entries(row)){if(!key.trim()||key.length>100||badKeys.has(key))throw Error('Use valid column names up to 100 characters.');keys.add(key);if(value!==null&&(!['string','number','boolean'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value)||String(value).length>2000))throw Error('Cells must be text, finite numbers, booleans or blank, up to 2,000 characters.')}}
 if(keys.size>MAX_COLUMNS||!keys.size)throw Error('Use between 1 and 50 columns.');return rows as DataRow[]
}
export function parseCSV(text:string,delimiter=','):DataRow[]{
 const grid:string[][]=[];let row:string[]=[],cell='',quoted=false,closed=false;const source=text.replace(/^\uFEFF/,'')
 function endCell(){row.push(cell);cell='';closed=false;if(row.length>MAX_COLUMNS)throw Error('Use at most 50 columns.')}
 function endRow(){endCell();if(row.some(x=>x!==''))grid.push(row);row=[];if(grid.length>MAX_ROWS+1)throw Error('Use at most 5,000 data rows.')}
 for(let i=0;i<source.length;i++){const c=source[i];if(quoted){if(c==='"'){if(source[i+1]==='"'){cell+='"';i++}else{quoted=false;closed=true}}else cell+=c}else if(c==='"'){if(cell!==''||closed)throw Error('Invalid CSV quote.');quoted=true}else if(c===delimiter)endCell();else if(c==='\r'||c==='\n'){if(c==='\r'&&source[i+1]==='\n')i++;endRow()}else{if(closed)throw Error('Unexpected text after a closing quote.');cell+=c}if(cell.length>2000)throw Error('A cell exceeds 2,000 characters.')}
 if(quoted)throw Error('A quoted cell is missing its closing quote.');if(cell!==''||row.length||closed)endRow();if(grid.length<2)throw Error('Include a header row and at least one data row.')
 const headers=grid.shift()!.map(s=>s.trim());if(headers.some(s=>!s||badKeys.has(s))||new Set(headers).size!==headers.length)throw Error('Every column needs a unique, nonempty name.')
 return validateRows(grid.map(cells=>{if(cells.length!==headers.length)throw Error('Every row must have the same number of cells as the header.');return Object.fromEntries(headers.map((key,i)=>[key,cells[i]]))}))
}
export const columnsOf=(rows:DataRow[])=>[...new Set(rows.flatMap(Object.keys))]
export function defaultSpec(rows:DataRow[]):ReportSpec{return {columns:columnsOf(rows).map(key=>({key,label:key.replace(/_/g,' ')})),filters:[],group:'',sums:[],sort:'',descending:false}}
export function numberCell(value:Cell|undefined){
 if(value===null||value===undefined||typeof value==='boolean'||String(value).trim()==='')return null
 let s=String(value).trim(),negative=false
 if(s.startsWith('(')&&s.endsWith(')')){negative=true;s=s.slice(1,-1)}
 s=s.replace(/^\$/,'');if(!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(s))return null
 const n=Number(s.replace(/,/g,''))*(negative?-1:1);return Number.isFinite(n)?n:null
}
function totalCells(rows:DataRow[],key:string){let total=0,correction=0;for(const row of rows){const adjusted=(numberCell(row[key])??0)-correction,next=total+adjusted;correction=(next-total)-adjusted;total=next}return Number(total.toPrecision(15))}
export function buildReport(rows:DataRow[],spec:ReportSpec){
 const filtered=rows.filter(row=>spec.filters.every(f=>{const v=row[f.column];if(f.op==='contains')return String(v??'').toLocaleLowerCase().includes(f.value.toLocaleLowerCase());if(f.op==='equals')return String(v??'').toLocaleLowerCase()===f.value.toLocaleLowerCase();const a=numberCell(v),b=numberCell(f.value);return a!==null&&b!==null&&(f.op==='gte'?a>=b:a<=b)}))
 let output:DataRow[],columns=spec.columns
 if(spec.group){const groups=new Map<string,{value:Cell;rows:DataRow[]}>();for(const row of filtered){const value=row[spec.group]??null,key=JSON.stringify(value);const group=groups.get(key)??{value,rows:[]};group.rows.push(row);groups.set(key,group)}
 columns=[{key:'group_value',label:spec.columns.find(c=>c.key===spec.group)?.label??spec.group},{key:'row_count',label:'Row count'},...spec.sums.filter(c=>c!==spec.group).map(key=>({key:'sum:'+key,label:'Total '+(spec.columns.find(c=>c.key===key)?.label??key)}))]
 output=[...groups.values()].map(g=>Object.fromEntries([['group_value',g.value],['row_count',g.rows.length],...spec.sums.filter(c=>c!==spec.group).map(key=>['sum:'+key,totalCells(g.rows,key)])]) as DataRow)
 }else output=filtered.map(row=>Object.fromEntries(columns.map(c=>[c.key,row[c.key]??null])))
 if(spec.sort)output.sort((a,b)=>{const av=a[spec.sort],bv=b[spec.sort],an=numberCell(av),bn=numberCell(bv);const cmp=an!==null&&bn!==null?an-bn:String(av??'').localeCompare(String(bv??''));return spec.descending?-cmp:cmp})
 const totals=Object.fromEntries(spec.sums.map(key=>[key,totalCells(filtered,key)]))
 return {rows:output,columns,inputCount:rows.length,matchedCount:filtered.length,totals}
}
function safeCSV(value:Cell|undefined){const raw=String(value??'');const safe=typeof value!=='number'&&numberCell(value)===null&&/^[\s]*[=+\-@\t\r]/.test(raw)?"'"+raw:raw;return '"'+safe.replace(/"/g,'""')+'"'}
export function exportCSV(rows:DataRow[],columns:{key:string;label:string}[]){return '\uFEFF'+[columns.map(c=>safeCSV(c.label)).join(','),...rows.map(r=>columns.map(c=>safeCSV(r[c.key])).join(','))].join('\r\n')}
export function validSpec(value:unknown):value is ReportSpec{const s=value as ReportSpec;return Boolean(s&&Array.isArray(s.columns)&&s.columns.length<=50&&s.columns.every(c=>c&&typeof c.key==='string'&&typeof c.label==='string')&&Array.isArray(s.filters)&&s.filters.length<=20&&s.filters.every(f=>f&&typeof f.column==='string'&&['contains','equals','gte','lte'].includes(f.op)&&typeof f.value==='string')&&typeof s.group==='string'&&Array.isArray(s.sums)&&s.sums.every(v=>typeof v==='string')&&typeof s.sort==='string'&&typeof s.descending==='boolean')}
