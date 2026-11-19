export const workingPositions = ['Server', 'Bartender', 'Host', 'Food Runner', 'Busser', 'Kitchen', 'Manager']

export function workingPositionKey(value: string) {
  const key = value.trim().toLowerCase().replace(/[_-]+/g, ' ')
  if (/\b(waiter|waitress|waitstaff|server)\b/.test(key)) return 'server'
  if (/\bbartend/.test(key)) return 'bartender'
  if (/buss/.test(key) && /runner/.test(key)) return 'busser / food runner'
  if (/runner/.test(key)) return 'food runner'
  if (/buss/.test(key)) return 'busser'
  if (/host/.test(key)) return 'host'
  if (/kitchen|cook|chef/.test(key)) return 'kitchen'
  if (/manager|management|owner/.test(key)) return 'manager'
  return key
}

export function taskPositionMatches(preset: string, position: string) {
  const group = workingPositionKey(preset)
  const staff = workingPositionKey(position)
  return group === 'general' || group === staff
    || (group === 'busser / food runner' && ['busser', 'food runner'].includes(staff))
    || (staff === 'busser / food runner' && ['busser', 'food runner'].includes(group))
}

export function workingPositionChoices(current: string) {
  if (!current || workingPositions.includes(current)) return workingPositions
  return [...workingPositions, current]
}
