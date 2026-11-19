export function targetFromPoolShare(pool: number, entered: string) {
  const value = entered.trim()
  if (!/^\d{1,3}(?:\.\d{0,2})?$/.test(value) || Number(value) > 100 || !Number.isFinite(pool) || pool <= 0) return null
  return Math.round(pool * Number(value)) / 100
}
