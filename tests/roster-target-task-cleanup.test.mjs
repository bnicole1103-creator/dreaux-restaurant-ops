import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'
import { PGlite } from '@electric-sql/pglite'

const { outputFiles } = await build({
  stdin:{resolveDir:process.cwd(),contents:"export * from './src/lib/workingPositions';export * from './src/lib/taskGroups';export * from './src/lib/targetShares';export * from './src/lib/balanceTargets';"},
  bundle:true,format:'esm',write:false,
})
const { workingPositions, workingPositionKey, taskPositionMatches, taskGroups, targetFromPoolShare, balanceTargets } =
  await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].contents).toString('base64'))
assert.ok(workingPositions.includes('Server'))
assert.ok(workingPositions.includes('Food Runner'))
assert.equal(workingPositionKey('Waitress'),'server')
assert.equal(taskPositionMatches('Food Runner','Busser / Food Runner'),true)
assert.equal(taskPositionMatches('Bartender','Server'),false)
assert.deepEqual(taskGroups(['Restock sparkling water','Dry goods: Refill napkins','Stock soda']).map(x=>[x.title,x.tasks.map(t=>t.index)]),[
  ['Non-alcoholic beverages',[0,2]],['Dry goods & disposables',[1]],
])
assert.equal(targetFromPoolShare(800,'25'),200)
assert.equal(targetFromPoolShare(800,'0'),0)
assert.equal(targetFromPoolShare(800,'101'),null)
const rows=[
  {key:'owner',group:'bar',hours:6,target:400},{key:'bar',group:'bar',hours:6,target:400},
  {key:'server',group:'floor',hours:6,target:1200},
]
const preview=balanceTargets(2000,rows,{'bar:owner':targetFromPoolShare(800,'25')})
assert.deepEqual(preview.rows.map(r=>r.target),[200,900,900])
assert.equal(preview.rows.reduce((sum,r)=>sum+r.target,0),2000)

const db=new PGlite()
try {
 await db.exec(`
  create role anon; create role authenticated;
  create function public.staff_tasks_can_manage(uuid) returns boolean language sql as $$ select true $$;
  create table public.staff_task_templates (
   location_id uuid,title text,position text,phase text,items jsonb,source_key text,source_note text,reviewed boolean,
   active boolean default true,version integer default 1,updated_at timestamptz default now(),unique(location_id,source_key)
  );
 `)
 const migration=readFileSync('supabase/migrations/20261119_role_closing_presets.sql','utf8')
 await db.exec(migration)
 const location='11111111-1111-1111-1111-111111111111'
 const seed=()=>db.query('select public.staff_tasks_seed_closing($1) as count',[location])
 assert.equal((await seed()).rows[0].count,10)
 assert.equal((await seed()).rows[0].count,0)
 const {rows}=await db.query('select distinct position from public.staff_task_templates order by position')
 assert.deepEqual(rows.map(r=>r.position),['Bartender','Busser','Food Runner','Host','Server'])
 assert.equal((await db.query('select count(*)::int as count from public.staff_task_templates where reviewed or jsonb_array_length(items)>8')).rows[0].count,0)
} finally {
 await db.close()
}
console.log('Roster positions, task grouping, percentage rebalancing and closing preset migration passed.')
