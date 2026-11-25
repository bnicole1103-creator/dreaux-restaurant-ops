import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'

const code=readFileSync('src/lib/textStudyGuide.ts','utf8')
const {outputText}=ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}})
const {sourceStudyGuide,validTextGuideSections}=await import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64'))

const menu='SOMETHING WARM\nPetite Bowl of Port St. Beef Yakamein\nPetite Bowl of Reyne St. Seafood Yakamein (+ $5)\n\nSOMETHING SWEET\nVanilla bread pudding'
const draft=sourceStudyGuide(menu,'Staff menu')
assert.equal(draft.title,'Staff menu')
assert.deepEqual(draft.sections.map(section=>section.name),['SOMETHING WARM','SOMETHING SWEET'])
assert.match(draft.sections[0].notes,/Seafood Yakamein \(\+ \$5\)/)
assert.equal(draft.sections.map(section=>section.build).join('\n\n'),menu)
assert.ok(validTextGuideSections(draft.sections))

const atLimit='a'.repeat(12000)
const unstructured=sourceStudyGuide(atLimit,' ')
assert.equal(unstructured.title,'Training study guide')
assert.equal(unstructured.sections[0].build,atLimit)
assert.ok(validTextGuideSections(unstructured.sections))

const many=Array.from({length:20},(_,index)=>`## Topic ${index+1}\r\nFact ${index+1}`).join('\r\n')
const capped=sourceStudyGuide(many,'Training')
assert.equal(capped.sections.length,12)
assert.match(capped.sections.at(-1).notes,/Fact 20$/)
assert.ok(validTextGuideSections(capped.sections))
console.log('Source study guide checks passed for pasted menus, long text, and section limits.')
