import {useRef, useState} from 'react'
import {serviceDay} from '../lib/serviceDay'
import {supabase} from '../lib/supabase'
import {combineTrainingSources, readTrainingFile, sourceLimit, uploadAccept, type TrainingDocument} from '../lib/trainingContent'
import {useAppAccess} from './AppAccess'

type Document = Pick<TrainingDocument, 'id' | 'title' | 'body' | 'shelf'>

export function TrainingSalesScripts({location, initialDocument}: {location:string;initialDocument?:Document}) {
  const access = useAppAccess()
  const [documents, setDocuments] = useState<Document[] | null>(null)
  const [selected, setSelected] = useState(initialDocument ? [initialDocument.id] : [])
  const [paste, setPaste] = useState('')
  const [scripts, setScripts] = useState<string[]>([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const pending = useRef(false)
  const available = (documents ?? (initialDocument ? [initialDocument] : [])).filter(document=>
    access.can('training', document.shelf==='menu'?'food':'service'))
  const source = combineTrainingSources(available.filter(document=>selected.includes(document.id)), paste)

  async function run(label:string, work:()=>Promise<void>) {
    if (pending.current) return
    pending.current = true
    setBusy(label)
    setError('')
    setStatus('')
    try { await work() }
    catch (e) { setError(String((e as {message?:string})?.message ?? e)) }
    finally { pending.current = false; setBusy('') }
  }

  async function loadDocuments() {
    await run('Loading Training documents…', async()=>{
      const shelves = (['menu', 'service'] as const).filter(shelf=>access.can('training', shelf==='menu'?'food':'service'))
      const responses = await Promise.all(shelves.map(shelf=>supabase.rpc('training_content_load', {
        p_location_id:location, p_shelf:shelf,
      }).abortSignal(AbortSignal.timeout(20000))))
      const found:Document[] = initialDocument ? [initialDocument] : []
      for (const response of responses) {
        if (response.error) continue
        for (const document of (response.data ?? []) as Document[]) {
          if (!found.some(existing=>existing.id===document.id)) found.push(document)
        }
      }
      setDocuments(found)
      const failed = responses.find(response=>response.error)
      if (failed?.error) throw failed.error
    })
  }

  async function importFile(file:File) {
    await run('Reading document…', async()=>{
      const section = access.can('training','food')?'food':'service'
      const {body} = await readTrainingFile(file, location, section)
      setPaste(previous=>[previous.trim(),body.trim()].filter(Boolean).join('\n\n'))
      setScripts([])
    })
  }

  async function generate() {
    if (!source || source.length>sourceLimit) return
    await run('Writing sales scripts…', async()=>{
      const response = await supabase.functions.invoke('operations-assistant', {
        body:{location_id:location, day:serviceDay(), kind:'sales', sales_script_source:source},
        signal:AbortSignal.timeout(75000),
      })
      if (response.error) {
        const detail = await response.error.context?.json?.().catch(()=>null)
        throw Error(detail?.error || response.error.message)
      }
      const drafts = response.data?.recommendations?.map((row:{text:string})=>row.text) as string[] | undefined
      if (response.data?.sales_script_source!==true) throw Error('Training-based scripts are unavailable. Try again after the sales script service is updated.')
      if (!drafts?.length) throw Error('No script was generated. Try selecting a document with specific menu items or selling points.')
      setScripts(drafts)
      setStatus('Scripts ready to review and copy.')
    })
  }

  async function copy(draft:string) {
    try { await navigator.clipboard.writeText(draft); setStatus('Script copied.') }
    catch { setStatus('Select the script text to copy it.') }
  }

  return <section aria-label="Sales scripts from Training" className="profile-plan-scripts">
    {!initialDocument && <h2>Sales scripts from Training</h2>}
    <fieldset disabled={!!busy}>
      <label>Paste menu items or selling notes
        <textarea rows={5} value={paste} placeholder="Paste item names, descriptions or a screenshot"
          onChange={event=>{setPaste(event.target.value);setScripts([])}}
          onPaste={event=>{
            const file = Array.from(event.clipboardData.files).find(item=>item.type.startsWith('image/')||item.type==='application/pdf')
            if (file) { event.preventDefault(); void importFile(file) }
          }}/>
      </label>
      <label>Upload a menu, PDF or image
        <input type="file" accept={uploadAccept} onChange={event=>{
          const file=event.target.files?.[0]
          event.target.value=''
          if (file) void importFile(file)
        }}/>
      </label>
      {(access.can('training','food')||access.can('training','service')) &&
        <button type="button" onClick={()=>void loadDocuments()}>{documents ? 'Reload Training documents' : 'Choose Training documents'}</button>}
      {available.map(document=><label className="training-select" key={document.id}>
        <input type="checkbox" checked={selected.includes(document.id)} onChange={event=>{
          const checked=event.target.checked
          setSelected(previous=>checked?[...previous,document.id]:previous.filter(id=>id!==document.id))
          setScripts([])
        }}/>{document.title}
      </label>)}
      {documents && !available.length && <p>No Training documents are available.</p>}
      {source && <details><summary>Review source text</summary><p className="training-text">{source}</p></details>}
      {source.length>sourceLimit && <p role="alert">Use up to 12,000 characters. Shorten the text or deselect a document.</p>}
      <button type="button" disabled={!source||source.length>sourceLimit} onClick={()=>void generate()}>
        {scripts.length ? 'Regenerate sales scripts' : 'Generate sales scripts'}
      </button>
    </fieldset>
    {busy && <p role="status">{busy}</p>}
    {error && <p role="alert">{error}</p>}
    {scripts.map((draft,index)=><div key={index}>
      <label>Sales script {index+1}
        <textarea rows={4} value={draft} onChange={event=>{
          const text=event.target.value
          setScripts(previous=>previous.map((value,i)=>i===index?text:value))
        }}/>
      </label>
      <button type="button" disabled={!draft.trim()||!!busy} onClick={()=>void copy(draft)}>Copy script {index+1}</button>
    </div>)}
    {status && <p role="status">{status}</p>}
  </section>
}
