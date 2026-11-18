import {readdirSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
let failed=0
for(const file of readdirSync('tests').filter(file=>/\.(cjs|mjs)$/.test(file)).sort()){
 console.log('\nRunning '+file)
 const result=spawnSync(process.execPath,['tests/'+file],{stdio:'inherit',timeout:120000})
 if(result.status!==0){failed++;console.error('FAILED '+file+(result.error?': '+result.error.message:''))}
}
console.log(failed?failed+' test files failed.':'All test files passed.')
process.exitCode=failed?1:0
