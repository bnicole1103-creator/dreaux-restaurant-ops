import type { KeyboardEvent } from 'react'
import './WorkflowTabs.css'
export type WorkflowTab = { key: string; label: string }
export function WorkflowTabs({ id, label, tabs, active, onChange, disabled = false }: { id: string; label: string; tabs: WorkflowTab[]; active: string; onChange: (key: string) => void; disabled?: boolean }) {
  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1
    if (next < 0 || disabled) return
    event.preventDefault(); onChange(tabs[next].key)
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
  }
  return <div className="workflow-tabs" role="tablist" aria-label={label}>{tabs.map((tab, index) => <button key={tab.key} id={`${id}-${tab.key}-tab`} role="tab" type="button" aria-selected={active === tab.key} aria-controls={`${id}-${tab.key}-panel`} tabIndex={active === tab.key ? 0 : -1} disabled={disabled} onClick={() => onChange(tab.key)} onKeyDown={event => move(event, index)}>{tab.label}</button>)}</div>
}
