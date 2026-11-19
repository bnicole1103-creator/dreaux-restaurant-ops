import { TimeInput12 } from './TimeInput12'

export function DateTimeInput12({ value, onChange, disabled, label }: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  label: string
}) {
  const [date, time = ''] = value.split('T')

  function change(nextDate: string, nextTime: string) {
    onChange(nextDate || nextTime ? `${nextDate}T${nextTime}` : '')
  }

  return <span role="group" aria-label={label}>
    <input type="date" aria-label={label + ' date'} value={date} disabled={disabled}
      onChange={event => change(event.target.value, time)} />
    <TimeInput12 aria-label={label + ' time'} value={time} disabled={disabled}
      onChange={event => change(date, event.target.value)} />
  </span>
}
