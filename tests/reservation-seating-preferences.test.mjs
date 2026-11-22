import assert from 'node:assert/strict'
import { build } from 'esbuild'

const {outputFiles}=await build({
  stdin:{resolveDir:process.cwd(),contents:"export * from './src/lib/reservationCapacity'; export * from './src/lib/reservationSeating'; export * from './src/lib/reservationConfirmation'"},
  bundle:true,format:'esm',write:false,
})
const {planCapacity,seatingArea,inquirySeatingPreference,confirmationInvitation} =
  await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].contents).toString('base64'))
const table=(id,seats,roomName)=>({id,name:id,seats,room:roomName,roomName})
const tables=[
  table('T1',2,'Main Dining'),table('T2',2,'Main Dining'),table('T3',4,'Main Dining'),
  table('G1',7,'Great Room'),table('Bar 1',10,'Main Bar'),table('C1',10,'Courtyard'),
  ...Array.from({length:8},(_,i)=>table('H'+(i+1),i<2?2:1,'High Top Bar')),
]
const data={now:0,config:{buffer:15,blockedTables:[],joinGroups:[['T1','T2'],tables.slice(6).map(t=>t.id)]},tables,bookings:[]}
function pick(party,seating='indoor',blockedTables=[]){
  return planCapacity({...data,config:{...data.config,blockedTables}},
    {id:'candidate',name:'Test Guest',party,seating,start:60,end:120,tableIds:[],room:'',version:0}).assignments.candidate
}
assert.deepEqual(pick(2),['T1'])
assert.deepEqual(pick(4),['T1','T2'])
assert.deepEqual(pick(5),['G1'])
assert.deepEqual(pick(7),['G1'])
assert.deepEqual(pick(10),tables.slice(6).map(t=>t.id))
assert.deepEqual(pick(2,'bar'),['Bar 1'])
assert.deepEqual(pick(2,'courtyard'),['C1'])
assert.deepEqual(pick(2,'indoor',tables.filter(t=>!['Bar 1','C1','G1'].includes(t.id)).map(t=>t.id)),['C1'])
assert.equal(pick(4,'indoor',tables.filter(t=>t.id!=='G1').map(t=>t.id)),undefined)
assert.equal(pick(11),undefined)
assert.equal(inquirySeatingPreference({'Guest notes':'Seating preference: Outdoor seating in the Courtyard\nBirthday'}),'courtyard')
assert.doesNotMatch(confirmationInvitation('https://example.test/link'),/Courtyard|table|seating/i)
console.log('Two-tops, Great Room, high-top, bar opt-in, Courtyard fallback and guest text checks passed.')

const brutTables = [
  table('L5', 3, 'Brut Bar'), table('L6', 3, 'Brut Bar'),
  table('L7', 3, 'Brut Bar'), table('L8', 3, 'Brut Bar'),
  table('L9', 3, 'Brut Bar'), table('L10', 3, 'Brut Bar'), table('L11', 3, 'Brut Bar'),
  table('L12', 2, 'Brut Bar'), table('L13', 2, 'Brut Bar'),
]
const firstGroup = brutTables.slice(0, 4).map(t=>t.id)
const secondGroup = brutTables.slice(4, 7).map(t=>t.id)
const brutBarSeats = Array.from({length:4},(_,i)=>table('BB'+(i+1),1,'Brut Bar'))
const brutDay = {...data, tables:[...tables,...brutTables,...brutBarSeats], config:{...data.config,joinGroups:[firstGroup,secondGroup]}}
const booking = (id,party,room,tableIds=[])=>({id,name:id,party,room,tableIds,seating:'indoor',start:60,end:120,version:0})
const existing = [booking('Five',5,'Great Room',['G1']),booking('Twelve',12,'Brut Bar',firstGroup)]
const plan = planCapacity({...brutDay,bookings:existing},booking('Nine',9,'Brut Bar'))
assert.equal(plan.ok,true)
assert.deepEqual(plan.assignments.Nine,secondGroup)
assert.deepEqual(planCapacity(brutDay,booking('Twelve',12,'')).assignments.Twelve,firstGroup)
assert.equal(seatingArea(brutTables),'indoor dining in the Brut Bar')
assert.equal(seatingArea(brutBarSeats),'bar seating')
assert.deepEqual(planCapacity(brutDay,{...booking('Bar',1,'Brut Bar'),seating:'bar'}).assignments.Bar,['BB1'])
assert.equal(planCapacity(brutDay,booking('Indoor',1,'Brut Bar',['BB1'])).ok,false)
assert.equal(planCapacity(brutDay,{...booking('Bar',1,'Brut Bar',['L13']),seating:'bar'}).ok,false)
assert.equal(planCapacity({...brutDay,bookings:existing,config:{...brutDay.config,joinGroups:[firstGroup]}},booking('Nine',9,'Brut Bar')).ok,false)
