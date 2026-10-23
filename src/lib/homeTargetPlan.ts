export function homeTargetPlan(target: number | null, hours: number | null, spend: string) {
  if (target === null || !Number.isFinite(target) || target < 0) return null
  const cents = Math.round(target * 100)
  const enteredSpend = spend.trim() === '' ? NaN : Number(spend)
  const spendCents = Number.isFinite(enteredSpend) && enteredSpend > 0 ? Math.round(enteredSpend * 100) : 0
  return {
    hourly: hours !== null && Number.isFinite(hours) && hours > 0 ? Math.ceil(cents / hours) / 100 : null,
    guests: spendCents > 0 ? Math.ceil(cents / spendCents) : null,
    spend: spendCents > 0 ? spendCents / 100 : null,
  }
}
