import {TimeInput12} from './TimeInput12'

export function DateTimeInput12({value, onChange, disabled, label}: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  label: string
}) {
  const [date, time = ''] = value.split('T')
  return <span role="group" aria-label={label}>
    <input type="date" aria-label={label + ' date'} value={date} disabled={disabled}
      onChange={event => onChange(event.target.value ? event.target.value + 'T' + time : '')}/>
    <TimeInput12 aria-label={label + ' time'} value={time} disabled={disabled || !date}
      onChange={event => onChange(date + 'T' + event.target.value)}/>
  </span>
}
