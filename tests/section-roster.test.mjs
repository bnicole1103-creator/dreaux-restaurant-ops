import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
const source=readFileSync(new URL('../src/lib/sectionRoster.ts',import.meta.url),'utf8')
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText
const {sectionRoster,chooseSectionShift}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'))
const amari={id:'amari-evening',user_id:'amari',name:'Amari Stewart',role:'Main Bartender (Front Bar)',start:'2026-11-13T16:30:00-06:00',end:'2026-11-13T22:00:00-06:00'}
const morning={...amari,id:'amari-morning',start:'2026-11-13T10:00:00-06:00',end:'2026-11-13T15:00:00-06:00'}
assert.equal(chooseSectionShift([amari],'amari','','')?.id,amari.id,'a single roster shift loads its own hours')
assert.equal(chooseSectionShift([morning,amari],'amari','',amari.id)?.start,amari.start,'selecting the second shift preserves its exact window')
assert.equal(chooseSectionShift([morning,amari],'amari','',''),undefined,'multiple windows require an explicit selection')
const unlinked={...amari,user_id:null}
assert.equal(chooseSectionShift([unlinked],null,' amari   STEWART ',amari.id)?.end,amari.end,'name-only shifts retain schedule defaults without an account')
assert.equal(chooseSectionShift([amari],'someone-else','',amari.id),undefined,'another employee cannot inherit these times')
assert.equal(chooseSectionShift([amari],'amari','','removed-shift'),undefined,'stale shift IDs do not silently select a different shift')
const missingEnd={...morning,end:''}
assert.equal(sectionRoster([missingEnd]).length,1,'incomplete roster data stays visible')
assert.equal(chooseSectionShift([missingEnd,amari],'amari','',morning.id),undefined,'an incomplete selected shift does not switch to another shift')
assert.equal(sectionRoster([{...amari,assigned:false}]).length,0,'open/unassigned shifts are excluded')
const component=readFileSync(new URL('../src/components/SectionSchedule.tsx',import.meta.url),'utf8')
assert.match(component,/rows=\{confirmed\}/,'person selection and time selection share one roster')
assert.doesNotMatch(component,/if\(r.data\?\.override\|\|r.data\?\.dining_preserve\)setConfirmed/,'imported schedules are not silently discarded')
console.log('Section roster regression checks passed (10 cases).')
