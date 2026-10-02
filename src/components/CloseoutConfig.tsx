import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
export type Question = { id: string; audience: 'staff' | 'manager'; label: string; type: 'text' | 'number' | 'yesno'; required: boolean; active: boolean; builtin: boolean }
export type PointRule = { id: string; category: string; reason: string; points: number; active: boolean; mode: 'automatic' | 'manual' }
export type Config = { version: number; questions: Question[]; rules: PointRule[] }
export type Answers = Record<string, string>
export function useCloseoutConfig(locationId: string) {
  const [config, setConfig] = useState<Config | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    setConfig(null); setError('')
    if (locationId) void supabase.rpc('closeout_get_config', { p_location_id: locationId }).then(({data,error}) => {
      if (!active) return
      if (error) setError(error.message)
      else setConfig(data as Config)
    })
    return () => { active = false }
  }, [locationId])
  return { config, error, setConfig }
}
export function questionLabel(config: Config | null, id: string, fallback: string) {
  return config?.questions.find(q => q.id === id)?.label ?? fallback
}
export function checkAnswers(config: Config | null, audience: string, answers: Answers) {
  if (!config) throw new Error('Closeout settings are not loaded. Reload the page before submitting.')
  const questions = config.questions.filter(q => q.active && !q.builtin && q.audience === audience)
  const result: Answers = {}
  questions.forEach(q => {
    const answer = answers[q.id] ?? ''
    if (q.required && !answer.trim()) throw new Error(`Answer required: ${q.label}`)
    if (answer.length > 2000 || (answer && q.type === 'number' && !/^-?\d+(\.\d+)?$/.test(answer))) throw new Error(`Invalid answer: ${q.label}`)
    result[q.id] = answer
  })
  return result
}
export function CloseoutQuestions({config,audience,answers,onChange}: {config: Config | null; audience: string; answers: Answers; onChange: (answers: Answers) => void}) {
  const questions = config?.questions.filter(q => q.active && !q.builtin && q.audience === audience) ?? []
  if (!questions.length) return null
  return <div className="card mod-review"><h2>Additional closeout questions</h2><div className="mod-fields">
    {questions.map(q => <label key={q.id}>{q.label}{!q.required && ' (optional)'}
      {q.type === 'yesno' ? <select required={q.required} value={answers[q.id] ?? ''} onChange={e => onChange({...answers,[q.id]:e.target.value})}>
        <option value="">Choose an answer</option><option value="yes">Yes</option><option value="no">No</option>
      </select> : q.type === 'number' ? <input type="number" step="any" required={q.required} value={answers[q.id] ?? ''} onChange={e => onChange({...answers,[q.id]:e.target.value})} />
        : <textarea rows={3} maxLength={2000} required={q.required} value={answers[q.id] ?? ''} onChange={e => onChange({...answers,[q.id]:e.target.value})} />}
    </label>)}
  </div></div>
}
