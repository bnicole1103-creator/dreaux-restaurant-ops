import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
const source=readFileSync('src/lib/messageComposer.ts','utf8')
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText
const {messageRecipient,messageComposerUrl}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'))
assert.equal(messageRecipient('(504) 555-1234'),'+15045551234')
assert.equal(messageRecipient('1-504-555-1234'),'+15045551234')
assert.equal(messageRecipient('+44 20 7946 0958'),'+442079460958')
for(const number of ['', '555', '5045551234&body=other', '5045551234,2125551234', 'phone', '+1234567890123456'])assert.equal(messageRecipient(number),null)
const message='JusTini’s reservation\nhttps://justinis-nola.vercel.app/reservation-confirmation#token=a&b=2\nPlease review & confirm.'
for(const apple of [true,false]){
 const href=messageComposerUrl('(504) 555-1234',message,apple)
 assert.ok(href.startsWith('sms:+15045551234'+(apple?'&':'?')+'body='))
 assert.equal(decodeURIComponent(href.split('body=')[1]),message)
 assert.ok(!href.includes('#token='),'fragment is encoded inside the message')
}
assert.equal(messageComposerUrl('5045551234','',true),null)
console.log('Message composer checks passed.')
