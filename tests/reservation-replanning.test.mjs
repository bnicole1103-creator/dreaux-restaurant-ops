import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {pathToFileURL} from 'node:url'
const temp=mkdtempSync(tmpdir()+'/reservation-replan-')
try {
 await build({entryPoints:['src/lib/reservationPlanning.ts'],outfile:temp+'/planning.mjs',bundle:true,platform:'node',format:'esm'})
 const {replanReservations,reservationMoves,reservationConflicts}=await import(pathToFileURL(temp+'/planning.mjs'))
 const table=(id,seats=4,room='main')=>({id,name:id,seats,room,roomName:room})
 const booking=(id,tableIds,start=200,end=290,extra={})=>({id,name:id,party:2,start,end,tableIds,room:'',version:0,...extra})
 const data={now:100,open:100,close:1000,day:'2030-01-01',configured:true,config:{duration:90,buffer:15,step:15,open:'11:00',close:'22:00',closed:false,joinGroups:[],blockedTables:[]},tables:[table('A'),table('B')],bookings:[booking('future',['A'])],blocks:[],slots:[],fingerprint:'test',canManage:true,organization:'org'}
 const candidate=booking('candidate',['A'])
 let result=replanReservations(data,candidate)
 assert.equal(result.ok,true)
 assert.deepEqual(result.assignments.future,['B'])
 assert.equal(reservationMoves(data,result.assignments)[0].name,'future')
 assert.equal(reservationConflicts(data,candidate)[0].direct,true)
 result=replanReservations(data,booking('candidate',['B']))
 assert.deepEqual(result.assignments.future,['A'],'prefer existing tables when they fit')
 assert.equal(reservationMoves(data,result.assignments).length,0)
 assert.equal(replanReservations({...data,bookings:[booking('seated',['A'],100,1000,{live:true})]},candidate).ok,false,'seated parties stay fixed')
 assert.equal(replanReservations({...data,bookings:[booking('late',['A'],90,290)]},candidate).ok,false,'past arrivals stay fixed')
 assert.equal(replanReservations({...data,tables:[table('A')]},candidate).ok,false,'no invented capacity')
 assert.equal(replanReservations({...data,bookings:[booking('future',['A'],200,290,{room:'main'})],tables:[table('A'),table('B',4,'patio')]},candidate).ok,false,'respect room preference')
 assert.equal(replanReservations({...data,config:{...data.config,blockedTables:['B']}},candidate).ok,false,'respect blocked tables')
 const resetParty=booking('earlier',['A'],105,190)
 assert.equal(reservationConflicts({...data,bookings:[resetParty]},candidate).length,1,'reset time counts as overlap')
 assert.equal(reservationConflicts({...data,bookings:[booking('earlier',['A'],105,185)]},candidate).length,0,'reset boundary is exclusive')
 assert.equal(reservationConflicts(data,booking('candidate',['B']))[0].direct,false,'overlap alone is not a shared-table conflict')
 const blocked={...data,blocks:[{id:'block',scope:'table',reason:'event',starts_at:new Date(195*60000).toISOString(),ends_at:new Date(300*60000).toISOString(),tableIds:['B'],version:0}]}
 assert.equal(replanReservations(blocked,candidate).ok,false,'respect time-specific blocks')
 const unassigned={...data,bookings:[booking('future',[])]}
 assert.equal(replanReservations(unassigned,candidate).ok,true)
 assert.equal(reservationMoves(unassigned,replanReservations(unassigned,candidate).assignments).length,0,'first assignment is not a move')
 await build({entryPoints:['src/lib/liveSeatingFinder.ts'],outfile:temp+'/finder.mjs',bundle:true,platform:'node',format:'esm'})
 const {liveSeatingOptions}=await import(pathToFileURL(temp+'/finder.mjs'))
 const crowded={...data,bookings:[booking('oversized',[],200,290,{party:20})]}
 const open=liveSeatingOptions(crowded,2)
 assert.ok(open.options.length>0,'an unresolved booking does not hide physically open tables')
 assert.ok(open.options.every(row=>row.requiresReview),'physical-only options require explicit review')
 const occupied={...crowded,bookings:[...crowded.bookings,booking('seated',['A'],100,1000,{live:true})]}
 assert.ok(liveSeatingOptions(occupied,2).options.every(row=>!row.ids.includes('A')),'never offer occupied tables as a fallback')
 assert.equal(liveSeatingOptions(data,50).options.length,0,'no fallback for an oversized arriving party')
 console.log('Reservation replanning checks passed (17 cases).')
} finally {rmSync(temp,{recursive:true,force:true})}
