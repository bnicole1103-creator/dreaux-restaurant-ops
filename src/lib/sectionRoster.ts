export type SectionRosterShift = {id:string;user_id:string|null;name:string;role?:string;start:string;end:string;assigned?:boolean}
export const rosterName = (name:string) => name.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase()
export function sectionRoster(rows:SectionRosterShift[]) {
 return rows.filter(s=>s.assigned!==false && !!s.id && !!s.name?.trim() && !/^(open shift|unassigned|team member)$/i.test(s.name.trim()))
}
export function sectionShiftCandidates(rows:SectionRosterShift[],employee:string|null,name:string) {
 return rows.filter(s=>(employee ? s.user_id===employee : employee===null && !!name.trim() && rosterName(s.name)===rosterName(name)) && Number.isFinite(Date.parse(s.start)) && Date.parse(s.end)>Date.parse(s.start))
}
export function chooseSectionShift(rows:SectionRosterShift[],employee:string|null,name:string,choice:string) {
 const candidates=sectionShiftCandidates(rows,employee,name)
 return choice ? candidates.find(s=>s.id===choice) : candidates.length===1 ? candidates[0] : undefined
}
