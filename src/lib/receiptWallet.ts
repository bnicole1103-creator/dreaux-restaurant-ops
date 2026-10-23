export type ReceiptKind='purchase'|'void'|'comp'
export const receiptKinds={purchase:'Purchase / expense',void:'Void receipt',comp:'Comp receipt'} as const
export function receiptKind(data:{category?:string}):ReceiptKind{return data.category==='Void receipt'?'void':data.category==='Comp receipt'?'comp':'purchase'}
export function receiptCategory(kind:ReceiptKind){return kind==='purchase'?'':receiptKinds[kind]}
export type ReceiptExtraction={vendor:string;purchase_date:string|null;total:number|null;tax:number|null;tip:number|null;warnings:string[];items:{description:string;quantity:number|null;unit_price:number|null}[]}
export type ReceiptLine={description:string;quantity:number;unit_price:number}
export type ReceiptData={vendor:string;purchase_date:string;source:'photo'|'manual';category:string;payment:string;reimburse:boolean;notes:string;items:ReceiptLine[];tax:number;tip:number;total:number|null}
export type PurchaseReceipt={closeout_receipt_id?:string|null;id:string;user_id:string;purchase_date:string;data:ReceiptData;total:number|null;status:'draft'|'captured'|'recorded';file_path:string|null;file_mime:string|null;has_file?:boolean;version:number;requires_check:boolean;checked_at:string|null;extraction?:ReceiptExtraction|null;review_note:string|null;reviewed_at:string|null;reviewer?:string|null;employee?:string;created_at:string}
export const receiptToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
export const receiptCents=(n:number)=>Math.round((n+Number.EPSILON)*100)
export function receiptTotal(items:ReceiptLine[],tax:number,tip:number){return (items.reduce((sum,l)=>sum+receiptCents(l.quantity*l.unit_price),0)+receiptCents(tax)+receiptCents(tip))/100}
export const receiptStatus=(s:PurchaseReceipt['status'])=>({draft:'Upload incomplete',captured:'Saved · details to enter',recorded:'Details recorded'})[s]
export function receiptCsv(rows:PurchaseReceipt[]){const cell=(value:unknown)=>{let s=String(value??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"'};return '\ufeff'+[['Receipt ID','Date','Employee','Receipt type','Vendor / check reference','Category','Total (USD)','Payment','Reimbursement requested','Source','Status','Purchaser check','Notes'],...rows.map(r=>[r.id,r.purchase_date,r.employee,receiptKinds[receiptKind(r.data)],r.data.vendor,r.data.category,r.total??'',r.data.payment,r.data.reimburse?'Yes':'No',r.data.source,receiptStatus(r.status),r.requires_check?(r.checked_at?'Checked':'Needs checking'):'Not required',r.data.notes])].map(row=>row.map(cell).join(',')).join('\r\n')}
export async function prepareReceiptFile(file:File){
 if(!['image/jpeg','image/png','image/webp','application/pdf'].includes(file.type))throw Error('Choose a JPG, PNG, WebP image or PDF.');
 if(file.size<=12*1024*1024)return file;
 if(file.type==='application/pdf')throw Error('Choose a PDF under 12 MB.');
 if(file.size>35*1024*1024)throw Error('Choose an image under 35 MB.');
 const url=URL.createObjectURL(file)
 try{const image=await new Promise<HTMLImageElement>((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(Error('This photo could not be opened. Try a JPG or PNG.'));i.src=url});
  const scale=Math.min(1,4000/Math.max(image.naturalWidth,image.naturalHeight)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));const context=canvas.getContext('2d');if(!context)throw Error('Photo processing is unavailable. Try uploading a PDF.');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Photo conversion failed.')),'image/jpeg',.94));if(blob.size>12*1024*1024)throw Error('This photo is too large. Choose a smaller image.');return new File([blob],'receipt.jpg',{type:'image/jpeg'});
 }finally{URL.revokeObjectURL(url)}
}

export function readReceiptExtraction(value:unknown):ReceiptExtraction{
 const r=value as ReceiptExtraction;const amount=(n:unknown,max:number)=>n===null||(typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=max);
 if(!r||typeof r.vendor!=='string'||r.vendor.length>200||!(r.purchase_date===null||(typeof r.purchase_date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(r.purchase_date)&&!Number.isNaN(Date.parse(r.purchase_date))&&new Date(r.purchase_date).toISOString().slice(0,10)===r.purchase_date))||!amount(r.total,9999999999.99)||!amount(r.tax,1000000)||!amount(r.tip,1000000)||!Array.isArray(r.items)||r.items.length>100||!Array.isArray(r.warnings)||r.warnings.some(w=>typeof w!=='string')||r.items.some(i=>!i||typeof i.description!=='string'||i.description.length>200||!amount(i.quantity,10000)||!amount(i.unit_price,1000000)))throw Error('The scan could not be read. Enter details manually.');return r
}
