export const taskPhases=['Morning','Opening','Running','Closing','Weekly','Other'] as const
export type TaskPreset={id:string;title:string;position:string;phase:string;items:string[];source_note:string;reviewed:boolean;version:number;weekday?:number|null;due_time?:string|null}
export const positionLabel=(position:string)=>!position||position==='General'?'Any position':position==='General Manager'?'Management':position
export function taskSections<T extends {phase:string}>(rows:T[]):[string,T[]][]{const names=[...taskPhases,...new Set(rows.map(r=>r.phase).filter(p=>!taskPhases.includes(p as typeof taskPhases[number])))];return names.map(phase=>[phase,rows.filter(r=>r.phase===phase)] as [string,T[]]).filter(([,rows])=>rows.length)}
export function filterPresets(rows:TaskPreset[],phase:string,position:string,search:string){return rows.filter(t=>(!phase||t.phase===phase)&&(!position||t.position===position||t.position==='General')&&(!search||[t.title,...t.items].join(' ').toLowerCase().includes(search.toLowerCase())))}
export function taskLines(text:string){return text.split('\n').map(s=>s.trim()).filter(Boolean)}
