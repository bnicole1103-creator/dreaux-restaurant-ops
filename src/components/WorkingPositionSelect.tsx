import { workingPositionChoices } from '../lib/workingPositions'

export function WorkingPositionSelect({ value, onChange }: {
  value:string
  onChange:(value:string)=>void
}) {
  return <select value={value} onChange={event=>onChange(event.target.value)}>
    {!value&&<option value="">Choose position</option>}
    {workingPositionChoices(value).map(position=><option key={position}>{position}</option>)}
  </select>
}
