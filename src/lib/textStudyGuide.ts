export type TextGuideSection={name:string;category:string;build:string;method:string;finish:string;notes:string}
export const textGuideFields=[['method','Overview'],['build','Key points'],['finish','Practice questions'],['notes','Answer key & source excerpts']] as const
export function validTextGuideSections(value:unknown):value is TextGuideSection[]{return Array.isArray(value)&&value.length>=1&&value.length<=12&&value.every(row=>row&&typeof row==='object'&&['name','category','build','method','finish','notes'].every(k=>typeof row[k]==='string'&&row[k].length<=12000)&&row.name.trim().length>0&&row.name.length<=160&&row.category.trim().length>0&&row.category.length<=80)}

/** Build an editable preview using the source wording when AI cannot verify its quotes. */
export function sourceStudyGuide(source:string, title:string) {
 const guideTitle=title.trim()||'Training study guide'
 const groups:{heading:string;lines:string[]}[]=[{heading:'Study notes',lines:[]}]
 for(const raw of source.trim().split(/\r?\n/)){
  const line=raw.trim()
  const heading=line.match(/^(?:#{1,6}\s+|SOURCE:\s+)(.+)$/i)?.[1]
   ?? (/^[\p{Lu}\p{M}][\p{Lu}\p{M} &/'’()-]{2,79}:?$/u.test(line)?line.replace(/:$/,''):undefined)
  const current=groups[groups.length-1]
  if(heading&&groups.length<12){
   if(current.lines.some(value=>value.trim()))groups.push({heading:heading.slice(0,160),lines:[raw]})
   else{current.heading=heading.slice(0,160);current.lines.push(raw)}
  }else current.lines.push(raw)
 }
 const sections:TextGuideSection[]=groups.map(({heading,lines})=>{
  const excerpt=lines.join('\n').trim()
  return {name:heading,category:'Study notes',method:'Read the source excerpt, then check what you remember.',
   build:excerpt,finish:'What items or details are listed in this section?',notes:excerpt}
 })
 return {title:guideTitle,sections,warnings:['This preview uses the source wording. Review the sections and edit the practice questions before saving.']}
}
