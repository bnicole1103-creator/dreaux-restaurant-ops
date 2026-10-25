import type {TaskPreset} from './taskWorkflow'
export type AssignmentSelection={templates:{id:string;version:number}[];users:string[];shift:string;use_preset_due:boolean;due:string|null;available:string|null}
export type AssignmentGroup={id:string;name:string;version:number;definition:AssignmentSelection;updated_at:string}
export function restoreAssignmentGroup(saved:AssignmentSelection,templates:TaskPreset[],activeUsers:string[]){
 const warnings:string[]=[],selected:string[]=[]
 for(const old of saved.templates){
  const current=templates.find(t=>t.id===old.id)
  if(!current||!current.reviewed||current.items.length<1||current.items.length>8){warnings.push((current?.title??'An unavailable checklist')+' was skipped.');continue}
  selected.push(current.id)
  if(current.version!==old.version)warnings.push(current.title+' has changed since this group was saved. Review its current tasks and due time.')
 }
 const users=saved.users.filter(id=>activeUsers.includes(id))
 if(users.length!==saved.users.length)warnings.push('Inactive or removed employees were skipped.')
 return {selected,users,warnings}
}
