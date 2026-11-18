import assert from 'node:assert/strict'
import ts from 'typescript'
import {readFileSync} from 'node:fs'
let channels=0,removed=0,intervals=0;const events=new Map()
const channel={on(){return this},subscribe(){return this}}
globalThis.refreshClient={channel(){channels++;return channel},removeChannel(){removed++;return Promise.resolve()}}
globalThis.window={addEventListener(name,fn){events.set(name,fn)},removeEventListener(name){events.delete(name)}}
globalThis.document={visibilityState:'visible',addEventListener(name,fn){events.set(name,fn)},removeEventListener(name){events.delete(name)}}
const interval=globalThis.setInterval,clear=globalThis.clearInterval
globalThis.setInterval=(...args)=>{intervals++;return interval(...args)}
const source=readFileSync('src/lib/reservationRefresh.ts','utf8').replace("import {supabase} from './supabase'","const supabase=globalThis.refreshClient")
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const {watchReservations}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'))
let a=0,b=0;const stopA=watchReservations('location',()=>a++),stopB=watchReservations('location',()=>b++)
assert.equal(channels,1);assert.equal(intervals,1)
events.get('reservations-changed')();events.get('focus')();await new Promise(resolve=>setTimeout(resolve,120))
assert.equal(a,1);assert.equal(b,1,'a burst invalidates each reader only once')
document.visibilityState='hidden';events.get('focus')();await new Promise(resolve=>setTimeout(resolve,120));assert.equal(a,1)
stopA();assert.equal(removed,0);stopB();assert.equal(removed,1);assert.equal(events.size,0)
globalThis.setInterval=interval;globalThis.clearInterval=clear
console.log('Shared channel/timer, invalidation coalescing, hidden-page pause and final-reader cleanup passed.')
