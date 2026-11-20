import { build } from 'esbuild'
import assert from 'node:assert/strict'

const { outputFiles } = await build({
  entryPoints: ['src/lib/inquiryReservationFields.ts'], bundle: true, format: 'esm', write: false,
})
const { inquiryDetails, inquiryReservationFields } = await import(
  'data:text/javascript;base64,' + Buffer.from(outputFiles[0].contents).toString('base64'),
)
const saved = { name: 'Test Guest', phone: '5045550100', email: '', date: '2026-11-20', guests: 2 }
for (const [input, expected] of [['5pm', '17:00'], ['5:30 PM', '17:30'], ['17:30:00', '17:30'], ['12 a.m.', '00:00'], ['12 PM', '12:00'], ['17 PM', '']]) {
  assert.equal(inquiryReservationFields({ ...saved, details: { time: input } }).time, expected)
}
const form = { time: '5pm', name: 'Other name', email: 'guest@example.test', eventDate: '2026-11-21', guests: '3' }
for (const input of [form, JSON.stringify(form)]) {
  assert.deepEqual(inquiryReservationFields({ ...saved, details: inquiryDetails(input) }), {
    name: saved.name, phone: saved.phone, email: form.email, date: saved.date, time: '17:00', size: '2',
  })
}
assert.equal(inquiryReservationFields({ ...saved, date: '', guests: 0, details: form }).size, '3')
assert.equal(inquiryReservationFields({ ...saved, date: '', guests: 0, details: form }).date, form.eventDate)
assert.deepEqual(inquiryDetails('Plain notes'), { Details: 'Plain notes' })
assert.deepEqual(inquiryDetails(JSON.stringify({
  time:'17:00','Text messaging':'Not opted in',reservationTextChoice:{optedIn:false,phone:'5045550100'},
})), {time:'17:00','Text messaging':'Not opted in'})
console.log('Saved inquiry fields, object and JSON details, AM/PM times and fallback checks passed.')
