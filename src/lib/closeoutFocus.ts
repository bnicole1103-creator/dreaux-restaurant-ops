export type CloseoutIssue={field:string;message:string;target?:string}

/** Reveal collapsed ancestors before scrolling and focusing a missing field. */
export function focusCloseoutIssue(issue:CloseoutIssue){
 const root=document.querySelector('.quick-closeout')
 if(!root)return
 const target=issue.target?Array.from(root.querySelectorAll<HTMLElement>('[data-closeout-field]')).find(el=>el.dataset.closeoutField===issue.target):null
 const section=target??root.querySelector<HTMLElement>('#quick-'+issue.field)??root.querySelector<HTMLElement>('#closeout-errors')
 if(!section)return
 if(issue.field==='receipts'&&!target&&!issue.target){
  const review=section.querySelector<HTMLButtonElement>('[data-receipt-needs-review="true"] [data-review-receipt]')
  if(review){review.click();requestAnimationFrame(()=>requestAnimationFrame(()=>focusCloseoutIssue({...issue,target:'receiptEditor'})));return}
 }
 let parent:HTMLElement|null=section
 while(parent&&parent!==root){if(parent instanceof HTMLDetailsElement)parent.open=true;parent=parent.parentElement}
 const controls=Array.from(section.querySelectorAll<HTMLElement>('input:not([type=hidden]),select,textarea,button:not([disabled])'))
 const field=(section.matches('input,select,textarea')?section:null)??controls.find(el=>el.matches('[aria-invalid=true],:invalid'))??controls.find(el=>(el instanceof HTMLInputElement||el instanceof HTMLSelectElement||el instanceof HTMLTextAreaElement)&&!el.value)??controls[0]??section
 field.setAttribute('aria-invalid','true')
 const clear=()=>{field.removeAttribute('aria-invalid');field.removeEventListener('input',clear);field.removeEventListener('change',clear)}
 field.addEventListener('input',clear);field.addEventListener('change',clear)
 requestAnimationFrame(()=>{
  section.scrollIntoView({block:'center',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'})
  if(!field.matches('input,select,textarea,button'))field.tabIndex=-1
  field.focus({preventScroll:true})
 })
}
