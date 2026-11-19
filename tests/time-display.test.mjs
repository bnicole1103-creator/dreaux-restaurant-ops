import assert from 'node:assert/strict'
import {build} from 'esbuild'

const {outputFiles} = await build({
  stdin: {resolveDir: process.cwd(), contents: "export * from './src/lib/time12'; export * from './src/lib/inquiryDisplay'"},
  bundle: true, write: false, format: 'esm'
})
const {time12, displayReportTime, formatInquirySummary} =
  await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'))
assert.equal(time12('00:00'), '12:00 AM')
assert.equal(time12('12:00'), '12:00 PM')
assert.equal(time12('17:30:00.123'), '5:30 PM')
assert.equal(time12('5:30 PM'), '5:30 PM')
assert.equal(time12('25:90'), '25:90')
assert.equal(displayReportTime('2026-11-18T23:30:00Z'), '11/18/2026, 5:30:00 PM')
assert.equal(displayReportTime('2026-11-18T17:30:00'), '2026-11-18 · 5:30 PM')
assert.equal(formatInquirySummary('occasion: Dinner · time: 17:00 · secondTime: 16:30 · thirdTime: 17:30 · expectations: Just dinner.'), 'occasion: Dinner · First time: 5:00 PM · Second time: 4:30 PM · Third time: 5:30 PM · expectations: Just dinner.')

assert.equal(formatInquirySummary('preferred_time: 00:30 · second_preferred_time: 5:30 PM · expectations: See you at 17:30'),
  'First time: 12:30 AM · Second time: 5:30 PM · expectations: See you at 17:30')
assert.equal(formatInquirySummary(null), '')
console.log('12-hour display and saved inquiry summary checks passed.')
