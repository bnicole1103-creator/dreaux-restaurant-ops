const clockPattern = /^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/
const timestampPattern = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/

export function time12(value: string | null | undefined) {
  if (!value) return 'Time not set'
  const match = clockPattern.exec(value.trim())
  if (!match) return value
  const hour = Number(match[1])
  return `${hour % 12 || 12}:${match[2]} ${hour >= 12 ? 'PM' : 'AM'}`
}

export function displayReportTime(value: string) {
  if (!timestampPattern.test(value)) return time12(value)
  // A timestamp without an offset is a local wall clock, not a UTC instant.
  if (!/(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(value)) {
    return value.slice(0, 10) + ' · ' + time12(value.slice(11))
  }
  const instant = new Date(value)
  return Number.isNaN(instant.getTime()) ? value :
    instant.toLocaleString('en-US', {timeZone: 'America/Chicago', hour12: true})
}
